// 世界模型加载器 — 从 v13 JSONL 加载结构化世界数据
// 按类型/章节索引，供 KP Agent 和其他系统查询

import { readFileSync, existsSync } from "fs";

// ============================================================
// v13 模式类型
// ============================================================

export interface WorldCausal {
  type: "causal";
  cause: string;
  effect: string;
  mechanism: string;
  mechanism_source: string;
  delay: string;
  domain: string;
  direction_confidence: "confirmed" | "inferred" | "ambiguous" | "suspected_inversion";
  temporal_order: string;
  source: string;
  quote_abridged: string;
  chapter: string;
  causal_precheck?: Record<string, any>;
}

export interface WorldBehavior {
  type: "behavior";
  trigger: string;
  response: string;
  world_fit: number;
  source: string;
  quote_abridged: string;
  chapter: string;
}

export interface WorldFactionRelation {
  type: "faction_relation";
  a: string;
  b: string;
  relation: string;
  confidence: number;
  source: string;
  quote_abridged: string;
  chapter: string;
}

export interface WorldResource {
  type: "resource";
  name: string;
  scarcity: number;
  drives: string;
  source: string;
  quote_abridged: string;
  chapter: string;
}

export interface WorldStrategy {
  type: "strategy";
  who: string;
  what: string;
  goal?: string;
  how?: string;
  result?: string;
  source: string;
  chapter: string;
}

export interface WorldCombat {
  type: "combat";
  trigger?: string;
  mechanism?: string;
  outcome?: string;
  source: string;
  chapter: string;
}

export type WorldPattern =
  | WorldCausal
  | WorldBehavior
  | WorldFactionRelation
  | WorldResource
  | WorldStrategy
  | WorldCombat;

// ============================================================
// 加载器
// ============================================================

export class WorldModelLoader {
  private patterns: WorldPattern[] = [];
  private byType: Map<string, WorldPattern[]> = new Map();
  private byChapter: Map<string, WorldPattern[]> = new Map();
  /** 已消费的 causal（避免重复触发） */
  private consumedCausal: Set<number> = new Set();
  private loaded = false;

  load(path: string = "../../世界模型/v13_output/world_model_v13_clean.jsonl") {
    if (!existsSync(path)) {
      console.warn(`  ⚠ 世界模型文件未找到: ${path}`);
      return;
    }

    const raw = readFileSync(path, "utf-8");
    const lines = raw.trim().split("\n");
    this.patterns = [];

    for (const line of lines) {
      try {
        const p = JSON.parse(line) as WorldPattern;
        if (!p.type || !p.chapter) continue;
        this.patterns.push(p);

        // 按类型索引
        if (!this.byType.has(p.type)) this.byType.set(p.type, []);
        this.byType.get(p.type)!.push(p);

        // 按章节索引
        if (!this.byChapter.has(p.chapter)) this.byChapter.set(p.chapter, []);
        this.byChapter.get(p.chapter)!.push(p);
      } catch { /* skip malformed */ }
    }

    this.loaded = true;
    console.log(`  🌐 世界模型已加载: ${this.patterns.length} 条 (causal: ${this.getByType("causal").length})`);
  }

  isLoaded(): boolean { return this.loaded; }

  /** 获取指定类型的所有模式 */
  getByType(type: string): WorldPattern[] {
    return this.byType.get(type) ?? [];
  }

  /** 获取指定章节的所有模式 */
  getByChapter(chapter: string): WorldPattern[] {
    return this.byChapter.get(chapter) ?? [];
  }

  /** 获取所有 causal 模式 */
  getCausal(): WorldCausal[] {
    return this.getByType("causal") as WorldCausal[];
  }

  /** 获取所有 behavior 模式 */
  getBehaviors(): WorldBehavior[] {
    return this.getByType("behavior") as WorldBehavior[];
  }

  /** 获取所有 faction_relation */
  getFactionRelations(): WorldFactionRelation[] {
    return this.getByType("faction_relation") as WorldFactionRelation[];
  }

  /**
   * 查询匹配当前上下文的 causal 链
   * @param contextKeywords 当前场景/事件的描述关键词
   * @param maxResults 最多返回条数
   * @returns 匹配的 causal 模式（按 direction_confidence 排序）
   */
  queryCausal(contextKeywords: string[], maxResults: number = 3): WorldCausal[] {
    const all = this.getCausal();
    const scored: Array<{ pattern: WorldCausal; score: number }> = [];

    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (this.consumedCausal.has(i)) continue;

      let score = 0;
      const text = `${p.cause} ${p.effect} ${p.mechanism}`.toLowerCase();
      for (const kw of contextKeywords) {
        if (text.includes(kw.toLowerCase())) score += 10;
      }

      // 确认的因果加分
      if (p.direction_confidence === "confirmed") score += 5;
      if (p.delay === "immediate" || p.delay === "short_term") score += 3;

      if (score > 0) scored.push({ pattern: p, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map(s => s.pattern);
  }

  /**
   * 随机获取 N 条因果链（用于随机事件注入）
   */
  randomCausal(n: number = 1): WorldCausal[] {
    const all = this.getCausal().filter((_, i) => !this.consumedCausal.has(i));
    if (all.length === 0) return [];

    const result: WorldCausal[] = [];
    const pool = [...all];
    for (let i = 0; i < n && pool.length > 0; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      result.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return result;
  }

  /** 标记 causal 已被消费 */
  consumeCausal(pattern: WorldCausal) {
    const all = this.getCausal();
    const idx = all.indexOf(pattern);
    if (idx >= 0) this.consumedCausal.add(idx);
  }

  /** 根据行为模式匹配 NPC 反应 */
  queryBehavior(contextKeywords: string[], maxResults: number = 1): WorldBehavior[] {
    const all = this.getBehaviors();
    const scored: Array<{ pattern: WorldBehavior; score: number }> = [];

    for (const p of all) {
      let score = 0;
      const text = `${p.trigger} ${p.response}`.toLowerCase();
      for (const kw of contextKeywords) {
        if (text.includes(kw.toLowerCase())) score += 10;
      }
      if (p.world_fit >= 4) score += 5;
      if (score > 0) scored.push({ pattern: p, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxResults).map(s => s.pattern);
  }

  /** 获取统计信息 */
  getStats() {
    return {
      total: this.patterns.length,
      causal: this.getByType("causal").length,
      behavior: this.getByType("behavior").length,
      faction_relation: this.getByType("faction_relation").length,
      resource: this.getByType("resource").length,
      strategy: this.getByType("strategy").length,
      combat: this.getByType("combat").length,
      consumed: this.consumedCausal.size,
    };
  }
}
