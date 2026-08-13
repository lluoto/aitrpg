// 世界模型加载器 — v18 版本（合并 v15+v16+v17，383K 条，73 部小说）
// 按小说/类型/关键词多重索引，支持 D&D 游戏规则路由
// 向后兼容 integrator 的 queryCausal/queryBehavior/getFactionRelations 接口

import { readFileSync, existsSync } from "fs";
import { log } from "../log";

// ============================================================
// v18 统一条目类型（v15+v16+v17 联合）
// ============================================================

export interface V18Entry {
  type: string;
  name?: string;
  description?: string;
  chapter: string;
  novel?: string;
  _version?: string;           // "v15+v16" | "v16" | "v17"

  // v15+v16: 原始世界观
  quote_abridged?: string;
  quote_source?: string;
  properties?: Record<string, string>;
  source?: string;
  hallucination_risk?: boolean;
  causal_precheck?: Record<string, any>;

  // v16: D&D 映射
  mechanic?: string;
  game_rule?: boolean | string;
  dnd_mapping?: string;

  // v17: 行为/因果
  trigger?: string;
  response?: string;
  world_fit?: number;

  // 保留原始字段
  [key: string]: unknown;
}

// ============================================================
// v18 查询结果（统一包装）
// ============================================================

export interface WorldModelStats {
  total: number;
  byNovel: Record<string, number>;
  byType: Record<string, number>;
  byVersion: Record<string, number>;
  dndGameRules: number;
  dndMappings: number;
  hallucinationRisky: number;
}

// 向后兼容的查询返回（集成层仍用）
export interface ScoredEntry {
  entry: V18Entry;
  score: number;
}

// ============================================================
// 加载器
// ============================================================

export const DEFAULT_V18_PATH = "../世界模型/v18_output/v18_all_master.jsonl";

/** 按路径共享的 loader 实例。世界模型是只读参考数据，没有按会话变化的内容。 */
const SHARED = new Map<string, WorldModelLoader>();

/**
 * 取得进程内共享的世界模型 loader。
 *
 * 为什么必须共享：v18_all_master.jsonl 是 383688 条只读参考数据。此前每个
 * GameSession 各 `new WorldModelLoader()`，实测建立 3 个会话就把它加载了 3 遍
 * （每遍约 1.2-1.3s），服务进程驻留 1938 MB；而磁盘上已有 41 个存档会话，
 * 按原样逐个恢复必然打爆内存。
 *
 * 为什么共享是安全的：全部可变状态都在 load() 里一次性建好，之后所有公开方法
 * 只读。调用方一律用 `isLoaded()` 守卫后再 load()，因此第二个使用者不会重复加载。
 */
export function sharedWorldModel(path: string = DEFAULT_V18_PATH): WorldModelLoader {
  const existing = SHARED.get(path);
  if (existing) return existing;
  const created = new WorldModelLoader();
  SHARED.set(path, created);
  return created;
}

export class WorldModelLoader {
  private entries: V18Entry[] = [];
  private byNovel: Map<string, V18Entry[]> = new Map();
  private byType: Map<string, V18Entry[]> = new Map();
  private byNovelAndType: Map<string, V18Entry[]> = new Map();
  private byVersion: Map<string, V18Entry[]> = new Map();
  private dndGameRules: V18Entry[] = [];
  private dndMappings: V18Entry[] = [];
  private hallucinationRisky: V18Entry[] = [];
  private loaded = false;
  private loadTime = 0;

