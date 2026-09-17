import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, openSync, readSync, readdirSync, renameSync, statSync, unlinkSync, writeSync } from "fs";
import { join, resolve } from "path";
import { COC_ATTRIBUTES, SKILL_NAME_MAP } from "../character/coc-character";
import type { ResolvedCompilerArtifactPayload } from "../compiler/compiler-artifact";
import {
  createMechanicsStateBudget,
  executeMechanicsAction,
  initialMechanicsState,
  mechanicsStateHash,
  normalizeMechanicsState,
  settleAutomaticMechanics,
  type MechanicsReachabilityEdge,
  type MechanicsState,
} from "../compiler/mechanics-execution";
import { COMPILER_ARTIFACT_CATALOG_ID_PATTERN } from "../compiler/compiler-artifact-catalog";
import { sha256 } from "../ingest/document-ir";

export const COMPILED_SESSION_SNAPSHOT_SCHEMA_VERSION = "2.0.0";
export const COMPILED_SESSION_COMPONENT_VERSIONS = Object.freeze({ snapshot: "2.0.0", mechanics: "1.0.0", gameSession: "2.0.0" });
export const COMPILED_SESSION_PERSISTED_RESPONSE_SCHEMA_VERSION = "1.0.0";
export const COMPILED_SESSION_HEADER_MAX_BYTES = 4096;
export const COMPILED_SESSION_BODY_MAX_BYTES = 1024 * 1024;
export const COMPILED_SESSION_JSON_MAX_DEPTH = 64;

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export interface CompiledSessionBundleRef {
  id: string;
  moduleId: string;
  artifactHash: string;
  mechanicsHash: string;
  bundleHash: string;
}

export interface PersistedCompiledActionResponse {
  schemaVersion: typeof COMPILED_SESSION_PERSISTED_RESPONSE_SCHEMA_VERSION;
  action: JsonRecord;
  summary: JsonRecord;
  generation: number;
}

export interface CompiledSessionIdempotencyRecord {
  actionId: string;
  input: string;
  requestHash: string;
  expectedGeneration: number;
  generation: number;
  response: PersistedCompiledActionResponse;
}

export interface CompiledSessionSnapshot {
  schemaVersion: typeof COMPILED_SESSION_SNAPSHOT_SCHEMA_VERSION;
  components: typeof COMPILED_SESSION_COMPONENT_VERSIONS;
  sessionId: string;
  bundle: CompiledSessionBundleRef;
  previousSnapshotHash: string | null;
  generation: number;
  timestamps: { createdAt: number; lastActiveAt: number };
  round: number;
  character: { pcId: "p1"; sheet: JsonRecord; sanity: JsonRecord };
  history: JsonValue[];
  state: MechanicsState;
  stateHash: string;
  trace: MechanicsReachabilityEdge[];
  terminal: { id: string; name: string; narration: string } | null;
  idempotency: CompiledSessionIdempotencyRecord[];
  snapshotHash: string;
}

export interface CompiledSessionSnapshotHeader {
  fileName: string;
  sessionId: string;
  bundleId: string;
  snapshotHash: string;
  generation: number;
  bodyBytes: number;
}

export type CompiledSessionSnapshotRefusalCode = "SNAPSHOT_NOT_FOUND" | "SNAPSHOT_CORRUPT" | "SNAPSHOT_INCOMPATIBLE" | "SNAPSHOT_STORAGE_FAILED" | "SNAPSHOT_CONFLICT";
export type CompiledSessionSnapshotResult<T> =
  | { status: "ok"; value: T }
  | { status: "refused"; code: CompiledSessionSnapshotRefusalCode; message: string; sessionId?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactOrOptionalKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("snapshot JSON contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("snapshot JSON contains a non-plain value");
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)) && Object.values(value).every(isJsonValue);
}

function validSessionId(id: unknown): id is string {
  return typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function validNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function validFiniteInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}

function validStringArray(value: unknown, max = 2048): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every((entry) => typeof entry === "string" && entry.length > 0 && entry.length <= 4096);
}

