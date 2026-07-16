// CoC 7e 物品装备系统
// 护甲减伤 / 负重 / 耐久 / 武器属性扩展
// ============================================================

import type { HitLocation, CombatCheckResult } from "./coc-engine";

// ============================================================
// 护甲定义
// ============================================================

export interface CoCArmorDef {
  name: string;
  /** 护甲类型 */
  category: "软质" | "硬质" | "结构性" | "临时";
  /** 覆盖部位 */
  coverage: HitLocation[];
  /** 减伤值（DR）— 对覆盖部位的每次攻击扣除 */
  dr: number;
  /** 最大耐久 */
  maxDurability: number;
  /** 重量（负重单位） */
  weight: number;
  /** 价格（美元） */
  price: number;
  /** 是否可堆叠（如多件软质护甲可叠加） */
  stackable: boolean;
  /** 描述 */
  description: string;
  /** 1920s 是否合法携带 */
  legal: boolean;
}

/** 1920s 护甲表 */
export const COC_ARMOR: CoCArmorDef[] = [
  {
    name: "厚皮夹克",
    category: "软质",
    coverage: ["胸部", "腹部", "右臂", "左臂"],
    dr: 1,
    maxDurability: 5,
    weight: 3,
    price: 15,
    stackable: false,
    description: "厚重的皮革外套，能抵挡轻微割伤和钝击",
    legal: true,
  },
  {
    name: "防刺背心",
    category: "软质",
    coverage: ["胸部", "腹部"],
    dr: 2,
    maxDurability: 8,
    weight: 4,
    price: 40,
    stackable: false,
    description: "多层凯夫拉纤维制成的防刺背心",
    legal: true,
  },
  {
    name: "警用防弹背心",
    category: "硬质",
    coverage: ["胸部", "腹部"],
    dr: 4,
    maxDurability: 12,
    weight: 8,
    price: 200,
    stackable: false,
    description: "警用标准防弹背心，内置陶瓷插板，可抵御手枪弹",
    legal: true,
  },
  {
    name: "军用防弹衣",
    category: "硬质",
    coverage: ["胸部", "腹部", "右臂", "左臂"],
    dr: 6,
    maxDurability: 20,
    weight: 12,
    price: 500,
    stackable: false,
    description: "军用级全身防弹衣，可抵御步枪弹",
    legal: false,
  },
  {
    name: "摩托车头盔",
    category: "硬质",
    coverage: ["头部"],
    dr: 3,
    maxDurability: 6,
    weight: 2,
    price: 25,
    stackable: false,
    description: "硬质摩托车头盔，能显著减轻头部冲击",
    legal: true,
  },
  {
    name: "钢盔",
    category: "硬质",
    coverage: ["头部"],
    dr: 4,
    maxDurability: 10,
    weight: 3,
    price: 10,
    stackable: false,
    description: "一战军用钢盔，对坠落物和弹片效果良好",
    legal: true,
  },
  {
    name: "厚重衣物",
    category: "临时",
    coverage: ["胸部", "腹部", "右臂", "左臂", "右腿", "左腿"],
    dr: 1,
    maxDurability: 3,
    weight: 2,
    price: 8,
    stackable: true,
    description: "多层冬装、工装等厚重衣物，聊胜于无",
    legal: true,
  },
  {
    name: "木制盾牌",
    category: "结构性",
    coverage: ["右臂", "胸部", "腹部"],
    dr: 3,
    maxDurability: 8,
    weight: 5,
    price: 20,
    stackable: false,
    description: "自制木盾，可抵挡冷兵器和部分小型火器",
    legal: true,
    // 注意：使用盾牌需要占用一只手
  },
  {
    name: "铁板甲",
    category: "结构性",
    coverage: ["胸部", "腹部", "头部"],
    dr: 8,
    maxDurability: 25,
    weight: 20,
    price: 300,
    stackable: false,
    description: "中世纪式铁板胸甲，极其笨重但防御力惊人",
    legal: true,
  },
];

// ============================================================
// 全套武器定义（扩展 CoCWeaponDef）
// ============================================================

export interface CoCWeaponFullDef {
  /** 弹药类型 */
  ammoType: string | null;
  /** 弹容量 */
  capacity: number | null;
  /** 基础技能值 */
  baseSkill: number;
  /** 伤害骰（如 "1d8", "2d6+2", "4d10"） */
  damage: string;
  /** 有效射程（米），近战武器为 0 */
  range: number;
  /** 需用手数 */
  hands: 1 | 2;
  /** 重量（负重单位） */
  weight: number;
  /** 最大耐久 */
  maxDurability: number;
  /** 特性标签 */
  traits: string[];
  /** 价格（美元） */
  price: number;
}

