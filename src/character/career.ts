/**
 * 角色卡传承模块 — CareerStore
 * ===============================
 *
 * 追踪调查员角色跨越多个神话模组的成长轨迹，支持：
 *
 * 1. **历程记录 (A)** — 每次模组完成时记录结局/奖励/变化
 * 2. **跨模组继承 (B)** — 从历程累算出角色的当前状态，带入下一模组
 * 3. **历程回溯** — 查询角色在任意时间点的状态
 *
 * 数据模型：
 *   CharacterSnapshot（角色创建时基线）
 *       ↓ 每次模组完成追加一条
 *   CareerEntry × N（模组完成记录）
 *       ↓ 累加
 *   CharacterCareer（计算出的当前状态）
 *
 * 存储：bun:sqlite → data/career.db
 *
 * 用法：
 *   const store = new CareerStore();
 *   store.saveSnapshot(aliceBase);                         // 第 1 步：记录初始角色
 *   store.addEntry(aliceName, entry1);                     // 第 2 步：记录模组完成
 *   const alice = store.loadCareer(aliceName);              // 第 3 步：获取当前状态
 *   const state = computeCurrentState(alice.base, alice.entries);  // 或直接计算
 */

import { Database } from "bun:sqlite";
import * as path from "path";
import * as fs from "fs";

// ============================================================
// 类型定义
// ============================================================

/** 角色初始快照 — 创建角色时记录的基线数据 */
export interface CharacterSnapshot {
  /** 角色名 */
  characterName: string;
  /** 玩家名（可选） */
  playerName?: string;
  /** 职业 */
  occupation: string;
  /** CoC 7e 核心属性（strength/constitution/size/dexterity/appearance/intelligence/power/education） */
  attributes: Record<string, number>;
  /** 技能值（中文技能名 → 百分比） */
  skills: Record<string, number>;
  /** 当前 SAN */
  san: number;
  /** 最大 SAN（99 - 克苏鲁神话） */
  maxSan: number;
  /** 克苏鲁神话技能值 */
  cthulhuMythos: number;
  /** HP */
  hp: number;
  /** 最大 HP */
  maxHp: number;
  /** 信誉值 */
  creditRating: number;
  /** 创建时间 */
  createdAt: string;
  /** 备注（自由文本） */
  notes?: string;

  // ── 完整角色卡扩展字段 ──
  /** 伤害加值（如 "+1d4"） */
  damageBonus?: string;
  /** 体格/体型 */
  build?: number;
  /** 移动力 */
  move?: number;
  /** 幸运值 */
  luck?: number;
  /** 护甲等级 */
  ac?: number;
  /** 现金 */
  cash?: number;
  /** 装备的武器列表 */
  weapons?: string[];
  /** 装备的护甲列表 */
  armor?: string[];
  /** 背包物品列表 */
  inventory?: string[];
  /** 年龄 */
  age?: number;
  /** 性别 */
  gender?: string;
  /** 身高 */
  height?: string;
  /** 体重 */
  weight?: string;
  /** 外貌描述 */
  description?: string;
  /** 背景故事 */
  backstory?: string;
  /** 恐惧症列表 */
  phobias?: string[];
  /** 躁狂症列表 */
  manias?: string[];
  /** 伤病史 */
  injuries?: string[];
  /** 职业技能点 */
  occupationSkillPoints?: number;
  /** 兴趣技能点 */
  interestSkillPoints?: number;
  /** 职业技能列表 */
  occupationSkills?: string[];
}