function validState(value: unknown): value is MechanicsState {
  const required = ["currentSceneId", "foundClueIds", "visitedSceneIds", "ownedItemIds", "stateValues", "npcStates", "unlockedConnectionIds", "failureCounts", "startedEncounterIds", "rewardIds"];
  if (!isRecord(value) || !exactKeys(value, value.terminalEndingId === undefined ? required : [...required, "terminalEndingId"])) return false;
  return typeof value.currentSceneId === "string"
    && validStringArray(value.foundClueIds) && validStringArray(value.visitedSceneIds) && validStringArray(value.ownedItemIds)
    && isRecord(value.stateValues) && Object.values(value.stateValues).every((entry) => entry === null || typeof entry === "string" || typeof entry === "boolean" || (typeof entry === "number" && Number.isFinite(entry)))
    && isRecord(value.npcStates) && Object.values(value.npcStates).every((entry) => typeof entry === "string" && entry.length > 0)
    && validStringArray(value.unlockedConnectionIds) && isRecord(value.failureCounts) && Object.values(value.failureCounts).every(validNonNegativeInteger)
    && validStringArray(value.startedEncounterIds) && validStringArray(value.rewardIds)
    && (value.terminalEndingId === undefined || typeof value.terminalEndingId === "string" && value.terminalEndingId.length > 0);
}

function validTrace(value: unknown): value is MechanicsReachabilityEdge[] {
  return Array.isArray(value) && value.length <= 10000 && value.every((edge) => isRecord(edge)
    && exactKeys(edge, ["mechanismId", "mechanismIds", "outcome", "beforeStateHash", "afterStateHash", "sourceInterpretationIds", "summary"])
    && typeof edge.mechanismId === "string" && edge.mechanismId.length > 0
    && validStringArray(edge.mechanismIds) && ["success", "failure", "failback", "traverse", "transition", "ending"].includes(edge.outcome as string)
    && typeof edge.beforeStateHash === "string" && typeof edge.afterStateHash === "string"
    && validStringArray(edge.sourceInterpretationIds) && typeof edge.summary === "string");
}

function validSanity(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !isJsonValue(value)) return false;
  const keys = ["currentSAN", "maxSAN", "temporaryInsanity", "indefiniteInsanity", "indefiniteLevel", "phobias", "manias", "sanLostThisRound", "nightmareStreak", "irreversibleChanges", "therapyProgress", "daysInstitutionalized", "cthulhuMythos", "mythosLog"];
  if (!exactKeys(value, keys) || !validFiniteInteger(value.maxSAN, 1, 100) || !validFiniteInteger(value.currentSAN, 0, value.maxSAN)
    || typeof value.temporaryInsanity !== "boolean" || typeof value.indefiniteInsanity !== "boolean"
    || !(value.indefiniteLevel === null || ["mild", "moderate", "severe"].includes(value.indefiniteLevel as string))
    || !validStringArray(value.phobias, 32) || !validStringArray(value.manias, 32) || !validStringArray(value.irreversibleChanges, 32)
    || !["sanLostThisRound", "nightmareStreak", "therapyProgress", "daysInstitutionalized", "cthulhuMythos"].every((key) => validFiniteInteger(value[key], 0, key === "cthulhuMythos" ? 99 : 1000000))
    || !Array.isArray(value.mythosLog) || value.mythosLog.length > 1024) return false;
  return value.mythosLog.every((entry) => isRecord(entry) && exactKeys(entry, ["source", "gain", "maxSanLoss"])
    && typeof entry.source === "string" && entry.source.length > 0 && entry.source.length <= 4096
    && validFiniteInteger(entry.gain, 1, 99) && validFiniteInteger(entry.maxSanLoss, 1, 99));
}

const PERSISTED_CHARACTER_KEYS = ["name", "archetypeId", "attributes", "luck", "hp", "maxHp", "ac", "damageBonus", "build", "move", "creditRating", "startingItems", "occupationSkillPoints", "interestSkillPoints", "occupationSkills", "availableSkills", "age", "valid", "warnings", "cthulhuMythos", "skillValues"] as const;
const COC_SKILL_KEYS = [...new Set(Object.values(SKILL_NAME_MAP))].sort();

function validCharacterSheet(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !isJsonValue(value) || !exactKeys(value, PERSISTED_CHARACTER_KEYS)) return false;
  const attributes = value.attributes as Record<string, unknown>;
  const skillValues = value.skillValues as Record<string, unknown>;
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 256 || typeof value.archetypeId !== "string" || value.archetypeId.length < 1 || value.archetypeId.length > 128
    || !isRecord(attributes) || !exactKeys(attributes, COC_ATTRIBUTES) || !COC_ATTRIBUTES.every((attribute) => validFiniteInteger(attributes[attribute], 1, 100))
    || !isRecord(skillValues) || !exactKeys(skillValues, COC_SKILL_KEYS) || !COC_SKILL_KEYS.every((skill) => validFiniteInteger(skillValues[skill], 0, 100))
    || !["luck", "hp", "maxHp", "ac", "build", "move", "creditRating", "occupationSkillPoints", "interestSkillPoints", "age", "cthulhuMythos"].every((key) => validFiniteInteger(value[key], 0, 1000000))
    || !validStringArray(value.startingItems, 128) || !validStringArray(value.occupationSkills, 128) || !validStringArray(value.availableSkills, 128) || !validStringArray(value.warnings, 128)
    || typeof value.damageBonus !== "string" || typeof value.valid !== "boolean") return false;
  return (value.hp as number) <= (value.maxHp as number) && (value.cthulhuMythos as number) <= 99;
}

