// KP Agent — 导演/Keeper
// 负责：场景描述、事件注入、节奏控制
//
// 设计原则：
//   KP 不扮演 NPC（那是 NPC Agent 的事）
//   KP 不判定规则（那是律书的事）
//   KP 只做三件事：描述环境、推进剧情、控制节奏

import type { LLMClient, Message as LLMMessage } from "../llm/client";
import type { KPDirective, TurnRecord, AgentMessage } from "./types";
import { fallbackNarrative, fallbackSceneDescription, DEGRADATION_NOTICE } from "../llm/fallback";
import { log } from "../log";

const KP_SYSTEM_PROMPT = `你是一个 TRPG 主持人（KP/DM）。你的任务是描述场景、推进剧情、控制节奏。

核心规则：
1. 用第二人称"你"描述玩家角色的所见所闻
2. 环境描写要具体，但只能使用权威事实或玩家明确观察到的信息；没有依据时保持中性
3. 每次仅推进一个节拍，不要跳跃式叙事
4. 不替玩家做决定——描述"你可以看到"而非"你走向"
5. 不代 NPC 发言——NPC 的对话由 NPC Agent 自己说
6. 遇到需要检定的情况，标出技能名但不投骰——骰子由律书处理
7. 叙事风格: 克苏鲁式渐近揭示——先普通再异常，从不全部说清
8. 如果后续 system 消息提供了模组原文或事实边界，它优先于常识和风格要求；不得补写原文未提供的光线、气味、声音、天气、温度、物品、人物或事件

格式：每次输出一个场景描述块。如果需要玩家行动，以"你要怎么做？"结尾。`;

export class KPAgent {
  private llm: LLMClient;
  private directive: KPDirective;
  private turns: TurnRecord[] = [];
  /** 世界模型权威事实注入（可选）：由会话层在叙事前设置，作为 system 上下文注入 */
  private worldModelContext: string = "";

  constructor(directive: KPDirective, llm: LLMClient) {
    this.directive = directive;
    this.llm = llm;
  }

  /** 更新剧情指令 */
  updateDirective(update: Partial<KPDirective>) {
    Object.assign(this.directive, update);
  }

  /** 设置世界模型注入文本（空串 = 不注入） */
  setWorldModelContext(text: string) {
    this.worldModelContext = text;
  }

  /** 推进当前场景 */
  async describeScene(): Promise<string> {
    const messages: LLMMessage[] = [
      { role: "system", content: KP_SYSTEM_PROMPT },
      {
        role: "system",
        content: [
          `当前场景: ${this.directive.scene_description}`,
          `场景元素: ${this.directive.scene_elements.join("、")}`,
          `剧情阶段: ${this.directive.current_phase}`,
          `叙事风格: ${this.directive.style}`,
        ].join("\n"),
      },
    ];

    // 世界模型权威事实注入（可选）
    if (this.worldModelContext) {
      messages.push({ role: "system", content: this.worldModelContext });
    }

    // 注入最近的回合历史
    if (this.turns.length > 0) {
      const recent = this.turns.slice(-3);
      const history = recent
        .map((t) => {
          const msgs = t.messages
            .map((m) => `[${m.speaker}] ${m.content}`)
            .join("\n  ");
          return `第${t.round}轮:\n  玩家输入: ${t.player_input}\n  ${msgs}`;
        })
        .join("\n\n");
      messages.push({
        role: "system",
        content: `最近的历史:\n${history}`,
      });
    }

    messages.push({
      role: "user",
      content:
        "请描述当前场景中玩家能看到、听到、感受到的一切。要先描述环境，再提示可能的行动方向；若上下文包含原文闭世界约束，只输出原文可证实的事实。",
    });

    try {
      const response = await this.llm.chat(messages, {
        temperature: this.worldModelContext.includes("[叙事输出最终约束]") ? 0.2 : 0.7,
        maxTokens: 600,
        timeout: 120000,
      });
      return response.trim();
    } catch (err: any) {
      log.warn("kp", `KP 场景描述 LLM 失败: ${err.message.slice(0, 60)}`);
      return fallbackSceneDescription(this.directive.scene_description);
    }
  }

