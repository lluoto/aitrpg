// NPC Reaction System — 基于性格特质/情绪/阵营的自动反应决策
// 用于战斗、社交、事件场景下的 NPC 行为选择

import type { NPCTraits, NPCMood, NPCFaction } from "./types";
import { DEFAULT_NPC_TRAITS } from "./types";

// ============================================================
// 反应类型
// ============================================================

export type CombatReaction = "fight" | "flee" | "parley" | "surrender" | "call_help" | "intimidate";
export type SocialReaction = "open" | "guarded" | "hostile" | "bargain" | "ignore" | "defer";
export type EventReaction = "investigate" | "ignore" | "panic" | "cautious" | "excited" | "calm";

export interface NPCReactionSet {
  combat: CombatReaction;
  social: SocialReaction;
  event: EventReaction;
}

// ============================================================
// 情绪转换表
// ============================================================

const MOOD_TRANSITIONS: Record<string, Partial<Record<NPCMood, number>>> = {
  // 受到威胁
  threatened: {
    fearful: 4, angry: 3, suspicious: 2, neutral: 1,
  },
  // 受到帮助
  helped: {
    friendly: 5, calm: 3, neutral: 1, suspicious: 1,
  },
  // 目睹恐怖/怪异
  witnessed_horror: {
    fearful: 5, suspicious: 3, excited: 1, neutral: 1,
  },
  // 战斗胜利
  combat_win: {
    excited: 4, calm: 2, friendly: 2, neutral: 2,
  },
  // 战斗失败/受伤
  combat_loss: {
    fearful: 4, angry: 3, sad: 2, neutral: 1,
  },
  // 玩家多次友善互动
  repeated_kindness: {
    friendly: 4, calm: 2, neutral: 2, suspicious: 1, fearful: 1,
  },
  // 玩家多次欺骗/背叛
  betrayed: {
    angry: 5, suspicious: 3, fearful: 1, neutral: 1,
  },
  // 获得重要信息/线索
  gained_knowledge: {
    excited: 4, calm: 2, curious: 1, neutral: 3,
  },
};

export type MoodTrigger = keyof typeof MOOD_TRANSITIONS;

// ============================================================
// 获取 NPC 有效特质（缺省兜底）
// ============================================================

function getTraits(traits?: NPCTraits): NPCTraits {
  return traits ?? DEFAULT_NPC_TRAITS;
}

// ============================================================
// 战斗反应决策
// ============================================================

export function determineCombatReaction(
  traits?: NPCTraits,
  mood: NPCMood = "neutral",
  /** 敌我力量对比: -2=远弱于敌 ... +2=远强于敌 */
  powerBalance: number = 0,
): CombatReaction {
  const t = getTraits(traits);

  // 低勇气 -> 倾向于逃跑/求和
  if (t.courage <= 3) {
    if (powerBalance <= 0) return "flee";
    return powerBalance >= 1 ? "fight" : "parley";
  }

  // 高勇气 -> 倾向于战斗
  if (t.courage >= 8) {
    if (powerBalance >= -1) return "fight";
    return "intimidate";
  }

  // 中等勇气: 受情绪影响
  if (mood === "fearful" && powerBalance <= 0) {
    if (t.stability >= 7) return "parley";
    return "flee";
  }
  if (mood === "angry" && powerBalance >= -1) return "fight";
  if (mood === "friendly" && powerBalance <= -1) return "parley";

  // 默认根据力量对比
  if (powerBalance >= 1) return "fight";
  if (powerBalance <= -1) return "flee";
  return "parley";
}

// ============================================================
// 社交反应决策
// ============================================================

export function determineSocialReaction(
  traits?: NPCTraits,
  mood: NPCMood = "neutral",
  /** 玩家与该 NPC 的关系值 -5~+5 */
  relationship: number = 0,
): SocialReaction {
  const t = getTraits(traits);

  // 低友善 + 高怀疑 -> 冷淡/敌对
  if (t.friendliness <= 3 && t.suspicion >= 7) {
    return relationship >= 2 ? "guarded" : "hostile";
  }

  // 高友善 -> 开放
  if (t.friendliness >= 7) {
    if (t.suspicion <= 4) return "open";
    return relationship >= 0 ? "open" : "guarded";
  }

  // 高怀疑 -> 戒备
  if (t.suspicion >= 7) {
    return relationship >= 3 ? "guarded" : "ignore";
  }

  // 情绪影响
  if (mood === "angry") return relationship >= 2 ? "guarded" : "hostile";
  if (mood === "fearful") return relationship >= 1 ? "guarded" : "ignore";
  if (mood === "friendly") return "open";

  // 默认: 根据关系值
  if (relationship >= 2) return "open";
  if (relationship <= -2) return "hostile";
  return "guarded";
}

