// D&D 5e 法术引擎 — 法术 YAML 加载 + 执行
// 职责：法术查询、环位管理、施法执行

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import type { RuleEngine } from "../engine/rule-engine";
import type { CombatResult } from "../types";
import { log } from "../log";

// ============================================================
// YAML 类型
// ============================================================

interface SpellDef {
  name: string;
  level: number;              // 0 = 戏法, 1-9
  school: string;
  casting_time: string;
  range: string;
  components: string;
  duration: string;
  description: string;
  damage?: string;            // "1d10" | "3d6" | "1d4+1"
  damage_count?: number;      // 魔法飞弹 3 发 / 灼热射线 3 束
  damage_type?: string;
  attack_type: string;        // "ranged_spell" | "save_dexterity" | "save_dexterity_half" | "auto_hit" | "heal" | "buff" | "utility" | "movement"
  healing?: string;           // "1d8+mod" | "1"
  revive?: boolean;
  ac_bonus?: number;
  classes: string[];
  damage_at_higher_level?: Record<string, string>;
}

interface SpellSlotsByLevel {
  [spellLevel: number]: number;  // 环位数量
}

interface SpellsYAML {
  spells: Record<string, SpellDef>;
  spell_slots_by_class: {
    full_caster: Record<number, SpellSlotsByLevel>;
    half_caster: Record<number, SpellSlotsByLevel>;
  };
  known_spells: Record<string, Record<number, string[]>>;
}

// ============================================================
// 法术施放结果
// ============================================================

interface CastResult {
  success: boolean;
  spellName: string;
  spellLevel: number;
  slotUsed: number | null;       // 消耗的环位（戏法=null）
  narrative: string;
  damage?: number;
  damageType?: string;
  healingAmount?: number;
  combatResult?: CombatResult;   // 攻击法术的 combat result
  targetName?: string;
}

// ============================================================
// 法术引擎
// ============================================================

export class SpellEngine {
  private spells: Map<string, SpellDef> = new Map();
  private knownSpells: Map<string, string[]> = new Map();
  private fullCasterSlots: Map<number, SpellSlotsByLevel> = new Map();
  private halfCasterSlots: Map<number, SpellSlotsByLevel> = new Map();

  constructor(yamlPath: string = "./src/rules/spells.yaml") {
    this.load(yamlPath);
  }

  private load(path: string) {
    try {
      const raw = readFileSync(path, "utf-8");
      const data = parseYaml(raw) as SpellsYAML;
      if (data?.spells) {
        for (const [key, spell] of Object.entries(data.spells)) {
          this.spells.set(key, spell);
        }
      }
      if (data?.known_spells) {
        for (const [cls, levels] of Object.entries(data.known_spells)) {
          for (const [level, spells] of Object.entries(levels)) {
            const key = `${cls}_${level}`;
            this.knownSpells.set(key, spells);
          }
        }
      }
      if (data?.spell_slots_by_class?.full_caster) {
        for (const [level, slots] of Object.entries(data.spell_slots_by_class.full_caster)) {
          this.fullCasterSlots.set(parseInt(level), slots);
        }
      }
      if (data?.spell_slots_by_class?.half_caster) {
        for (const [level, slots] of Object.entries(data.spell_slots_by_class.half_caster)) {
          this.halfCasterSlots.set(parseInt(level), slots);
        }
      }
    } catch (err) {
      log.warn("spell", `法术系统 YAML 加载失败: ${(err as Error).message}`);
    }
  }

  /** 获取法术定义 */
  getSpell(spellId: string): SpellDef | undefined {
    return this.spells.get(spellId);
  }

  /** 列出所有法术 ID */
  listSpells(): string[] {
    return [...this.spells.keys()];
  }

  /** 获取某职业某等级已知法术列表 */
  getKnownSpells(archetypeId: string, level: number): string[] {
    const key = `${archetypeId}_${level}`;
    return this.knownSpells.get(key) ?? [];
  }

  /** 获取施法职业的环位配置 */
  getSlots(archetypeId: string, level: number): SpellSlotsByLevel {
    const fullCasters = ["sorcerer", "wizard", "cleric", "bard", "druid"];
    const halfCasters = ["paladin", "ranger"];
    if (fullCasters.includes(archetypeId)) {
      return this.fullCasterSlots.get(level) ?? {};
    }
    if (halfCasters.includes(archetypeId)) {
      return this.halfCasterSlots.get(level) ?? {};
    }
    return {};
  }

