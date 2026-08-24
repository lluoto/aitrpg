// 只取类型 —— 注册表（getRulesetMod）留在组合层。
// `coc-ruleset-mod` 自己 import 了 `coc-engine`，这边再 import 值就成环。
import type { RulesetModHooks } from "../rules/coc-ruleset-mod";

// ============================================================
// 基础类型
// ============================================================

export type WoundSeverity = "scratch" | "flesh" | "deep" | "grievous" | "lethal";

/** 与 coc-engine.ts HitLocation 一致的命中部位 */
export type HitLocation = "右腿" | "左腿" | "腹部" | "胸部" | "右臂" | "左臂" | "头部";

// ============================================================
// 严重度计算
// ============================================================

/**
 * 根据单次伤害 / 总 HP 计算伤势严重度。
 * 阈值已调整为 CoC 7e 标准：
 *   - ≤25%   → scratch（无惩罚）
 *   - 25~49% → flesh（叙事，无惩罚骰）
 *   - 50~74% → deep（CoC Major Wound）
 *   - ≥75%   → grievous（Major Wound + 致残）
 */
export function calcSeverity(
  damage: number,
  maxHp: number,
  /**
   * 规则集钩子（`coc-ruleset-mod.ts`）。不给就是标准 CoC 7e。
   *
   * ⚠ 这里**只收类型**、由调用方把 hooks 传进来，不 import 注册表：
   *   `coc-ruleset-mod` 自己 import 了 `coc-engine`，反向再连一条就成环了。
   *   注册表只在组合层（play/combat、api/game-session）出现。
   */
  hooks?: Pick<RulesetModHooks, "majorWoundThreshold">,
): WoundSeverity {
  if (maxHp <= 0) return "flesh";
  const ratio = damage / maxHp;
  // 变体规则改了重伤阈值时，deep 的门槛跟着走。
  // 标准 CoC 下 `ceil(maxHp/2)` 与 `ratio >= 0.50` 完全等价（奇数也一样：
  // maxHp=7 时 0.5×7=3.5 → damage≥4，ceil(7/2)=4），所以不给 hooks 时行为不变。
  const deepAt = hooks?.majorWoundThreshold?.(maxHp);
  if (deepAt !== undefined) {
    if (damage >= deepAt * 1.5) return "grievous";
    if (damage >= deepAt) return "deep";
    if (ratio > 0.25) return "flesh";
    return "scratch";
  }
  // 边界取 >= 而不是 > —— CoC 7e 的 Major Wound 是「单次伤害**等于或大于**最大 HP 一半」。
  // 原先写 `> 0.50`，于是"10 点体力挨 5 点"这种最常见的一击恰好落在边界外，
  // 被判成轻伤、不掷体质、不加惩罚骰。上面注释写的一直是「50~74% → deep」，
  // 是代码与注释不符，注释才是对的。
  //
  // ⚠ 别拿它去统一 play-module 的 `isMajorWound`：那条是陷阱截肢，
  // 模组原文写的是「伤害**大于**耐久半值」，用 `>` 是对的。两条规则本就不同口径。
  if (ratio >= 0.75) return "grievous";
  if (ratio >= 0.50) return "deep";   // CoC Major Wound 阈值
  if (ratio > 0.25) return "flesh";
  return "scratch";
}

// ============================================================
// 名称工具
// ============================================================

export function severityLabel(severity: WoundSeverity): string {
  switch (severity) {
    case "scratch":  return "擦伤";
    case "flesh":    return "轻伤";
    case "deep":     return "重伤";
    case "grievous": return "致命伤";
    case "lethal":   return "致命一击";
  }
}

// ============================================================
// 惩罚骰
// ============================================================

/**
 * 伤势对应的 CoC 惩罚骰数量。
 * scratch/flesh 无惩罚（CoC 规则：普通失血不影响战斗技能）。
 * deep = 1 惩罚骰（Major Wound，轻微干扰）。
 * grievous = 3 惩罚骰（致命伤 + 致残）。
 */