  /** 玩家行动后，KP 推进叙事 */
  async narrateOutcome(
    playerAction: string,
    outcome: string,
    recentMessages: AgentMessage[] = []
  ): Promise<string> {
    const messages: LLMMessage[] = [
      { role: "system", content: KP_SYSTEM_PROMPT },
      {
        role: "system",
        content: [
          `场景: ${this.directive.scene_description}`,
          `剧情阶段: ${this.directive.current_phase}`,
        ].join("\n"),
      },
    ];

    // 世界模型权威事实注入（可选）
    if (this.worldModelContext) {
      messages.push({ role: "system", content: this.worldModelContext });
    }

    if (recentMessages.length > 0) {
      const history = recentMessages
        .slice(-8)
        .map((m) => `[${m.speaker}] ${m.content}`)
        .join("\n");
      messages.push({
        role: "system",
        content: `最近事件:\n${history}`,
      });
    }

    messages.push({
      role: "user",
      content: [
        `玩家行动: ${playerAction}`,
        `判定结果: ${outcome}`,
        "",
        "请以 KP 的口吻描述结果，推进一个叙事节拍。不要替 NPC 说话。若上下文包含原文闭世界约束，只输出原文可证实的物品、空间、状态和玩家动作结果，不要添加氛围细节。",
      ].join("\n"),
    });

    try {
      const response = await this.llm.chat(messages, {
        temperature: this.worldModelContext.includes("[叙事输出最终约束]") ? 0.2 : 0.8,
        maxTokens: 500,
        timeout: 120000,
      });
      return response.trim();
    } catch (err: any) {
      log.warn("kp", `KP 叙事 LLM 失败: ${err.message}`);
      return DEGRADATION_NOTICE + "\n\n" + fallbackNarrative(playerAction + " " + outcome);
    }
  }

  /** 局势停滞时注入新事件 */
  async injectEvent(): Promise<string | null> {
    const pendingNodes = this.directive.plot_nodes.filter((n) => !n.done);
    if (pendingNodes.length === 0) return null;

    const messages: LLMMessage[] = [
      { role: "system", content: KP_SYSTEM_PROMPT },
      {
        role: "system",
        content: [
          `场景: ${this.directive.scene_description}`,
          `可触发的剧情节点:`,
          ...pendingNodes.map(
            (n) => `  - ${n.id}: ${n.description}（触发条件: ${n.trigger}）`
          ),
        ].join("\n"),
      },
      {
        role: "user",
        content:
          "根据剧情节点，决定一个合理的叙事推进。描述环境中的新变化——新线索、新 NPC 进入、或某个等待中的事件发生了。输出 2-3 句话的环境/事件描述。如果时机不成熟，输出 'WAIT'。",
      },
    ];

    try {
      const response = await this.llm.chat(messages, {
        temperature: 0.6,
        maxTokens: 300,
      });
      const trimmed = response.trim();
      if (trimmed === "WAIT" || trimmed === '"WAIT"') return null;
      return trimmed;
    } catch (err: any) {
      log.warn("kp", `KP 事件注入 LLM 失败: ${err.message}`);
      return null;
    }
  }

  /** 场景切换 */
  async transitionScene(
    newScene: string,
    reason: string
  ): Promise<string> {
    this.directive.scene_description = newScene;
    this.directive.current_phase = newScene;

    const messages: LLMMessage[] = [
      { role: "system", content: KP_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          `场景切换原因: ${reason}`,
          `新场景: ${newScene}`,
          "",
          "请写一段场景过渡叙事（2-4句话），柔和地将玩家从上一个场景引入新场景。",
        ].join("\n"),
      },
    ];

    const response = await this.llm.chat(messages, {
      temperature: 0.7,
      maxTokens: 400,
    });

    return response.trim();
  }

  /** 记录一个回合 */
  recordTurn(turn: TurnRecord) {
    this.turns.push(turn);
  }

  /** 获取当前剧情指令 */
  getDirective(): KPDirective {
    return this.directive;
  }

  /** 获取回合历史 */
  getTurns(): TurnRecord[] {
    return this.turns;
  }
}