  /** 判断职业是否施法者 */
  isSpellcaster(archetypeId: string): boolean {
    const casters = ["sorcerer", "wizard", "cleric", "bard", "warlock", "paladin", "druid", "ranger"];
    return casters.includes(archetypeId);
  }

  /**
   * 执行法术
   * @param spellId  法术 ID
   * @param targetName 目标实体名(可选)
   * @param attackerAttrs 施法者属性
   * @param proficiency 熟练加值
   * @param ruleEngine 律书引擎
   * @param archetypeId 职业 ID（用于判断施法属性）
   */
  cast(
    spellId: string,
    targetName: string | undefined,
    attackerAttrs: Record<string, number>,
    proficiency: number,
    ruleEngine: RuleEngine,
    archetypeId: string,
  ): CastResult {
    const spell = this.spells.get(spellId);
    if (!spell) {
      return { success: false, spellName: spellId, spellLevel: 0, slotUsed: null, narrative: `你不知如何施展「${spellId}」。` };
    }

    // 计算施法属性调整值
    const spellcastingAbility = this.getSpellcastingAbility(archetypeId);
    const spellMod = ruleEngine.abilityMod(attackerAttrs[spellcastingAbility] ?? 10);
    const dc = ruleEngine.spellSaveDC(proficiency, spellMod);

    // 不同法术类型分发
    switch (spell.attack_type) {
      case "heal":
        return this.handleHeal(spell, spellMod, ruleEngine, targetName);
      case "ranged_spell":
        return this.handleAttackSpell(spell, spellMod, proficiency, ruleEngine, attackerAttrs, archetypeId, targetName);
      case "save_dexterity":
        return this.handleSaveSpell(spell, dc, ruleEngine, false, targetName);
      case "save_dexterity_half":
        return this.handleSaveSpell(spell, dc, ruleEngine, true, targetName);
      case "auto_hit":
        return this.handleAutoHit(spell, ruleEngine, targetName);
      case "buff":
        return this.handleBuff(spell, targetName);
      case "utility":
        return this.handleUtility(spell);
      case "movement":
        return this.handleMovement(spell);
      default:
        return { success: true, spellName: spell.name, spellLevel: spell.level, slotUsed: null, narrative: spell.description };
    }
  }

  private getSpellcastingAbility(archetypeId: string): string {
    const map: Record<string, string> = {
      wizard: "intelligence",
      sorcerer: "charisma",
      cleric: "wisdom",
      druid: "wisdom",
      bard: "charisma",
      warlock: "charisma",
      paladin: "charisma",
      ranger: "wisdom",
    };
    return map[archetypeId] ?? "intelligence";
  }

