import { prepareCompiler, resolveCompiler } from "../compiler/compiler-api";
import type { CompilerArtifactEnvelope } from "../compiler/compiler-artifact";
import { projectResolvedCompilerArtifact, type ModuleDataPresentationMetadata } from "../compiler/compiler-module-data-projection";
import type { ModuleCompileHints } from "../compiler/compiler-question-queue";
import type { GameSession } from "./game-session";
import { validateCompiledModuleBundle } from "./compiled-module-bundle";
import { CompilerArtifactCatalog, type CatalogRefusalCode } from "../compiler/compiler-artifact-catalog";
import { CharacterFactory } from "../character/character-factory";

/** One mebibyte for compiler PDFs and JSON, enforced before and after body decoding. */
export const COMPILER_HTTP_BODY_LIMIT_BYTES = 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type ErrorStage = "prepare" | "resolve" | "project" | "session";
type SessionLike = Pick<GameSession, "loadCompiledModule" | "getCharacterSummary" | "getSummary" | "getCompiledMechanicsState">;

export interface CompiledModuleHttpDependencies {
  createSession(id: string, archetype: string, characterName: string, persona: { personality?: string; backstory?: string; currentGoal?: string }): SessionLike;
  hasSession(id: string): boolean;
  registerSession(id: string, session: SessionLike): void;
  unregisterSession?(id: string): void;
  persistSession(id: string, session: SessionLike, bundleId: string): void;
  hasDurableSession?(id: string): boolean;
  rollbackSessionStorage?(id: string): void;
  generateId(): string;
  logError?(error: unknown): void;
  catalog?: CompilerArtifactCatalog;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function refusal(stage: ErrorStage, code: string, message: string, status: number, causeCode?: string): Response {
  return json({ error: { stage, code, message, ...(causeCode ? { causeCode } : {}) } }, status);
}

function contentType(req: Request): string {
  return (req.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

async function bodyBytes(req: Request, stage: ErrorStage): Promise<Uint8Array | Response> {
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return refusal(stage, "CONTENT_LENGTH_INVALID", "Content-Length must be a non-negative integer", 400);
    if (BigInt(declared) > BigInt(COMPILER_HTTP_BODY_LIMIT_BYTES)) return refusal(stage, "BODY_TOO_LARGE", "request body exceeds the compiler HTTP limit", 413);
  }
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const next = total + value.byteLength;
      if (next > COMPILER_HTTP_BODY_LIMIT_BYTES) {
        await reader.cancel();
        return refusal(stage, "BODY_TOO_LARGE", "request body exceeds the compiler HTTP limit", 413);
      }
      chunks.push(value);
      total = next;
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } catch {
    try { await reader.cancel(); } catch { /* best-effort cancellation after a failed stream */ }
    return refusal(stage, "REQUEST_BODY_INVALID", "request body could not be read", 400);
  } finally {
    reader.releaseLock();
  }
}

async function jsonBody(req: Request, stage: ErrorStage): Promise<JsonRecord | Response> {
  const bytes = await bodyBytes(req, stage);
  if (bytes instanceof Response) return bytes;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isRecord(value) ? value : refusal(stage, "REQUEST_SHAPE_INVALID", "request body must be a JSON object", 400);
  } catch {
    return refusal(stage, "JSON_INVALID", "request body must be valid JSON", 400);
  }
}

function hasOnlyKeys(body: JsonRecord, keys: readonly string[]): boolean {
  return Object.keys(body).every((key) => keys.includes(key));
}

function isPresentationMetadata(value: JsonRecord): boolean {
  if (!isRecord(value.module) || !isRecord(value.scenes) || !isRecord(value.connections) || !isRecord(value.clues) || !isRecord(value.endings)) return false;
  const module = value.module;
  if (["title", "version", "ruleset", "era", "summary", "playerCount", "expectedDuration"].some((key) => typeof module[key] !== "string") || !Array.isArray(module.triggerWarnings) || !module.triggerWarnings.every((entry) => typeof entry === "string")) return false;
  return Object.values(value.scenes).every((entry) => isRecord(entry) && typeof entry.description === "string")
    && Object.values(value.connections).every((entry) => isRecord(entry) && typeof entry.condition === "string")
    && Object.values(value.clues).every((entry) => isRecord(entry) && Array.isArray(entry.findMethods) && typeof entry.revelation === "string" && Array.isArray(entry.unlocks) && typeof entry.importance === "string")
    && Object.values(value.endings).every((entry) => isRecord(entry) && typeof entry.name === "string" && typeof entry.description === "string" && Array.isArray(entry.conditions) && entry.conditions.every((condition) => typeof condition === "string"));
}

