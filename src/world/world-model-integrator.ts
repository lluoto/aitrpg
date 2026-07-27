// 世界模型 → 跑团集成层（v18 适配）
// 将 v18 的 383K 条目按小说/场景/行为/因果/D&D 规则注入游戏运行时
// 支持多小说路由和 D&D 5e / CoC 7e 双规则集

import type { WorldModelLoader, V18Entry } from "./world-model-loader";
import type { WorldState } from "../types";

// ============================================================
// 场景上下文
// ============================================================

export interface SceneContext {
  sceneId: string;
  sceneName: string;
  /** 场景中的关键词（用于匹配世界模型） */
  keywords: string[];
  /** 在场 NPC 名 */
  presentNPCs: string[];
  /** 玩家已发现的线索 */
  discoveredClues: string[];
  /** 当前回合 */
  round: number;
  /** 可选：当前激活的小说上下文（如 "黎明之剑"） */
  activeNovel?: string;
  /** 可选：当前规则集（"dnd5e" | "coc7e" | "grail"） */
  ruleset?: string;
}

// ============================================================
// 世界模型注入结果
// ============================================================

export interface WorldModelInjection {
  /** 当前场景的势力关系上下文 */
  factionContext: string;
  /** 当前场景中 NPC 可能触发的行为模式 */
  npcBehaviorHints: string[];
  /** 可触发的因果事件链 */
  availableEvents: Array<{
    cause: string;
    effect: string;
    mechanism: string;
    confidence: string;
  }>;
  /** 当前场景的资源/环境信息 */
  resourceContext: string;
  /** D&D 规则线索（game_rule/mechanic 条目） */
  dndRuleHints: string[];
  /** 当前小说上下文标识 */
  novelContext: string;
}

// ============================================================
// 公用字段提取（兼容 v15+v16 flat 字段 + v17 flat 字段）
// ============================================================

function getEntryName(e: V18Entry): string {
  return e.name || e.trigger || e.cause || e.type || "未知";
}

function getEntryDescription(e: V18Entry): string {
  return e.description || e.response || e.effect || e.mechanism || "";
}

function getEntryText(e: V18Entry): string {
  return `${getEntryName(e)} ${getEntryDescription(e)} ${e.quote_abridged || ""} ${e.mechanic || ""} ${e.dnd_mapping || ""}`.toLowerCase();
}

/** 提取势力关系文本（兼容 v15+v16 的 name/description 结构和 v13 的 a/b/relation 结构） */
function extractRelationText(e: V18Entry): string {
  if (e.name && e.description) {
    // v15+v16 风格: name="贵族与巫师的关系", description="..."
    const props = e.properties ? Object.values(e.properties).join("; ") : "";
    return `${e.name}: ${e.description.slice(0, 60)}${props ? ` (${props})` : ""}`;
  }
  // v13 风格 (a/b/relation) — v17 可能保留
  const a = (e as any).a || e.name || "未知";
  const b = (e as any).b || "未知";
  const relation = (e as any).relation || "未知关系";
  return `${a}与${b}: ${relation}`;
}

/** 提取行为模式文本 */
function extractBehaviorText(e: V18Entry): string {
  if (e.trigger && e.response) {
    // v17 风格
    return `当「${e.trigger}」→ 倾向于「${e.response}」`;
  }
  // v15+v16 风格: 从 name/description 提取
  return `${e.name || "该角色"}: ${e.description || "有特定行为模式"}`;
}

/** 提取因果文本 */
function extractCausalText(e: V18Entry): { cause: string; effect: string; mechanism: string; confidence: string } {
  const cause = e.cause || e.name || "未知原因";
  const effect = e.effect || e.description || "未知结果";
  const mechanism = (e.mechanism || e.mechanic || "").slice(0, 120);
  const confidence = e.direction_confidence
    || (e.causal_precheck?.direction_confidence as string)
    || "inferred";
  return { cause, effect, mechanism, confidence };
}