function validHistory(value: unknown): value is JsonValue[] {
  const messageKeys = ["speaker", "content", "type", "verbatim", "mood", "visible_to", "timestamp", "visibility", "discoverer"];
  return Array.isArray(value) && value.length <= 100000 && value.every((message) => isRecord(message)
    && Object.keys(message).every((key) => messageKeys.includes(key))
    && typeof message.speaker === "string" && typeof message.content === "string"
    && ["dialogue", "narration", "system", "action"].includes(message.type as string)
    && (message.verbatim === undefined || typeof message.verbatim === "boolean")
    && (message.mood === undefined || ["neutral", "friendly", "angry", "fearful", "suspicious", "excited", "sad", "calm"].includes(message.mood as string))
    && (message.visible_to === undefined || validStringArray(message.visible_to, 64))
    && (message.timestamp === undefined || validNonNegativeInteger(message.timestamp))
    && (message.visibility === undefined || ["public", "scene_restricted", "discoverer_only", "targeted", "private"].includes(message.visibility as string))
    && (message.discoverer === undefined || typeof message.discoverer === "string"));
}

function validActionState(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !exactOrOptionalKeys(value, ["scene", "round", "player", "npcs", "monsters", "companions", "party", "gameTime"], ["bgm"])) return false;
  const player = value.player;
  const gameTime = value.gameTime;
  const actor = (entry: unknown): boolean => isRecord(entry) && exactKeys(entry, ["name", "hp", "maxHp", "status"])
    && typeof entry.name === "string" && validFiniteInteger(entry.hp, 0, 1000000) && validFiniteInteger(entry.maxHp, 0, 1000000) && entry.hp <= entry.maxHp && validStringArray(entry.status, 256);
  if (typeof value.scene !== "string" || !validNonNegativeInteger(value.round) || (value.bgm !== undefined && typeof value.bgm !== "string")
    || !isRecord(player) || !exactKeys(player, ["name", "hp", "maxHp", "ac", "status"]) || typeof player.name !== "string" || !validFiniteInteger(player.hp, 0, 1000000) || !validFiniteInteger(player.maxHp, 0, 1000000) || player.hp > player.maxHp || !validFiniteInteger(player.ac, 0, 1000000) || !validStringArray(player.status, 256)
    || !Array.isArray(value.npcs) || !value.npcs.every(actor) || !Array.isArray(value.monsters) || !value.monsters.every(actor)
    || !Array.isArray(value.companions) || value.companions.length !== 0 || !Array.isArray(value.party) || value.party.length !== 1
    || !isRecord(gameTime) || !exactKeys(gameTime, ["day", "period", "label"]) || !validNonNegativeInteger((gameTime as Record<string, unknown>).day) || typeof gameTime.period !== "string" || typeof gameTime.label !== "string") return false;
  const party = value.party[0];
  return isRecord(party) && exactKeys(party, ["pcId", "name", "control", "hp", "maxHp", "status", "san", "maxSan"])
    && party.pcId === "p1" && typeof party.name === "string" && party.control === "auto" && validFiniteInteger(party.hp, 0, 1000000) && validFiniteInteger(party.maxHp, 0, 1000000) && party.hp <= party.maxHp && validStringArray(party.status, 256) && validFiniteInteger(party.san, 0, 100) && validFiniteInteger(party.maxSan, 1, 100) && party.san <= party.maxSan;
}