/** 1920s CoC 武器表（全面参数） */
export const COC_WEAPONS_FULL: Record<string, CoCWeaponFullDef> = {
  // ── 徒手 ──
  "格斗(肉搏)": { ammoType: null, capacity: null, baseSkill: 25, damage: "1d3+db", range: 0, hands: 1, weight: 0, maxDurability: 99, traits: ["徒手"], price: 0 },
  "踢击":        { ammoType: null, capacity: null, baseSkill: 25, damage: "1d6+db", range: 0, hands: 1, weight: 0, maxDurability: 99, traits: ["徒手"], price: 0 },

  // ── 冷兵器 ──
  "猎刀":        { ammoType: null, capacity: null, baseSkill: 30, damage: "1d4+db", range: 0, hands: 1, weight: 1, maxDurability: 15, traits: ["穿刺", "可投掷"], price: 20 },
  "棒球棍":      { ammoType: null, capacity: null, baseSkill: 25, damage: "1d6+db", range: 0, hands: 2, weight: 2, maxDurability: 12, traits: ["钝器", "易碎"], price: 10 },
  "消防斧":      { ammoType: null, capacity: null, baseSkill: 30, damage: "1d8+db", range: 0, hands: 2, weight: 4, maxDurability: 18, traits: ["挥砍", "破门"], price: 15 },
  "撬棍":        { ammoType: null, capacity: null, baseSkill: 25, damage: "1d6+db", range: 0, hands: 2, weight: 3, maxDurability: 20, traits: ["钝器", "工具"], price: 8 },
  "木棍":        { ammoType: null, capacity: null, baseSkill: 20, damage: "1d4+db", range: 0, hands: 2, weight: 2, maxDurability: 8, traits: ["钝器", "易碎"], price: 2 },

  // ── 手枪 ──
  ".22手枪":       { ammoType: ".22 LR",   capacity: 8,  baseSkill: 20, damage: "1d6",     range: 10,  hands: 1, weight: 1, maxDurability: 15, traits: ["半自动", "廉价"], price: 25 },
  ".32自动手枪":   { ammoType: ".32 ACP",  capacity: 8,  baseSkill: 20, damage: "1d8",     range: 15,  hands: 1, weight: 1, maxDurability: 15, traits: ["半自动"], price: 40 },
  ".38左轮":       { ammoType: ".38 Special", capacity: 6, baseSkill: 20, damage: "1d10",    range: 15,  hands: 1, weight: 1, maxDurability: 18, traits: ["左轮"], price: 75 },
  ".45自动手枪":   { ammoType: ".45 ACP",  capacity: 7,  baseSkill: 20, damage: "1d10+2",  range: 15,  hands: 1, weight: 2, maxDurability: 18, traits: ["半自动", "大威力"], price: 85 },

  // ── 冲锋枪 ──
  "汤普森冲锋枪": { ammoType: ".45 ACP",  capacity: 30, baseSkill: 15, damage: "1d10+2",  range: 25,  hands: 2, weight: 5, maxDurability: 20, traits: ["全自动", "扫射"], price: 200 },
  "MP18":          { ammoType: "9mm",      capacity: 32, baseSkill: 15, damage: "1d10",    range: 25,  hands: 2, weight: 4, maxDurability: 18, traits: ["全自动"], price: 180 },

  // ── 霰弹枪 ──
  "12号霰弹枪":   { ammoType: "12号霰弹", capacity: 5, baseSkill: 25, damage: "4d6/2d6/1d6", range: 10, hands: 2, weight: 4, maxDurability: 16, traits: ["霰弹", "近距离致命"], price: 120 },
  "双管霰弹枪":   { ammoType: "12号霰弹", capacity: 2, baseSkill: 25, damage: "4d6/2d6/1d6", range: 10, hands: 2, weight: 3, maxDurability: 14, traits: ["霰弹", "双发"], price: 80 },

  // ── 步枪 ──
  ".30-30杠杆步枪": { ammoType: ".30-30",  capacity: 6,  baseSkill: 25, damage: "2d6+2",   range: 50,  hands: 2, weight: 4, maxDurability: 20, traits: ["杠杆式", "狩猎"], price: 60 },
  "春田M1903":     { ammoType: ".30-06",  capacity: 5,  baseSkill: 30, damage: "2d6+4",   range: 80,  hands: 2, weight: 4, maxDurability: 22, traits: ["栓动", "军用", "精准"], price: 80 },
  "猎枪(单发)":    { ammoType: "各式",    capacity: 1,  baseSkill: 20, damage: "2d6+2",   range: 40,  hands: 2, weight: 3, maxDurability: 15, traits: ["单发"], price: 35 },

  // ── 爆炸物 ──
  "炸药(一捆)":   { ammoType: null, capacity: null, baseSkill: 20, damage: "6d6",    range: 5,   hands: 2, weight: 3, maxDurability: 99, traits: ["爆炸", "投掷", "引信"], price: 50 },
  "炸药棒":       { ammoType: null, capacity: null, baseSkill: 20, damage: "4d6",    range: 5,   hands: 1, weight: 1, maxDurability: 99, traits: ["爆炸", "投掷", "引信"], price: 15 },
  "莫洛托夫鸡尾酒": { ammoType: null, capacity: null, baseSkill: 15, damage: "2d6",    range: 5,   hands: 1, weight: 1, maxDurability: 99, traits: ["爆炸", "投掷", "燃烧"], price: 3 },
  "铝热剂手榴弹":  { ammoType: null, capacity: null, baseSkill: 20, damage: "4d6",    range: 10,  hands: 1, weight: 1, maxDurability: 99, traits: ["爆炸", "投掷"], price: 30 },
};

