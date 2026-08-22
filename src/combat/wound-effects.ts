// 伤势效果系统 — 克苏鲁 COC 7e 风格创伤 + 部位致残
//
// 参考 CoC 7e Major Wound 规则：
//   单次伤害 ≥ maxHp/2  →  体质检定，失败则昏迷
//   单次伤害 < maxHp/2  →  普通失血，无额外机制效果
//
// 本系统分级：
//   scratch  ≤25%    普通擦伤 —— 无任何惩罚
//   flesh    25~49%  轻伤 —— 叙事描述，无惩罚骰（CoC 设定：普通受伤只扣血）
//   deep     50~74%  重伤 —— 1惩罚骰 + 体质检定（= CoC Major Wound）
//   grievous ≥75%    致命伤 — 3惩罚骰 + 体质检定 + 部位致残
//   lethal   (hp≤0)  由 applyDamage 处理死亡
//
// ⚠️ 关键设计原则：
//   1. 残疾只发生在致命伤（≥75%），不发生在普通重伤
//   2. 残疾惩罚包含在基础惩罚骰中，不多重叠加
//   3. 残疾描述用 CoC 风格的"暂时失能"而非"永久粉碎"
//   4. 清创支持两种模式：
//      standard — 全部清除，无残留
//      survival — grievous 降级为 旧伤（1 惩罚骰残留）

import type { WorldEntity } from "../types";

// ============================================================
// 基础类型
// ============================================================

export type WoundSeverity = "scratch" | "flesh" | "deep" | "grievous" | "lethal";

/** 与 coc-engine.ts HitLocation 一致的命中部位 */
export type HitLocation = "右腿" | "左腿" | "腹部" | "胸部" | "右臂" | "左臂" | "头部";

/** 清创模式 */
export type WoundMode = "standard" | "survival";

