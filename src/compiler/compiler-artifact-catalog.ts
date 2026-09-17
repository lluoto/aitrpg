import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync, linkSync } from "fs";
import { join, resolve } from "path";
import { randomBytes } from "crypto";
import { restoreCompilerArtifact, type CompilerArtifactEnvelope, type PreparedCompilerArtifactIdentity, type ResolvedCompilerArtifactIdentity } from "./compiler-artifact";
import { sha256 } from "../ingest/document-ir";
import { validateCompiledModuleBundle } from "../api/compiled-module-bundle";
import type { CompilerModuleDataProjection } from "./compiler-module-data-projection";

export const COMPILER_ARTIFACT_CATALOG_SCHEMA_VERSION = "1.0.0";
export const COMPILER_ARTIFACT_CATALOG_ID_LENGTH = 24;
export const COMPILER_ARTIFACT_CATALOG_ID_PATTERN = /^[a-z2-7]{24}$/;

type CatalogStage = "prepared" | "bundle";
type CatalogRecord = Record<string, unknown>;

export interface CompilerArtifactCatalogFileOps {
  mkdir(path: string): void;
  open(path: string): number;
  write(fd: number, value: string): void;
  flush(fd: number): void;
  close(fd: number): void;
  publish(tempPath: string, targetPath: string): void;
  remove(path: string): void;
  read(path: string): string;
  list(path: string): string[];
  exists(path: string): boolean;
  isRegularFile(path: string): boolean;
  isSafeDirectory(path: string): boolean;
}

export const compilerArtifactCatalogNodeFileOps: CompilerArtifactCatalogFileOps = {
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  open: (path) => openSync(path, "wx", 0o600),
  write: (fd, value) => { writeSync(fd, value, undefined, "utf8"); },
  flush: (fd) => fsyncSync(fd),
  close: (fd) => closeSync(fd),
  // link is no-clobber, unlike rename on Windows; remove only the private temp after publication.
  publish: (tempPath, targetPath) => { linkSync(tempPath, targetPath); unlinkSync(tempPath); },
  remove: (path) => unlinkSync(path),
  read: (path) => readFileSync(path, "utf8"),
  list: (path) => readdirSync(path),
  exists: (path) => existsSync(path),
  isRegularFile: (path) => lstatSync(path).isFile(),
  isSafeDirectory: (path) => lstatSync(path).isDirectory(),
};

export interface CompilerArtifactCatalogOptions {
  root?: string;
  maxEntries?: number;
  maxBytes?: number;
  now?: () => string;
  generateId?: () => string;
  fileOps?: CompilerArtifactCatalogFileOps;
}

export type CatalogRefusalCode = "CATALOG_ID_INVALID" | "CATALOG_NOT_FOUND" | "CATALOG_CORRUPT" | "CATALOG_INCOMPATIBLE" | "CATALOG_QUOTA_EXCEEDED" | "CATALOG_ID_COLLISION" | "CATALOG_STORAGE_FAILED";
export type CatalogResult<T> = { status: "ok"; value: T } | { status: "refused"; code: CatalogRefusalCode; message: string };

export interface PreparedCatalogMetadata { id: string; createdAt: string; artifactHash: string; identity: PreparedCompilerArtifactIdentity; }
export interface BundleCatalogMetadata { id: string; createdAt: string; artifactHash: string; identity: ResolvedCompilerArtifactIdentity; mechanicsHash: string; bundleHash: string; }
export interface LoadedPreparedCatalogEntry extends PreparedCatalogMetadata { artifact: CompilerArtifactEnvelope; }
export interface LoadedBundleCatalogEntry extends BundleCatalogMetadata { artifact: CompilerArtifactEnvelope; projection: CompilerModuleDataProjection; }

interface PreparedCatalogEnvelope extends PreparedCatalogMetadata { schemaVersion: typeof COMPILER_ARTIFACT_CATALOG_SCHEMA_VERSION; stage: "prepared"; artifact: CompilerArtifactEnvelope; }
interface BundleCatalogEnvelope extends BundleCatalogMetadata { schemaVersion: typeof COMPILER_ARTIFACT_CATALOG_SCHEMA_VERSION; stage: "bundle"; artifact: CompilerArtifactEnvelope; projection: CompilerModuleDataProjection; }

const DEFAULT_ROOT = join("data", "compiler-catalog");
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const processLocks = new Set<string>();

