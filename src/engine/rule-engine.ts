// POC 规则引擎 — YAML 规则匹配 + 骰子执行

import { readFileSync } from 'fs';
import { parse } from 'yaml';
import type { ActionIntent, CombatResult, BonusEntry, SaveResult, WorldState } from '../types';

interface WeaponDef { dice: string; damage_type: string; properties: string[]; }
interface CreatureDef { ac: number; hp: number; passive_perception: number; cr: string; }

export class RuleEngine {
  private rules: any[];
  private weapons: Record<string, WeaponDef>;
  private creatures: Record<string, CreatureDef>;

  constructor() {
    const yamlText = readFileSync('./src/rules/dnd5e.yaml', 'utf-8');
    const config = parse(yamlText);
    this.rules = config.rules;
    this.weapons = config.weapons;
    this.creatures = config.creatures;
  }

  /** 投骰子 */
  roll(diceExpr: string): number {
    // 1d20, 2d6, 1d6+3 等
    const match = diceExpr.match(/(\d+)d(\d+)(?:\+(\d+))?/);
    if (!match) return 0;
    const [_, count, sides, bonus] = match;
    let total = 0;
    for (let i = 0; i < parseInt(count); i++) {
      total += Math.floor(Math.random() * parseInt(sides)) + 1;
    }
    return total + (bonus ? parseInt(bonus) : 0);
  }

  /** 优势投掷——2d20取高 */
  rollWithAdvantage(): { rolls: number[]; result: number } {
    const r1 = this.roll('1d20');
    const r2 = this.roll('1d20');
    return { rolls: [r1, r2], result: Math.max(r1, r2) };
  }

  /** 劣势投掷——2d20取低 */
  rollWithDisadvantage(): { rolls: number[]; result: number } {
    const r1 = this.roll('1d20');
    const r2 = this.roll('1d20');
    return { rolls: [r1, r2], result: Math.min(r1, r2) };
  }

  /** 裁决攻击行动 */
  adjudicate(
    intent: ActionIntent,
    attacker: {
      proficiency: number;
      abilities: Record<string, number>;
      name: string;
      hasSneakAttack: boolean;
      /** 特性/专长带来的额外攻击加值 */
      attackBonus?: number;
      /** 特性/专长带来的额外伤害加值（flat） */
      damageBonus?: number;
      /** 特性/专长带来的额外伤害骰 */
      damageDice?: string;
    },
    defender: { ac: number; hp: number; id: string; name: string },
    hasAdvantage: boolean,
    hasDisadvantage: boolean,
    weaponName: string
  ): CombatResult {
    const weapon = this.weapons[weaponName];
    if (!weapon) throw new Error(`Unknown weapon: ${weaponName}`);

    // Step 1: 投攻击骰
    let attackRoll: number;
    let bonusEntries: BonusEntry[] = [];
    const abilityMod = Math.floor(((attacker.abilities.dexterity || attacker.abilities.strength || 0) - 10) / 2);

    if (hasAdvantage && !hasDisadvantage) {
      const adv = this.rollWithAdvantage();
      attackRoll = adv.result;
      bonusEntries.push({ source: '优势取高', value: `${adv.rolls[0]}/${adv.rolls[1]}` });
    } else if (hasDisadvantage && !hasAdvantage) {
      const dis = this.rollWithDisadvantage();
      attackRoll = dis.result;
      bonusEntries.push({ source: '劣势取低', value: `${dis.rolls[0]}/${dis.rolls[1]}` });
    } else {
      attackRoll = this.roll('1d20');
    }

    bonusEntries.push({ source: '熟练加值', value: attacker.proficiency });
    bonusEntries.push({ source: '敏捷调整', value: abilityMod });

    if (attacker.attackBonus) {
      bonusEntries.push({ source: '特性加值', value: attacker.attackBonus });
    }

    const total = attackRoll + attacker.proficiency + abilityMod + (attacker.attackBonus ?? 0);
    const hit = total >= defender.ac;
    const crit = attackRoll === 20;

    // Step 2: 伤害计算
    let damage = 0;
    if (hit) {
      damage = this.roll(weapon.dice) + abilityMod;
      // 特性/专长额外伤害加值
      if (attacker.damageBonus) {
        damage += attacker.damageBonus;
        bonusEntries.push({ source: '特性伤害加值', value: attacker.damageBonus });
      }
      // 特性/专长额外伤害骰
      if (attacker.damageDice) {
        const extra = this.roll(attacker.damageDice);
        damage += extra;
        bonusEntries.push({ source: `额外${attacker.damageDice}`, value: extra });
      }
      if (crit) damage += this.roll(weapon.dice); // 重击=双倍伤害骰

      // 偷袭条件判定
      if (attacker.hasSneakAttack && hasAdvantage && weapon.properties.includes('finesse')) {
        const sneakDice = Math.floor((3 + 1) / 2); // Lv3 = 2d6
        const sneakDamage = this.roll(`${sneakDice}d6`);
        damage += sneakDamage;
        bonusEntries.push({ source: '偷袭', value: sneakDamage });
      }
    }

    // Step 3: 结果判定
    const overkill = damage - defender.hp;
    const result = !hit ? 'miss' : (damage >= defender.hp ? 'kill' : 'wound');
    const intensity = result === 'kill' ? 0.7 : (result === 'wound' ? 0.4 : 0.1);

    return {
      hit,
      crit,
      roll: attackRoll,
      bonuses: bonusEntries,
      total,
      damage,
      damage_type: weapon.damage_type,
      result,
      intensity,
      camera_hint: result === 'kill' ? 'close_up_fatal' : (hit ? 'impact' : 'miss'),
      sfx_hint: weapon.damage_type === 'piercing' ? 'blade_pierce' : 'weapon_clash'
    };
  }

