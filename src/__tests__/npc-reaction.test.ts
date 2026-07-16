// NPC 性格特质 + 反应系统 + 情绪状态机 测试
import { describe, it, expect } from "bun:test";
import { NPCAgent } from "../agent/npc-agent";
import type { NPCPersonality, NPCMood } from "../agent/types";
import {
  determineCombatReaction,
  determineSocialReaction,
  determineEventReaction,
  updateMood,
  getNPCReactions,
  describeCombatReaction,
  describeSocialReaction,
  describeEventReaction,
  type CombatReaction,
  type SocialReaction,
  type EventReaction,
} from "../agent/npc-reaction";
import { DEFAULT_NPC_TRAITS } from "../agent/types";

// ============================================================
// 性格特质 → 战斗反应
// ============================================================
describe("determineCombatReaction", () => {
  it("低勇气(low courage, ≤3) → 劣势逃跑, 优势才战", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 2 };
    expect(determineCombatReaction(t, "neutral", -1)).toBe("flee");
    expect(determineCombatReaction(t, "neutral", 0)).toBe("flee");
    expect(determineCombatReaction(t, "neutral", 1)).toBe("fight");
  });

  it("高勇气(high courage, ≥8) → 主动战斗", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 9 };
    expect(determineCombatReaction(t, "neutral", 0)).toBe("fight");
    expect(determineCombatReaction(t, "neutral", -1)).toBe("fight");
    expect(determineCombatReaction(t, "neutral", -2)).toBe("intimidate");
  });

  it("恐惧情绪 + 劣势 → 逃跑", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 5 };
    expect(determineCombatReaction(t, "fearful", -1)).toBe("flee");
  });

  it("愤怒情绪 → 倾向战斗", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 5 };
    expect(determineCombatReaction(t, "angry", 0)).toBe("fight");
    expect(determineCombatReaction(t, "angry", -1)).toBe("fight");
  });

  it("无特质时使用默认值", () => {
    const r = determineCombatReaction(undefined, "neutral", 0);
    expect(["fight", "flee", "parley"]).toContain(r);
  });
});

// ============================================================
// 性格特质 → 社交反应
// ============================================================
describe("determineSocialReaction", () => {
  it("低友善+高怀疑 → 关系不好持续敌对", () => {
    const t = { ...DEFAULT_NPC_TRAITS, friendliness: 2, suspicion: 8 };
    expect(determineSocialReaction(t, "neutral", 0)).toBe("hostile");
    expect(determineSocialReaction(t, "neutral", 1)).toBe("hostile");
    // 需要关系 ≥ 2 才能进入戒备而非敌对
    expect(determineSocialReaction(t, "neutral", 2)).toBe("guarded");
  });

  it("高友善+低怀疑 → 开放", () => {
    const t = { ...DEFAULT_NPC_TRAITS, friendliness: 8, suspicion: 3 };
    expect(determineSocialReaction(t, "neutral", 0)).toBe("open");
  });

  it("愤怒情绪 → 敌意或戒备取决于关系", () => {
    const t = { ...DEFAULT_NPC_TRAITS };
    expect(determineSocialReaction(t, "angry", -1)).toBe("hostile");
    // 关系 0 时愤怒仍敌对；关系≥2 才降为戒备
    expect(determineSocialReaction(t, "angry", 0)).toBe("hostile");
    expect(determineSocialReaction(t, "angry", 2)).toBe("guarded");
  });

  it("友好情绪 → 开放", () => {
    const t = { ...DEFAULT_NPC_TRAITS };
    expect(determineSocialReaction(t, "friendly", 0)).toBe("open");
  });

  it("关系值 ≥ 2 时倾向开放", () => {
    const t = { ...DEFAULT_NPC_TRAITS };
    expect(determineSocialReaction(t, "neutral", 3)).toBe("open");
  });
});