  private handleHeal(spell: SpellDef, mod: number, ruleEngine: RuleEngine, targetName?: string): CastResult {
    let healAmount: number;
    if (spell.healing === "1d8+mod") {
      const base = ruleEngine.roll("1d8");
      healAmount = base + mod;
    } else if (spell.healing) {
      healAmount = parseInt(spell.healing) || 0;
    } else {
      healAmount = 0;
    }

    const targetDesc = targetName ? `对 ${targetName}` : "";
    const narrative = `${spell.name}！${targetDesc} 恢复 ${healAmount} 点生命值。`;
    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: spell.level > 0 ? spell.level : null,
      healingAmount: healAmount,
      narrative,
    };
  }

  private handleAttackSpell(
    spell: SpellDef,
    mod: number,
    proficiency: number,
    ruleEngine: RuleEngine,
    _attrs: Record<string, number>,
    // 攻击法术这一支不看职业（伤害由法术本身定），但签名与 castSpell 对齐着传下来
    _archetypeId: string,
    targetName?: string,
  ): CastResult {
    // 复用 adjudicate 的逻辑——但这里是法术攻击，需要额外的抽象
    // 简化：直接投 d20 + mod + prof vs 默认 AC 12
    const roll = ruleEngine.roll("1d20");
    const total = roll + mod + proficiency;
    const ac = 12; // 默认
    const hit = total >= ac;
    const crit = roll === 20;

    let damage = 0;
    if (hit) {
      const dice = crit ? this.doubleDice(spell.damage ?? "1d0") : (spell.damage ?? "1d0");
      damage = this.rollDamage(dice, ruleEngine, spell.damage_count);
    }

    const targetDesc = targetName ? ` 目标: ${targetName}` : "";
    const hitLabel = hit ? (crit ? "暴击！" : "命中") : "未命中";
    const dmgStr = hit ? `(${damage} ${spell.damage_type}伤害)` : "";

    const narrative = `你施展${spell.name}！${targetDesc}\n掷骰: d20=${roll} + ${mod}(施法) + ${proficiency}(熟练) = ${total} vs AC ${ac} → ${hitLabel}${dmgStr}`;

    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: spell.level > 0 ? spell.level : null,
      damage, damageType: spell.damage_type,
      targetName,
      narrative,
    };
  }

  private handleSaveSpell(
    spell: SpellDef, dc: number, ruleEngine: RuleEngine, halfOnSave: boolean, targetName?: string,
  ): CastResult {
    // 目标豁免检定（简化：d20 + 2 vs dc）
    const saveRoll = ruleEngine.roll("1d20") + 2;
    const saved = saveRoll >= dc;

    let damage = 0;
    if (!saved || halfOnSave) {
      const dice = spell.damage ?? "1d0";
      damage = this.rollDamage(dice, ruleEngine, spell.damage_count);
      if (saved && halfOnSave) damage = Math.max(1, Math.floor(damage / 2));
    }

    const targetDesc = targetName ? ` 目标: ${targetName}` : "";
    const saveLabel = saved ? "成功(伤害减半)" : "失败";
    const dmgStr = damage > 0 ? `(${damage} ${spell.damage_type}伤害)` : "";

    const narrative = `你施展${spell.name}！${targetDesc}\n目标豁免 ${saveLabel}${dmgStr}`;
    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: spell.level > 0 ? spell.level : null,
      damage, damageType: spell.damage_type,
      targetName,
      narrative,
    };
  }

  private handleAutoHit(spell: SpellDef, ruleEngine: RuleEngine, targetName?: string): CastResult {
    let totalDamage = 0;
    const count = spell.damage_count ?? 1;
    for (let i = 0; i < count; i++) {
      totalDamage += this.rollDamage(spell.damage ?? "1d4+1", ruleEngine);
    }

    const targetDesc = targetName ? ` 目标: ${targetName}` : "";
    const narrative = `你施展${spell.name}！${targetDesc} 自动命中！${count} 枚飞弹造成 ${totalDamage} 点 ${spell.damage_type} 伤害。`;
    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: spell.level > 0 ? spell.level : null,
      damage: totalDamage, damageType: spell.damage_type,
      targetName,
      narrative,
    };
  }

  private handleBuff(spell: SpellDef, targetName?: string): CastResult {
    const targetDesc = targetName ? `对 ${targetName}` : "自身";
    const bonusDesc = spell.ac_bonus ? ` AC+${spell.ac_bonus}` : " 获得增益效果";
    const narrative = `你施展${spell.name}！${targetDesc}${bonusDesc}。`;
    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: spell.level > 0 ? spell.level : null,
      narrative,
    };
  }

  private handleUtility(spell: SpellDef): CastResult {
    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: null,
      narrative: `你施展${spell.name}。${spell.description}`,
    };
  }

  private handleMovement(spell: SpellDef): CastResult {
    return {
      success: true, spellName: spell.name, spellLevel: spell.level,
      slotUsed: spell.level > 0 ? spell.level : null,
      narrative: `你施展${spell.name}！你消失在银色薄雾中，在 30 英尺外重新出现。`,
    };
  }

  // ============================================================
  // 辅助
  // ============================================================

  private rollDamage(diceExpr: string, ruleEngine: RuleEngine, count: number = 1): number {
    let total = 0;
    for (let i = 0; i < count; i++) {
      total += ruleEngine.roll(diceExpr);
    }
    return total;
  }

  private doubleDice(diceExpr: string): string {
    // "1d6" → "2d6", "1d4+1" → "2d4+1"
    return diceExpr.replace(/^(\d+)d/, (_, n) => `${parseInt(n) * 2}d`);
  }
}