  /** 获取生物数据 */
  getCreature(name: string): CreatureDef | undefined {
    return this.creatures[name];
  }

  /** 获取武器数据 */
  getWeapon(name: string): WeaponDef | undefined {
    return this.weapons[name];
  }

  // 属性名 → 中文标签
  private readonly ABILITY_LABELS: Record<string, string> = {
    strength: "力量", dexterity: "敏捷", constitution: "体质",
    intelligence: "智力", wisdom: "感知", charisma: "魅力",
  };

  /** 计算属性调整值 (5e: floor((value-10)/2)) */
  abilityMod(value: number): number {
    return Math.floor((value - 10) / 2);
  }

  /** 计算法术豁免 DC: 8 + prof + 施法属性调整 */
  spellSaveDC(proficiency: number, spellcastingMod: number): number {
    return 8 + proficiency + spellcastingMod;
  }

  /**
   * D&D 5e 豁免检定
   * @param ability 属性名
   * @param dc      目标 DC
   * @param abilityValue 属性值
   * @param proficient 是否熟练
   * @param proficiencyBonus 熟练加值 (默认 2)
   * @param advantage 是否有优势
   * @param disadvantage 是否有劣势
   */
  adjudicateSave(
    ability: string,
    dc: number,
    abilityValue: number,
    proficient: boolean,
    proficiencyBonus: number = 2,
    advantage: boolean = false,
    disadvantage: boolean = false
  ): SaveResult {
    // 投骰（优势/劣势）
    let roll: number;
    if (advantage && !disadvantage) {
      const r1 = this.roll("1d20");
      const r2 = this.roll("1d20");
      roll = Math.max(r1, r2);
    } else if (disadvantage && !advantage) {
      const r1 = this.roll("1d20");
      const r2 = this.roll("1d20");
      roll = Math.min(r1, r2);
    } else {
      roll = this.roll("1d20");
    }

    const mod = this.abilityMod(abilityValue);
    const profBonus = proficient ? proficiencyBonus : 0;
    const total = roll + mod + profBonus;

    return {
      ability,
      abilityLabel: this.ABILITY_LABELS[ability] ?? ability,
      roll,
      mod,
      proficient,
      proficiencyBonus: profBonus,
      total,
      dc,
      success: total >= dc,
      critical: roll === 20,
      fumble: roll === 1,
    };
  }
}
