// 世界模型 → 跑团集成层
// 将 v14 提取的模式按场景/行为/事件三层映射到游戏运行时
// 替代当前"每3轮随机抽一条causal"的粗糙接入

import type { WorldModelLoader, WorldCausal, WorldBehavior, WorldFactionRelation } from "../world/world-model-loader";
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
    confidence: string;  // direction_confidence
  }>;
  /** 当前场景的资源稀缺信息 */
  resourceContext: string;
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
   * 替代原来的裸 causal query
   */
  buildInjection(ctx: SceneContext): WorldModelInjection {
    // ── 层 1: 势力关系 ──
    const relations = this.loader.getFactionRelations();
    const relevantRelations = relations.filter((r) => {
      const text = `${r.a} ${r.b} ${r.relation}`.toLowerCase();
      return ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
    }).slice(0, 3);

    const factionContext = relevantRelations.length > 0
      ? relevantRelations.map((r) => `${r.a}与${r.b}: ${r.relation}`).join("; ")
      : "当前场景无特殊势力关系";

    // ── 层 2: 行为模式 ──
    const behaviors = this.loader.getBehaviors();
    const npcHints: string[] = [];

    for (const npcName of ctx.presentNPCs) {
      const relevantBehaviors = behaviors.filter((b) => {
        const text = `${b.trigger} ${b.response}`.toLowerCase();
        return text.includes(npcName.toLowerCase()) ||
               ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
      }).slice(0, 2);

      for (const b of relevantBehaviors) {
        npcHints.push(`${npcName}: 当${b.trigger}时，该角色倾向于${b.response}`);
      }
    }

    // ── 层 3: 因果事件 ──
    const causals = this.loader.queryCausal(ctx.keywords, 3);
    const availableEvents = causals.map((c) => ({
      cause: c.cause,
      effect: c.effect,
      mechanism: c.mechanism.slice(0, 120),
      confidence: c.direction_confidence,
    }));

    // ── 层 4: 资源稀缺 ──
    const resources = this.loader.getByType("resource");
    const relevantResources = resources.filter((r: any) => {
      const text = `${r.name} ${r.drives}`.toLowerCase();
      return ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
    }).slice(0, 2);

    const resourceContext = relevantResources.length > 0
      ? relevantResources.map((r: any) => `${r.name}(稀缺度${r.scarcity}/5): ${r.drives}`).join("; ")
      : "当前场景无特殊资源稀缺";

    return {
      factionContext,
      npcBehaviorHints: npcHints,
      availableEvents,
      resourceContext,
    };
  }

  /**
   * 生成注入 KP 叙事 prompt 的上下文文本
   */
  buildKPContext(ctx: SceneContext): string {
    const injection = this.buildInjection(ctx);

    const lines: string[] = [];
    lines.push("[世界模型上下文]");

    if (injection.factionContext !== "当前场景无特殊势力关系") {
      lines.push(`势力关系: ${injection.factionContext}`);
    }

    if (injection.resourceContext !== "当前场景无特殊资源稀缺") {
      lines.push(`资源: ${injection.resourceContext}`);
    }

    if (injection.npcBehaviorHints.length > 0) {
      lines.push("NPC行为倾向:");
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
    const behaviors = this.loader.getBehaviors();
    const relevant = behaviors.filter((b) => {
      const text = `${b.trigger} ${b.response}`.toLowerCase();
      return text.includes(npcName.toLowerCase()) ||
             ctx.keywords.some((kw) => text.includes(kw.toLowerCase()));
    }).slice(0, 3);

    if (relevant.length === 0) return "";

    return "世界模型行为参考:\n" +
      relevant.map((b) => `  当「${b.trigger}」→ 该角色倾向于「${b.response}」`).join("\n");
  }
}