// ============================================================
// 集成器
// ============================================================

export class WorldModelIntegrator {
  private loader: WorldModelLoader;

  constructor(loader: WorldModelLoader) {
    this.loader = loader;
  }

  /**
   * 为当前场景生成世界模型注入上下文
   */
  buildInjection(ctx: SceneContext): WorldModelInjection {
    const novel = ctx.activeNovel;
    const keywords = ctx.keywords;

    // ── 层 0: 小说上下文 ──
    const novelCount = novel ? this.loader.getByNovel(novel).length : 0;
    const novelContext = novel
      ? `当前世界观: ${novel} (${novelCount} 条世界模型条目)`
      : `当前场景 (${this.loader.getNovelNames().length} 部可用小说)`;

    // ── 层 1: 势力关系 ──
    const relations = novel
      ? this.loader.getByNovelAndType(novel, "faction_relation")
      : this.loader.getFactionRelations();
    const relevantRelations = relations
      .filter((r: V18Entry) => {
        const text = getEntryText(r);
        return keywords.some((kw) => text.includes(kw.toLowerCase()));
      })
      .slice(0, 3);

    const factionContext = relevantRelations.length > 0
      ? relevantRelations.map((r: V18Entry) => extractRelationText(r)).join("; ")
      : "当前场景无特殊势力关系";

    // ── 层 2: NPC 行为模式 ──
    const behaviors = novel
      ? this.loader.getByNovelAndType(novel, "behavior")
      : this.loader.getBehaviors();
    const npcHints: string[] = [];

    for (const npcName of ctx.presentNPCs) {
      const relevantBehaviors = behaviors
        .filter((b: V18Entry) => {
          const text = getEntryText(b);
          return text.includes(npcName.toLowerCase()) ||
                 keywords.some((kw) => text.includes(kw.toLowerCase()));
        })
        .slice(0, 2);

      for (const b of relevantBehaviors) {
        npcHints.push(`${npcName}: ${extractBehaviorText(b)}`);
      }
    }

    // ── 层 3: 因果事件 ──
    const causals = novel
      ? this.loader.getByNovelAndType(novel, "causal")
      : this.loader.getByType("causal");
    const scoredCausals = causals
      .map((e: V18Entry) => {
        const text = getEntryText(e);
        const score = keywords.reduce((s, kw) => text.includes(kw.toLowerCase()) ? s + 10 : s, 0);
        return { entry: e, score };
      })
      .filter((s: any) => s.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3);

    const availableEvents = scoredCausals.map((s: any) => {
      const { cause, effect, mechanism, confidence } = extractCausalText(s.entry);
      return { cause, effect, mechanism, confidence };
    });

    // ── 层 4: 资源/环境 ──
    const resources = novel
      ? this.loader.getByNovelAndType(novel, "resource")
      : this.loader.getByType("resource");
    const relevantResources = resources
      .filter((r: V18Entry) => {
        const text = getEntryText(r);
        return keywords.some((kw) => text.includes(kw.toLowerCase()));
      })
      .slice(0, 2);

    const resourceContext = relevantResources.length > 0
      ? relevantResources.map((r: V18Entry) => {
          const name = r.name || "未知资源";
          const scarcity = (r as any).scarcity || r.properties?.accessibility || "未知";
          const drives = (r as any).drives || r.description?.slice(0, 60) || "";
          return `${name}(可访问性: ${scarcity}): ${drives}`;
        }).join("; ")
      : "当前场景无特殊资源信息";

    // ── 层 5: D&D 规则线索 ──
    const dndRules = novel
      ? this.loader.getDndRules(novel)
      : this.loader.getDndRules();
    const relevantDnd = keywords.length > 0
      ? dndRules.filter((r: V18Entry) => {
          const text = getEntryText(r);
          return keywords.some((kw) => text.includes(kw.toLowerCase()));
        }).slice(0, 3)
      : [];

    const dndRuleHints = relevantDnd.map((r: V18Entry) => {
      const name = r.name || "规则";
      const mechanic = r.mechanic ? ` (机制: ${r.mechanic.slice(0, 60)})` : "";
      const mapping = r.dnd_mapping ? ` [D&D: ${r.dnd_mapping}]` : "";
      return `${name}${mechanic}${mapping}`;
    });

    return {
      factionContext,
      npcBehaviorHints: npcHints,
      availableEvents,
      resourceContext,
      dndRuleHints,
      novelContext,
    };
  }

