/**
 * NPC Store — SQLite 持久化层
 * =============================
 *
 * 功能：
 *   - NPC 人格卡持久化（增删改查）
 *   - NPC 记忆持久化（写入+时序+重要性检索）
 *   - NPC 关系值持久化
 *   - NPC 情绪/状态持久化
 *
 * 依赖：bun:sqlite（Bun 内置，零外部依赖）
 * 数据库文件：data/npc.db（自动创建）
 */

import { Database } from "bun:sqlite";
import type { NPCPersonality, NPCMood, MemoryEntry } from "../agent/types";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// 数据库路径
// ============================================================

const DEFAULT_DB_PATH = path.join(import.meta.dir, "../../data/npc.db");

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============================================================
// NPC Store 类
// ============================================================

export class NPCStore {
  private db: Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? DEFAULT_DB_PATH;
    ensureDir(resolved);
    this.db = new Database(resolved);
    this.db.run("PRAGMA journal_mode = WAL");
    this.db.run("PRAGMA foreign_keys = ON");
    this.initSchema();
  }

  /** 关闭数据库连接 */
  close() {
    this.db.close();
  }

  /** 获取底层 Database 实例（供高级查询） */
  get raw() {
    return this.db;
  }

  // ============================================================
  // Schema
  // ============================================================

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS npc_personalities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        personality TEXT DEFAULT '',
        background TEXT DEFAULT '',
        speech_style TEXT DEFAULT '',
        goals TEXT DEFAULT '[]',
        knowledge TEXT DEFAULT '[]',
        secrets TEXT DEFAULT '[]',
        attitudes TEXT DEFAULT '{}',
        ruleset TEXT DEFAULT '',
        traits TEXT DEFAULT '{}',
        factions TEXT DEFAULT '[]',
        initial_mood TEXT DEFAULT 'neutral',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS npc_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        npc_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('observation','dialogue','event','decision')),
        content TEXT NOT NULL,
        importance INTEGER NOT NULL DEFAULT 5,
        timestamp INTEGER NOT NULL,
        scene_id TEXT DEFAULT '',
        related_entities TEXT DEFAULT '[]',
        is_summary INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (npc_id) REFERENCES npc_personalities(id) ON DELETE CASCADE
      )
    `);
    // 按 NPC+时间排序的索引
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_memories_npc_time
        ON npc_memories(npc_id, timestamp DESC)
    `);
    // 按重要性检索的索引（用于记忆裁剪）
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_memories_importance
        ON npc_memories(npc_id, importance DESC)
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS npc_relationships (
        npc_id TEXT NOT NULL,
        target_name TEXT NOT NULL,
        relationship REAL NOT NULL DEFAULT 0,
        interaction_count INTEGER NOT NULL DEFAULT 0,
        last_interaction INTEGER DEFAULT 0,
        PRIMARY KEY (npc_id, target_name),
        FOREIGN KEY (npc_id) REFERENCES npc_personalities(id) ON DELETE CASCADE
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS npc_states (
        npc_id TEXT PRIMARY KEY,
        mood TEXT NOT NULL DEFAULT 'neutral',
        relationship REAL NOT NULL DEFAULT 0,
        player_interaction_count INTEGER NOT NULL DEFAULT 0,
        last_active INTEGER DEFAULT 0,
        FOREIGN KEY (npc_id) REFERENCES npc_personalities(id) ON DELETE CASCADE
      )
    `);
  }

  // ============================================================
  // NPC 人格卡
  // ============================================================

  /** 保存/更新 NPC 人格卡 */
  savePersonality(npc: NPCPersonality): void {
    const now = Date.now();
    const id = npc.name; // name 作为主键
    this.db.run(
      `INSERT INTO npc_personalities
       (id, name, role, personality, background, speech_style,
        goals, knowledge, secrets, attitudes, ruleset, traits, factions,
        initial_mood, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM npc_personalities WHERE id=?), ?), ?)
       ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, role=excluded.role, personality=excluded.personality,
        background=excluded.background, speech_style=excluded.speech_style,
        goals=excluded.goals, knowledge=excluded.knowledge, secrets=excluded.secrets,
        attitudes=excluded.attitudes, ruleset=excluded.ruleset, traits=excluded.traits,
        factions=excluded.factions, initial_mood=excluded.initial_mood,
        updated_at=excluded.updated_at`,
      [
        id, npc.name, npc.role, npc.personality ?? "", npc.background ?? "",
        npc.speech_style ?? "",
        JSON.stringify(npc.goals ?? []),
        JSON.stringify(npc.knowledge ?? []),
        JSON.stringify(npc.secrets ?? []),
        JSON.stringify(npc.attitudes ?? {}),
        npc.ruleset ?? "",
        JSON.stringify(npc.traits ?? {}),
        JSON.stringify(npc.factions ?? []),
        npc.initialMood ?? "neutral",
        now, id, now,
      ]
    );
  }

  /** 获取所有 NPC 人格卡 */
  getAllPersonalities(): NPCPersonality[] {
    const rows = this.db.query("SELECT * FROM npc_personalities").all() as any[];
    return rows.map(rowToPersonality);
  }

  /** 按 ID 获取 NPC 人格卡 */
  getPersonality(id: string): NPCPersonality | null {
    const row = this.db.query("SELECT * FROM npc_personalities WHERE id = ?").get(id) as any;
    return row ? rowToPersonality(row) : null;
  }

  /** 删除 NPC 人格卡（级联删除记忆、关系） */
  deletePersonality(id: string): void {
    this.db.run("DELETE FROM npc_personalities WHERE id = ?", [id]);
  }

  // ============================================================
  // NPC 记忆
  // ============================================================

  /** 写入一条记忆 */
  addMemory(npcId: string, entry: MemoryEntry): void {
    this.db.run(
      `INSERT INTO npc_memories (npc_id, type, content, importance, timestamp, scene_id, related_entities)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        npcId, entry.type, entry.content, entry.importance, entry.timestamp,
        (entry as any).scene_id ?? "",
        JSON.stringify((entry as any).related_entities ?? []),
      ]
    );
  }

  /** 批量写入记忆 */
  addMemories(npcId: string, entries: MemoryEntry[]): void {
    const insert = this.db.prepare(
      `INSERT INTO npc_memories (npc_id, type, content, importance, timestamp, scene_id, related_entities)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = this.db.transaction(() => {
      for (const e of entries) {
        insert.run(
          npcId, e.type, e.content, e.importance, e.timestamp,
          (e as any).scene_id ?? "",
          JSON.stringify((e as any).related_entities ?? [])
        );
      }
    });
    tx();
  }

  /** 获取 NPC 最近记忆（按时间倒序，limit 控制条数） */
  getRecentMemories(npcId: string, limit = 50): MemoryEntry[] {
    const rows = this.db.query(
      `SELECT * FROM npc_memories WHERE npc_id = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(npcId, limit) as any[];
    return rows.map(rowToMemory);
  }

  /** 获取 NPC 高重要性记忆（用于裁剪时保留） */
  getImportantMemories(npcId: string, minImportance = 7, limit = 30): MemoryEntry[] {
    const rows = this.db.query(
      `SELECT * FROM npc_memories WHERE npc_id = ? AND importance >= ? ORDER BY importance DESC LIMIT ?`
    ).all(npcId, minImportance, limit) as any[];
    return rows.map(rowToMemory);
  }

  /** 获取 NPC 在特定场景中的记忆 */
  getSceneMemories(npcId: string, sceneId: string, limit = 20): MemoryEntry[] {
    const rows = this.db.query(
      `SELECT * FROM npc_memories WHERE npc_id = ? AND scene_id = ? ORDER BY timestamp DESC LIMIT ?`
    ).all(npcId, sceneId, limit) as any[];
    return rows.map(rowToMemory);
  }

  /** 检索 NPC 记忆（关键词匹配 content） */
  searchMemories(npcId: string, keyword: string, limit = 20): MemoryEntry[] {
    const rows = this.db.query(
      `SELECT * FROM npc_memories WHERE npc_id = ? AND content LIKE ? ORDER BY timestamp DESC LIMIT ?`
    ).all(npcId, `%${keyword}%`, limit) as any[];
    return rows.map(rowToMemory);
  }

  /** 裁剪低重要性记忆（保留 top N 条高重要性，删除其他） */
  pruneMemories(npcId: string, keepTop = 100): number {
    // 获取第 keepTop 条的重要性阈值
    const threshold = this.db.query(
      `SELECT importance FROM npc_memories WHERE npc_id = ? ORDER BY importance DESC LIMIT 1 OFFSET ?`
    ).get(npcId, keepTop - 1) as any;
    if (!threshold) return 0;
    // 删除低于该重要性且非 summary 的记忆
    const result = this.db.run(
      `DELETE FROM npc_memories WHERE npc_id = ? AND importance < ? AND is_summary = 0`,
      [npcId, threshold.importance]
    );
    return result.changes;
  }

  /** 获取 NPC 记忆总数 */
  countMemories(npcId: string): number {
    const row = this.db.query("SELECT COUNT(*) as cnt FROM npc_memories WHERE npc_id = ?").get(npcId) as any;
    return row?.cnt ?? 0;
  }

  // ============================================================
  // NPC 关系
  // ============================================================

  /** 获取关系值 */
  getRelationship(npcId: string, targetName: string): number {
    const row = this.db.query(
      "SELECT relationship FROM npc_relationships WHERE npc_id = ? AND target_name = ?"
    ).get(npcId, targetName) as any;
    return row?.relationship ?? 0;
  }

  /** 更新关系值 */
  updateRelationship(npcId: string, targetName: string, delta: number): number {
    const current = this.getRelationship(npcId, targetName);
    const newVal = Math.max(-5, Math.min(5, current + delta));
    this.db.run(
      `INSERT INTO npc_relationships (npc_id, target_name, relationship, interaction_count, last_interaction)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(npc_id, target_name) DO UPDATE SET
        relationship = excluded.relationship,
        interaction_count = interaction_count + 1,
        last_interaction = excluded.last_interaction`,
      [npcId, targetName, newVal, Date.now()]
    );
    return newVal;
  }

  /** 获取所有关系 */
  getAllRelationships(npcId: string): Array<{ targetName: string; relationship: number; interactionCount: number }> {
    const rows = this.db.query(
      "SELECT target_name, relationship, interaction_count FROM npc_relationships WHERE npc_id = ? ORDER BY relationship DESC"
    ).all(npcId) as any[];
    return rows.map(r => ({
      targetName: r.target_name,
      relationship: r.relationship,
      interactionCount: r.interaction_count,
    }));
  }

  // ============================================================
  // NPC 状态
  // ============================================================

  /** 获取 NPC 当前状态 */
  getState(npcId: string): { mood: NPCMood; relationship: number; interactionCount: number } | null {
    const row = this.db.query("SELECT * FROM npc_states WHERE npc_id = ?").get(npcId) as any;
    if (!row) return null;
    return {
      mood: row.mood as NPCMood,
      relationship: row.relationship,
      interactionCount: row.player_interaction_count,
    };
  }

  /** 更新 NPC 状态 */
  updateState(npcId: string, mood: NPCMood, relationship: number, interactionCount: number): void {
    this.db.run(
      `INSERT INTO npc_states (npc_id, mood, relationship, player_interaction_count, last_active)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(npc_id) DO UPDATE SET
        mood=excluded.mood, relationship=excluded.relationship,
        player_interaction_count=excluded.player_interaction_count,
        last_active=excluded.last_active`,
      [npcId, mood, relationship, interactionCount, Date.now()]
    );
  }
}

// ============================================================
// 行 → 对象 转换函数
// ============================================================

function rowToPersonality(row: any): NPCPersonality {
  return {
    name: row.name,
    role: row.role,
    personality: row.personality,
    background: row.background,
    speech_style: row.speech_style,
    goals: safeJSONParse(row.goals, []),
    knowledge: safeJSONParse(row.knowledge, []),
    secrets: safeJSONParse(row.secrets, []),
    attitudes: safeJSONParse(row.attitudes, {}),
    ruleset: row.ruleset || undefined,
    traits: safeJSONParse(row.traits, undefined),
    factions: safeJSONParse(row.factions, undefined),
    initialMood: row.initial_mood as NPCMood | undefined,
  };
}

function rowToMemory(row: any): MemoryEntry {
  return {
    timestamp: row.timestamp,
    type: row.type,
    content: row.content,
    importance: row.importance,
    scene_id: row.scene_id || undefined,
    related_entities: safeJSONParse(row.related_entities, undefined),
    is_summary: row.is_summary === 1,
  } as MemoryEntry & any;
}

function safeJSONParse(str: string | undefined, fallback: any): any {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}