/** 单次模组完成记录 */
export interface CareerEntry {
  /** 唯一标识（自动生成） */
  id: string;
  /** 角色名（与 snapshot.characterName 关联） */
  characterName: string;
  /** 模组 ID */
  moduleId: string;
  /** 模组名称 */
  moduleName: string;
  /** 模组难度 */
  moduleDifficulty?: string;
  /** 完成时间 */
  completedAt: string;
  /** 达成的结局 ID */
  endingId: string;
  /** 结局显示名 */
  endingName: string;
  /** 结局描述 */
  endingDescription?: string;
  /** SAN 变化（负值为损失） */
  sanChange: number;
  /** CM 变化（正值为增长） */
  cmChange: number;
  /** 信誉变化 */
  reputationChange: number;
  /** 技能成长列表（如 ["侦查+d10→87", "潜行+d6→45"]） */
  skillChanges: string[];
  /** 生效的奖励规则 ID 列表 */
  rewardIds: string[];
  /** 自动生成的一句话叙事摘要 */
  narrative: string;
  /** 原始奖励数据快照（JSON，供 debug/溯源） */
  rewardSnapshot?: string;
}

/** 角色的完整历程（计算视图） */
export interface CharacterCareer {
  /** 角色名 */
  characterName: string;
  /** 基线快照 */
  base: CharacterSnapshot;
  /** 所有模组完成记录（按时间正序） */
  entries: CareerEntry[];
  /** 已完成的模组数量 */
  totalModules: number;
  // ── 计算字段 ──
  /** 当前 SAN */
  currentSan: number;
  /** 当前最大 SAN */
  currentMaxSan: number;
  /** 当前 CM */
  currentCthulhuMythos: number;
  /** 当前 HP */
  currentHp: number;
  /** 当前最大 HP */
  currentMaxHp: number;
  /** 当前技能值（基线技能 + 所有成长变更） */
  currentSkills: Record<string, number>;
  /** 当前信誉 */
  currentCreditRating: number;
}

// ============================================================
// 计算函数
// ============================================================

/**
 * 从基线快照 + 历程条目列表，计算角色的当前状态
 * （继承计算的核心逻辑）
 */
export function computeCurrentState(
  base: CharacterSnapshot,
  entries: CareerEntry[],
): {
  san: number;
  maxSan: number;
  cthulhuMythos: number;
  hp: number;
  maxHp: number;
  skills: Record<string, number>;
  creditRating: number;
} {
  let san = base.san;
  let maxSan = base.maxSan;
  let cm = base.cthulhuMythos;
  let hp = base.hp;
  let maxHp = base.maxHp;
  let cr = base.creditRating;
  const skills: Record<string, number> = { ...base.skills };

  for (const entry of entries) {
    san += entry.sanChange;
    cm += entry.cmChange;
    cr += entry.reputationChange;

    // 技能成长
    for (const change of entry.skillChanges) {
      // format: "技能名+骰子→最终值" or "技能名+dX" or "技能名→最终值"
      const parsed = parseSkillChange(change);
      if (parsed) {
        skills[parsed.name] = parsed.value;
      }
    }
  }

  // CoC 7e: 最大 SAN = 99 - CM（始终从 CM 计算，忽略 base.maxSan）
  maxSan = Math.max(0, 99 - cm);

  // 保证 SAN 不溢出边界
  san = Math.max(0, Math.min(san, maxSan));
  cm = Math.max(0, cm);
  maxHp = base.maxHp; // HP 上限通常不变（除非模组特别说明）
  hp = Math.min(hp, maxHp); // 实际 HP 由游戏内战斗/治疗决定，这里只是传递基线

  return { san, maxSan, cthulhuMythos: cm, hp, maxHp, skills, creditRating: cr };
}

/**
 * 解析技能变更字符串
 * 支持格式: "侦查+d10→87", "潜行→45"
 * 用 String.split 避免 regex 转义问题
 */
function parseSkillChange(change: string): { name: string; value: number } | null {
  // Split on → (U+2192)
  const parts = change.split("\u2192");
  if (parts.length !== 2) return null;
  const namePart = parts[0];
  const value = parseInt(parts[1], 10);
  if (isNaN(value)) return null;
  // Strip trailing dice notation: "+d10", "+1d10", "+1d6" etc.
  // Find the last '+' that precedes a digit-or-dice pattern
  const plusIdx = namePart.lastIndexOf("+");
  if (plusIdx >= 0) {
    const suffix = namePart.slice(plusIdx);
    // Check if suffix looks like dice notation: +[num]d[num]
    if (/^\+\d*d\d+$/.test(suffix)) {
      return { name: namePart.slice(0, plusIdx).trim(), value };
    }
  }
  // No dice notation — just skill name
  return { name: namePart.trim(), value };
}

