// 世界属性注册表 + 尺度门（PLAN.md「A 推演引擎」缺的第三块：属性注册表 + 事件传播）
//
// ⚠ 动手写这个文件之前先做了证伪：docs/world-property-falsification.md。
//   结论——尺度（personal/local/regional/world）是真实存在的独立现象
//   （码/米/局部/区域/位面都是原文量词），但**和位阶不是同一个轴**：
//   传奇阶的终极剑技可以是纯局部效果（30 米），恶魔伯爵这种非最高位阶
//   的存在也可能有区域甚至位面级的"背景辐射"效应。这个文件只处理尺度
//   这一个轴，不吞并 grail-engine.ts 的位阶压制——两个门分开点，别合并。
//
// 已有两个原语（PLAN.md 校准过的事实，见下方引用）：
//   ① 合法性闸门 = apply-action.ts 的 freeform 分支（校验"变化"而非
//      "动作名"，闸门自身不写状态）
//   ② 尺度/位阶压制门 = grail-engine.ts 的 TierSuppressionResult
//      （跨位阶不掷骰、在规则层直接判定；同位阶才掷骰）
// 这个文件做的事：
//   - 把①的 StateDomain 复用到属性声明上（不是另造一套值域系统）
//   - 把②的判定模式（跨档不掷骰/同档才掷骰）推广到尺度这个新轴上
//   - 新增 composition（幂等/可加/取极值/互斥）——这是①②都没有的，
//     因为①②处理的都是单一来源的状态转移，没有"多个来源怎么合并"
//     这个问题。属性会被多个能力同时影响，composition 就是回答
//     "合并规则是什么"，且必须显式声明——证伪报告 §发现三 已经拿
//     德鲁伊光环叠加规则证明了"可加"不声明清楚会指数爆炸。

import type { StateDomain } from "./apply-action";
import type { RulesetId } from "./rules-engine";

// ============================================================
// 尺度轴
// ============================================================

/**
 * 一个属性/效果波及多远。四档是初始建议，已按证伪报告核实过能装下
 * 已读素材里出现的现象（码级光环、米级剑技、局部地形改造、区域级
 * 生态灾难、位面级规则侵蚀）。
 */
export type PropertyScale = "personal" | "local" | "regional" | "world";

const SCALE_ORDER: readonly PropertyScale[] = ["personal", "local", "regional", "world"];

function scaleIndex(scale: PropertyScale): number {
  const i = SCALE_ORDER.indexOf(scale);
  if (i < 0) throw new Error(`未知尺度："${scale}"`);
  return i;
}

// ============================================================
// composition：多个来源如何合并成一个值
// ============================================================

/**
 * 幂等：多次施加同一个效果，结果与施加一次相同（"这件事发生了没有"，
 *   不是"发生了几次"）。
 * 可加：多个来源的数值直接相加。**危险项**——没有显式声明会从后门
 *   带回非线性（证伪报告 §发现三：光环叠加不声明上限就指数爆炸）。
 * 取极值：多个来源竞争同一效果时只取最强的一个，不叠加。
 * 互斥：同一时刻只能有一个来源生效，出现第二个来源是设计错误。
 */
export type PropertyComposition = "idempotent" | "additive" | "extremum" | "exclusive";

/**
 * 按 composition 规则合并多个来源的数值。
 *
 * ⚠ 这是「composition 不能靠约定」的机器判据本体：
 *   - `idempotent` 收到不一致的值 → 抛错（幂等变量不该有竞争的来源）
 *   - `exclusive` 收到 >1 个来源 → 抛错（互斥变量同一时刻只能一个来源生效）
 *   - `additive`/`extremum` 各自只用对应的数学运算，不允许彼此顶替
 *     （比如把"取极值"错写成"可加"——这里 switch 的每个分支各自独立，
 *     不共用一段"顺手就地相加"的代码，防止复制粘贴时端错分支）
 */
export function composePropertyValues(
  composition: PropertyComposition,
  values: readonly number[],
): number {
  if (values.length === 0) {
    throw new Error("composePropertyValues：没有任何来源，没有值可合并");
  }
  switch (composition) {
    case "idempotent": {
      const first = values[0]!;
      if (!values.every((v) => v === first)) {
        throw new Error(
          `composition="idempotent" 但收到了不一致的值 [${values.join(", ")}]——` +
          `幂等变量表达的是"是否发生"，不该有多个不同来源在竞争同一个数值`,
        );
      }
      return first;
    }
    case "additive":
      return values.reduce((a, b) => a + b, 0);
    case "extremum":
      return Math.max(...values);
    case "exclusive": {
      if (values.length > 1) {
        throw new Error(
          `composition="exclusive" 但收到了 ${values.length} 个来源 [${values.join(", ")}]——` +
          `互斥变量同一时刻只能有一个来源生效，出现第二个来源是设计错误，不是"取哪个"的问题`,
        );
      }
      return values[0]!;
    }
    default: {
      const exhaustive: never = composition;
      return exhaustive;
    }
  }
}

// ============================================================
// 尺度门：推广 grail-engine.ts 的 TierSuppressionResult
// ============================================================

export interface ScaleSuppressionResult {
  readonly applicable: boolean; // 是否跨尺度——false 表示同尺度，走正常掷骰
  readonly actorScale: PropertyScale;
  readonly targetScale: PropertyScale;
  /** actor 档位序号 - target 档位序号；正数=actor 更宏观。 */
  readonly scaleDifference: number;
  readonly suppressed: boolean; // 是否在规则层直接判定，不掷骰——恒等于 applicable
  readonly outcome?: "actor_dominates" | "actor_futile";
  readonly description: string;
}

