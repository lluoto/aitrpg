// 律书路由器 — 根据 activeRuleset 分发到对应引擎
// 统一接口，玩家/NPC 战斗都走这条路

import { RuleEngine } from "../engine/rule-engine";
import { CoCEngine, getCalledShotPenalty, type HitLocation } from "./coc-engine";
import { GrailEngine, type GrailRank } from "./grail-engine";
import type { WorldEntity, ActionIntent, CombatResult } from "../types";

export type RulesetId = "dnd5e" | "coc7e" | "grail" | "pulpcoc";

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
  counterDamage?: number;
  counterHit?: boolean;
  /** 反击/格挡命中时，反击方对攻击者造成的伤害 */
  counterDamage?: number;
  counterHit?: boolean;
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
    // 圣杯
    attackerRank?: GrailRank,
    defenderRank?: GrailRank,
    // 通用: 额外惩罚骰（掩护、黑暗等）
    penaltyDiceOverride?: number,
    // CoC 反击/格挡
    isFightBack?: boolean,
    fightBackDamageDice?: string,
  ): UnifiedCombatResult {
    switch (ruleset) {
      case "dnd5e":
        return this.adjudicateDnD(intent, attacker, defender, hasAdvantage ?? false, hasDisadvantage ?? false, weaponName ?? "shortsword");
      case "coc7e":
        return this.adjudicateCoC(intent, attacker, defender, attackerSkill ?? 40, defenderDodge ?? 30, intent.method, damageDice, penaltyDiceOverride, isFightBack, fightBackDamageDice);
      case "grail":
        return this.adjudicateGrail(attacker as any, defender, "1d8");
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
    attacker: any,
    defender: WorldEntity,
    attackerSkill: number,
    defenderDodge: number,
    method?: string,
    damageDice?: string,
    penaltyDiceOverride?: number,
    isFightBack?: boolean,
    fightBackDamageDice?: string,
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
    const result = CoCEngine.combatCheck(attackerSkill, defenderDodge, dice, bonusDice, penaltyDice, aimedMode, calledShot, isFightBack ?? false, fightBackDamageDice);

    const hpEffect = result.hit ? (defender.hp <= result.damage ? "kill" : "wound") : "miss";

    return {
      hit: result.hit,
      damage: result.damage,
      damageType: "bludgeoning",
      result: hpEffect,
      critical: result.isCritical,
      details: result.result,
      ruleset: "coc7e",
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
    attacker: WorldEntity,
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
