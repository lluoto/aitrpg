
// ============================================================
// 难度画像
// ============================================================

export interface DifficultyProfile {
  /** 难度标签 */
  label: "easy" | "medium" | "hard" | "nightmare";

  /** 检定修正
   *  - easy:   奖励骰 +1（有利）
   *  - medium: 无修正
   *  - hard:   惩罚骰 +1
   *  - nightmare: 惩罚骰 +2
   */
  penaltyDice: number;

  /** 失败时的线索保留程度 */
  clueOnFail: "partial" | "minimal" | "none" | "costly";

  /** 推动检定的额外代价乘数（相比常规推动） */
  pushCostMultiplier: number;

  /** 推动是否允许（nightmare 需要特殊叙事触发后才可推动） */
  pushAllowed: boolean;

  /** SAN 消耗倍率（hard=1.5x, nightmare=2x） */
  sanMultiplier: number;

  /** 失败时的叙事引导 */
  failureGuidance: string;

  /** 难度描述（给 KP/玩家看） */
  description: string;
}

// ============================================================
// 难度配置表
// ============================================================

const DIFFICULTY_TABLE: Record<string, DifficultyProfile> = {
  easy: {
    label: "easy",
    penaltyDice: -1, // 奖励骰
    clueOnFail: "partial",
    pushCostMultiplier: 1,
    pushAllowed: true,
    sanMultiplier: 0.5,
    failureGuidance: "你虽然没有找到关键线索，但注意到了一些异常痕迹——或许换个角度会有发现。",
    description: "适合新人上手，调查失败也会获得部分线索。",
  },
  medium: {
    label: "medium",
    penaltyDice: 0,
    clueOnFail: "minimal",
    pushCostMultiplier: 1.5,
    pushAllowed: true,
    sanMultiplier: 1,
    failureGuidance: "你仔细搜索了每个角落，但一无所获。也许遗漏了什么——推动检定会消耗更多精力。",
    description: "标准难度，失败只获得非常有限的信息。",
  },
  hard: {
    label: "hard",
    penaltyDice: 1,
    clueOnFail: "none",
    pushCostMultiplier: 2,
    pushAllowed: true,
    sanMultiplier: 1.5,
    failureGuidance: "黑暗中你什么都看不清。线索隐藏在层层伪装之下——推动检定将消耗大量体力，且可能引起注意。",
    description: "困难模组，失败无线索，惩罚骰+1，SAN消耗增加50%。",
  },
  nightmare: {
    label: "nightmare",
    penaltyDice: 2,
    clueOnFail: "costly",
    pushCostMultiplier: 3,
    pushAllowed: false, // 需要特殊叙事触发后才可推动
    sanMultiplier: 2,
    failureGuidance: "一股无形的力量在阻止你接近真相。你感觉到——如果再深入，代价将不只是理智……",
    description: "噩梦难度，失败获得线索但伴随SAN损失和惩罚骰+2，推动需叙事触发。",
  },
};

/**
 * 获取指定难度的画像（直接查表，不依赖模组对象）
 */
export function getDifficultyProfile(label: "easy" | "medium" | "hard" | "nightmare"): DifficultyProfile {
  return { ...(DIFFICULTY_TABLE[label] ?? DIFFICULTY_TABLE.medium) };
}

/**
 * 根据难度生成推动检定的附加描述
 */
export function getPushNarration(profile: DifficultyProfile): string {
  switch (profile.label) {
    case "easy":
      return "你决定再试一次，这次你有了新的思路。";
    case "medium":
      return "你深吸一口气，决定投入更多精力重新搜索。代价将更加沉重。";
    case "hard":
      return "你咬紧牙关，强迫自己冷静下来重新审视。失败后推动将消耗额外体力，且可能会暴露你的意图。";
    case "nightmare":
      return "你感觉到了某种存在的注视。推动检定需要付出更大的代价——可能需要消耗幸运值或理智。";
  }
}