/**
 * 尺度压制判定：跨尺度在规则层直接判定，不掷骰；同尺度才掷骰。
 * 永远不做乘法——这是对"数值乘性膨胀""一击必杀"的结构性回答
 * （PLAN.md:745-749 对 grail-engine 位阶压制的描述，原样搬到尺度轴）。
 *
 * @returns applicable=false 时表示同尺度，调用方应该走正常掷骰路径，
 *   本函数不参与那一步（跟 grail-engine.calcSuppression 返回 null
 *   表示"同阶无压制"是同一种语义，这里用 applicable 字段而不是 null，
 *   因为 TS 的可辨识联合在这里比"返回 null 还是对象"更不容易被调用方
 *   漏判——少一次 `!== null` 判断被漏写的机会）。
 */
export function calcScaleSuppression(
  actorScale: PropertyScale,
  targetScale: PropertyScale,
): ScaleSuppressionResult {
  const a = scaleIndex(actorScale);
  const t = scaleIndex(targetScale);
  const diff = a - t;

  if (diff === 0) {
    return {
      applicable: false, suppressed: false,
      actorScale, targetScale, scaleDifference: 0,
      description: "同尺度——正常掷骰，不做规则层压制判定",
    };
  }

  const outcome = diff > 0 ? "actor_dominates" : "actor_futile";
  return {
    applicable: true, suppressed: true,
    actorScale, targetScale, scaleDifference: diff, outcome,
    description: diff > 0
      ? `${actorScale} 尺度对 ${targetScale} 尺度形成碾压——规则层直接判定生效，不掷骰`
      : `${actorScale} 尺度作用于 ${targetScale} 尺度不构成有效影响——规则层直接判定无效，不掷骰`,
  };
}

// ============================================================
// WorldProperty：属性声明
// ============================================================

export interface WorldProperty {
  readonly id: string;
  readonly domain: StateDomain; // 复用 apply-action.ts 的值域声明，不另造
  readonly scale: PropertyScale;
  readonly composition: PropertyComposition;
  readonly ruleset: RulesetId; // 一开始就按规则集分流，见 PLAN.md:868-887
}

const REGISTRY = new Map<string, WorldProperty>();

/** 注册一个世界属性。重复 id 视为设计错误（同一属性被两处各注册一份，早晚漂移）。 */
export function registerWorldProperty(property: WorldProperty): void {
  if (REGISTRY.has(property.id)) {
    throw new Error(`世界属性 "${property.id}" 已经注册过一次，不能重复注册`);
  }
  REGISTRY.set(property.id, property);
}

export function getWorldProperty(id: string): WorldProperty | undefined {
  return REGISTRY.get(id);
}

export function listWorldProperties(): readonly WorldProperty[] {
  return [...REGISTRY.values()];
}

/** 仅供测试用：清空注册表，避免测试间互相污染。 */
export function _clearWorldPropertyRegistry(): void {
  REGISTRY.clear();
}

// ============================================================
// 能力 → 属性表（N×M，不是能力×能力的 N² 交互表）
// ============================================================

/**
 * 一条"来源对某个属性的影响"。这是 PLAN.md:745 明确拒绝的"把表做大"
 * （能力×能力的 N² 交互表）的替代方案——新增一个来源只是加一行数据，
 * 不需要枚举它和已有每个来源的组合怎么处理；组合规则由属性自己的
 * composition 统一回答。
 */
export interface AbilityPropertyEffect {
  readonly sourceId: string; // 触发这条效果的来源（技能检定轮次、环境因素……）
  readonly propertyId: string;
  readonly value: number;
  readonly scale: PropertyScale; // 这条效果发生在哪个尺度上
}

export type ResolvePropertyResult =
  | { readonly ok: true; readonly value: number; readonly composition: PropertyComposition }
  | { readonly ok: false; readonly reason: "unknown_property" | "empty_effects" }
  | { readonly ok: false; readonly reason: "cross_scale"; readonly suppression: ScaleSuppressionResult };

/**
 * 把一组来源对同一个属性的效果合并成最终值。
 *
 * 流程：
 *   1. 属性必须已注册，否则拒绝——不允许对着一个没声明 composition 的
 *      属性瞎合并数值（那正是判据①要堵的后门）。
 *   2. 所有来源必须同尺度。出现跨尺度的来源，先走尺度门判定
 *      （calcScaleSuppression），不直接把跨尺度的数字加在一起——
 *      永远不做乘法/加法跨尺度混算，这是尺度门存在的意义。
 *      调用方拿到 suppression 结果后自己决定怎么处理（本函数只负责
 *      在探测到跨尺度时报出来，不替调用方做判定之外的决定）。
 *   3. 同尺度时，按属性声明的 composition 合并所有来源的数值。
 */
export function resolvePropertyEffects(
  effects: readonly AbilityPropertyEffect[],
): ResolvePropertyResult {
  if (effects.length === 0) return { ok: false, reason: "empty_effects" };

  const propertyId = effects[0]!.propertyId;
  const property = getWorldProperty(propertyId);
  if (!property) return { ok: false, reason: "unknown_property" };

  const scales = new Set(effects.map((e) => e.scale));
  if (scales.size > 1) {
    // 跨尺度：只报第一对不一致的尺度，调用方据此走尺度门。
    const [first, second] = [...scales];
    return {
      ok: false, reason: "cross_scale",
      suppression: calcScaleSuppression(first as PropertyScale, second as PropertyScale),
    };
  }

  const values = effects.map((e) => e.value);
  const value = composePropertyValues(property.composition, values);
  return { ok: true, value, composition: property.composition };
}
