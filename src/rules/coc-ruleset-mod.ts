// CoC 规则集模组系统 — 支持 Pulp Cthulhu 等变体规则
// RulesetMod 钩子模式：通过 hook 函数修改引擎行为，不侵入核心逻辑
// ============================================================

import {
  CoCEngine,
  type CombatCheckResult,
} from "./coc-engine";

// ============================================================
// Hook 接口定义
// ============================================================

export interface RulesetModHooks {
  /** 规则集标识 */
  id: string;
  /** 显示名称 */
  label: string;

  // ── 生命值 ──

  /** 计算最大 HP（覆盖默认 CON） */
  calcMaxHP?: (con: number, siz?: number) => number;

  /** 重伤阈值（默认 Math.ceil(maxHP/2)） */
  majorWoundThreshold?: (maxHP: number) => number;

  /** 是否启用重伤系统（Pulp 可禁用） */
  enableMajorWound?: boolean;

  // ── SAN ──

  /** SAN 每周恢复量（默认 1d3） */
  sanWeeklyRecovery?: () => number;

  /** 阅读典籍的 SAN 损失修正（乘数，默认 1.0） */
  tomeSanMultiplier?: number;

  /** 最大 SAN 值计算（默认 99 - CM） */
  calcMaxSAN?: (pow: number, cm: number) => number;

  // ── 战斗 ──

  /** 伤害骰修正：return "加值" | "减半" | "翻倍" */
  modifyDamage?: (damage: number, context: { isImpale: boolean; isCritical: boolean }) => number;

  /** 闪避限制（Pulp 可多次闪避） */
  maxDodgesPerRound?: number;

  /** 是否允许双武器战斗 */
  allowDualWielding?: boolean;

  /** 双武器战斗的惩罚骰 */
  dualWieldPenalty?: number;

  // ── 幸运 ──

  /** 每日幸运恢复量（默认 POW） */
  luckDailyRecovery?: (pow: number) => number;

  /** 燃运上限（默认 0 = 无限，Pulp 可设置每轮上限） */
  maxLuckPerRoll?: number;

  // ── 技能 ──

  /** 技能上限（默认 99，Pulp 可 110+） */
  maxSkill?: number;

  /** 是否允许推动检定（Pulp 默认允许） */
  allowPushing?: boolean;

  // ── 战斗修正 ──

  /** 对 combatCheck 结果的后期修正 */
  onCombatResult?: (result: CombatCheckResult) => CombatCheckResult;
}

// ============================================================
// 默认（标准 CoC 7e）实现
// ============================================================

export const DEFAULT_COC_HOOKS: RulesetModHooks = {
  id: "coc7e",
  label: "克苏鲁的呼唤 7 版",

  calcMaxHP: (con: number) => con,

  majorWoundThreshold: (maxHP: number) => Math.ceil(maxHP / 2),

  enableMajorWound: true,

  sanWeeklyRecovery: () => CoCEngine.rollDice("1d3"),

  tomeSanMultiplier: 1.0,

  calcMaxSAN: (_pow: number, cm: number) => Math.max(0, 99 - cm),

  maxDodgesPerRound: 1,

  allowDualWielding: false,

  luckDailyRecovery: (pow: number) => pow,

  maxSkill: 99,

  allowPushing: true,
};

// ============================================================
// Pulp Cthulhu 实现
// ============================================================

export const PULP_COC_HOOKS: RulesetModHooks = {
  id: "pulpcoc",
  label: "Pulp Cthulhu",

  // HP = CON + floor(CON/2) ≈ 1.5x 标准
  calcMaxHP: (con: number) => {
    // Pulp Cthulhu: HP = CON + (CON/2 向上取整)
    // 等级 (Tier) 1-4 影响 HP 倍数，简化按最低 tier ≈ CON*1.5
    return con + Math.ceil(con / 2);
  },

  // Pulp：重伤阈值为 1/4（更容易触发但 Pulp 主角更能承受）
  majorWoundThreshold: (maxHP: number) => Math.ceil(maxHP / 4),

  // Pulp 仍有重伤
  enableMajorWound: true,

  // 每周 SAN 恢复 1d8+2
  sanWeeklyRecovery: () => CoCEngine.rollDice("1d8") + 2,

  // 典籍 SAN 减半
  tomeSanMultiplier: 0.5,

  // Pulp 最大 SAN = 99 - CM（与标准相同）
  calcMaxSAN: (_pow: number, cm: number) => Math.max(0, 99 - cm),

  // Pulp 英雄每轮可闪避多次
  maxDodgesPerRound: 3,

  // 允许双武器
  allowDualWielding: true,

  // 双武器 -1 penalty die
  dualWieldPenalty: 1,

  // 每日恢复全部幸运
  luckDailyRecovery: (pow: number) => pow,

  // Pulp 技能上限 110
  maxSkill: 110,

  // 允许推动
  allowPushing: true,
};

// ============================================================
// 规则集模组注册表
// ============================================================

const MOD_REGISTRY: Record<string, RulesetModHooks> = {
  coc7e: DEFAULT_COC_HOOKS,
  pulpcoc: PULP_COC_HOOKS,
};

export function getRulesetMod(id: string): RulesetModHooks {
  return MOD_REGISTRY[id] ?? DEFAULT_COC_HOOKS;
}

export function registerRulesetMod(id: string, hooks: RulesetModHooks): void {
  MOD_REGISTRY[id] = hooks;
}