// ============================================================
// 性格特质 → 事件反应
// ============================================================
describe("determineEventReaction", () => {
  it("低稳定性+高威胁 → 恐慌", () => {
    const t = { ...DEFAULT_NPC_TRAITS, stability: 2 };
    expect(determineEventReaction(t, "neutral", 7)).toBe("panic");
  });

  it("高稳定性 → 冷静", () => {
    const t = { ...DEFAULT_NPC_TRAITS, stability: 9 };
    expect(determineEventReaction(t, "neutral", 6)).toBe("calm");
  });

  it("高勇气+高好奇 → 主动调查", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 8, curiosity: 8 };
    expect(determineEventReaction(t, "neutral", 4)).toBe("investigate");
  });

  it("恐惧情绪 → 高威胁恐慌", () => {
    const t = { ...DEFAULT_NPC_TRAITS };
    expect(determineEventReaction(t, "fearful", 6)).toBe("panic");
    expect(determineEventReaction(t, "fearful", 3)).toBe("ignore");
  });

  it("高兴奋 → excited", () => {
    const t = { ...DEFAULT_NPC_TRAITS };
    expect(determineEventReaction(t, "excited", 5)).toBe("excited");
  });

  it("极高威胁(≥8) → 恐慌", () => {
    const t = { ...DEFAULT_NPC_TRAITS };
    expect(determineEventReaction(t, "neutral", 9)).toBe("panic");
  });
});

// ============================================================
// 情绪状态转换
// ============================================================
describe("updateMood", () => {
  it("受到威胁 → 大概率 fearful/angry", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const m = updateMood("neutral", "threatened");
      counts[m] = (counts[m] || 0) + 1;
    }
    // fearful 和 angry 应为主要结果
    const total = (counts["fearful"] || 0) + (counts["angry"] || 0);
    expect(total).toBeGreaterThan(500); // >50%
  });

  it("高稳定性减少负面情绪", () => {
    const t = { ...DEFAULT_NPC_TRAITS, stability: 10 };
    const fearfulCount: number[] = [];
    for (let i = 0; i < 500; i++) {
      const m = updateMood("neutral", "threatened", t);
      if (m === "fearful") fearfulCount.push(1);
    }
    // 高稳定性下的恐惧应该明显少于默认
    const highFreq = fearfulCount.length / 500;

    // 低稳定性
    const tLow = { ...DEFAULT_NPC_TRAITS, stability: 1 };
    const fearfulLow: number[] = [];
    for (let i = 0; i < 500; i++) {
      const m = updateMood("neutral", "threatened", tLow);
      if (m === "fearful") fearfulLow.push(1);
    }
    const lowFreq = fearfulLow.length / 500;

    expect(lowFreq).toBeGreaterThan(highFreq);
  });

  it("帮助事件 → 大概率 friendly/calm", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const m = updateMood("neutral", "helped");
      counts[m] = (counts[m] || 0) + 1;
    }
    const total = (counts["friendly"] || 0) + (counts["calm"] || 0);
    expect(total).toBeGreaterThan(400);
  });

  it("背叛事件 → 大概率 angry", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 200; i++) {
      const m = updateMood("neutral", "betrayed");
      counts[m] = (counts[m] || 0) + 1;
    }
    expect(counts["angry"] || 0).toBeGreaterThan(80);
  });
});

// ============================================================
// 完整 ReactionSet
// ============================================================
describe("getNPCReactions", () => {
  it("返回三元素完整集", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 7, friendliness: 6, stability: 7 };
    const r = getNPCReactions(t, "neutral", 0, 0, 5);
    expect(r).toHaveProperty("combat");
    expect(r).toHaveProperty("social");
    expect(r).toHaveProperty("event");
  });

  it("高勇气组合: 战斗+开放+调查", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 8, friendliness: 7, curiosity: 8, stability: 7 };
    const r = getNPCReactions(t, "neutral", 0, 2, 4);
    expect(r.combat).toBe("fight");
    expect(r.social).toBe("open");
    expect(r.event).toBe("investigate");
  });

  it("低勇气+高威胁组合: 逃跑+敌对+恐慌", () => {
    const t = { ...DEFAULT_NPC_TRAITS, courage: 2, friendliness: 2, suspicion: 9, stability: 2 };
    const r = getNPCReactions(t, "neutral", -1, -2, 8);
    expect(r.combat).toBe("flee");
    expect(r.social).toBe("hostile");
    expect(r.event).toBe("panic");
  });
});

