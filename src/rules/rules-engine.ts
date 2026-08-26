// 规则集路由器 — 根据 activeRuleset 分发到对应引擎
// 统一接口，玩家/NPC 战斗都走这条路
//
// ⚠ 术语订正（docs/todo.json 的 todo-17）：这里原先叫"律书路由器"。
// 按契约，"律书"是玩家向 KP 提出规则解释/适用请求的**制度**，不是规则
// 执行器的名字——这个类才是规则执行器（读已提交状态、判定、不受 LLM 支配）。

import { RuleEngine } from "../engine/rule-engine";
import { CoCEngine, getCalledShotPenalty } from "./coc-engine";
import { GrailEngine, type RankSource } from "./grail-engine";
import type { WorldEntity, ActionIntent, CombatResult, BonusEntry } from "../types";

export type RulesetId = "dnd5e" | "cosmic-horror" | "grail";

export interface UnifiedCombatResult {
  hit: boolean;
  damage: number;
  damageType: string;
  result: "kill" | "wound" | "miss";
  critical: boolean;
  details: string;         // 规则集特定的额外描述
  ruleset: RulesetId;
  // D&D 字段
  d20Roll?: number;
  d20Bonuses?: Array<{ source: string; value: number | string }>;
  // CoC 字段
  cocRoll?: number;
  cocSuccessLevel?: string;
  sanLoss?: number;
  // 圣杯字段
  grailSuppression?: string;
  moraleResult?: string;
  // CoC 战斗字段
  hitLocation?: string;
  isImpale?: boolean;
  /** 反击/格挡命中时，反击方对攻击者造成的伤害 */
  counterDamage?: number;
  counterHit?: boolean;
}

/**
 * 把规则引擎的战斗结果转成事件日志与叙事层要的 CombatResult。
 *
 * 两边字段名不一样：critical/crit、damageType/damage_type。之前调用方是把
 * UnifiedCombatResult 直接传过去的，而 generateNarrativeLLM 读的正是 result.crit
 * 和 result.damage_type —— 这两个键在 UnifiedCombatResult 上根本不存在，于是
 * 提示词里的"暴击"永远是"否"、伤害类型永远写成 undefined，暴击的描写从来没出现过。
 *
 * 演出提示按 engine/rule-engine.ts resolveAttack() 里的同一套推导补齐，
 * 两条战斗链路给出的口径保持一致。
 */
export function toCombatResult(u: UnifiedCombatResult): CombatResult {
  const roll = u.d20Roll ?? u.cocRoll ?? 0;
  const bonuses: BonusEntry[] = (u.d20Bonuses ?? []).map(b => ({ source: b.source, value: b.value }));
  const total = bonuses.reduce((sum, b) => sum + (typeof b.value === "number" ? b.value : 0), roll);
  return {
    hit: u.hit,
    crit: u.critical,
    roll,
    bonuses,
    total,
    damage: u.damage,
    damage_type: u.damageType,
    result: u.result,
    intensity: u.result === "kill" ? 0.7 : u.result === "wound" ? 0.4 : 0.1,
    camera_hint: u.result === "kill" ? "close_up_fatal" : (u.hit ? "impact" : "miss"),
    sfx_hint: u.damageType === "piercing" ? "blade_pierce" : "weapon_clash",
  };
}

export class RulesEngine {
  private dndEngine: RuleEngine;
  private grailEngine: GrailEngine;

  constructor() {
    this.dndEngine = new RuleEngine();
    this.grailEngine = new GrailEngine();
  }

  /**
   * 裁决攻击行动（统一入口）
   */
  adjudicateAttack(
    intent: ActionIntent,
    attacker: { name: string; id: string; proficiency: number; abilities: Record<string, number>; hasSneakAttack: boolean },
    defender: WorldEntity,
    ruleset: RulesetId,
    // D&D
    hasAdvantage?: boolean,
    hasDisadvantage?: boolean,
    weaponName?: string,
    // CoC
    attackerSkill?: number,
    defenderDodge?: number,
    // CoC 生物伤害骰（如 "1d6+1d4"），默认 "1d6"
    damageDice?: string,
    // ⚠ 这里原先还有 `attackerRank?: GrailRank, defenderRank?: GrailRank` 两个参数，
    //   **收了完全不传下去** —— `case "grail"` 那支直接
    //   `this.adjudicateGrail(attacker, defender, "1d8")`，位阶是
    //   `adjudicateGrail` 从 attacker（RankSource）自己推断的（见它的注释）。
    //   参数存在却影响不了任何结果，比没有更坏：调用方以为自己指定得了位阶。
    //   删掉之后 index.ts 的调用点少了两个 `undefined` 占位。
    // 通用: 额外惩罚骰（掩护、黑暗等）
    penaltyDiceOverride?: number,
    // CoC 反击/格挡
    isFightBack?: boolean,
    fightBackDamageDice?: string,
    /** CoC 伤害加值 DB（如 "+1d4"），由角色的 STR+SIZ 决定 */
    attackerDb?: string,
  ): UnifiedCombatResult {
    switch (ruleset) {
      case "dnd5e":
        return this.adjudicateDnD(intent, attacker, defender, hasAdvantage ?? false, hasDisadvantage ?? false, weaponName ?? "shortsword");
      case "cosmic-horror":
        return this.adjudicateCoC(intent, attacker, defender, attackerSkill ?? 40, defenderDodge ?? 30, intent.method, damageDice, penaltyDiceOverride, isFightBack, fightBackDamageDice, attackerDb);
      case "grail":
        return this.adjudicateGrail(attacker, defender, "1d8");
      default:
        return this.adjudicateDnD(intent, attacker, defender, false, false, "shortsword");
    }
  }