/**
 * 构建技能变更字符串 — 记录成长表达式与实际结果
 * @param skillName 技能名（如 "侦查"）
 * @param dice 成长骰子（如 "d10"）
 * @param newValue 投骰后的最终技能值
 */
export function formatSkillChange(skillName: string, dice: string, newValue: number): string {
  return `${skillName}+${dice}→${newValue}`;
}

/**
 * 从技能成长定义和投骰结果生成变更字符串列表
 * @param skillGrowth 技能成长定义 { 技能名: 骰子表达式 }
 * @param rolledResults 投骰后的最终技能值 { 技能名: 最终值 }
 */
export function buildSkillChanges(
  skillGrowth: Record<string, string>,
  rolledResults: Record<string, number>,
): string[] {
  const changes: string[] = [];
  for (const [skill, dice] of Object.entries(skillGrowth)) {
    const newVal = rolledResults[skill] ?? 0;
    changes.push(formatSkillChange(skill, dice, newVal));
  }
  return changes;
}

/**
 * 自动生成完成记录的一句话叙事
 */
export function generateNarrative(
  moduleName: string,
  endingName: string,
  sanChange: number,
  cmChange: number,
  skillChanges: string[],
): string {
  const parts: string[] = [];
  parts.push(`完成模组「${moduleName}」`);

  if (endingName) {
    parts.push(`结局：${endingName}`);
  }
  if (sanChange !== 0) {
    parts.push(sanChange > 0 ? `SAN +${sanChange}` : `SAN ${sanChange}`);
  }
  if (cmChange > 0) {
    parts.push(`CM +${cmChange}`);
  }
  if (skillChanges.length > 0) {
    const skillNames = skillChanges.map(s => {
      const m = s.match(/^(.+?)\+/);
      return m ? m[1] : s;
    });
    parts.push(`技能成长：${skillNames.join("、")}`);
  }

  return parts.join("，") + "。";
}

// ============================================================
// SQLite 持久化层
// ============================================================