function validPersistedCompiledAction(value: unknown): value is JsonRecord {
  if (!isRecord(value) || !exactOrOptionalKeys(value, ["narrative", "events", "state", "dead", "sanity", "compiled"], ["dice"])) return false;
  if (typeof value.narrative !== "string" || !Array.isArray(value.events) || !value.events.every((event) => isRecord(event) && exactKeys(event, ["speaker", "content", "type"])
    && typeof event.speaker === "string" && typeof event.content === "string" && ["dialogue", "narration", "system", "action"].includes(event.type as string))
    || !validActionState(value.state) || typeof value.dead !== "boolean" || !isRecord(value.sanity) || !exactKeys(value.sanity, ["currentSAN", "maxSAN", "temporaryInsanity", "indefiniteInsanity", "phobias"])
    || !validFiniteInteger(value.sanity.currentSAN, 0, 100) || !validFiniteInteger(value.sanity.maxSAN, 1, 100) || value.sanity.currentSAN > value.sanity.maxSAN || typeof value.sanity.temporaryInsanity !== "boolean" || typeof value.sanity.indefiniteInsanity !== "boolean" || !validStringArray(value.sanity.phobias, 32)
    || !isRecord(value.compiled) || !exactOrOptionalKeys(value.compiled, ["moduleId", "artifactHash", "mechanicsHash", "state", "stateHash", "trace", "generation"], ["terminalEnding"])
    || typeof value.compiled.moduleId !== "string" || !validHash(value.compiled.artifactHash) || !validHash(value.compiled.mechanicsHash) || !validState(value.compiled.state) || typeof value.compiled.stateHash !== "string" || !validTrace(value.compiled.trace) || !validNonNegativeInteger(value.compiled.generation)) return false;
  return (value.compiled.terminalEnding === undefined || isRecord(value.compiled.terminalEnding) && exactKeys(value.compiled.terminalEnding, ["id", "name", "narration"]) && Object.values(value.compiled.terminalEnding).every((entry) => typeof entry === "string"))
    && (value.dice === undefined || Array.isArray(value.dice) && value.dice.length === 1 && value.dice.every((dice) => isRecord(dice) && exactKeys(dice, ["expr", "total", "detail"]) && dice.expr === "d100" && validFiniteInteger(dice.total, 1, 100) && typeof dice.detail === "string" && dice.detail.length > 0 && dice.detail.length <= 128));
}

function validPersistedResponse(value: unknown): value is PersistedCompiledActionResponse {
  if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "action", "summary", "generation"]) || value.schemaVersion !== COMPILED_SESSION_PERSISTED_RESPONSE_SCHEMA_VERSION || !validNonNegativeInteger(value.generation) || !validPersistedCompiledAction(value.action) || !isRecord(value.summary)) return false;
  const summary = value.summary;
  return exactKeys(summary, ["id", "round", "ruleset", "scene", "playerName", "archetype", "messageCount", "npcCount", "createdAt", "generation"])
    && typeof summary.id === "string" && validNonNegativeInteger(summary.round) && typeof summary.ruleset === "string" && typeof summary.scene === "string" && typeof summary.playerName === "string" && (summary.archetype === null || typeof summary.archetype === "string") && validNonNegativeInteger(summary.messageCount) && validNonNegativeInteger(summary.npcCount) && validNonNegativeInteger(summary.createdAt) && validNonNegativeInteger(summary.generation);
}

function validIdempotency(value: unknown): value is CompiledSessionIdempotencyRecord[] {
  return Array.isArray(value) && value.length <= 100000 && value.every((record) => isRecord(record)
    && exactKeys(record, ["actionId", "input", "requestHash", "expectedGeneration", "generation", "response"])
    && typeof record.actionId === "string" && record.actionId.length > 0 && record.actionId.length <= 256
    && typeof record.input === "string" && record.input.length > 0 && record.input.length <= 16384 && record.input.trim() === record.input
    && validHash(record.requestHash) && validNonNegativeInteger(record.expectedGeneration) && validNonNegativeInteger(record.generation) && validPersistedResponse(record.response));
}

function jsonDepth(value: unknown, depth = 0): number {
  if (depth > COMPILED_SESSION_JSON_MAX_DEPTH) return depth;
  if (Array.isArray(value)) return value.reduce((max, child) => Math.max(max, jsonDepth(child, depth + 1)), depth);
  if (isRecord(value)) return (Object.values(value) as unknown[]).reduce<number>((max, child) => Math.max(max, jsonDepth(child, depth + 1)), depth);
  return depth;
}

function unsignedSnapshot(snapshot: CompiledSessionSnapshot | Record<string, unknown>): Record<string, unknown> {
  const { snapshotHash: _snapshotHash, ...unsigned } = snapshot as CompiledSessionSnapshot;
  return unsigned;
}

export function compiledSessionSnapshotHash(snapshot: CompiledSessionSnapshot | Record<string, unknown>): string {
  return sha256(canonicalJson(unsignedSnapshot(snapshot)));
}