function downstream(stage: ErrorStage, result: { code: string; message: string; artifactCode?: string; causeCode?: string }): Response {
  return refusal(stage, result.code, result.message, 422, result.causeCode ?? result.artifactCode);
}

function catalogFailure(stage: ErrorStage, result: { status: "refused"; code: CatalogRefusalCode; message: string }): Response {
  const status = result.code === "CATALOG_ID_INVALID" ? 400 : result.code === "CATALOG_NOT_FOUND" ? 404 : result.code === "CATALOG_CORRUPT" || result.code === "CATALOG_INCOMPATIBLE" ? 409 : result.code === "CATALOG_QUOTA_EXCEEDED" || result.code === "CATALOG_ID_COLLISION" ? 409 : 500;
  return refusal(stage, result.code, result.message, status);
}

async function prepare(req: Request, catalog: CompilerArtifactCatalog, logError?: (error: unknown) => void): Promise<Response> {
  if (contentType(req) !== "application/pdf") return refusal("prepare", "CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/pdf", 415);
  const moduleId = new URL(req.url).searchParams.get("moduleId")?.trim();
  if (!moduleId) return refusal("prepare", "MODULE_ID_REQUIRED", "moduleId is required", 400);
  const bytes = await bodyBytes(req, "prepare");
  if (bytes instanceof Response) return bytes;
  if (bytes.length === 0) return refusal("prepare", "PDF_EMPTY", "PDF bytes must be non-empty", 400);
  try {
    const result = await prepareCompiler({ kind: "pdf_bytes", moduleId, pdfBytes: bytes });
    if (result.status === "refused") return downstream("prepare", result);
    const saved = catalog.savePrepared(result.artifact);
    return saved.status === "refused" ? catalogFailure("prepare", saved) : json({ ...result, preparedArtifactId: saved.value.id }, 201);
  } catch (error) {
    logError?.(error);
    return refusal("prepare", "PREPARE_INTERNAL", "compiler preparation failed", 500);
  }
}

async function resolve(req: Request, catalog: CompilerArtifactCatalog, logError?: (error: unknown) => void): Promise<Response> {
  if (contentType(req) !== "application/json") return refusal("resolve", "CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/json", 415);
  const body = await jsonBody(req, "resolve");
  if (body instanceof Response) return body;
  if (!hasOnlyKeys(body, ["preparedArtifact", "preparedArtifactId", "preparedQueueHash", "hints", "presentation"]) || (("preparedArtifact" in body) === ("preparedArtifactId" in body)) || typeof body.preparedQueueHash !== "string" || !isRecord(body.hints) || !isRecord(body.presentation) || ("preparedArtifactId" in body && typeof body.preparedArtifactId !== "string")) return refusal("resolve", "REQUEST_SHAPE_INVALID", "resolve requires exactly one preparedArtifact or preparedArtifactId plus preparedQueueHash, hints, and presentation", 400);
  if (!isPresentationMetadata(body.presentation)) return refusal("project", "PRESENTATION_METADATA_INVALID", "presentation metadata has an invalid shape", 422);
  try {
    const prepared = "preparedArtifactId" in body ? catalog.loadPrepared(body.preparedArtifactId as string) : null;
    if (prepared?.status === "refused") return catalogFailure("resolve", prepared);
    const result = resolveCompiler((prepared?.status === "ok" ? prepared.value.artifact : body.preparedArtifact) as CompilerArtifactEnvelope, body.preparedQueueHash, body.hints as unknown as ModuleCompileHints);
    if (result.status === "refused") return downstream("resolve", result);
    const projection = projectResolvedCompilerArtifact(result.artifact.payload as any, body.presentation as unknown as ModuleDataPresentationMetadata);
    if (projection.status === "refused") return downstream("project", projection);
    const saved = catalog.saveBundle(result.artifact, projection);
    return saved.status === "refused" ? catalogFailure("resolve", saved) : json({ status: "resolved", identity: result.identity, artifact: result.artifact, projection, bundleId: saved.value.id });
  } catch (error) {
    logError?.(error);
    return refusal("resolve", "RESOLVE_INTERNAL", "compiler resolution failed", 500);
  }
}