// ============================================================
// Pulp Cthulhu 天赋系统
// ============================================================

export interface PulpTalent {
  id: string;
  name: string;
  description: string;
  /** 类别 */
  category: "战斗" | "调查" | "通用" | "社交" | "生存";
  /** 需求 */
  requirements?: Partial<{
    minSTR: number;
    minDEX: number;
    minCON: number;
    minSkill: number;
    skillName: string;
    otherTalent: string;
  }>;
  /** 效果简述 */
  effect: string;
}

/** Pulp Cthulhu 天赋列表 */
export const PULP_TALENTS: PulpTalent[] = [
  {
    id: "fighter",
    name: "斗士",
    category: "战斗",
    description: "近战伤害 +2，HP +3",
    requirements: { minSTR: 60, minCON: 60 },
    effect: "近战伤害+2, HP+3",
  },
  {
    id: "tough",
    name: "坚韧",
    category: "战斗",
    description: "重伤状态下不昏迷，仍可行动但所有行动 -1 penalty die",
    requirements: { minCON: 70 },
    effect: "重伤不昏迷，行动-1惩罚骰",
  },
  {
    id: "alert",
    name: "警觉",
    category: "调查",
    description: "先手权 +2 penalty dice（对敌人），不会被突袭",
    requirements: { minDEX: 60 },
    effect: "先手+2惩罚骰(对敌)，不会被突袭",
  },
  {
    id: "medic",
    name: "战地医护",
    category: "生存",
    description: "急救/医学技能检定成功时额外恢复 1d3 HP",
    requirements: { minSkill: 50, skillName: "急救" },
    effect: "急救/医学成功额外+1d3 HP",
  },
  {
    id: "iron_will",
    name: "钢铁意志",
    category: "通用",
    description: "SAN 检定成功时少损失 1 点 SAN（至少 0）",
    requirements: { minCON: 50 },
    effect: "SAN检定成功-1损失",
  },
  {
    id: "sharpshooter",
    name: "神射手",
    category: "战斗",
    description: "远程瞄准射击时 penalty dice 减少 1",
    requirements: { minDEX: 60 },
    effect: "远程瞄准-1惩罚骰",
  },
  {
    id: "fast_heal",
    name: "快速自愈",
    category: "生存",
    description: "自然恢复速度翻倍（每日恢复 2 HP 而非 1）",
    requirements: { minCON: 70 },
    effect: "自然恢复翻倍",
  },
  {
    id: "silver_tongue",
    name: "巧舌如簧",
    category: "社交",
    description: "社交技能检定获得 1 奖励骰",
    requirements: { minSkill: 60, skillName: "说服" },
    effect: "社交技能+1奖励骰",
  },
  {
    id: "daredevil",
    name: "亡命之徒",
    category: "通用",
    description: "闪避成功后下轮攻击获得 1 奖励骰",
    requirements: { minDEX: 65 },
    effect: "闪避成功后下轮+1奖励骰",
  },
  {
    id: "bookworm",
    name: "书虫",
    category: "调查",
    description: "阅读典籍的 SAN 损失减半（与 Pulp 规则叠加）",
    requirements: { minSkill: 60, skillName: "克苏鲁神话" },
    effect: "典籍SAN损失减半",
  },
];

/**
 * 检查角色是否符合天赋条件
 */
export function checkTalentRequirements(
  talent: PulpTalent,
  attrs: { STR?: number; DEX?: number; CON?: number; [key: string]: number | undefined },
  skills: Record<string, number>,
  ownedTalents: string[],
): { satisfied: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const reqs = talent.requirements;
  if (!reqs) return { satisfied: true, reasons: [] };

  if (reqs.minSTR && (attrs.STR ?? 0) < reqs.minSTR) {
    reasons.push(`STR ${reqs.minSTR} 需求未满足（当前 ${attrs.STR ?? 0}）`);
  }
  if (reqs.minDEX && (attrs.DEX ?? 0) < reqs.minDEX) {
    reasons.push(`DEX ${reqs.minDEX} 需求未满足（当前 ${attrs.DEX ?? 0}）`);
  }
  if (reqs.minCON && (attrs.CON ?? 0) < reqs.minCON) {
    reasons.push(`CON ${reqs.minCON} 需求未满足（当前 ${attrs.CON ?? 0}）`);
  }
  if (reqs.minSkill && reqs.skillName) {
    const skillVal = skills[reqs.skillName] ?? 0;
    if (skillVal < reqs.minSkill) {
      reasons.push(`${reqs.skillName} ${reqs.minSkill} 需求未满足（当前 ${skillVal}）`);
    }
  }
  if (reqs.otherTalent && !ownedTalents.includes(reqs.otherTalent)) {
    reasons.push(`前置天赋「${reqs.otherTalent}」未获得`);
  }

  return { satisfied: reasons.length === 0, reasons };
}

/**
 * 应用 Pulp 天赋对战斗结果的影响
 */
export function applyTalentToCombat(
  result: CombatCheckResult,
  talents: PulpTalent[],
  isMelee: boolean,
): CombatCheckResult {
  let modified = { ...result };

  for (const talent of talents) {
    if (talent.id === "fighter" && isMelee) {
      // 斗士：近战伤害 +2
      modified.damage += 2;
    }
    if (talent.id === "tough" && modified.hit) {
      // 坚韧：重伤标记但不昏迷（在外部逻辑中处理）
      // 这里仅作为标记
    }
  }

  return modified;
}