function isRecord(value: unknown): value is CatalogRecord { return !!value && typeof value === "object" && !Array.isArray(value); }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("catalog JSON contains a non-finite number"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("catalog JSON contains a non-plain value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function bundleIdentity(value: Omit<BundleCatalogEnvelope, "bundleHash"> | BundleCatalogEnvelope): string {
  const { bundleHash: _bundleHash, ...unsigned } = value as BundleCatalogEnvelope;
  return sha256(canonicalJson(unsigned));
}
function validId(id: string): boolean { return COMPILER_ARTIFACT_CATALOG_ID_PATTERN.test(id); }
function stableRefusal(code: CatalogRefusalCode, message: string): CatalogResult<never> { return { status: "refused", code, message }; }
function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

/** Immutable local storage for already validated compiler artifacts; reads always replay validation. */
export class CompilerArtifactCatalog {
  readonly root: string;
  private readonly preparedRoot: string;
  private readonly bundleRoot: string;
  private readonly ops: CompilerArtifactCatalogFileOps;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly now: () => string;
  private readonly generateId: () => string;
  private readonly deterministicIds: boolean;

  constructor(options: CompilerArtifactCatalogOptions = {}) {
    this.root = resolve(options.root ?? process.env.COMPILER_CATALOG_ROOT ?? DEFAULT_ROOT);
    this.preparedRoot = join(this.root, "prepared");
    this.bundleRoot = join(this.root, "bundles");
    this.ops = options.fileOps ?? compilerArtifactCatalogNodeFileOps;
    this.maxEntries = options.maxEntries ?? Number(process.env.COMPILER_CATALOG_MAX_ENTRIES ?? DEFAULT_MAX_ENTRIES);
    this.maxBytes = options.maxBytes ?? Number(process.env.COMPILER_CATALOG_MAX_BYTES ?? DEFAULT_MAX_BYTES);
    this.now = options.now ?? (() => new Date().toISOString());
    this.deterministicIds = !options.generateId;
    this.generateId = options.generateId ?? (() => randomBytes(24).toString("base64").replace(/[0189+=/]/g, "").slice(0, COMPILER_ARTIFACT_CATALOG_ID_LENGTH).toLowerCase());
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 0 || !Number.isSafeInteger(this.maxBytes) || this.maxBytes < 0) throw new Error("catalog quotas must be non-negative safe integers");
  }

  savePrepared(artifactValue: unknown): CatalogResult<PreparedCatalogMetadata> {
    let artifact: CompilerArtifactEnvelope;
    try {
      const restored = restoreCompilerArtifact(artifactValue as CompilerArtifactEnvelope);
      if (restored.status === "refused" || restored.stage !== "prepared") return stableRefusal("CATALOG_INCOMPATIBLE", "prepared catalog entry requires a valid prepared artifact");
      artifact = clone(artifactValue as CompilerArtifactEnvelope);
    } catch { return stableRefusal("CATALOG_INCOMPATIBLE", "prepared catalog entry requires a valid prepared artifact"); }
    const id = this.newId(`prepared:${artifact.artifactHash}`);
    if (!id) return stableRefusal("CATALOG_ID_COLLISION", "could not allocate an immutable catalog ID");
    const envelope: PreparedCatalogEnvelope = { schemaVersion: COMPILER_ARTIFACT_CATALOG_SCHEMA_VERSION, stage: "prepared", id, createdAt: this.now(), artifactHash: artifact.artifactHash, identity: clone(artifact.payload.identity as PreparedCompilerArtifactIdentity), artifact };
    return this.publish("prepared", id, envelope, (existing) => isRecord(existing) && existing.artifactHash === envelope.artifactHash) as CatalogResult<PreparedCatalogMetadata>;
  }

  saveBundle(artifactValue: unknown, projectionValue: unknown): CatalogResult<BundleCatalogMetadata> {
    const validated = validateCompiledModuleBundle(artifactValue, projectionValue);
    if (validated.status === "refused") return stableRefusal("CATALOG_INCOMPATIBLE", validated.message);
    const id = this.newId(`bundle:${validated.artifactHash}:${canonicalJson(validated.projection)}`);
    if (!id) return stableRefusal("CATALOG_ID_COLLISION", "could not allocate an immutable catalog ID");
    const artifact = clone(artifactValue as CompilerArtifactEnvelope);
    const envelope: BundleCatalogEnvelope = { schemaVersion: COMPILER_ARTIFACT_CATALOG_SCHEMA_VERSION, stage: "bundle", id, createdAt: this.now(), artifactHash: validated.artifactHash, identity: clone(validated.payload.identity), mechanicsHash: validated.payload.identity.mechanicsHash, artifact, projection: clone(validated.projection), bundleHash: "" };
    envelope.bundleHash = bundleIdentity(envelope);
    return this.publish("bundle", id, envelope, (existing) => isRecord(existing) && existing.artifactHash === envelope.artifactHash && this.equal(existing.projection, envelope.projection)) as CatalogResult<BundleCatalogMetadata>;
  }

  loadPrepared(id: string): CatalogResult<LoadedPreparedCatalogEntry> { return this.load("prepared", id) as CatalogResult<LoadedPreparedCatalogEntry>; }
  loadBundle(id: string): CatalogResult<LoadedBundleCatalogEntry> { return this.load("bundle", id) as CatalogResult<LoadedBundleCatalogEntry>; }

  private newId(seed: string): string | null {
    if (this.deterministicIds) return sha256(seed).slice(0, COMPILER_ARTIFACT_CATALOG_ID_LENGTH).replace(/[0-9a-f]/g, (character) => "234567abcdefghijkl"[parseInt(character, 16)]!);
    for (let attempt = 0; attempt < 8; attempt++) { const id = this.generateId(); if (validId(id)) return id; }
    return null;
  }
  private directory(stage: CatalogStage): string { return stage === "prepared" ? this.preparedRoot : this.bundleRoot; }
  private path(stage: CatalogStage, id: string): string { return join(this.directory(stage), `${id}.json`); }
  private safeRoot(): boolean { return this.ops.exists(this.root) && this.ops.isSafeDirectory(this.root); }
  private safeDirectory(stage: CatalogStage): boolean { return this.ops.exists(this.directory(stage)) && this.ops.isSafeDirectory(this.directory(stage)); }
  private metadata(envelope: PreparedCatalogEnvelope | BundleCatalogEnvelope): PreparedCatalogMetadata | BundleCatalogMetadata {
    const { schemaVersion: _schemaVersion, stage: _stage, artifact: _artifact, projection: _projection, ...metadata } = envelope as BundleCatalogEnvelope;
    return clone(metadata);
  }
  private equal(left: unknown, right: unknown): boolean { return canonicalJson(left) === canonicalJson(right); }
  private usage(): { entries: number; bytes: number } {
    let entries = 0, bytes = 0;
    for (const dir of [this.preparedRoot, this.bundleRoot]) {
      if (!this.ops.exists(dir)) continue;
      if (!this.ops.isSafeDirectory(dir)) throw new Error("catalog stage directory is not a real directory");
      for (const name of this.ops.list(dir)) {
        if (!/^[a-z2-7]{24}\.json$/.test(name)) continue;
        const path = join(dir, name);
        if (!this.ops.isRegularFile(path)) continue;
        entries++; bytes += new TextEncoder().encode(this.ops.read(path)).length;
      }
    }
    return { entries, bytes };
  }
  private publish(stage: CatalogStage, id: string, envelope: PreparedCatalogEnvelope | BundleCatalogEnvelope, same: (existing: unknown) => boolean): CatalogResult<PreparedCatalogMetadata | BundleCatalogMetadata> {
    const lock = this.root;
    if (processLocks.has(lock)) return stableRefusal("CATALOG_STORAGE_FAILED", "catalog publication is already in progress");
    processLocks.add(lock);
    const target = this.path(stage, id), text = `${JSON.stringify(envelope)}\n`, temp = `${target}.${randomBytes(8).toString("hex")}.tmp`;
    let fd: number | undefined;
    try {
      this.ops.mkdir(this.directory(stage));
      if (!this.safeRoot() || !this.safeDirectory(stage)) return stableRefusal("CATALOG_STORAGE_FAILED", "catalog root or stage directory is not a real directory");
      if (this.ops.exists(target)) {
        const existing = JSON.parse(this.ops.read(target));
        return same(existing) ? { status: "ok", value: this.metadata(envelope) } : stableRefusal("CATALOG_ID_COLLISION", "immutable catalog ID already contains different content");
      }
      const usage = this.usage(), bytes = new TextEncoder().encode(text).length;
      if (usage.entries + 1 > this.maxEntries || usage.bytes + bytes > this.maxBytes) return stableRefusal("CATALOG_QUOTA_EXCEEDED", "catalog entry or byte quota would be exceeded");
      fd = this.ops.open(temp); this.ops.write(fd, text); this.ops.flush(fd); this.ops.close(fd); fd = undefined;
      try { this.ops.publish(temp, target); }
      catch (error) {
        if (this.ops.exists(target) && same(JSON.parse(this.ops.read(target)))) return { status: "ok", value: this.metadata(envelope) };
        throw error;
      }
      return { status: "ok", value: this.metadata(envelope) };
    } catch (error) {
      return stableRefusal("CATALOG_STORAGE_FAILED", error instanceof Error ? error.message : "catalog storage failed");
    } finally {
      if (fd !== undefined) try { this.ops.close(fd); } catch { /* preserve the storage failure */ }
      try { this.ops.remove(temp); } catch { /* private temp files are never discoverable catalog entries */ }
      processLocks.delete(lock);
    }
  }
  private load(stage: CatalogStage, id: string): CatalogResult<LoadedPreparedCatalogEntry | LoadedBundleCatalogEntry> {
    if (!validId(id)) return stableRefusal("CATALOG_ID_INVALID", "catalog ID has an invalid alphabet or length");
    const target = this.path(stage, id);
    try {
      if (this.ops.exists(this.root) && !this.safeRoot()) return stableRefusal("CATALOG_CORRUPT", "catalog root is not a real directory");
      if (this.ops.exists(this.directory(stage)) && !this.safeDirectory(stage)) return stableRefusal("CATALOG_CORRUPT", "catalog stage directory is not a real directory");
      if (!this.ops.exists(target)) return stableRefusal("CATALOG_NOT_FOUND", "catalog entry was not found");
      if (!this.ops.isRegularFile(target)) return stableRefusal("CATALOG_CORRUPT", "catalog entry is not a regular file");
      const envelope = JSON.parse(this.ops.read(target)) as unknown;
      if (!isRecord(envelope) || envelope.schemaVersion !== COMPILER_ARTIFACT_CATALOG_SCHEMA_VERSION || envelope.stage !== stage || envelope.id !== id || typeof envelope.createdAt !== "string" || typeof envelope.artifactHash !== "string" || !isRecord(envelope.identity)) return stableRefusal("CATALOG_INCOMPATIBLE", "catalog envelope schema, stage, or ID is invalid");
      if (stage === "prepared") {
        if (!exactKeys(envelope, ["schemaVersion", "stage", "id", "createdAt", "artifactHash", "identity", "artifact"])) return stableRefusal("CATALOG_INCOMPATIBLE", "prepared catalog envelope has unknown or missing fields");
        const restored = restoreCompilerArtifact(envelope.artifact as CompilerArtifactEnvelope);
        if (restored.status === "refused" || restored.stage !== "prepared" || envelope.artifactHash !== restored.artifactHash || !this.equal(envelope.identity, restored.payload.identity)) return stableRefusal("CATALOG_CORRUPT", "prepared catalog entry failed artifact revalidation");
        return { status: "ok", value: clone({ ...this.metadata(envelope as unknown as PreparedCatalogEnvelope), artifact: envelope.artifact }) as LoadedPreparedCatalogEntry };
      }
      const bundle = envelope as unknown as BundleCatalogEnvelope;
      if (!exactKeys(bundle, ["schemaVersion", "stage", "id", "createdAt", "artifactHash", "identity", "mechanicsHash", "artifact", "projection", "bundleHash"]) || typeof bundle.mechanicsHash !== "string") return stableRefusal("CATALOG_INCOMPATIBLE", "bundle catalog envelope has unknown or missing fields");
      if (typeof bundle.bundleHash !== "string" || bundle.bundleHash !== bundleIdentity(bundle) || bundle.mechanicsHash !== (bundle.identity as ResolvedCompilerArtifactIdentity)?.mechanicsHash) return stableRefusal("CATALOG_CORRUPT", "bundle catalog hash or mechanics identity is invalid");
      const validated = validateCompiledModuleBundle(bundle.artifact, bundle.projection);
      if (validated.status === "refused" || validated.artifactHash !== bundle.artifactHash || !this.equal(validated.payload.identity, bundle.identity)) return stableRefusal("CATALOG_CORRUPT", "bundle catalog entry failed artifact or projection revalidation");
      return { status: "ok", value: clone({ ...this.metadata(bundle), artifact: bundle.artifact, projection: bundle.projection }) as LoadedBundleCatalogEntry };
    } catch (error) { return stableRefusal("CATALOG_CORRUPT", error instanceof Error ? error.message : "catalog entry could not be decoded"); }
  }
}
