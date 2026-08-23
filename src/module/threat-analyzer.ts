// 模组威胁分析 & 武器许可判定
// 从模块现有数据推断难度等级，自动决定 PC 初始武器配额

import type { ModuleData, ModuleNPC } from "./types";

// ── 产出类型 ──

type DifficultyTier = "easy" | "medium" | "hard" | "deadly";

interface ThreatProfile {
  tier: DifficultyTier;
  score: number;
  details: {
    hostileNpcCount: number;
    maxHostileDamage: number;
    trapCount: number;
    hardCheckCount: number;
    extremeCheckCount: number;
    maxSanLossPerClue: number;
    hasBossCombat: boolean;
  };
}

interface WeaponPolicy {
  /** 是否允许持枪 */
  allowed: boolean;
  /** 武器类型 */
  weaponType: "none" | "revolver" | "pistol" | "shotgun";
  /** 配弹数 */
  ammo: number;
  /** 特殊限制说明 */
  restrictions: string[];
  /** 拒绝原因（allowed=false 时） */
  deniedReason?: string;
}

// ── 威胁分析 ──

/**
 * 分析 NPC 是否为敌对（威胁调查员安全）
 *
 * 判定原则：
 * - 有战斗数值 ≠ 敌对（警员、保镖、路人 NPC 也可能有数据但非威胁）
 * - 敌对来源三选一：
 *   ① traits 中包含暴力倾向特征（"暴力倾向"等）
 *   ② attitude 描述指向与调查员战斗（"发现后攻击"等）
 *   ③ 描述中出现神话生物/怪物特征（"理智损失"、"食尸鬼"、"Mi-Go" 等）
 */
function parseNpcThreat(npc: ModuleNPC): { hostile: boolean; damage: number } {
  const desc = npc.description || "";
  const traits = npc.personality?.traits ?? [];
  const attitude = npc.personality?.attitude ?? "";

  // 伤害关键词 —— 从战斗数据行提取，如 "1d6+DB"、"4d6/1d6"
  const dmgMatch = desc.match(/(\d+)d(\d+)/i);
  const maxRawDmg = dmgMatch ? parseInt(dmgMatch[1], 10) * parseInt(dmgMatch[2], 10) : 0;

  // ① 暴力倾向特征
  const hostileTraitKeywords = ["暴力倾向", "攻击倾向", "攻击性生物", "敌意", "掠夺性"];
  const hasHostileTrait = traits.some(t =>
    hostileTraitKeywords.some(kw => t.includes(kw))
  );

  // ② attitude 指向战斗（排除条件性防守如"有人闹事才动手"）
  const combatAttitudePattern = /发现.*攻击|攻击调查员|与.*死斗|索敌|驱动/i;
  const hasCombatAttitude = combatAttitudePattern.test(attitude);

  // ③ 神话生物/怪物标记：描述中含理智损失关键词 = 怪物，自动敌对
  const monsterPattern = /理智损失|食尸鬼|来自尤格|神话生物|每回合攻击|护甲[：:]/i;
  const isMonster = monsterPattern.test(desc);

  const hostile = hasHostileTrait || hasCombatAttitude || isMonster;

  return { hostile, damage: maxRawDmg };
}

/**
 * 统计模块中的独立陷阱数
 * - 统计 type === "trap" 的物品（1 item = 1 trap）
 * - 统计场景描述中包含陷阱关键词的 unique 场景数（去重）
 * - 取两者最大值（防止 double-count 同一陷阱即作为 item 又在 scene description 中出现）
 */
function countTraps(scenes: ModuleData["scenes"], items: ModuleData["items"]): number {
  // 1. 物品类型的陷阱
  const itemTraps = items.filter(i => i.type === "trap").length;

  // 2. 场景描述中包含陷阱关键词的场景数
  const trapKeywords = ["陷阱", "捕兽夹", "硫酸", "毒气", "警报", "爆炸", "trigger"];
  const sceneTrapZones = new Set<string>();
  for (const scene of scenes) {
    const text = scene.description + " " + (scene.atmosphere ?? "");
    if (trapKeywords.some(kw => text.includes(kw))) {
      sceneTrapZones.add(scene.id);
    }
  }

  // 如果物品和场景都检测到同一陷阱（如 trap_bear 在 farm_periphery 场景中），取 max 去重
  return Math.max(itemTraps, sceneTrapZones.size);
}

/**
 * 收集所有检定的难度分布
 */
function collectCheckDifficulties(scenes: ModuleData["scenes"]): { hard: number; extreme: number } {
  let hard = 0;
  let extreme = 0;

  const processDifficulty = (d?: "regular" | "hard" | "extreme") => {
    if (d === "hard") hard++;
    else if (d === "extreme") extreme++;
  };

  for (const scene of scenes) {
    for (const clue of scene.clues) {
      for (const fm of clue.findMethods) processDifficulty(fm.difficulty);
    }
    for (const sc of scene.skillChecks ?? []) processDifficulty(sc.difficulty);
    for (const conn of scene.connections) {
      if (conn.checkRequired) processDifficulty(conn.checkRequired.difficulty);
    }
  }

  return { hard, extreme };
}

/**
 * 解析 SAN 损失字符串中的最大值
 * "0/1d3" → 3, "1/1d6" → 6, "1d3+1/1d6+1" → 7
 */