  /**
   * 加载 v18_all_master.jsonl
   * @param path JSONL 文件路径
   */
  load(path: string = DEFAULT_V18_PATH) {
    if (!existsSync(path)) {
      log.warn("world", `世界模型文件未找到: ${path}`);
      return;
    }

    const start = performance.now();
    const raw = readFileSync(path, "utf-8");
    const lines = raw.trim().split("\n");
    this.entries = [];

    for (const line of lines) {
      try {
        const e = JSON.parse(line) as V18Entry;
        if (!e.type || !e.chapter) continue;
        this.entries.push(e);
        const novel = e.novel || "未知";

        // 按小说索引
        if (!this.byNovel.has(novel)) this.byNovel.set(novel, []);
        this.byNovel.get(novel)!.push(e);

        // 按类型索引
        if (!this.byType.has(e.type)) this.byType.set(e.type, []);
        this.byType.get(e.type)!.push(e);

        // 按小说+类型索引
        const novelTypeKey = `${novel}|${e.type}`;
        if (!this.byNovelAndType.has(novelTypeKey)) this.byNovelAndType.set(novelTypeKey, []);
        this.byNovelAndType.get(novelTypeKey)!.push(e);

        // 按版本索引
        const ver = e._version || "unknown";
        if (!this.byVersion.has(ver)) this.byVersion.set(ver, []);
        this.byVersion.get(ver)!.push(e);

        // D&D 游戏规则
        if (e.game_rule === true || e.game_rule === "true" || typeof e.game_rule === "string") {
          this.dndGameRules.push(e);
        }
        if (e.dnd_mapping) {
          this.dndMappings.push(e);
        }
        if (e.hallucination_risk === true) {
          this.hallucinationRisky.push(e);
        }
      } catch { /* skip malformed */ }
    }

    this.loaded = true;
    this.loadTime = performance.now() - start;
    const byNovelCount = Object.fromEntries(
      [...this.byNovel.entries()].map(([k, v]) => [k, v.length])
    );
    console.log(`  🌐 世界模型 v18 已加载: ${this.entries.length} 条 | ${this.byNovel.size} 部小说 | ${this.byType.size} 种类型 | ${(this.loadTime / 1000).toFixed(1)}s`);
    console.log(`     D&D 规则: ${this.dndGameRules.length} | D&D 映射: ${this.dndMappings.length} | 幻觉风险: ${this.hallucinationRisky.length}`);
  }

  isLoaded(): boolean { return this.loaded; }

  // ============================================================
  // 基础查询
  // ============================================================

  /** 获取所有条目（谨慎使用 — 内存大） */
  getAll(): V18Entry[] {
    return this.entries;
  }

  /** 按小说获取 */
  getByNovel(novel: string): V18Entry[] {
    return this.byNovel.get(novel) ?? [];
  }

  /** 按类型获取（保留旧名兼容） */
  getByType(type: string): V18Entry[] {
    return this.byType.get(type) ?? [];
  }

  /** 按小说+类型获取 */
  getByNovelAndType(novel: string, type: string): V18Entry[] {
    return this.byNovelAndType.get(`${novel}|${type}`) ?? [];
  }

  /** 所有小说名 */
  getNovelNames(): string[] {
    return [...this.byNovel.keys()].sort();
  }

  /** 所有类型 */
  getTypeNames(): string[] {
    return [...this.byType.keys()].sort();
  }

  // ============================================================
  // D&D 专用查询（v16 字段）
  // ============================================================

  /** 获取含 game_rule 的条目（可路由到 D&D 规则系统） */
  getDndRules(novel?: string): V18Entry[] {
    if (novel) {
      return this.dndGameRules.filter(e => e.novel === novel);
    }
    return this.dndGameRules;
  }

  /** 获取含 dnd_mapping 的条目 */
  getDndMappings(novel?: string): V18Entry[] {
    if (novel) {
      return this.dndMappings.filter(e => e.novel === novel);
    }
    return this.dndMappings;
  }

  /** 获取含 mechanic 描述的条目 */
  getMechanics(novel?: string): V18Entry[] {
    const all = this.entries.filter(e => e.mechanic);
    if (novel) return all.filter(e => e.novel === novel);
    return all;
  }

  // ============================================================
  // 关键词搜索（线性扫描 + 评分）
  // ============================================================