  /** D&D 5e 裁决 */
  private adjudicateDnD(
    intent: ActionIntent,
    attacker: any,
    defender: WorldEntity,
    hasAdvantage: boolean,
    hasDisadvantage: boolean,
    weaponName: string,
  ): UnifiedCombatResult {
    const result: CombatResult = this.dndEngine.adjudicate(
      intent, attacker, { id: defender.id, name: defender.name, ac: defender.ac, hp: defender.hp },
      hasAdvantage, hasDisadvantage, weaponName
    );

    return {
      hit: result.hit,
      damage: result.damage,
      damageType: result.damage_type,
      result: result.result,
      critical: result.crit,
      details: `d20=${result.roll}+${result.total - result.roll} vs AC${defender.ac}`,
      ruleset: "dnd5e",
      d20Roll: result.roll,
      d20Bonuses: result.bonuses.map(b => ({ source: b.source, value: b.value })),
      counterDamage: undefined,
      counterHit: undefined,
    };
  }

  /** CoC 7e 裁决 */
  private adjudicateCoC(
    intent: ActionIntent,
    _attacker: any,
    defender: WorldEntity,
    attackerSkill: number,
    defenderDodge: number,
    method?: string,
    damageDice?: string,
    penaltyDiceOverride?: number,
    isFightBack?: boolean,
    fightBackDamageDice?: string,
    attackerDb?: string,
  ): UnifiedCombatResult {
    const aimedMode = method === "aimed" || !!intent.calledShot;
    const calledShot = intent.calledShot;
    // 瞄准攻击带来 1 penalty die，除非已由 getCalledShotPenalty 指定
    // 射击模式惩罚骰：burst=1, auto/suppress=2
    let penaltyDice = 0;
    if (method === "burst") penaltyDice = 1;
    else if (method === "auto" || method === "suppress") penaltyDice = 2;
    else if (aimedMode) penaltyDice = getCalledShotPenalty(calledShot ?? "") || 1;
    // 额外惩罚骰：掩护、黑暗等环境因素
    if (penaltyDiceOverride && penaltyDiceOverride > 0) {
      penaltyDice += penaltyDiceOverride;
    }
    const bonusDice = aimedMode && !calledShot ? 1 : 0;
    const dice = damageDice || "1d6";
    const result = CoCEngine.combatCheck(attackerSkill, defenderDodge, dice, bonusDice, penaltyDice, aimedMode, calledShot, isFightBack ?? false, fightBackDamageDice, attackerDb);

    const hpEffect = result.hit ? (defender.hp <= result.damage ? "kill" : "wound") : "miss";

    return {
      hit: result.hit,
      damage: result.damage,
      damageType: "bludgeoning",
      result: hpEffect,
      critical: result.isCritical,
      details: result.result,
      ruleset: "cosmic-horror",
      cocRoll: result.roll,
      cocSuccessLevel: result.successLevel,
      hitLocation: result.hitLocation,
      isImpale: result.isImpale,
      counterDamage: result.counterDamage,
      counterHit: result.counterHit,
    };
  }

  /** 圣杯裁决 */
  private adjudicateGrail(
    // 攻击方在这条路径上是玩家属性表而不是世界实体，圣杯裁决也只用它来推断位阶。
    attacker: RankSource,
    defender: WorldEntity,
    weaponDamage: string,
  ): UnifiedCombatResult {
    const result = this.grailEngine.adjudicateAttack(attacker, defender, weaponDamage);

    return {
      hit: result.hit,
      damage: result.damage,
      damageType: "slashing",
      result: result.hit ? (defender.hp <= result.damage ? "kill" : "wound") : "miss",
      critical: result.critical,
      details: result.suppression?.description ?? "普通攻击",
      ruleset: "grail",
      grailSuppression: result.suppression?.description,
      counterDamage: undefined,
      counterHit: undefined,
    };
  }

  // ==========================================================
  // CoC 专用：SAN 检定
  // ==========================================================

  static cocSkillCheck(skillValue: number, difficulty: "regular" | "hard" | "extreme" = "regular") {
    return CoCEngine.skillCheck(skillValue, difficulty);
  }

  // ==========================================================
  // 圣杯专用：位阶压制
  // ==========================================================

  getGrailEngine(): GrailEngine {
    return this.grailEngine;
  }
}