  /**
   * 生成注入 KP 叙事 prompt 的上下文文本
   */
  buildKPContext(ctx: SceneContext): string {
    const injection = this.buildInjection(ctx);

    const lines: string[] = [];
    lines.push("[世界模型上下文]");

    // 小说上下文
    lines.push(injection.novelContext);

    if (injection.factionContext !== "当前场景无特殊势力关系") {
      lines.push(`势力关系: ${injection.factionContext}`);
    }

    if (injection.resourceContext !== "当前场景无特殊资源信息") {
      lines.push(`环境/资源: ${injection.resourceContext}`);
    }

    if (injection.dndRuleHints.length > 0) {
      lines.push("D&D 规则参考:");
      for (const hint of injection.dndRuleHints) {
        lines.push(`  - ${hint}`);
      }
    }

    if (injection.npcBehaviorHints.length > 0) {
      lines.push("NPC 行为倾向:");
      for (const hint of injection.npcBehaviorHints) {
        lines.push(`  - ${hint}`);
      }
    }

    if (injection.availableEvents.length > 0) {
      lines.push("可推进的事件方向:");
      for (const evt of injection.availableEvents) {
        lines.push(`  - ${evt.cause} → ${evt.effect} [${evt.confidence}]`);
      }
    }

    return lines.join("\n");
  }

  /**
   * 为 NPC Agent 提供行为指导
   */
  getNPCGuidance(npcName: string, ctx: SceneContext): string {
    const novel = ctx.activeNovel;
    const behaviors = novel
      ? this.loader.getByNovelAndType(novel, "behavior")
      : this.loader.getBehaviors();

    const relevant = behaviors
      .filter((b: V18Entry) => {
        const text = getEntryText(b);
        return text.includes(npcName.toLowerCase()) ||
               ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
      })
      .slice(0, 3);

    if (relevant.length === 0) return "";

    return "世界模型行为参考:\n" +
      relevant.map((b: V18Entry) => `  当「${b.trigger || b.name || "特定情况"}」→ 该角色倾向于「${b.response || b.description || "有特定行为"}」`).join("\n");
  }

  /**
   * 按规则集路由查询
   */
  getRuleHints(ruleset: string, ctx: SceneContext): string[] {
    const novel = ctx.activeNovel;
    if (ruleset === "dnd5e") {
      const rules = novel
        ? this.loader.getDndRules(novel)
        : this.loader.getDndRules();
      return rules
        .filter((r: V18Entry) => {
          const text = getEntryText(r);
          return ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
        })
        .slice(0, 5)
        .map((r: V18Entry) => {
          const mapping = r.dnd_mapping ? ` [${r.dnd_mapping}]` : "";
          const mechanic = r.mechanic ? `: ${r.mechanic.slice(0, 80)}` : "";
          return `${r.name || "规则"}${mechanic}${mapping}`;
        });
    }

    // CoC: 从 behavior/causal 条目提取源
    if (ruleset === "coc7e") {
      const causals = novel
        ? this.loader.getByNovelAndType(novel, "causal")
        : this.loader.getByType("causal");
      return causals
        .filter((c: V18Entry) => {
          const text = getEntryText(c);
          return ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
        })
        .slice(0, 3)
        .map((c: V18Entry) => {
          const { cause, effect, mechanism } = extractCausalText(c);
          return `[事件] ${cause} → ${effect} (${mechanism.slice(0, 60)})`;
        });
    }

    return [];
  }
}
