// NPC Agent — 独立角色实例
// 每人一张人格卡 + 独立记忆 buffer + LLM 驱动对话
//
// 设计原则：
//   NPC 不管理世界状态（那是律书的事）
//   NPC 只做角色扮演——以自己的身份说话和行动

import type { LLMLike, Message as LLMMessage } from "../llm/client";
import type { NPCPersonality, MemoryEntry, AgentMessage, NPCMood } from "./types";
import { DEFAULT_NPC_TRAITS } from "./types";
import {
  getNPCReactions,
  updateMood,
  type MoodTrigger,
} from "./npc-reaction";
import { NPCStore } from "../db/index";
import { applyConstraints } from "./constraints";
import { checkDialogueText, DIALOGUE_FABRICATED_CHARACTER_BLOCK_MESSAGE } from "../world/world-constraint";
import type { RulesetId } from "../rules/rules-engine";
import { log } from "../log";

/**
 * `respond()`/`speakUp()` 的可选约束上下文——开发·约束层补角色实体域
 * N9 任务 A/B。不传时（既有调用点，本轮之外的路径）`checkDialogueText`
 * 拿不到 sceneId/场景数据，场景限定的约束天然不命中，行为与改动前
 * 一致——与 `NarrateConstraintOpts`（kp-agent.ts）同一个设计。
 */
