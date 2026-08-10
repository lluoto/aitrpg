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
  id: "cosmic-horror",
  label: "宇宙恐怖（百分位）",

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
// 规则集模组注册表
// ============================================================
//
// 变体规则（不同 HP 计算、技能上限、天赋体系等）不再内置于本仓库。
// 需要变体规则时，由已加载模组或用户提供的规则书通过 registerRulesetMod() 注入。

const MOD_REGISTRY: Record<string, RulesetModHooks> = {
  "cosmic-horror": DEFAULT_COC_HOOKS,
};

export function getRulesetMod(id: string): RulesetModHooks {
  return MOD_REGISTRY[id] ?? DEFAULT_COC_HOOKS;
}

export function registerRulesetMod(id: string, hooks: RulesetModHooks): void {
  MOD_REGISTRY[id] = hooks;
}