/** Validates the persisted JSON schema before any artifact, world, or session writes. */
export function validateCompiledSessionSnapshot(value: unknown): CompiledSessionSnapshotResult<CompiledSessionSnapshot> {
  try {
    if (jsonDepth(value) > COMPILED_SESSION_JSON_MAX_DEPTH) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot JSON nesting exceeds the storage limit" };
    if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "components", "sessionId", "bundle", "previousSnapshotHash", "generation", "timestamps", "round", "character", "history", "state", "stateHash", "trace", "terminal", "idempotency", "snapshotHash"])) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot has unknown, missing, or incompatible fields" };
    if (value.schemaVersion !== COMPILED_SESSION_SNAPSHOT_SCHEMA_VERSION || !isRecord(value.components) || canonicalJson(value.components) !== canonicalJson(COMPILED_SESSION_COMPONENT_VERSIONS)) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot schema or component version is unsupported" };
    if (!validSessionId(value.sessionId) || !isRecord(value.bundle) || !exactKeys(value.bundle, ["id", "moduleId", "artifactHash", "mechanicsHash", "bundleHash"])
      || typeof value.bundle.id !== "string" || !COMPILER_ARTIFACT_CATALOG_ID_PATTERN.test(value.bundle.id) || typeof value.bundle.moduleId !== "string" || !validHash(value.bundle.artifactHash) || !validHash(value.bundle.mechanicsHash) || !validHash(value.bundle.bundleHash)) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot bundle identity is invalid" };
    if (!(value.previousSnapshotHash === null || validHash(value.previousSnapshotHash)) || !validNonNegativeInteger(value.generation) || (value.generation === 0) !== (value.previousSnapshotHash === null)
      || !isRecord(value.timestamps) || !exactKeys(value.timestamps, ["createdAt", "lastActiveAt"]) || !validNonNegativeInteger(value.timestamps.createdAt) || !validNonNegativeInteger(value.timestamps.lastActiveAt) || !validNonNegativeInteger(value.round)) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot generation, predecessor, timestamps, or round is invalid" };
    if (!isRecord(value.character) || !exactKeys(value.character, ["pcId", "sheet", "sanity"]) || value.character.pcId !== "p1" || !validCharacterSheet(value.character.sheet) || !validSanity(value.character.sanity)) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot requires one complete p1 character and SAN state" };
    if (!validHistory(value.history) || !validState(value.state) || typeof value.stateHash !== "string" || !validTrace(value.trace) || !validIdempotency(value.idempotency)) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot history, state, trace, or idempotency records are invalid" };
    if (value.terminal !== null && (!isRecord(value.terminal) || !exactKeys(value.terminal, ["id", "name", "narration"]) || [value.terminal.id, value.terminal.name, value.terminal.narration].some((entry) => typeof entry !== "string"))) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot terminal identity is invalid" };
    if (!validHash(value.snapshotHash) || value.snapshotHash !== compiledSessionSnapshotHash(value) || value.stateHash !== mechanicsStateHash(value.state)) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: "snapshot hash or mechanics state hash does not match" };
    if (canonicalJson(normalizeMechanicsState(value.state)) !== canonicalJson(value.state)) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: "snapshot mechanics state is not normalized" };
    return { status: "ok", value: cloneJson(value as unknown as CompiledSessionSnapshot) };
  } catch (error) {
    return { status: "refused", code: "SNAPSHOT_CORRUPT", message: error instanceof Error ? error.message : "snapshot could not be decoded" };
  }
}

export function validatePersistedCompiledActionResponse(value: unknown): value is PersistedCompiledActionResponse {
  return validPersistedResponse(value);
}

function sameEdge(actual: MechanicsReachabilityEdge, expected: MechanicsReachabilityEdge): boolean {
  return canonicalJson(actual) === canonicalJson(expected);
}

/** Replays the complete trace and records the settled state/trace prefix for every executable player edge. */
export function replayCompiledSessionTrace(
  payload: ResolvedCompilerArtifactPayload,
  trace: readonly MechanicsReachabilityEdge[],
): CompiledSessionSnapshotResult<{ state: MechanicsState; budget: ReturnType<typeof createMechanicsStateBudget>; playerActions: Array<{ edge: MechanicsReachabilityEdge; state: MechanicsState; traceLength: number }> }> {
  try {
    const budget = createMechanicsStateBudget(payload.analysisInput.maxStates);
    let offset = 0;
    let settled = settleAutomaticMechanics(payload.mechanicsIR, initialMechanicsState(payload.analysisInput), budget);
    for (const edge of settled.steps) {
      if (!sameEdge(trace[offset]!, edge)) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: `trace automatic edge ${offset} does not replay` };
      offset++;
    }
    let state = settled.state;
    const playerActions: Array<{ edge: MechanicsReachabilityEdge; state: MechanicsState; traceLength: number }> = [];
    while (offset < trace.length) {
      const expected = trace[offset]!;
      if (!expected || !["success", "failure", "failback", "traverse"].includes(expected.outcome)) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: `trace edge ${offset} is not an executable player action` };
      const executed = executeMechanicsAction(payload.mechanicsIR, payload.analysisInput, state, expected as Pick<typeof expected, "mechanismId" | "outcome"> & { outcome: "success" | "failure" | "failback" | "traverse" });
      if (!sameEdge(expected, executed.edge)) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: `trace action edge ${offset} does not replay` };
      offset++;
      budget.observe(executed.state);
      settled = settleAutomaticMechanics(payload.mechanicsIR, executed.state, budget);
      for (const edge of settled.steps) {
        if (!sameEdge(trace[offset]!, edge)) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: `trace automatic edge ${offset} does not replay` };
        offset++;
      }
      state = settled.state;
      playerActions.push({ edge: executed.edge, state: structuredClone(state), traceLength: offset });
    }
    return { status: "ok", value: { state, budget, playerActions } };
  } catch (error) {
    return { status: "refused", code: "SNAPSHOT_CORRUPT", message: error instanceof Error ? error.message : "trace replay failed" };
  }
}