function parseMaxSanLoss(costStr: string): number {
  const parts = costStr.split("/");
  const maxPart = parts.length > 1 ? parts[1] : parts[0];
  const diceMatch = maxPart.match(/(\d*)d(\d+)(?:\+(\d+))?/);
  if (!diceMatch) return 0;
  const diceCount = parseInt(diceMatch[1] || "1", 10);
  const diceSize = parseInt(diceMatch[2], 10);
  const bonus = parseInt(diceMatch[3] || "0", 10);
  return diceCount * diceSize + bonus;
}

/**
 * 检查模块是否有 BOSS 战斗遭遇
 */
function hasBossCombat(encounterNarrations?: { victoryLines: string[]; defeatLines: string[] }[]): boolean {
  if (!encounterNarrations || encounterNarrations.length === 0) return false;
  return encounterNarrations.some(e =>
    e.victoryLines.length > 0 || e.defeatLines.length > 0
  );
}

// ── 主入口 ──

/**
 * 分析模块数据，生成威胁评估
 */
export function analyzeThreats(module: ModuleData, extra?: {
  encounterNarrations?: { victoryLines: string[]; defeatLines: string[] }[];
  traumaticClues?: Record<string, string>;
}): ThreatProfile {
  // 1. NPC 威胁
  let hostileNpcCount = 0;
  let maxHostileDamage = 0;
  for (const npc of module.npcs) {
    const threat = parseNpcThreat(npc);
    if (threat.hostile) {
      hostileNpcCount++;
      maxHostileDamage = Math.max(maxHostileDamage, threat.damage);
    }
  }

  // 2. 陷阱
  const trapCount = countTraps(module.scenes, module.items ?? []);

  // 3. 检定难度
  const { hard: hardCheckCount, extreme: extremeCheckCount } = collectCheckDifficulties(module.scenes);

  // 4. SAN 损耗
  let maxSanLossPerClue = 0;
  if (extra?.traumaticClues) {
    for (const cost of Object.values(extra.traumaticClues)) {
      maxSanLossPerClue = Math.max(maxSanLossPerClue, parseMaxSanLoss(cost));
    }
  }

  // 5. BOSS 战斗
  const bossCombat = hasBossCombat(extra?.encounterNarrations);

  // ── 加权评分 ──
  const score = Math.round(
    (hostileNpcCount * 2) +
    (Math.min(maxHostileDamage, 10) * 0.5) +
    (trapCount * 1.5) +
    (hardCheckCount * 0.5) +
    (extremeCheckCount * 1.5) +
    (maxSanLossPerClue * 0.5) +
    (bossCombat ? 3 : 0)
  );

  const tier: DifficultyTier =
    score <= 10 ? "easy" :
    score <= 25 ? "medium" :
    score <= 45 ? "hard" :
                  "deadly";

  return { tier, score, details: {
    hostileNpcCount, maxHostileDamage, trapCount,
    hardCheckCount, extremeCheckCount, maxSanLossPerClue,
    hasBossCombat: bossCombat,
  }};
}

// ── 武器许可判定 ──

/**
 * 根据威胁等级 + 角色数据决定武器许可
 *
 * @param threat 模块威胁评估
 * @param hasFirearmsSkill 角色是否有射击技能（> base 值）
 * @param occupation 角色职业名
 * @param creditRating 信用评级
 */
export function getWeaponPolicy(
  threat: ThreatProfile,
  hasFirearmsSkill: boolean,
  occupation: string,
  creditRating: number,
): WeaponPolicy {
  // 经济约束：贫困以下买不起
  if (creditRating < 6) {
    return { allowed: false, weaponType: "none", ammo: 0, restrictions: [], deniedReason: "信用评级过低，无力购买枪械。" };
  }

  const militaryLike = /警|侦探|侦探|军人|士兵|军官|保安|执法|赏金|federal|agent|军队/i.test(occupation);

  switch (threat.tier) {
    case "easy":
      // 随便带
      return {
        allowed: true,
        weaponType: "revolver",
        ammo: 12,
        restrictions: [],
      };

    case "medium":
      if (!hasFirearmsSkill && !militaryLike) {
        return { allowed: false, weaponType: "none", ammo: 0, restrictions: [], deniedReason: "缺乏射击训练，且无军事/执法背景。" };
      }
      return {
        allowed: true,
        weaponType: "revolver",
        ammo: 6,
        restrictions: ["仅限受过射击训练者"],
      };

    case "hard":
      if (!hasFirearmsSkill && !militaryLike) {
        return { allowed: false, weaponType: "none", ammo: 0, restrictions: [], deniedReason: "缺乏射击训练，且无军事/执法背景。" };
      }
      return {
        allowed: true,
        weaponType: "revolver",
        ammo: 6,
        restrictions: ["弹药有限", "枪械可能引起警察注意"],
      };

    case "deadly":
      // 只有执法/军事背景才能带枪，弹药极有限
      if (!militaryLike || !hasFirearmsSkill) {
        return { allowed: false, weaponType: "none", ammo: 0, restrictions: [], deniedReason: "模组危险度极高，仅允许有执法/军事背景且受过射击训练者持枪。" };
      }
      return {
        allowed: true,
        weaponType: "pistol",
        ammo: 3,
        restrictions: ["弹药极有限", "枪声可能引来更多敌人"],
      };
  }
}