export function woundPenaltyDice(severity: WoundSeverity): number {
  switch (severity) {
    case "grievous": return 3;
    case "deep":     return 1;
    default:         return 0;
  }
}

/**
 * 这一次伤害要不要掷「重伤体质检定」。
 *
 * 两个条件缺一不可：
 *   1. 伤势够重（deep / grievous，即 CoC 7e 的 Major Wound）
 *   2. **人还有意识**（hpAfter > 0）
 *
 * 第 2 条原先没有统一。四个调用点里两个带 `pc.hp > 0`、两个不带：
 *   traps 主伤害路径、combat 敌人命中 —— 不带，HP 已经归零还会补掷一次
 *   traps 挣脱大失败、traps 持续伤害   —— 带
 * 结果是同一条规则在同一局里有两种口径，`scripts/diag/diag-wounds.ts` 只能把
 * 「重伤但当场昏迷」那些单列出来不下结论。
 *
 * 规则本身很清楚：这一掷决定的是「会不会昏过去」，人已经躺下了就没什么可决定的。
 * 抽成一个函数而不是四处各写一遍，是因为口径漂移正是这么来的。
 */
/** 致残效果：部位 + 一句功能障碍描写。只在本文件内用，不导出 */
interface Disability {
  location: HitLocation;
  /** 功能障碍描述，直接播报给玩家 */
  impairment: string;
  /** 是否倒地 */
  knockdown: boolean;
  /** 是否脱手 */
  disarmed: boolean;
}

/**
 * 致命伤（≥75% 最大 HP）打在哪儿 → 具体致残。deep 及以下只扣 HP + 给惩罚骰。
 *
 * ⚠ 这段描写一直在仓库里，但**从来没有被调用过** —— 在「死导出清零」那轮
 *   被当作死代码删掉了（全仓确实无人引用）。也就是说从项目开始到现在，
 *   玩家一次都没见过「右臂遭受毁灭性打击……武器从无力手指中滑落」这种话，
 *   致命伤和普通重伤在播报上长得一模一样，只有 HP 数字不同。
 *
 *   现在接上：`play/combat.ts` 的伤害结算里按伤势与部位取一句播出来。
 *   文字从 git 历史里取回，一字未改 —— 它写得比我现编的好。
 */
export function getDisability(location: HitLocation, severity: WoundSeverity): Disability | null {
  if (severity !== "grievous") return null;
  switch (location) {
    case "右臂":
    case "左臂": {
      const side = location === "右臂" ? "右" : "左";
      return {
        location,
        impairment: `${side}臂遭受毁灭性打击，皮开肉绽，完全无法用力，武器从无力手指中滑落。`,
        knockdown: false, disarmed: true,
      };
    }
    case "右腿":
    case "左腿": {
      const side = location === "右腿" ? "右" : "左";
      return {
        location,
        impairment: `${side}腿被彻底撕开一道深可见骨的伤口，无法承重。身体不受控制地向前倾倒。`,
        knockdown: true, disarmed: false,
      };
    }
    case "腹部":
      return { location, impairment: "腹部被撕开裂口，温热的液体从指缝间涌出。视线开始模糊，意识在痛楚中摇摆。", knockdown: true, disarmed: false };
    case "胸部":
      return { location, impairment: "胸部遭受致命打击——呼吸带出血沫。每一次心跳都让鲜血从伤口喷涌更多。", knockdown: true, disarmed: false };
    case "头部":
      return { location, impairment: "头部遭到重击！视野瞬间变成一片白色，耳鸣淹没了所有声音。双腿失去力量，栽倒在地。", knockdown: true, disarmed: false };
  }
}

export function needsMajorWoundCheck(
  severity: WoundSeverity,
  hpAfter: number,
  /** 规则集钩子；Pulp 之类的变体可以整个关掉重伤系统。不给就是标准 CoC 7e */
  hooks?: Pick<RulesetModHooks, "enableMajorWound">,
): boolean {
  if (hooks?.enableMajorWound === false) return false;
  return (severity === "deep" || severity === "grievous") && hpAfter > 0;
}