async function createSession(req: Request, dependencies: CompiledModuleHttpDependencies): Promise<Response> {
  if (contentType(req) !== "application/json") return refusal("session", "CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/json", 415);
  const body = await jsonBody(req, "session");
  if (body instanceof Response) return body;
  if (!hasOnlyKeys(body, ["resolvedArtifact", "projection", "bundleId", "archetype", "characterName", "personality", "backstory", "currentGoal"]) || (("bundleId" in body) === ("resolvedArtifact" in body || "projection" in body)) || (("resolvedArtifact" in body) !== ("projection" in body)) || ("bundleId" in body && typeof body.bundleId !== "string") || typeof body.archetype !== "string" || !body.archetype.trim() || typeof body.characterName !== "string" || !body.characterName.trim() || ["personality", "backstory", "currentGoal"].some((key) => body[key] !== undefined && typeof body[key] !== "string")) return refusal("session", "REQUEST_SHAPE_INVALID", "compiled session requires bundleId or resolvedArtifact plus projection, archetype, and characterName", 400);
  const archetype = body.archetype.trim();
  const characterName = body.characterName.trim();
  if (!CharacterFactory.listArchetypes("cosmic-horror").some((candidate) => candidate.id === archetype)) return refusal("session", "ARCHETYPE_UNKNOWN", "compiled session archetype is not available for cosmic-horror", 422);
  const catalog = dependencies.catalog ?? defaultCatalog;
  const supplied = "bundleId" in body ? null : validateCompiledModuleBundle(body.resolvedArtifact, body.projection);
  if (supplied?.status === "refused") return downstream("session", supplied);
  const stored = "bundleId" in body
    ? catalog.loadBundle(body.bundleId as string)
    : (() => {
      const saved = catalog.saveBundle(body.resolvedArtifact, body.projection);
      return saved.status === "ok" ? catalog.loadBundle(saved.value.id) : saved;
    })();
  if (stored.status === "refused") return catalogFailure("session", stored);
  const bundle = supplied?.status === "validated" ? supplied : validateCompiledModuleBundle(stored.value.artifact, stored.value.projection);
  if (bundle.status === "refused") return downstream("session", bundle);
  let id = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = dependencies.generateId();
    if (!dependencies.hasSession(candidate) && !dependencies.hasDurableSession?.(candidate)) { id = candidate; break; }
  }
  if (!id) return refusal("session", "SESSION_ID_COLLISION", "could not allocate a session ID", 409);
  try {
    const session = dependencies.createSession(id, archetype, characterName, { personality: body.personality as string | undefined, backstory: body.backstory as string | undefined, currentGoal: body.currentGoal as string | undefined });
    const loaded = session.loadCompiledModule(bundle.payload, bundle.projection);
    if (loaded.status === "refused") {
      dependencies.rollbackSessionStorage?.(id);
      return refusal("session", loaded.code, loaded.message, loaded.code === "COMPILED_SESSION_CONFLICT" ? 409 : 422);
    }
    dependencies.persistSession(id, session, stored.value.id);
    dependencies.registerSession(id, session);
    return json({ sessionId: id, bundleId: stored.value.id, character: session.getCharacterSummary(), summary: session.getSummary(), compiled: loaded.compiled }, 201);
  } catch (error) {
    dependencies.unregisterSession?.(id);
    try { dependencies.rollbackSessionStorage?.(id); } catch (rollbackError) { dependencies.logError?.(rollbackError); }
    dependencies.logError?.(error);
    return refusal("session", "SESSION_INTERNAL", "compiled session could not be created", 500);
  }
}

/** Route core with injected mutable server dependencies; it never starts a server or owns session state. */
export async function handleCompiledModuleHttpRequest(req: Request, dependencies: CompiledModuleHttpDependencies): Promise<Response | null> {
  const url = new URL(req.url);
  const catalog = dependencies.catalog ?? defaultCatalog;
  if (req.method === "GET" && /^\/api\/compiler\/(artifacts|bundles)\/[^/]+$/.test(url.pathname)) {
    const [, , , kind, id] = url.pathname.split("/");
    const loaded = kind === "artifacts" ? catalog.loadPrepared(id!) : catalog.loadBundle(id!);
    return loaded.status === "refused" ? catalogFailure("resolve", loaded) : json({ stage: kind === "artifacts" ? "prepared" : "bundle", ...loaded.value });
  }
  if (req.method !== "POST") return null;
  if (url.pathname === "/api/compiler/prepare") return prepare(req, catalog, dependencies.logError);
  if (url.pathname === "/api/compiler/resolve") return resolve(req, catalog, dependencies.logError);
  if (url.pathname === "/api/sessions/compiled") return createSession(req, dependencies);
  return null;
}

const defaultCatalog = new CompilerArtifactCatalog();
