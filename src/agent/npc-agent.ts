// NPC Agent — 独立角色实例
// 每人一张人格卡 + 独立记忆 buffer + LLM 驱动对话
//
// 设计原则：
//   NPC 不管理世界状态（那是律书的事）
//   NPC 只做角色扮演——以自己的身份说话和行动

import type { LLMClient, Message as LLMMessage } from "../llm/client";
import type { NPCPersonality, MemoryEntry, AgentMessage, NPCMood } from "./types";
import { DEFAULT_NPC_TRAITS } from "./types";
import {
  getNPCReactions,
  updateMood,
  describeCombatReaction,
  describeSocialReaction,
  describeEventReaction,
  type MoodTrigger,
} from "./npc-reaction";
import { NPCStore } from "../db/index";
import { applyConstraints } from "./constraints";

const MAX_RECENT_MEMORIES = 20;
const SYSTEM_PROMPT_PREAMBLE = `你是一个 TRPG 非玩家角色（NPC）。你必须始终以角色的身份说话，不要跳出角色、不要评论游戏机制、不要替其他角色发言。

核心规则：
1. 只说你角色知道的事——不知道就说不知道
2. 保持角色性格和说话风格一致
3. 不要透露角色的"秘密"（除非剧情发展到揭露点）
4. 回应长度控制在 1-3 句，像真实对话而非独白
5. 你对世界的理解仅限于角色背景+记忆中的信息`;

