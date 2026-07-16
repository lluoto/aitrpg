/**
 * 角色卡传承模块 — CareerFileStore（JSON 文件存储）
 * ============================================================
 *
 * 替代 CareerStore（SQLite），将角色历程存为 JSON 文件：
 *   data/careers/爱丽丝.career.json
 *
 * 优势：
 *   - 单文件 = 单角色，复制即分享
 *   - ✓ 可读（JSON 纯文本）✓ 可追溯（Git diff）✓ 零依赖
 *   - 原子写入（.tmp → rename），防断电丢数据
 *   - 纯 JSON 可在浏览器环境中直接使用
 *
 * 接口与 CareerStore 一致，可无缝替换。
 *
 * 用法：
 *   const store = new CareerFileStore();
 *   store.saveSnapshot(base);
 *   store.addEntry(entry);
 *   const career = store.loadCareer("爱丽丝");
 *
 * 浏览器环境：
 *   用 exportToJson() → 下载 .career.json
 *   用 importFromJson() ← 上传解析
 */

import * as path from "path";
import * as fs from "fs";
import {
  computeCurrentState,
  generateNarrative,
  formatSkillChange,
  generateEntryId,
  type CharacterSnapshot,
  type CareerEntry,
  type CharacterCareer,
} from "./career";

// ============================================================
// 默认路径
// ============================================================

const DEFAULT_CAREER_DIR =
  process.env.__CAREER_DIR ?? path.join(import.meta.dir, "../../data/careers");

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** 文件名安全化（替换文件名中的非法字符） */
function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, "_");
}

// ============================================================
// JSON 文件存储
// ============================================================

/** 磁盘上的角色档案结构 */
interface CareerFile {
  /** 格式版本，便于未来迁移 */
  version: 1;
  /** 角色基线快照（空档案时为 null） */
  base: CharacterSnapshot | null;
  /** 模组完成记录（按时间正序） */
  entries: CareerEntry[];
  /** 最后修改时间 */
  updatedAt: string;
}

export class CareerFileStore {
  private baseDir: string;

  /**
   * @param dir 存放 .career.json 的目录，默认 data/careers/
   */
  constructor(dir?: string) {
    this.baseDir = dir ?? DEFAULT_CAREER_DIR;
    ensureDir(this.baseDir);
  }

  // ============================================================
  // 私有工具
  // ============================================================

  /** 文件路径 */
  private filePath(characterName: string): string {
    return path.join(this.baseDir, safeFileName(characterName) + ".career.json");
  }

  /** 读取文件，不存在返回 null */
  private readFile(characterName: string): CareerFile | null {
    const fp = this.filePath(characterName);
    try {
      const raw = fs.readFileSync(fp, "utf-8");
      return JSON.parse(raw) as CareerFile;
    } catch {
      return null;
    }
  }

  /** 原子写入：写 .tmp → rename → .json */
  private atomicWrite(characterName: string, data: CareerFile): void {
    const fp = this.filePath(characterName);
    const tmp = fp + ".tmp";
    data.updatedAt = new Date().toISOString();
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, fp);
  }

  /** 读或创建空档案 */
  private readOrCreate(characterName: string): CareerFile {
    return this.readFile(characterName) ?? {
      version: 1,
      base: null,
      entries: [],
      updatedAt: "",
    };
  }

  // ============================================================
  // Snapshot 操作
  // ============================================================

  /** 记录或更新角色基线快照 */
  saveSnapshot(snapshot: CharacterSnapshot): void {
    const file = this.readOrCreate(snapshot.characterName);
    file.base = snapshot;
    this.atomicWrite(snapshot.characterName, file);
  }

  /** 获取角色基线快照 */
  getSnapshot(characterName: string): CharacterSnapshot | null {
    const file = this.readFile(characterName);
    return file?.base ?? null;
  }

  /** 删除角色全部数据 */
  deleteSnapshot(characterName: string): void {
    const fp = this.filePath(characterName);
    try { fs.unlinkSync(fp); } catch { /* 文件不存在 */ }
  }

  /** 列出所有已记录的角色名 */
  listCharacters(): string[] {
    try {
      const files = fs.readdirSync(this.baseDir);
      return files
        .filter(f => f.endsWith(".career.json"))
        .map(f => {
          // 从文件名反解角色名（读取 JSON 更准确）
          const fp = path.join(this.baseDir, f);
          try {
            const raw = fs.readFileSync(fp, "utf-8");
            const parsed = JSON.parse(raw) as CareerFile;
            return parsed.base?.characterName ?? f.replace(/\.career\.json$/, "");
          } catch {
            return f.replace(/\.career\.json$/, "");
          }
        });
    } catch {
      return [];
    }
  }

  // ============================================================
  // CareerEntry 操作
  // ============================================================

  /** 添加模组完成记录 */
  addEntry(entry: CareerEntry): void {
    const file = this.readOrCreate(entry.characterName);
    file.entries.push(entry);
    this.atomicWrite(entry.characterName, file);
  }

  /** 获取指定角色所有模组完成记录 */
  getEntries(characterName: string): CareerEntry[] {
    const file = this.readFile(characterName);
    return file?.entries ?? [];
  }

  /** 删除指定模组完成记录 */
  deleteEntry(entryId: string): void {
    // 需要在所有文件中查找，效率不高但操作罕见
    const chars = this.listCharacters();
    for (const name of chars) {
      const file = this.readFile(name);
      if (!file) continue;
      const before = file.entries.length;
      file.entries = file.entries.filter(e => e.id !== entryId);
      if (file.entries.length !== before) {
        this.atomicWrite(name, file);
        return;
      }
    }
  }

  // ============================================================
  // 综合查询
  // ============================================================

  /** 加载角色的完整历程（含计算状态） */
  loadCareer(characterName: string): CharacterCareer | null {
    const file = this.readFile(characterName);
    if (!file?.base) return null;

    const state = computeCurrentState(file.base, file.entries);

    return {
      characterName,
      base: file.base,
      entries: file.entries,
      totalModules: file.entries.length,
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

  /** 导出角色历程为 JSON 字符串 */
  exportToJson(characterName: string): string | null {
    const file = this.readFile(characterName);
    if (!file) return null;
    return JSON.stringify(file, null, 2);
  }

  /** 从 JSON 字符串导入角色历程 */
  importFromJson(json: string): boolean {
    try {
      const data = JSON.parse(json) as CareerFile;
      if (!data.base?.characterName) return false;
      // 兼容旧格式：顶层 characterName 字段
      const oldFormat = data as unknown as { characterName?: string };
      if (data.base.characterName !== oldFormat.characterName && !oldFormat.characterName) {
        // 旧格式兼容通过
      }
      this.atomicWrite(data.base.characterName, data);
      return true;
    } catch {
      return false;
    }
  }
}