// ============================================================
// 事件反应决策
// ============================================================

export function determineEventReaction(
  traits?: NPCTraits,
  mood: NPCMood = "neutral",
  /** 事件的恐怖/危险程度 1-10 */
  threatLevel: number = 5,
): EventReaction {
  const t = getTraits(traits);

  // 低稳定性 -> 容易恐慌
  if (t.stability <= 3 && threatLevel >= 5) return "panic";

  // 高稳定性 -> 保持冷静
  if (t.stability >= 8 && threatLevel <= 7) return "calm";

  // 高勇气 + 高好奇 -> 主动调查
  if (t.courage >= 7 && t.curiosity >= 7) return "investigate";

  // 高好奇 -> 尝试查看
  if (t.curiosity >= 6 && threatLevel <= 6) return "cautious";

  // 高恐惧情绪 -> 忽视/恐慌
  if (mood === "fearful") {
    return threatLevel >= 5 ? "panic" : "ignore";
  }

  // 高兴奋情绪 -> 兴奋
  if (mood === "excited") return "excited";

  // 默认按威胁等级
  if (threatLevel >= 8) return "panic";
  if (threatLevel >= 5) return "cautious";
  return "ignore";
}

// ============================================================
// 情绪状态转换
// ============================================================

/**
 * 根据事件触发 NPC 情绪转变
 * @returns 新的情绪状态
 */
export function updateMood(
  current: NPCMood,
  trigger: MoodTrigger,
  /** 特质影响（高稳定性更难改变情绪） */
  traits?: NPCTraits,
): NPCMood {
  const t = getTraits(traits);
  const transitions = MOOD_TRANSITIONS[trigger];
  if (!transitions) return current;

  const stabilityResist = (t.stability - 5) * 0.5;

  // 按权重选取新情绪
  const candidates = Object.entries(transitions) as [NPCMood, number][];
  const adjusted = candidates.map(([mood, weight]) => {
    // 高稳定性更难转入负面情绪
    const penalty = (mood === "fearful" || mood === "angry" || mood === "sad")
      ? Math.max(0, stabilityResist)
      : 0;
    return { mood, weight: Math.max(0, weight - penalty) };
  });

  const totalWeight = adjusted.reduce((s, c) => s + c.weight, 0);
  if (totalWeight <= 0) return current;

  let r = Math.random() * totalWeight;
  for (const { mood, weight } of adjusted) {
    r -= weight;
    if (r <= 0) return mood;
  }

  return current;
}

// ============================================================
// 快速反应（一次调用获得完整反应集）
// ============================================================

export function getNPCReactions(
  traits?: NPCTraits,
  mood: NPCMood = "neutral",
  powerBalance: number = 0,
  relationship: number = 0,
  threatLevel: number = 5,
): NPCReactionSet {
  return {
    combat: determineCombatReaction(traits, mood, powerBalance),
    social: determineSocialReaction(traits, mood, relationship),
    event: determineEventReaction(traits, mood, threatLevel),
  };
}

/**
 * 获取战斗反应的中文描述
 */
export function describeCombatReaction(reaction: CombatReaction): string {
  const map: Record<CombatReaction, string> = {
    fight: "战斗",
    flee: "逃跑",
    parley: "谈判",
    surrender: "投降",
    call_help: "呼救",
    intimidate: "威吓",
  };
  return map[reaction];
}

/**
 * 获取社交反应的中文描述
 */
export function describeSocialReaction(reaction: SocialReaction): string {
  const map: Record<SocialReaction, string> = {
    open: "开放",
    guarded: "戒备",
    hostile: "敌对",
    bargain: "交易",
    ignore: "无视",
    defer: "顺从",
  };
  return map[reaction];
}

/**
 * 获取事件反应的中文描述
 */
export function describeEventReaction(reaction: EventReaction): string {
  const map: Record<EventReaction, string> = {
    investigate: "主动调查",
    ignore: "忽视",
    panic: "恐慌",
    cautious: "谨慎靠近",
    excited: "兴奋",
    calm: "冷静",
  };
  return map[reaction];
}