export interface NPCDialogueConstraintOpts {
  sceneId?: string;
  ruleset?: RulesetId;
  /**
   * 登记表（`CHARACTER_NOUN_REGISTRY`）里当前场景没有对应 NPC 的角色
   * 名词——见 `world-constraint.ts` 的 `ConstraintContext
   * .sceneFabricableCharacterNouns` 注释。缺省不传，该约束不生效。
   */
  sceneFabricableCharacterNouns?: string[];
}

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
  private llm: LLMLike;
  private memories: MemoryEntry[] = [];
  private systemPrompt: string;
  private db?: NPCStore;

  /** 当前情绪状态 */
  private mood: NPCMood;
  /** 玩家关系值（-5~+5） */
  private relationship: number = 0;
  /** 对玩家的态度记录 */
  private playerInteractionCount: number = 0;

  constructor(personality: NPCPersonality, llm: LLMLike, db?: NPCStore) {
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
    recentMessages: AgentMessage[] = [],
    constraintOpts?: NPCDialogueConstraintOpts,
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

    const callOnce = async (extra?: LLMMessage): Promise<string> => {
      const raw = await this.llm.chat(extra ? [...messages, extra] : messages, {
        temperature: 0.8,
        maxTokens: 300,
      });
      return raw.trim();
    };

    try {
      let response = await callOnce();

      // 输出约束层 — 检查并改写
      const constraintResult = applyConstraints(response, this.personality, this.mood, this.relationship);
      if (!constraintResult.passed) {
        log.warn("npc", `NPC ${this.name} 约束拦截: ${constraintResult.warnings.join("; ")}`);
        response = constraintResult.sanitized;
      }

      response = await this.applyDialogueSafetyConstraints(response, constraintOpts, callOnce, "对话");

      this.rememberDialogue(this.name, response);
      return response;
    } catch (err: any) {
      log.warn("npc", `NPC ${this.name} 回应 LLM 失败: ${err.message.slice(0, 60)}`);
      // LLM 不可用时，用角色性格生成模板回应
      return this.templateReply(context);
    }
  }

  /**
   * 时代/角色实体两道世界观约束的共用检查+处置——respond()/speakUp()
   * 各自构造 `callOnce` 闭包传进来，这里只管"检查、要不要重生成、
   * 重生成后还不干净就退回安全兜底"这一段逻辑，不重复写两份。
   *
   * 两类命中处置方式不同（都是 block，但不是同一回事）：
   *   - `dialogue_fabricated_character`（todo-56，N9 任务 B）：值得给
   *     LLM 一次纠正机会——带上具体的纠正指示重新生成一次，仍不干净
   *     才退回兜底文案。与 kp-agent.ts 的 narrateOutcome 同一处置
   *     （block + 重生成 + 兜底），保持两条"叙事类"约束路径口径一致。
   *   - 其它 scope=dialogue 约束（时代错置/meta 词汇）：维持这两条
   *     约束原有的行为——直接换安全话术，不重生成（这两类命中通常是
   *     整句话都跑题了，重生成不一定能对症，且这是已有行为，本轮任务
   *     A 明确"只接线不改判定"，不在这里扩大改动范围）。
   */
  private async applyDialogueSafetyConstraints(
    response: string,
    constraintOpts: NPCDialogueConstraintOpts | undefined,
    callOnce: (extra?: LLMMessage) => Promise<string>,
    logLabel: string,
  ): Promise<string> {
    let hit = checkDialogueText(
      response, constraintOpts?.sceneId, constraintOpts?.ruleset, constraintOpts?.sceneFabricableCharacterNouns,
    );
    if (hit?.type === "block" && hit.blockMessage === DIALOGUE_FABRICATED_CHARACTER_BLOCK_MESSAGE) {
      log.warn("npc", `NPC ${this.name} ${logLabel}角色实体约束拦截，重生成一次（提到了场景里不存在的角色）`);
      response = await callOnce({
        role: "system",
        content: "上一句回答提到了一个这个场景实际不存在的角色（比如「老板」「前台」这类称呼），这与场景事实矛盾——不要提及任何具体的人名/身份称呼，除非你确定这个人真的在场，把这部分内容换成不点名任何人的说法。",
      });
      hit = checkDialogueText(
        response, constraintOpts?.sceneId, constraintOpts?.ruleset, constraintOpts?.sceneFabricableCharacterNouns,
      );
      if (hit?.type === "block" && hit.blockMessage === DIALOGUE_FABRICATED_CHARACTER_BLOCK_MESSAGE) {
        log.warn("npc", `NPC ${this.name} ${logLabel}重生成后仍命中角色实体约束，退回安全兜底文案`);
        return this.fabricatedCharacterSafeReply();
      }
      return response;
    }
    if (hit) {
      log.warn("npc", `NPC ${this.name} ${logLabel}时代约束拦截（含现代科技词）`);
      return this.anachronismSafeReply();
    }
    return response;
  }

  /**
   * NPC 主动发言（不由玩家触发，由 KP 调度）
   * @param trigger 触发原因描述
   * @param recentMessages 最近消息历史
   */
  async speakUp(
    trigger: string,
    recentMessages: AgentMessage[] = [],
    constraintOpts?: NPCDialogueConstraintOpts,
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

    const callOnce = async (extra?: LLMMessage): Promise<string> => {
      const raw = await this.llm.chat(extra ? [...messages, extra] : messages, {
        temperature: 0.9,
        maxTokens: 200,
      });
      return raw.trim();
    };

    try {
      let response = await callOnce();

      // 输出约束层
      const constraintResult = applyConstraints(response, this.personality, this.mood, this.relationship);
      if (!constraintResult.passed) {
        log.warn("npc", `NPC ${this.name} 主动发言约束拦截: ${constraintResult.warnings.join("; ")}`);
        response = constraintResult.sanitized;
      }

      response = await this.applyDialogueSafetyConstraints(response, constraintOpts, callOnce, "主动发言");

      this.rememberDialogue(this.name, response, 6);
      return response;
    } catch (err: any) {
      log.warn("npc", `NPC ${this.name} 主动发言 LLM 失败: ${err.message.slice(0, 60)}`);
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

  /** 提取短角色标签用于身份感知 */
  private roleTag(): string {
    const role = this.personality.role || "";
    if (!role) return "";
    const short = role.includes("——") ? role.split("——")[0] : role;
    if (short.length > 10) return "";
    return short;
  }

  /** 时代约束拦截时的安全话术 — 不含任何具体内容/现代科技词，保持角色感 */
  private anachronismSafeReply(): string {
    const tag = this.roleTag();
    const tagPhrase = tag ? `我这个${tag}` : "我";
    const replies = [
      `（${this.name}摇了摇头）"这事……我得再想想怎么说。"`,
      `"抱歉，我一时不知道该怎么跟你说。"`,
      `（${this.name}沉默了片刻）"有些事，我还理不清头绪。"`,
      `"唉……说来话长，改天再细说吧。"`,
      `${tagPhrase ? `"我${tagPhrase}一时也想不明白。"` : `"我也说不清楚。"`}`,
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  /**
   * 角色实体约束拦截、重生成仍不干净时的安全话术——开发·约束层补角色
   * 实体域 N9（todo-56）。不点名任何具体的人，避免重蹈"编出一个不存在
   * 的角色"的覆辙；与 `anachronismSafeReply()` 分开一份而不是共用，
   * 是因为那份话术的措辞是"这事我说不清"，读起来像在回避一个**话题**，
   * 这里要回避的是"点名一个人"，措辞更贴近"我不方便说是谁"。
   */
  private fabricatedCharacterSafeReply(): string {
    const tag = this.roleTag();
    const tagPhrase = tag ? `我这个${tag}` : "我";
    const replies = [
      `"这个啊……不方便说是谁经手的。"`,
      `（${this.name}含糊地摆了摆手）"反正有人管这事，你别多问是谁了。"`,
      `"具体是哪位，${tagPhrase}也不好替人家说。"`,
      `（${this.name}顿了顿）"这事儿……说来话长，反正不归我管。"`,
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  /** LLM 不可用时的模板回应（特质+情绪+身份驱动） */
  private templateReply(_context: string): string {
    const p = this.personality;
    const combined = (p.personality + " " + p.speech_style).toLowerCase();
    const tag = this.roleTag();
    const tagPhrase = tag ? `我这个${tag}` : "我";

    // 情绪驱动
    if (this.mood === "fearful") {
      const replies = [
        `（${this.name}声音发抖）"不……不要靠近我！${tag ? `我${tagPhrase}真的什么都不知道……` : ""}"`,
        `（${this.name}后退了一步）"我……${tag ? `我只是个${tag}` : ""}没什么好说的，求你了……"`,
        `"你不明白……你不明白这里发生了什么……" ${this.name}语无伦次地说。`,
        `（${this.name}蜷缩着）"求求你，别问我了……${tag ? `我${tagPhrase}只想安安静静的……` : ""}"`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    if (this.mood === "angry") {
      const replies = [
        `（${this.name}怒视着你）"你还有脸来找我？${tag ? `我${tagPhrase}可不是好欺负的。` : ""}"`,
        `"别浪费我的时间。" ${this.name}转过身去，显然不想再谈。`,
        `（${this.name}咬牙切齿）"你要是聪明的话，趁我没发火之前赶紧走。"`,
        `"我警告你——${tag ? `${tagPhrase}可不是吃素的` : "别太过分"}。" ${this.name}的声音冷了下来。`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    if (this.mood === "friendly") {
      const replies = [
        `"啊，是你！" ${this.name}的表情明显放松了下来，"我正想着你会不会来呢。"`,
        `（${this.name}向你招了招手）"来，我给你看点东西——${tag ? `${tagPhrase}可不会随便给人看这个。` : "我觉得你会感兴趣。"}"`,
        `"太好了，有你在我就放心多了。"`,
        `（${this.name}笑了笑）"我就知道你靠得住——${tag ? `${tagPhrase}见过的人不少，你算特别的。` : ""}"`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    // 特质+性格关键词驱动
    if (this.traits.courage <= 3 || combined.includes("紧张") || combined.includes("警惕") || combined.includes("恐惧")) {
      const replies = [
        `（${this.name}紧张地看着你，低声说）"你……你也是听到那个声音才来的吗？"`,
        `（${this.name}不安地搓着手）"这里不对劲……${tag ? `${tagPhrase}劝你赶紧离开。` : "我建议你赶紧离开。"}"`,
        `"嘘——别那么大声。它们……它们能听到。"`,
        `（${this.name}东张西望了一番）"我不知道你是什么人，但${tag ? `${tagPhrase}得提醒你——` : ""}别进那个谷仓。"`,
        `（${this.name}压低声音）"这地方有古怪……${tag ? `我${tagPhrase}在这里待久了，感觉不对劲。` : ""}"`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    if (combined.includes("沉默") || combined.includes("寡言") || combined.includes("简洁")) {
      const replies = [
        `"嗯。" ${this.name}简短地应了一声，没有多说的意思。`,
        `"没时间闲聊。" ${this.name}的目光扫过你的肩膀，似乎在注意别的东西。`,
        `"该说的都说了。你自己小心。"`,
        `（${this.name}只是沉默地看了你一眼，没有搭话）`,
        `${tag ? `"${tagPhrase}没什么好说的。"` : `"不关我事。"`} ${this.name}移开了目光。`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    if (this.traits.friendliness >= 7 || combined.includes("友好") || combined.includes("热情") || combined.includes("开朗")) {
      const replies = [
        `"哦！终于有人来了！" ${this.name}露出松了一口气的表情，"${tag ? `${tagPhrase}正需要帮手。` : "我正需要帮手。"}"`,
        `"你好啊，旅行者！你看起来像是能应付麻烦的人。"`,
        `"太好了——这里我一个人实在应付不来。"`,
        `（${this.name}热情地招呼你）"来来来，${tag ? `${tagPhrase}跟你说道说道。` : "我跟你说说这里的事。"}"`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    // 关系值影响
    if (this.relationship <= -2) {
      return `（${this.name}冷淡地看着你）"我们没什么好说的。"`;
    }

    if (this.relationship >= 3) {
      const replies = [
        `"你来了。" ${this.name}露出一个难得的微笑，"说实话，见到你让我安心不少。"`,
        `（${this.name}点了点头）"又见面了。${tag ? `我${tagPhrase}一直想着你可能会回来。` : "我还以为你不会回来了。"}"`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }

    // 默认
    const defaults = [
      `"你是……谁？" ${this.name}警惕地打量着你。`,
      `（${this.name}摇了摇头）"我没什么好说的。"`,
      `"你最好别管这里的事。"`,
      `（${this.name}沉默了片刻）"……你想知道什么？"`,
      tag ? `"我就是个${tag}，能知道什么。" ${this.name}耸了耸肩。` : `"别问我，我什么都不知道。"`,
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }

  /** LLM 不可用时主动发言模板（身份感知） */
  private templateSpeakUp(_trigger: string): string {
    const p = this.personality;
    const combined = (p.personality + " " + p.speech_style).toLowerCase();
    const tag = this.roleTag();

    if (combined.includes("紧张") || combined.includes("恐惧")) {
      const replies = [
        `（${this.name}突然抓住你的手臂）"听到了吗？那个声音又来了……"`,
        `"我们得走了……这里很快就不安全了。"`,
        `（${this.name}猛地回头看向黑暗中）"……没事。我以为看到了什么。"`,
        tag ? `"${tag}的直觉告诉我——有什么东西在靠近。" ${this.name}的声音压得很低。` : `"我觉得有人在看着我们。" ${this.name}低声道。`,
      ];
      return replies[Math.floor(Math.random() * replies.length)];
    }
    if (combined.includes("沉默") || combined.includes("寡言")) {
      const replies = [
        `"……有动静。" ${this.name}低声说。`,
        `（${this.name}停下脚步，侧耳倾听了一会儿）`,
        tag ? `${this.name}指了指某个方向——${tag}的手在微微发抖。` : `${this.name}抬了抬下巴，示意你看那边。`,
      ];

      return replies[Math.floor(Math.random() * replies.length)];
    }
    const defaults = [
      `（${this.name}清了清嗓子）"嗯……你还在啊。"`,
      `"你有闻到什么味道吗？" ${this.name}皱了皱眉头。`,
      tag ? `（${this.name}低声道）"我${tag}可以跟你说件事，但你别说出去。"` : `"喂，你知道这里都发生过什么事吗？"`,
    ];
    return defaults[Math.floor(Math.random() * defaults.length)];
  }
}