const DEFAULT_DB_PATH = path.join(import.meta.dir, "../../data/career.db");

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export class CareerStore {
  private db: Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? DEFAULT_DB_PATH;
    ensureDir(resolved);
    this.db = new Database(resolved);
    this.db.run("PRAGMA journal_mode = WAL");
    this.initSchema();
  }

  /** 关闭数据库 */
  close() {
    this.db.close();
  }

  /** 获取原始 Database 实例 */
  get raw() {
    return this.db;
  }

  // ============================================================
  // Schema
  // ============================================================

  private initSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS snapshots (
        character_name TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS career_entries (
        id TEXT PRIMARY KEY,
        character_name TEXT NOT NULL,
        module_id TEXT NOT NULL,
        module_name TEXT NOT NULL,
        module_difficulty TEXT,
        completed_at TEXT NOT NULL,
        ending_id TEXT NOT NULL,
        ending_name TEXT NOT NULL,
        ending_description TEXT,
        san_change INTEGER NOT NULL DEFAULT 0,
        cm_change INTEGER NOT NULL DEFAULT 0,
        reputation_change INTEGER NOT NULL DEFAULT 0,
        skill_changes TEXT NOT NULL DEFAULT '[]',
        reward_ids TEXT NOT NULL DEFAULT '[]',
        narrative TEXT NOT NULL DEFAULT '',
        reward_snapshot TEXT,
        FOREIGN KEY (character_name) REFERENCES snapshots(character_name)
      )
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_entries_character
      ON career_entries(character_name)
    `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_entries_module
      ON career_entries(module_id)
    `);
  }

  // ============================================================
  // Snapshot 操作
  // ============================================================

  /** 记录或更新角色基线快照 */
  saveSnapshot(snapshot: CharacterSnapshot): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO snapshots (character_name, data, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(
      snapshot.characterName,
      JSON.stringify(snapshot),
      snapshot.createdAt,
    );
  }

  /** 获取角色基线快照 */
  getSnapshot(characterName: string): CharacterSnapshot | null {
    const row = this.db.prepare(
      "SELECT data FROM snapshots WHERE character_name = ?",
    ).get(characterName) as { data: string } | undefined;
    if (!row) return null;
    return JSON.parse(row.data) as CharacterSnapshot;
  }

  /** 删除角色基线快照（级联删除 entries） */
  deleteSnapshot(characterName: string): void {
    this.db.run("DELETE FROM career_entries WHERE character_name = ?", [characterName]);
    this.db.run("DELETE FROM snapshots WHERE character_name = ?", [characterName]);
  }

  /** 列出所有已记录的角色名 */
  listCharacters(): string[] {
    const rows = this.db.prepare(
      "SELECT character_name FROM snapshots ORDER BY created_at DESC",
    ).all() as Array<{ character_name: string }>;
    return rows.map(r => r.character_name);
  }

  // ============================================================
  // CareerEntry 操作
  // ============================================================

  /** 添加模组完成记录 */
  addEntry(entry: CareerEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO career_entries
        (id, character_name, module_id, module_name, module_difficulty,
         completed_at, ending_id, ending_name, ending_description,
         san_change, cm_change, reputation_change,
         skill_changes, reward_ids, narrative, reward_snapshot)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      entry.id,
      entry.characterName,
      entry.moduleId,
      entry.moduleName,
      entry.moduleDifficulty ?? null,
      entry.completedAt,
      entry.endingId,
      entry.endingName,
      entry.endingDescription ?? null,
      entry.sanChange,
      entry.cmChange,
      entry.reputationChange,
      JSON.stringify(entry.skillChanges ?? []),
      JSON.stringify(entry.rewardIds ?? []),
      entry.narrative,
      entry.rewardSnapshot ?? null,
    );
  }

  /** 获取指定角色所有模组完成记录（按时间正序） */
  getEntries(characterName: string): CareerEntry[] {
    const rows = this.db.prepare(
      "SELECT * FROM career_entries WHERE character_name = ? ORDER BY completed_at ASC",
    ).all(characterName) as Array<Record<string, any>>;

    return rows.map(row => ({
      id: row.id,
      characterName: row.character_name,
      moduleId: row.module_id,
      moduleName: row.module_name,
      moduleDifficulty: row.module_difficulty ?? undefined,
      completedAt: row.completed_at,
      endingId: row.ending_id,
      endingName: row.ending_name,
      endingDescription: row.ending_description ?? undefined,
      sanChange: row.san_change,
      cmChange: row.cm_change,
      reputationChange: row.reputation_change,
      skillChanges: JSON.parse(row.skill_changes),
      rewardIds: JSON.parse(row.reward_ids),
      narrative: row.narrative,
      rewardSnapshot: row.reward_snapshot ?? undefined,
    }));
  }

  /** 删除指定模组完成记录 */
  deleteEntry(entryId: string): void {
    this.db.run("DELETE FROM career_entries WHERE id = ?", [entryId]);
  }

  // ============================================================
  // 综合查询
  // ============================================================

  /** 加载角色的完整历程（含计算状态） */
  loadCareer(characterName: string): CharacterCareer | null {
    const base = this.getSnapshot(characterName);
    if (!base) return null;

    const entries = this.getEntries(characterName);
    const state = computeCurrentState(base, entries);

    return {
      characterName,
      base,
      entries,
      totalModules: entries.length,
      currentSan: state.san,
      currentMaxSan: state.maxSan,
      currentCthulhuMythos: state.cthulhuMythos,
      currentHp: state.hp,
      currentMaxHp: state.maxHp,
      currentSkills: state.skills,
      currentCreditRating: state.creditRating,
    };
  }

  /** 列出所有角色的简短摘要 */
  listCareers(): Array<{
    characterName: string;
    totalModules: number;
    currentSan: number;
    currentCm: number;
  }> {
    const chars = this.listCharacters();
    return chars.map(name => {
      const career = this.loadCareer(name);
      if (!career) return { characterName: name, totalModules: 0, currentSan: 0, currentCm: 0 };
      return {
        characterName: name,
        totalModules: career.totalModules,
        currentSan: career.currentSan,
        currentCm: career.currentCthulhuMythos,
      };
    });
  }

  // ============================================================
  // 导入/导出
  // ============================================================

  /** 导出角色历程为 JSON */
  exportToJson(characterName: string): string | null {
    const career = this.loadCareer(characterName);
    if (!career) return null;
    return JSON.stringify(career, null, 2);
  }

  /** 从 JSON 导入角色历程 */
  importFromJson(json: string): boolean {
    try {
      const data = JSON.parse(json);
      if (!data.base || !data.characterName) return false;

      // 保存基线
      this.saveSnapshot(data.base);

      // 保存条目
      if (data.entries) {
        for (const entry of data.entries) {
          // 检查是否已存在
          const existing = this.db.prepare(
            "SELECT id FROM career_entries WHERE id = ?",
          ).get(entry.id) as { id: string } | undefined;
          if (!existing) {
            this.addEntry(entry);
          }
        }
      }

      return true;
    } catch {
      return false;
    }
  }
}