function buildSystemPrompt(npc: NPCPersonality): string {
  const traits = npc.traits ?? DEFAULT_NPC_TRAITS;
  return [
    SYSTEM_PROMPT_PREAMBLE,
    "",
    `你的名字: ${npc.name}`,
    `你的身份: ${npc.role}`,
    `性格: ${npc.personality}`,
    `背景: ${npc.background}`,
    `当前目标: ${npc.goals.join("、")}`,
    `说话风格: ${npc.speech_style}`,
    `你知道的信息: ${npc.knowledge.join("、")}`,
    `你的秘密（绝不主动透露）: ${npc.secrets.join("、")}`,
    "",
    `你的性格特质（影响你的行为方式）:
  - 勇气: ${traits.courage}/10（高=无畏低=怯懦）
  - 友善: ${traits.friendliness}/10（高=热情低=冷漠）
  - 怀疑: ${traits.suspicion}/10（高=多疑低=轻信）
  - 好奇心: ${traits.curiosity}/10（高=好奇低=保守）
  - 情绪稳定性: ${traits.stability}/10（高=冷静低=易激）`,
    "",
    npc.attitudes
      ? "对其他人物的态度:\n" +
        Object.entries(npc.attitudes)
          .map(([name, att]) => `  - 对 ${name}: ${att}`)
          .join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatMemories(memories: MemoryEntry[]): string {
  if (memories.length === 0) return "（这是故事的开端，你还没有任何记忆。）";

  const recent = memories.slice(-MAX_RECENT_MEMORIES);
  const lines = recent.map(
    (m) => `[${m.type}] ${m.content}`
  );
  return "你的近期经历:\n" + lines.map((l) => `  - ${l}`).join("\n");
}

export class NPCAgent {
  readonly name: string;
  readonly personality: NPCPersonality;
  private llm: LLMClient;
  private memories: MemoryEntry[] = [];
  private systemPrompt: string;
  private db?: NPCStore;

  /** 当前情绪状态 */
  private mood: NPCMood;
  /** 玩家关系值（-5~+5） */
  private relationship: number = 0;
  /** 对玩家的态度记录 */
  private playerInteractionCount: number = 0;

  constructor(personality: NPCPersonality, llm: LLMClient, db?: NPCStore) {
    this.name = personality.name;
    this.personality = personality;
    this.llm = llm;
    this.db = db;
    this.systemPrompt = buildSystemPrompt(personality);
    this.mood = personality.initialMood ?? "neutral";
  }

  /** 从数据库加载记忆（如果 db 可用） */
  loadMemoriesFromDB(limit = MAX_RECENT_MEMORIES): void {
    if (!this.db) return;
    this.memories = this.db.getRecentMemories(this.name, limit);
  }

  /** 将当前状态持久化到数据库 */
  persistState(): void {
    if (!this.db) return;
    this.db.updateState(this.name, this.mood, this.relationship, this.playerInteractionCount);
  }

  /** 获取当前情绪 */
  getMood(): NPCMood { return this.mood; }

  /** 获取当前关系值 */
  getRelationship(): number { return this.relationship; }

  /** 获取有效特质 */
  private get traits() {
    return this.personality.traits ?? DEFAULT_NPC_TRAITS;
  }

  /**
   * 获取 NPC 在当前状态下的反应集
   */
  getReactions(powerBalance = 0, threatLevel = 5) {
    return getNPCReactions(this.traits, this.mood, powerBalance, this.relationship, threatLevel);
  }

  /** 触发情绪转变 */
  triggerMood(trigger: MoodTrigger) {
    const old = this.mood;
    this.mood = updateMood(this.mood, trigger, this.traits);
    if (old !== this.mood) {
      this.rememberEvent(`情绪变化: ${old} → ${this.mood}（因为 ${trigger}）`, 5);
      this.persistState();
    }
  }

  /** 调整关系值（正=友善，负=敌对） */
  adjustRelationship(delta: number) {
    this.relationship = Math.max(-5, Math.min(5, this.relationship + delta));
    // 持久化到数据库
    if (this.db) {
      this.db.updateRelationship(this.name, "player", delta);
    }
    this.persistState();
  }

  /** 记录一次玩家互动 */
  recordInteraction(positive: boolean) {
    this.playerInteractionCount++;
    if (positive) {
      this.adjustRelationship(0.5);
      if (this.playerInteractionCount >= 3) {
        this.triggerMood("repeated_kindness");
      }
    } else {
      this.persistState();
    }
  }

  /** 处理战斗结果对 NPC 的影响 */
  handleCombatOutcome(won: boolean) {
    this.triggerMood(won ? "combat_win" : "combat_loss");
  }

  /** 处理目睹恐怖事件 */
  handleWitnessHorror() {
    this.triggerMood("witnessed_horror");
  }

  /** 记录一条新记忆 */
  remember(entry: MemoryEntry) {
    this.memories.push(entry);
    // 持久化到数据库
    if (this.db) {
      this.db.addMemory(this.name, entry);
      // 数据库记录过多时裁剪
      const count = this.db.countMemories(this.name);
      if (count > 200) {
        this.db.pruneMemories(this.name, 100);
      }
    }
    // 保留最近 50 条，重要性低的优先丢弃
    if (this.memories.length > 50) {
      this.memories.sort((a, b) => b.importance - a.importance);
      this.memories = this.memories.slice(0, 40);
    }
  }

  /** 记录对话 */
  rememberDialogue(speaker: string, content: string, importance = 5) {
    this.remember({
      timestamp: Date.now(),
      type: "dialogue",
      content: `${speaker}说: "${content}"`,
      importance,
    });
  }

  /** 记录事件 */
  rememberEvent(description: string, importance = 7) {
    this.remember({
      timestamp: Date.now(),
      type: "event",
      content: description,
      importance,
    });
  }

  /**
   * 对当前情境做出回应
   * @param context 当前发生的对话/事件上下文
   * @param recentMessages 最近几轮的消息历史
   * @returns 角色的回应文本
   */
  async respond(
    context: string,
    recentMessages: AgentMessage[] = []
  ): Promise<string> {
    const messages: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "system", content: formatMemories(this.memories) },
    ];

    // 注入最近的消息历史
    if (recentMessages.length > 0) {
      const history = recentMessages
        .slice(-10)
        .map((m) => {
          if (m.type === "narration") return `[旁白] ${m.content}`;
          if (m.type === "system") return `[系统] ${m.content}`;
          return `[${m.speaker}] ${m.content}`;
        })
        .join("\n");
      messages.push({
        role: "system",
        content: `最近的对话:\n${history}`,
      });
    }

    // 注入当前情绪和关系状态
    const moodLine = `当前心情: ${this.mood}（玩家关系: ${this.relationship}）`;
    messages.push({
      role: "user",
      content: `${moodLine}\n\n现在的情况: ${context}\n\n请以 ${this.name} 的身份回应。`,
    });

    try {
      const raw = await this.llm.chat(messages, {
        temperature: 0.8,
        maxTokens: 300,
      });
      let response = raw.trim();

      // 输出约束层 — 检查并改写
      const constraintResult = applyConstraints(response, this.personality, this.mood, this.relationship);
      if (!constraintResult.passed) {
        console.warn(`  ⚠ NPC ${this.name} 约束拦截: ${constraintResult.warnings.join("; ")}`);
        response = constraintResult.sanitized;
      }

      this.rememberDialogue(this.name, response);
      return response;
    } catch (err: any) {
      console.warn(`  ⚠ NPC ${this.name} 回应 LLM 失败: ${err.message.slice(0, 60)}`);
      // LLM 不可用时，用角色性格生成模板回应
      return this.templateReply(context);
    }
  }

  /**
   * NPC 主动发言（不由玩家触发，由 KP 调度）
   * @param trigger 触发原因描述
   * @param recentMessages 最近消息历史
   */
  async speakUp(
    trigger: string,
    recentMessages: AgentMessage[] = []
  ): Promise<string> {
    const messages: LLMMessage[] = [
      { role: "system", content: this.systemPrompt },
      { role: "system", content: formatMemories(this.memories) },
      {
        role: "user",
        content: `触发事件: ${trigger}\n\n你注意到了一些事。请以 ${this.name} 的身份主动发言（1-2句）。`,
      },
    ];

    if (recentMessages.length > 0) {
      const history = recentMessages
        .slice(-5)
        .map((m) => `[${m.speaker}] ${m.content}`)
        .join("\n");
      messages.splice(2, 0, {
        role: "system",
        content: `最近对话:\n${history}`,
      });
    }

    try {
      const raw = await this.llm.chat(messages, {
        temperature: 0.9,
        maxTokens: 200,
      });
      let response = raw.trim();

      // 输出约束层
      const constraintResult = applyConstraints(response, this.personality, this.mood, this.relationship);
      if (!constraintResult.passed) {
        console.warn(`  ⚠ NPC ${this.name} 主动发言约束拦截: ${constraintResult.warnings.join("; ")}`);
        response = constraintResult.sanitized;
      }

      this.rememberDialogue(this.name, response, 6);
      return response;
    } catch (err: any) {
      console.warn(`  ⚠ NPC ${this.name} 主动发言 LLM 失败: ${err.message.slice(0, 60)}`);
      // LLM 不可用时用模板
      return this.templateSpeakUp(trigger);
    }
  }

  /** 获取角色最近记忆（供调试） */
  getRecentMemories(n = 5): MemoryEntry[] {
    return this.memories.slice(-n);
  }

  /** 获取角色态度（供世界模型使用） */
  getAttitude(targetName: string): string {
    return this.personality.attitudes?.[targetName] ?? "中立";
  }

  /** LLM 不可用时的模板回应（特质+情绪驱动） */
  private templateReply(context: string): string {
    const p = this.personality;
    const combined = (p.personality + " " + p.speech_style).toLowerCase();

    // 情绪驱动
    if (this.mood === "fearful") {
      const fearfulReplies = [
        `（${this.name}声音发抖）"不……不要靠近我！"`,
        `（${this.name}后退了一步）"我……我没什么好说的，求你了……"`,
        `"你不明白……你不明白这里发生了什么……" ${this.name}语无伦次地说。`,
      ];
      return fearfulReplies[Math.floor(Math.random() * fearfulReplies.length)];
    }

    if (this.mood === "angry") {
      const angryReplies = [
        `（${this.name}怒视着你）"你还有脸来找我？"`,
        `"别浪费我的时间。" ${this.name}转过身去，显然不想再谈。`,
        `（${this.name}咬牙切齿地说）"你要是聪明的话，就趁我没发火之前赶紧走。"`,
      ];
      return angryReplies[Math.floor(Math.random() * angryReplies.length)];
    }

    if (this.mood === "friendly") {
      const friendlyReplies = [
        `"啊，是你！" ${this.name}的表情明显放松了下来，"我正想着你会不会来呢。"`,
        `（${this.name}向你招了招手）"来，我给你看点东西——我觉得你会感兴趣。"`,
        `"太好了，有你在我就放心多了。"`,
      ];
      return friendlyReplies[Math.floor(Math.random() * friendlyReplies.length)];
    }

    // 特质+性格关键词驱动
    if (this.traits.courage <= 3 || combined.includes("紧张") || combined.includes("警惕") || combined.includes("恐惧")) {
      const nervousReplies = [
        `（${this.name}紧张地看着你，低声说）"你……你也是听到那个声音才来的吗？"`,
        `（${this.name}不安地搓着手）"这里不对劲……我建议你赶紧离开。"`,
        `"嘘——别那么大声。它们……它们能听到。"`,
        `（${this.name}东张西望了一番才开口）"我不知道你是什么人，但你要是聪明的话，就别进那个谷仓。"`,
      ];
      return nervousReplies[Math.floor(Math.random() * nervousReplies.length)];
    }

    if (combined.includes("沉默") || combined.includes("寡言") || combined.includes("简洁")) {
      const terseReplies = [
        `"嗯。" ${this.name}简短地应了一声，没有多说的意思。`,
        `"没时间闲聊。" ${this.name}的目光扫过你的肩膀，似乎在注意别的东西。`,
        `"该说的都说了。你自己小心。"`,
      ];
      return terseReplies[Math.floor(Math.random() * terseReplies.length)];
    }

    if (this.traits.friendliness >= 7 || combined.includes("友好") || combined.includes("热情") || combined.includes("开朗")) {
      const friendlyReplies = [
        `"哦！终于有人来了！" ${this.name}露出松了一口气的表情，"我正需要帮手。"`,
        `"你好啊，旅行者！你看起来像是能应付麻烦的人。"`,
        `"太好了——这里我一个人实在应付不来。"`,
      ];
      return friendlyReplies[Math.floor(Math.random() * friendlyReplies.length)];
    }

    // 关系值影响
    if (this.relationship <= -2) {
      return `（${this.name}冷淡地看着你）"我们没什么好说的。"`;
    }

    if (this.relationship >= 3) {
      return `"你来了。" ${this.name}露出一个难得的微笑，"说实话，见到你让我安心不少。"`;
    }

    // 默认
    const defaultReplies = [
      `"你是……谁？" ${this.name}警惕地打量着你。`,
      `（${this.name}摇了摇头）"我没什么好说的。"`,
      `"你最好别管这里的事。"`,
      `（${this.name}沉默了片刻）"……你想知道什么？"`,
    ];
    return defaultReplies[Math.floor(Math.random() * defaultReplies.length)];
  }

  /** LLM 不可用时主动发言模板 */
  private templateSpeakUp(trigger: string): string {
    const p = this.personality;
    const combined = (p.personality + " " + p.speech_style).toLowerCase();

    if (combined.includes("紧张") || combined.includes("恐惧")) {
      const nervous = [
        `（${this.name}突然抓住你的手臂）"听到了吗？那个声音又来了……"`,
        `"我们得走了……这里很快就不安全了。"`,
        `（${this.name}猛地回头看向黑暗中）"……没事。我以为看到了什么。"`,
      ];
      return nervous[Math.floor(Math.random() * nervous.length)];
    }
    if (combined.includes("沉默") || combined.includes("寡言")) {
      const terse = [
        `"……有动静。" ${this.name}低声说。`,
        `（${this.name}停下脚步，侧耳倾听了一会儿）`,
      ];
      return terse[Math.floor(Math.random() * terse.length)];
    }
    const defaults = [
      `（${this.name}清了清嗓子）"嗯……你还在啊。"`,
      `"你有闻到什么味道吗？" ${this.name}皱了皱眉头。`,
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }
}