  /**
   * 全量关键词搜索（跨所有小说）
   * @param keywords 关键词数组
   * @param novel 可选：限制小说
   * @param type 可选：限制类型
   * @param maxResults 最多返回
   * @returns 评分排序的条目
   */
  search(
    keywords: string[],
    novel?: string,
    type?: string,
    maxResults: number = 10
  ): ScoredEntry[] {
    const pool = novel
      ? (type ? this.getByNovelAndType(novel, type) : this.getByNovel(novel))
      : (type ? this.getByType(type) : this.entries);

    const lowerKeywords = keywords.map(k => k.toLowerCase());
    const scored: ScoredEntry[] = [];

    for (const e of pool) {
      const text = [
        e.name,
        e.description,
        e.mechanic,
        e.dnd_mapping,
        e.trigger,
        e.response,
        e.quote_abridged,
      ].filter(Boolean).join(" ").toLowerCase();

      let score = 0;
      for (const kw of lowerKeywords) {
        if (text.includes(kw)) {
          score += 10;
          // 名字命中权重更高
          if (e.name?.toLowerCase().includes(kw)) score += 5;
        }
      }

      // quality boost
      if (e.world_fit && e.world_fit >= 4) score += 3;
      if (e.dnd_mapping) score += 2; // D&D 映射条目更实用

      if (score > 0) scored.push({ entry: e, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults);
  }

  // ============================================================
  // 向后兼容接口（integrator 仍用）
  // ============================================================

  /**
   * 获取 faction_relation 类型条目
   * 旧接口: 返回任意类型（可强转）
   */
  getFactionRelations(): any[] {
    return this.getByType("faction_relation");
  }

  /**
   * 获取 behavior 类型条目
   * 旧接口兼容
   */
  getBehaviors(): any[] {
    return this.getByType("behavior");
  }

  /**
   * 关键词匹配 causal 类型条目
   * 旧接口: queryCausal(contextKeywords, maxResults)
   */
  queryCausal(contextKeywords: string[], maxResults: number = 3): any[] {
    return this.search(contextKeywords, undefined, "causal", maxResults)
      .map(s => s.entry);
  }

  /**
   * 关键词匹配 behavior 类型条目
   * 旧接口: queryBehavior(contextKeywords, maxResults)
   */
  queryBehavior(contextKeywords: string[], maxResults: number = 1): any[] {
    return this.search(contextKeywords, undefined, "behavior", maxResults)
      .map(s => s.entry);
  }

  /**
   * 随机获取 N 条 causal（旧接口兼容）
   */
  randomCausal(n: number = 1): any[] {
    const causal = this.getByType("causal");
    if (causal.length === 0) return [];
    const result: any[] = [];
    const pool = [...causal];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return result;
  }

  /**
   * 标记 causal 已被消费（旧接口 — v18 保持空操作确保兼容）
   */
  private consumedIndices: Set<number> = new Set();
  consumeCausal(_pattern: any) {
    // v18 不做消费跟踪（causal 太多），保留方法签名兼容
    this.consumedIndices.add(this.consumedIndices.size);
  }

  // ============================================================
  // 统计
  // ============================================================

  getStats(): WorldModelStats {
    const byNovel: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byVersion: Record<string, number> = {};

    for (const [n, entries] of this.byNovel) byNovel[n] = entries.length;
    for (const [t, entries] of this.byType) byType[t] = entries.length;
    for (const [v, entries] of this.byVersion) byVersion[v] = entries.length;

    return {
      total: this.entries.length,
      byNovel,
      byType,
      byVersion,
      dndGameRules: this.dndGameRules.length,
      dndMappings: this.dndMappings.length,
      hallucinationRisky: this.hallucinationRisky.length,
    };
  }

  /**
   * 获取指定小说的统计摘要
   */
  getNovelStats(novel: string) {
    const entries = this.getByNovel(novel);
    const byType: Record<string, number> = {};
    for (const e of entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
    }
    return {
      novel,
      total: entries.length,
      byType,
      dndRules: entries.filter(e => e.game_rule === true || e.game_rule === "true" || typeof e.game_rule === "string").length,
      dndMappings: entries.filter(e => e.dnd_mapping).length,
    };
  }
}