// ============================================================
// 便利工具：生成 CareerEntry ID
// ============================================================

/** 生成唯一的 career entry ID */
export function generateEntryId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `ce_${ts}_${rand}`;
}

// ============================================================
// 与 MythosModule 集成
// ============================================================

/**
 * 从 MythosModule 信息 + 角色当前状态，创建模组完成记录并持久化
 *
 * @param store CareerStore 实例
 * @param characterName 角色名
 * @param moduleInfo 模组信息（需满足最小接口）
 * @param completion 完成详情
 *
 * 用法（在 GameSession 中调用）：
 *   import { CareerStore, recordModuleCompletion } from "../character/career";
 *   const store = new CareerStore();
 *   recordModuleCompletion(store, "爱丽丝", myModule, {
 *     endingId: "true",
 *     rewardResults: { sanChange: -5, cmChange: 3, skillGrowth: { "侦查": "d10" }, ... },
 *   });
 */
export function recordModuleCompletion(
  store: CareerStore,
  characterName: string,
  moduleInfo: {
    id: string;
    name: string;
    difficulty?: string;
  },
  completion: {
    /** 达成的结局 ID */
    endingId: string;
    /** 结局显示名 */
    endingName: string;
    /** 结局描述 */
    endingDescription?: string;
    /** SAN 变化净值（负值为损失） */
    sanChange: number;
    /** CM 变化净值 */
    cmChange: number;
    /** 信誉变化 */
    reputationChange: number;
    /** 技能成长定义及投骰后最终值 */
    skillGrowthResults?: Record<string, { dice: string; newValue: number }>;
    /** 生效的奖励规则 ID 列表 */
    rewardIds?: string[];
    /** 奖励原始快照（JSON） */
    rewardSnapshot?: string;
  },
): CareerEntry {
  const skillChanges: string[] = [];
  if (completion.skillGrowthResults) {
    for (const [skill, result] of Object.entries(completion.skillGrowthResults)) {
      skillChanges.push(formatSkillChange(skill, result.dice, result.newValue));
    }
  }

  const entry: CareerEntry = {
    id: generateEntryId(),
    characterName,
    moduleId: moduleInfo.id,
    moduleName: moduleInfo.name,
    moduleDifficulty: moduleInfo.difficulty,
    completedAt: new Date().toISOString(),
    endingId: completion.endingId,
    endingName: completion.endingName,
    endingDescription: completion.endingDescription,
    sanChange: completion.sanChange,
    cmChange: completion.cmChange,
    reputationChange: completion.reputationChange,
    skillChanges,
    rewardIds: completion.rewardIds ?? [],
    narrative: generateNarrative(
      moduleInfo.name,
      completion.endingName,
      completion.sanChange,
      completion.cmChange,
      skillChanges,
    ),
    rewardSnapshot: completion.rewardSnapshot,
  };

  store.addEntry(entry);
  return entry;
}
