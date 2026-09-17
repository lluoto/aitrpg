// ============================================================
// Session 持久化存储
// ============================================================

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const BASE_DIR = join(process.cwd(), "data", "sessions");

function ensureDir() {
  if (!existsSync(BASE_DIR)) mkdirSync(BASE_DIR, { recursive: true });
}

export function mergeSessionMetadata(existing: unknown, patch: Record<string, unknown>): Record<string, unknown> {
  return { ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {}), ...patch };
}

/** 写回磁盘：game-session的路由/元数据快照足以在重启时重建摘要 */
export function saveSessionMeta(id: string, meta: Record<string, unknown>): void {
  ensureDir();
  const file = join(BASE_DIR, `${id}.json`);
  const merged = mergeSessionMetadata(loadSessionMeta(id), meta);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(merged, null, 2), "utf-8");
    renameSync(temp, file);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

/** Durable-ID collision check used before constructors that may create session files. */
export function sessionMetaExists(id: string): boolean {
  return existsSync(join(BASE_DIR, `${id}.json`));
}

/** 读取已持久化的 session 列表 */
function loadSessionIds(): string[] {
  ensureDir();
  return readdirSync(BASE_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => f.replace(/\.json$/, ""));
}

/** 读取某个 session 的持久化数据 */
function loadSessionMeta(id: string): Record<string, unknown> | null {
  const fp = join(BASE_DIR, `${id}.json`);
  if (!existsSync(fp)) return null;
  return JSON.parse(readFileSync(fp, "utf-8"));
}

/** 删除某个 session */
export function deleteSessionFile(id: string): void {
  const fp = join(BASE_DIR, `${id}.json`);
  if (existsSync(fp)) unlinkSync(fp);
}

/** 列出所有持久化 session 的基本信息（不含完整状态） */
export function listStoredSessions(): { id: string; createdAt: number; ruleset: string; playerName: string; scene: string; bundleId?: string }[] {
  return loadSessionIds().map(id => {
    const meta = loadSessionMeta(id);
    return {
      id,
      createdAt: (meta?.createdAt as number) ?? 0,
      ruleset: (meta?.ruleset as string) ?? "unknown",
      playerName: (meta?.playerName as string) ?? "unknown",
      scene: (meta?.scene as string) ?? "unknown",
      ...(typeof meta?.bundleId === "string" ? { bundleId: meta.bundleId } : {}),
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
}