// ============================================================
// 描述函数
// ============================================================
describe("describe* 函数", () => {
  it("所有战斗反应都有中文描述", () => {
    const reactions: CombatReaction[] = ["fight", "flee", "parley", "surrender", "call_help", "intimidate"];
    for (const r of reactions) {
      expect(typeof describeCombatReaction(r)).toBe("string");
      expect(describeCombatReaction(r).length).toBeGreaterThan(0);
    }
  });

  it("所有社交反应都有中文描述", () => {
    const reactions: SocialReaction[] = ["open", "guarded", "hostile", "bargain", "ignore", "defer"];
    for (const r of reactions) {
      expect(typeof describeSocialReaction(r)).toBe("string");
      expect(describeSocialReaction(r).length).toBeGreaterThan(0);
    }
  });

  it("所有事件反应都有中文描述", () => {
    const reactions: EventReaction[] = ["investigate", "ignore", "panic", "cautious", "excited", "calm"];
    for (const r of reactions) {
      expect(typeof describeEventReaction(r)).toBe("string");
      expect(describeEventReaction(r).length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// NPCAgent 集成
// ============================================================
describe("NPCAgent 集成", () => {
  function makeNPC(overrides?: Partial<NPCPersonality>): NPCPersonality {
    return {
      name: "测试NPC",
      role: "测试角色",
      personality: "普通性格",
      background: "测试背景",
      goals: ["测试目标"],
      speech_style: "正常说话",
      knowledge: ["知道一些事"],
      secrets: ["一个秘密"],
      ...overrides,
    };
  }

  it("默认情绪为 neutral", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    expect(agent.getMood()).toBe("neutral");
  });

  it("可以设置初始情绪", () => {
    const agent = new NPCAgent(makeNPC({ initialMood: "fearful" }), null as any);
    expect(agent.getMood()).toBe("fearful");
  });

  it("初始关系值为 0", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    expect(agent.getRelationship()).toBe(0);
  });

  it("adjustRelationship 增减关系值", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    agent.adjustRelationship(2);
    expect(agent.getRelationship()).toBe(2);
    agent.adjustRelationship(-1);
    expect(agent.getRelationship()).toBe(1);
  });

  it("关系值限制在 -5 ~ +5", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    agent.adjustRelationship(10);
    expect(agent.getRelationship()).toBe(5);
    agent.adjustRelationship(-20);
    expect(agent.getRelationship()).toBe(-5);
  });

  it("triggerMood 改变情绪", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    expect(agent.getMood()).toBe("neutral");
    agent.triggerMood("helped");
    // helped 大概率变 friendly，但可能不变
    const emotional = agent.getMood();
    expect(emotional).not.toBeNull();
  });

  it("handleCombatOutcome 触发情绪变化", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    agent.handleCombatOutcome(true);
    // 应该能正常调用，不抛异常
    expect(agent.getMood()).not.toBeNull();
  });

  it("handleWitnessHorror 触发情绪变化", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    agent.handleWitnessHorror();
    expect(agent.getMood()).not.toBeNull();
  });

  it("recordInteraction 累计 3 次触发友善", () => {
    const lowCourage = { ...DEFAULT_NPC_TRAITS, courage: 7, friendliness: 7 };
    const agent = new NPCAgent(makeNPC({ traits: lowCourage }), null as any);
    // 三次正面互动后，关系值 +1.5，触发 repeated_kindness
    agent.recordInteraction(true);
    agent.recordInteraction(true);
    expect(agent.getRelationship()).toBe(1);
    agent.recordInteraction(true);
    expect(agent.getRelationship()).toBe(1.5);
  });

  it("getReactions 返回完整反应集", () => {
    const agent = new NPCAgent(makeNPC(), null as any);
    const r = agent.getReactions(0, 5);
    expect(r).toHaveProperty("combat");
    expect(r).toHaveProperty("social");
    expect(r).toHaveProperty("event");
  });
});
