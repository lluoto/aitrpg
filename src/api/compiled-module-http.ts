import { prepareCompiler, resolveCompiler } from "../compiler/compiler-api";
import type { CompilerArtifactEnvelope } from "../compiler/compiler-artifact";
import { projectResolvedCompilerArtifact, type ModuleDataPresentationMetadata } from "../compiler/compiler-module-data-projection";
import type { ModuleCompileHints } from "../compiler/compiler-question-queue";
import type { GameSession } from "./game-session";
import { validateCompiledModuleBundle } from "./compiled-module-bundle";

/** One mebibyte for compiler PDFs and JSON, enforced before and after body decoding. */
export const COMPILER_HTTP_BODY_LIMIT_BYTES = 1024 * 1024;

type JsonRecord = Record<string, unknown>;
type ErrorStage = "prepare" | "resolve" | "project" | "session";
type SessionLike = Pick<GameSession, "loadCompiledModule" | "getCharacterSummary" | "getSummary" | "getCompiledMechanicsState">;

export interface CompiledModuleHttpDependencies {
  createSession(id: string, archetype: string, characterName: string, persona: { personality?: string; backstory?: string; currentGoal?: string }): SessionLike;
  hasSession(id: string): boolean;
  registerSession(id: string, session: SessionLike): void;
  persistSession(id: string, session: SessionLike): void;
  generateId(): string;
  logError?(error: unknown): void;
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
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > COMPILER_HTTP_BODY_LIMIT_BYTES)) return refusal(stage, "BODY_TOO_LARGE", "request body exceeds the compiler HTTP limit", 413);
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    return bytes.length > COMPILER_HTTP_BODY_LIMIT_BYTES ? refusal(stage, "BODY_TOO_LARGE", "request body exceeds the compiler HTTP limit", 413) : bytes;
  } catch {
    return refusal(stage, "REQUEST_BODY_INVALID", "request body could not be read", 400);
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

async function prepare(req: Request): Promise<Response> {
  if (contentType(req) !== "application/pdf") return refusal("prepare", "CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/pdf", 415);
  const moduleId = new URL(req.url).searchParams.get("moduleId")?.trim();
  if (!moduleId) return refusal("prepare", "MODULE_ID_REQUIRED", "moduleId is required", 400);
  const bytes = await bodyBytes(req, "prepare");
  if (bytes instanceof Response) return bytes;
  if (bytes.length === 0) return refusal("prepare", "PDF_EMPTY", "PDF bytes must be non-empty", 400);
  try {
    const result = await prepareCompiler({ kind: "pdf_bytes", moduleId, pdfBytes: bytes });
    return result.status === "refused" ? downstream("prepare", result) : json(result, 201);
  } catch (error) {
    return refusal("prepare", "PREPARE_INTERNAL", "compiler preparation failed", 500);
  }
}

async function resolve(req: Request): Promise<Response> {
  if (contentType(req) !== "application/json") return refusal("resolve", "CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/json", 415);
  const body = await jsonBody(req, "resolve");
  if (body instanceof Response) return body;
  if (!hasOnlyKeys(body, ["preparedArtifact", "preparedQueueHash", "hints", "presentation"]) || !("preparedArtifact" in body) || typeof body.preparedQueueHash !== "string" || !isRecord(body.hints) || !isRecord(body.presentation)) return refusal("resolve", "REQUEST_SHAPE_INVALID", "resolve requires preparedArtifact, preparedQueueHash, hints, and presentation", 400);
  if (!isPresentationMetadata(body.presentation)) return refusal("project", "PRESENTATION_METADATA_INVALID", "presentation metadata has an invalid shape", 422);
  try {
    const result = resolveCompiler(body.preparedArtifact as CompilerArtifactEnvelope, body.preparedQueueHash, body.hints as unknown as ModuleCompileHints);
    if (result.status === "refused") return downstream("resolve", result);
    const projection = projectResolvedCompilerArtifact(result.artifact.payload as any, body.presentation as unknown as ModuleDataPresentationMetadata);
    if (projection.status === "refused") return downstream("project", projection);
    return json({ status: "resolved", identity: result.identity, artifact: result.artifact, projection });
  } catch (error) {
    return refusal("resolve", "REQUEST_SHAPE_INVALID", "resolve request contains invalid nested data", 400);
  }
}

async function createSession(req: Request, dependencies: CompiledModuleHttpDependencies): Promise<Response> {
  if (contentType(req) !== "application/json") return refusal("session", "CONTENT_TYPE_UNSUPPORTED", "Content-Type must be application/json", 415);
  const body = await jsonBody(req, "session");
  if (body instanceof Response) return body;
  if (!hasOnlyKeys(body, ["resolvedArtifact", "projection", "archetype", "characterName", "personality", "backstory", "currentGoal"]) || !("resolvedArtifact" in body) || !("projection" in body) || typeof body.archetype !== "string" || !body.archetype.trim() || typeof body.characterName !== "string" || !body.characterName.trim() || ["personality", "backstory", "currentGoal"].some((key) => body[key] !== undefined && typeof body[key] !== "string")) return refusal("session", "REQUEST_SHAPE_INVALID", "compiled session requires resolvedArtifact, projection, archetype, and characterName", 400);
  const bundle = validateCompiledModuleBundle(body.resolvedArtifact, body.projection);
  if (bundle.status === "refused") return downstream("session", bundle);
  let id = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const candidate = dependencies.generateId();
    if (!dependencies.hasSession(candidate)) { id = candidate; break; }
  }
  if (!id) return refusal("session", "SESSION_ID_COLLISION", "could not allocate a session ID", 409);
  try {
    const session = dependencies.createSession(id, body.archetype, body.characterName, { personality: body.personality as string | undefined, backstory: body.backstory as string | undefined, currentGoal: body.currentGoal as string | undefined });
    const loaded = session.loadCompiledModule(bundle.payload, bundle.projection);
    if (loaded.status === "refused") return refusal("session", loaded.code, loaded.message, loaded.code === "COMPILED_SESSION_CONFLICT" ? 409 : 422);
    dependencies.registerSession(id, session);
    dependencies.persistSession(id, session);
    return json({ sessionId: id, character: session.getCharacterSummary(), summary: session.getSummary(), compiled: loaded.compiled }, 201);
  } catch (error) {
    dependencies.logError?.(error);
    return refusal("session", "SESSION_INTERNAL", "compiled session could not be created", 500);
  }
}

/** Route core with injected mutable server dependencies; it never starts a server or owns session state. */
export async function handleCompiledModuleHttpRequest(req: Request, dependencies: CompiledModuleHttpDependencies): Promise<Response | null> {
  const url = new URL(req.url);
  if (req.method !== "POST") return null;
  if (url.pathname === "/api/compiler/prepare") return prepare(req);
  if (url.pathname === "/api/compiler/resolve") return resolve(req);
  if (url.pathname === "/api/sessions/compiled") return createSession(req, dependencies);
  return null;
}