// ============================================================
// 负重系统
// ============================================================

export interface CoCEncumbranceState {
  /** 当前负重 */
  currentWeight: number;
  /** 最大负重（基于 STR+SIZ） */
  maxWeight: number;
  /** 负重等级 */
  level: "unencumbered" | "light" | "heavy" | "max";
  /** 物理行动惩罚骰 */
  penaltyDice: number;
}

/**
 * 计算最大负重：STR + SIZ 决定基础负重上限
 * CoC 7e 规则考：STR+SIZ 决定 Build，负重上限 ≈ Build × 10 kg
 * 简化：每点 STR+SIZ = 2 负重单位
 */
export function calcMaxWeight(str: number, siz: number): number {
  return Math.max(10, Math.floor((str + siz) * 2));
}

/**
 * 计算负重等级及惩罚
 */
export function calcEncumbrance(currentWeight: number, str: number, siz: number): CoCEncumbranceState {
  const maxWeight = calcMaxWeight(str, siz);
  const ratio = currentWeight / maxWeight;

  if (ratio <= 0.5) {
    return { currentWeight, maxWeight, level: "unencumbered", penaltyDice: 0 };
  } else if (ratio <= 0.75) {
    return { currentWeight, maxWeight, level: "light", penaltyDice: 1 };
  } else if (ratio <= 1.0) {
    return { currentWeight, maxWeight, level: "heavy", penaltyDice: 2 };
  } else {
    return { currentWeight, maxWeight, level: "max", penaltyDice: 4 };
  }
}

/**
 * 检查能否携带额外重量
 */
export function canCarry(currentWeight: number, additionalWeight: number, str: number, siz: number): boolean {
  const maxWeight = calcMaxWeight(str, siz);
  return currentWeight + additionalWeight <= maxWeight * 1.5; // 允许短时间超载 50%
}

// ============================================================
// 耐久系统
// ============================================================

export interface CoCDurabilityState {
  current: number;
  max: number;
  /** 状态 */
  status: "intact" | "damaged" | "broken";
  /** 当前减伤衰减（护甲损坏后 DR 减半） */
  effectiveDr: number;
}

/**
 * 计算物品受击后的耐久变化
 */
export function applyDurabilityDamage(
  currentDurability: number,
  incomingDamage: number,
  dr: number,
): { newDurability: number; status: CoCDurabilityState["status"]; effectiveDr: number } {
  // 每 3 点原始伤害消耗 1 点耐久
  const durabilityLoss = Math.max(1, Math.floor(incomingDamage / 3));
  const newDurability = Math.max(0, currentDurability - durabilityLoss);

  let status: CoCDurabilityState["status"];
  let effectiveDr: number;

  if (newDurability <= 0) {
    status = "broken";
    effectiveDr = 0; // 损坏后无防护
  } else if (newDurability < currentDurability * 0.3) {
    status = "damaged";
    effectiveDr = Math.ceil(dr / 2); // 损坏后 DR 减半
  } else {
    status = "intact";
    effectiveDr = dr;
  }

  return { newDurability, status, effectiveDr };
}

// ============================================================
// 护甲伤害减免（整合入口）
// ============================================================