interface SnapshotHeaderFile {
  schemaVersion: typeof COMPILED_SESSION_SNAPSHOT_SCHEMA_VERSION;
  sessionId: string;
  bundleId: string;
  snapshotHash: string;
  generation: number;
  bodyBytes: number;
}

export interface CompiledSessionSnapshotFileOps {
  mkdir(path: string): void;
  exists(path: string): boolean;
  list(path: string): string[];
  read(path: string, maxBytes: number): string;
  writeNew(path: string, value: string): void;
  writeReplace(path: string, value: string): void;
  remove(path: string): void;
  /** Optional platform hook for durable directory-entry publication; Windows commonly returns EINVAL for directory fsync. */
  syncDirectory?(path: string): void;
}

function writeAll(fd: number, value: string): void {
  const bytes = new TextEncoder().encode(value);
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = writeSync(fd, bytes, offset, bytes.byteLength - offset);
    if (written <= 0) throw new Error("snapshot write made no progress");
    offset += written;
  }
}

function writeFileAtomically(path: string, value: string, replace: boolean): void {
  const temp = `${path}.${process.pid}.${Date.now()}.${crypto.randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeAll(fd, value);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    if (replace) renameSync(temp, path);
    else {
      // Hard-link publication is no-clobber on every supported local filesystem.
      linkSync(temp, path);
      unlinkSync(temp);
    }
    // Windows does not support fsync on directory handles. The renamed file was fsynced;
    // callers can inject a stronger directory durability operation on platforms that expose one.
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
  }
}

export const compiledSessionSnapshotNodeFileOps: CompiledSessionSnapshotFileOps = {
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  exists: (path) => existsSync(path),
  list: (path) => readdirSync(path),
  read: (path, maxBytes) => {
    const size = statSync(path).size;
    if (size > maxBytes) throw new Error(`snapshot file exceeds ${maxBytes} byte limit`);
    const fd = openSync(path, "r");
    try {
      const bytes = Buffer.alloc(size + 1);
      const count = readSync(fd, bytes, 0, size + 1, 0);
      if (count > maxBytes) throw new Error(`snapshot file exceeds ${maxBytes} byte limit`);
      return bytes.subarray(0, count).toString("utf8");
    } finally { closeSync(fd); }
  },
  writeNew: (path, value) => writeFileAtomically(path, value, false),
  writeReplace: (path, value) => writeFileAtomically(path, value, true),
  remove: (path) => { if (existsSync(path)) unlinkSync(path); },
  syncDirectory: (path) => {
    let fd: number | undefined;
    try {
      fd = openSync(path, "r");
      fsyncSync(fd);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== "EINVAL" && code !== "EPERM") throw error;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  },
};

export interface CompiledSessionSnapshotStoreOptions {
  root?: string;
  fileOps?: CompiledSessionSnapshotFileOps;
}

/** Immutable snapshot bodies plus a bounded, atomically replaced current-header pointer. */
export class CompiledSessionSnapshotStore {
  readonly root: string;
  private readonly ops: CompiledSessionSnapshotFileOps;
  /** Only a generation-zero header written by this store instance is rollback-eligible. */
  private readonly pendingCreationHashes = new Set<string>();

  constructor(options: CompiledSessionSnapshotStoreOptions = {}) {
    this.root = resolve(options.root ?? process.env.COMPILED_SESSION_ROOT ?? join("data", "compiled-sessions"));
    this.ops = options.fileOps ?? compiledSessionSnapshotNodeFileOps;
  }

  save(snapshot: unknown): CompiledSessionSnapshotResult<CompiledSessionSnapshotHeader> {
    const validated = validateCompiledSessionSnapshot(snapshot);
    if (validated.status === "refused") return validated;
    const value = validated.value;
    const body = `${canonicalJson(value)}\n`;
    const bodyBytes = new TextEncoder().encode(body).byteLength;
    if (bodyBytes > COMPILED_SESSION_BODY_MAX_BYTES) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot body exceeds the storage limit", sessionId: value.sessionId };
    try {
      this.ops.mkdir(this.root);
      const current = this.readHeader(value.sessionId);
      if (current.status === "ok") {
        if (current.value.snapshotHash === value.snapshotHash && current.value.generation === value.generation) return current;
        if (value.generation !== current.value.generation + 1 || value.previousSnapshotHash !== current.value.snapshotHash) return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "snapshot predecessor is not the current durable generation", sessionId: value.sessionId };
      } else if (current.code !== "SNAPSHOT_NOT_FOUND") {
        return { status: "refused", code: "SNAPSHOT_CONFLICT", message: `session ID is occupied by an unavailable snapshot: ${current.message}`, sessionId: value.sessionId };
      } else if (this.isOccupied(value.sessionId)) {
        return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "session ID is occupied by an incomplete or unavailable snapshot", sessionId: value.sessionId };
      } else if (value.generation !== 0 || value.previousSnapshotHash !== null) {
        return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "new durable sessions must start at generation zero", sessionId: value.sessionId };
      }
      const header: SnapshotHeaderFile = { schemaVersion: COMPILED_SESSION_SNAPSHOT_SCHEMA_VERSION, sessionId: value.sessionId, bundleId: value.bundle.id, snapshotHash: value.snapshotHash, generation: value.generation, bodyBytes };
      const bodyPath = this.bodyPath(value.sessionId, value.snapshotHash);
      if (this.ops.exists(bodyPath)) {
        if (this.ops.read(bodyPath, COMPILED_SESSION_BODY_MAX_BYTES) !== body) return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "immutable snapshot body hash collides with different content", sessionId: value.sessionId };
      } else {
        this.ops.writeNew(bodyPath, body);
        this.ops.syncDirectory?.(this.root);
      }
      this.ops.writeReplace(this.headerPath(value.sessionId), `${canonicalJson(header)}\n`);
      this.ops.syncDirectory?.(this.root);
      if (value.generation === 0) this.pendingCreationHashes.add(value.snapshotHash);
      return { status: "ok", value: this.headerFromFile(this.headerFileName(value.sessionId), header) };
    } catch (error) {
      return { status: "refused", code: "SNAPSHOT_STORAGE_FAILED", message: error instanceof Error ? error.message : "snapshot storage failed", sessionId: value.sessionId };
    }
  }

  /** Reads only bounded header sidecars. Callers load catalog bundles before body decoding. */
  listHeaders(): Array<CompiledSessionSnapshotResult<CompiledSessionSnapshotHeader>> {
    if (!this.ops.exists(this.root)) return [];
    try {
      return this.ops.list(this.root).filter((name) => name.endsWith(".header.json")).sort().map((name) => this.readHeaderFile(name));
    } catch (error) {
      return [{ status: "refused", code: "SNAPSHOT_STORAGE_FAILED", message: error instanceof Error ? error.message : "snapshot directory could not be enumerated" }];
    }
  }

  read(sessionId: string): CompiledSessionSnapshotResult<unknown> {
    const header = this.readHeader(sessionId);
    if (header.status === "refused") return header;
    try {
      const raw = this.ops.read(this.bodyPath(sessionId, header.value.snapshotHash), COMPILED_SESSION_BODY_MAX_BYTES);
      if (new TextEncoder().encode(raw).byteLength !== header.value.bodyBytes) return { status: "refused", code: "SNAPSHOT_CORRUPT", message: "snapshot body length does not match its header", sessionId };
      const value = JSON.parse(raw) as unknown;
      if (jsonDepth(value) > COMPILED_SESSION_JSON_MAX_DEPTH) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: "snapshot JSON nesting exceeds the storage limit", sessionId };
      return { status: "ok", value };
    } catch (error) {
      return { status: "refused", code: "SNAPSHOT_CORRUPT", message: error instanceof Error ? error.message : "snapshot body could not be decoded", sessionId };
    }
  }

  /** Marks a successfully registered generation-zero session as no longer rollback-eligible. */
  confirmCreated(snapshot: unknown): void {
    const validated = validateCompiledSessionSnapshot(snapshot);
    if (validated.status === "ok" && validated.value.generation === 0) this.pendingCreationHashes.delete(validated.value.snapshotHash);
  }

  /** Removes exactly this failed creation's current header and immutable body, never an existing durable session. */
  rollbackCreated(snapshot: unknown): CompiledSessionSnapshotResult<void> {
    const validated = validateCompiledSessionSnapshot(snapshot);
    if (validated.status === "refused") return validated;
    const value = validated.value;
    if (value.generation !== 0 || value.previousSnapshotHash !== null || !this.pendingCreationHashes.has(value.snapshotHash)) {
      return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "snapshot was not created by this pending durable-session attempt", sessionId: value.sessionId };
    }
    try {
      const header = this.readHeader(value.sessionId);
      if (header.status !== "ok" || header.value.snapshotHash !== value.snapshotHash || header.value.generation !== 0 || header.value.bundleId !== value.bundle.id) {
        return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "snapshot header no longer belongs to the failed creation attempt", sessionId: value.sessionId };
      }
      const body = `${canonicalJson(value)}\n`;
      const bodyPath = this.bodyPath(value.sessionId, value.snapshotHash);
      if (!this.ops.exists(bodyPath) || this.ops.read(bodyPath, COMPILED_SESSION_BODY_MAX_BYTES) !== body) {
        return { status: "refused", code: "SNAPSHOT_CONFLICT", message: "snapshot body no longer belongs to the failed creation attempt", sessionId: value.sessionId };
      }
      this.ops.remove(this.headerPath(value.sessionId));
      this.ops.syncDirectory?.(this.root);
      this.ops.remove(bodyPath);
      this.ops.syncDirectory?.(this.root);
      this.pendingCreationHashes.delete(value.snapshotHash);
      return { status: "ok", value: undefined };
    } catch (error) {
      return { status: "refused", code: "SNAPSHOT_STORAGE_FAILED", message: error instanceof Error ? error.message : "snapshot creation rollback failed", sessionId: value.sessionId };
    }
  }

  /** Existing headers, immutable bodies, and malformed header entries all reserve their session IDs. */
  isOccupied(sessionId: string): boolean {
    if (!validSessionId(sessionId) || !this.ops.exists(this.root)) return false;
    try {
      return this.ops.list(this.root).some((name) => name === this.headerFileName(sessionId) || name.startsWith(`${sessionId}.`) && name.endsWith(".json"));
    } catch { return true; }
  }

  readHeader(sessionId: string): CompiledSessionSnapshotResult<CompiledSessionSnapshotHeader> {
    if (!validSessionId(sessionId)) return { status: "refused", code: "SNAPSHOT_NOT_FOUND", message: "snapshot session ID is invalid", sessionId };
    return this.readHeaderFile(this.headerFileName(sessionId));
  }

  private readHeaderFile(fileName: string): CompiledSessionSnapshotResult<CompiledSessionSnapshotHeader> {
    const sessionId = fileName.replace(/\.header\.json$/, "");
    const path = join(this.root, fileName);
    try {
      if (!this.ops.exists(path)) return { status: "refused", code: "SNAPSHOT_NOT_FOUND", message: "snapshot header was not found", sessionId };
      const value = JSON.parse(this.ops.read(path, COMPILED_SESSION_HEADER_MAX_BYTES)) as unknown;
      if (!isRecord(value) || !exactKeys(value, ["schemaVersion", "sessionId", "bundleId", "snapshotHash", "generation", "bodyBytes"])
        || value.schemaVersion !== COMPILED_SESSION_SNAPSHOT_SCHEMA_VERSION || !validSessionId(value.sessionId) || value.sessionId !== sessionId || !COMPILER_ARTIFACT_CATALOG_ID_PATTERN.test(value.bundleId as string) || !validHash(value.snapshotHash) || !validNonNegativeInteger(value.generation) || !validNonNegativeInteger(value.bodyBytes) || value.bodyBytes > COMPILED_SESSION_BODY_MAX_BYTES) return { status: "refused", code: "SNAPSHOT_INCOMPATIBLE", message: `snapshot header is invalid for ${fileName}`, sessionId };
      return { status: "ok", value: this.headerFromFile(fileName, value as unknown as SnapshotHeaderFile) };
    } catch (error) {
      return { status: "refused", code: "SNAPSHOT_CORRUPT", message: `${fileName}: ${error instanceof Error ? error.message : "snapshot header could not be decoded"}`, sessionId };
    }
  }

  private headerFromFile(fileName: string, value: SnapshotHeaderFile): CompiledSessionSnapshotHeader {
    return { fileName, sessionId: value.sessionId, bundleId: value.bundleId, snapshotHash: value.snapshotHash, generation: value.generation, bodyBytes: value.bodyBytes };
  }

  private headerFileName(sessionId: string): string { return `${sessionId}.header.json`; }
  private headerPath(sessionId: string): string { return join(this.root, this.headerFileName(sessionId)); }
  private bodyPath(sessionId: string, snapshotHash: string): string { return join(this.root, `${sessionId}.${snapshotHash}.json`); }
}