/** 旧伤惩罚骰（survival 模式残留） */
const OLD_WOUND_PENALTY = 1;
const OLD_WOUND_STATUS = "old_wound";
export interface Disability {
  location: HitLocation;
  /** 写入 entity.status 的状态标记 */
  statusName: string;
  /** 功能障碍描述（用于消息推送） */
  impairment: string;
  /** 是否倒地 */
  knockdown: boolean;
  /** 是否武器脱手 */
  disarmed: boolean;
}

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
export function calcSeverity(damage: number, maxHp: number): WoundSeverity {
  if (maxHp <= 0) return "flesh";
  const ratio = damage / maxHp;
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

export function locationLabel(loc: HitLocation): string {
  return loc;
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
export function needsMajorWoundCheck(severity: WoundSeverity, hpAfter: number): boolean {
  return (severity === "deep" || severity === "grievous") && hpAfter > 0;
}

// ============================================================
// 致残映射（仅 grievous ≥75%）
// ============================================================

/**
 * 根据命中部位 + 伤势严重度计算具体残疾效果。
 * 仅 grievous 会产生残疾，deep 及以下只影响 HP + 给惩罚骰。
 */
export function getDisability(location: HitLocation, severity: WoundSeverity): Disability | null {
  if (severity !== "grievous") return null;

  switch (location) {
    case "右臂":
    case "左臂": {
      const side = location === "右臂" ? "右" : "左";
      return {
        location,
        statusName: `${side}臂重创`,
        impairment: `${side}臂遭受毁灭性打击，皮开肉绽，完全无法用力。${side === "右" ? "武" : "另"}器从无力手指中滑落。`,
        knockdown: false,
        disarmed: true,
      };
    }
    case "右腿":
    case "左腿": {
      const side = location === "右腿" ? "右" : "左";
      return {
        location,
        statusName: `${side}腿重创`,
        impairment: `${side}腿被彻底撕开一道深可见骨的伤口，无法承重。身体不受控制地向前倾倒。`,
        knockdown: true,
        disarmed: false,
      };
    }
    case "腹部": {
      return {
        location,
        statusName: "腹部重创",
        impairment: "腹部被撕开裂口，温热的液体从指缝间涌出。视线开始模糊，意识在痛楚中摇摆。",
        knockdown: true,
        disarmed: false,
      };
    }
    case "胸部": {
      return {
        location,
        statusName: "胸部重创",
        impairment: "胸部遭受致命打击——呼吸带出血沫。每一次心跳都让鲜血从伤口喷涌更多。",
        knockdown: true,
        disarmed: false,
      };
    }
    case "头部": {
      return {
        location,
        statusName: "头部重创",
        impairment: "头部遭到重击！视野瞬间变成一片白色，耳鸣淹没了所有声音。双腿失去力量，栽倒在地。",
        knockdown: true,
        disarmed: false,
      };
    }
  }
}

// ============================================================
// 状态管理
// ============================================================

/** 检查字符串是否为伤势/致残状态 */
export function isWoundStatus(s: string): boolean {
  return s.startsWith("wound_") || s.endsWith("重创") || s === OLD_WOUND_STATUS;
}

/** 通用伤势状态标记名 */
function woundStatusName(severity: WoundSeverity): string {
  switch (severity) {
    case "deep":     return "wound_deep";
    case "grievous": return "wound_grievous";
    default:         return "";
  }
}

/**
 * 为目标实体施加伤势状态 + 致残状态。
 * 返回生成的消息片段。
 *
 * 设计原则（避免过度惩罚）：
 * - scratch/flesh → 只叙事，不加状态
 * - deep → 加 wound_deep 状态（2 惩罚骰），无致残
 * - grievous → 加 wound_grievous（3 惩罚骰）+ 部位致残
 */
export function applyWoundEffects(
  entity: WorldEntity,
  severity: WoundSeverity,
  location?: HitLocation,
): string[] {
  const messages: string[] = [];

  // 1. 伤势状态（仅 deep/grievous）
  const wsn = woundStatusName(severity);
  if (wsn && !entity.status.includes(wsn)) {
    entity.status.push(wsn);
  }

  // 2. 致残状态（仅 grievous + 有部位信息）
  if (location) {
    const disability = getDisability(location, severity);
    if (disability && !entity.status.includes(disability.statusName)) {
      entity.status.push(disability.statusName);
      messages.push(disability.impairment);
      if (disability.knockdown) {
        messages.push(`${locationLabel(location)}遭受重击，${entity.name}摔倒在地！`);
      }
      if (disability.disarmed) {
        messages.push(`${entity.name}的武器从无力手指中滑落！`);
      }
    }
  }

  return messages;
}

/** 清除目标身上所有伤势/致残状态（急救时调用） */
export function clearWoundStatuses(entity: WorldEntity, mode: WoundMode = "standard"): string[] {
  const removed: string[] = [];
  let hadGrievous = false;

  entity.status = entity.status.filter((s) => {
    if (isWoundStatus(s)) {
      removed.push(s);
      if (s === "wound_grievous" || s.endsWith("重创")) hadGrievous = true;
      return false;
    }
    return true;
  });

  // survival 模式：grievous 降级为旧伤，留 1 惩罚骰
  if (mode === "survival" && hadGrievous && !entity.status.includes(OLD_WOUND_STATUS)) {
    entity.status.push(OLD_WOUND_STATUS);
  }

  return removed;
}

/**
 * 计算实体当前所有伤势带来的总惩罚骰。
 * scratch/flesh 不贡献惩罚骰，致残不叠加。
 * deep=1, grievous=3, old_wound=1。
 * 多个伤口取最高值。
 */
export function totalWoundPenalty(entity: WorldEntity): number {
  let total = 0;
  for (const s of entity.status) {
    if (s === "wound_deep")     total = Math.max(total, 1);
    if (s === "wound_grievous") total = Math.max(total, 3);
    if (s === OLD_WOUND_STATUS) total = Math.max(total, OLD_WOUND_PENALTY);
    if (s.endsWith("重创"))     total = Math.max(total, 3);
  }
  return total;
}

// ============================================================
// 消息生成
// ============================================================

/** 伤势基础消息 */
export function woundObstacleMessage(
  targetName: string,
  severity: WoundSeverity,
  penaltyDice: number,
): string | null {
  if (penaltyDice <= 0) return null;
  const label = severityLabel(severity);
  const conNote = severity === "deep" || severity === "grievous"
    ? "，且需进行体质检定" : "";
  return `🩸 ${targetName}受到「${label}」——物理技能${penaltyDice}个惩罚骰${conNote}。`;
}