export interface ArmorApplicationResult {
  /** 最终伤害 */
  finalDamage: number;
  /** 被护甲减免的伤害 */
  absorbed: number;
  /** 生效的护甲列表 */
  armorsUsed: string[];
  /** 耐久变化 */
  durabilityChanges: Array<{ armorName: string; newDurability: number; status: CoCDurabilityState["status"] }>;
  /** 伤害穿透（高伤害武器可无视部分护甲） */
  penetrated: boolean;
}

/**
 * 对战斗结果应用护甲减伤
 * @param result 战斗结果（含伤害和命中部位）
 * @param armors 穿戴中的护甲列表（按部位）
 * @returns 护甲应用结果
 */
export function applyArmorToDamage(
  result: CombatCheckResult,
  armors: Array<{ def: CoCArmorDef; currentDurability: number }>,
): ArmorApplicationResult {
  if (!result.hitLocation || result.damage <= 0) {
    return {
      finalDamage: result.damage,
      absorbed: 0,
      armorsUsed: [],
      durabilityChanges: [],
      penetrated: false,
    };
  }

  const location = result.hitLocation;

  // 找到覆盖该部位的所有护甲（按 DR 排序，最优者生效；可堆叠则叠加）
  const coveringArmors = armors
    .filter(a => a.def.coverage.includes(location) && a.currentDurability > 0)
    .sort((a, b) => b.def.dr - a.def.dr);

  if (coveringArmors.length === 0) {
    return {
      finalDamage: result.damage,
      absorbed: 0,
      armorsUsed: [],
      durabilityChanges: [],
      penetrated: false,
    };
  }

  // 计算总 DR（仅 stackable 的护甲可叠加，非 stackable 取最高）
  let totalDr = 0;
  const armorsUsed: string[] = [];
  let usedBestNonStackable = false;

  for (const armor of coveringArmors) {
    if (armor.def.stackable) {
      totalDr += armor.def.dr;
      armorsUsed.push(armor.def.name);
    } else if (!usedBestNonStackable) {
      totalDr += armor.def.dr;
      armorsUsed.push(armor.def.name);
      usedBestNonStackable = true;
    }
  }

  // 贯穿/暴击 可无视部分护甲
  let effectiveDr = totalDr;
  let penetrated = false;

  if (result.isImpale || result.isCritical) {
    // 贯穿/暴击：DR 减半（向上取整）
    effectiveDr = Math.ceil(totalDr / 2);
    penetrated = totalDr > 0;
  }

  // 高伤害（damage > 5*DR）可穿透 — 只有明显超出护甲承受极限的伤害才能部分无视
  if (result.damage > totalDr * 5 && totalDr > 0) {
    effectiveDr = Math.floor(totalDr / 2);
    penetrated = true;
  }

  const absorbed = Math.min(result.damage, effectiveDr);
  const finalDamage = Math.max(0, result.damage - absorbed);

  // 耐久损耗
  const durabilityChanges: ArmorApplicationResult["durabilityChanges"] = [];
  for (const armor of coveringArmors) {
    const change = applyDurabilityDamage(armor.currentDurability, result.damage, armor.def.dr);
    durabilityChanges.push({
      armorName: armor.def.name,
      newDurability: change.newDurability,
      status: change.status,
    });
  }

  return {
    finalDamage,
    absorbed,
    armorsUsed,
    durabilityChanges,
    penetrated,
  };
}

// ============================================================
// 物品便捷查询
// ============================================================

/** 按类别查询武器 */
export function getWeaponsByTrait(trait: string): CoCWeaponFullDef[] {
  return Object.values(COC_WEAPONS_FULL).filter(w => w.traits.includes(trait));
}

/** 按部位查询护甲 */
export function getArmorByLocation(location: HitLocation): CoCArmorDef[] {
  return COC_ARMOR.filter(a => a.coverage.includes(location));
}

/** 解析伤害骰（含 db 格式） */
export function parseDamage(dice: string, damageBonus: number = 0): { dice: string; bonus: number } {
  const hasDb = dice.includes("db");
  const cleanDice = dice.replace("+db", "").replace("-db", "");
  const m = cleanDice.match(/(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?/);
  if (!m) return { dice: "1d3", bonus: damageBonus };

  let bonus = 0;
  if (m[3] === "+") bonus += parseInt(m[4]);
  else if (m[3] === "-") bonus -= parseInt(m[4]);

  if (hasDb) bonus += damageBonus;

  return { dice: `${m[1]}d${m[2]}`, bonus };
}
