// 约束层补角色实体域——开发·约束层补角色实体域 N9 任务 B（todo-56）。
//
// 背景：todo-56 用真实撞坑案例钉住过——酒吧保镖那句「名单什么的早让
// 老板锁进抽屉了，哪轮得到你翻。」（analysis/sim/2026-08-30-barn-
// natural-play.md:58）编出了「老板」这个 weisen_bar 场景里完全不存在
// 的角色，applyConstraints/checkDialogueText 都放行。本轮新增
// `dialogue_fabricated_character` 约束域堵住这一半。
//
// bun test src/__tests__/npc-entity-fabrication-constraint.test.ts

import { describe, it, expect } from "bun:test";
import { NPCAgent } from "../agent/npc-agent";
import type { NPCPersonality } from "../agent/types";
import type { Message, ChatOptions, LLMLike } from "../llm/client";

/** 真实撞坑原句，一字不改。 */
const FABRICATED_LINE = "名单什么的早让老板锁进抽屉了，哪轮得到你翻。";
const CLEAN_LINE = "不清楚客人的事，问了也白问——有事去问前台。";

/** 按调用顺序返回脚本里的每一句；脚本用完后重复最后一句。 */
class ScriptedLLM implements LLMLike {
  calls = 0;
  constructor(private script: string[]) {}
  async chat(_messages: Message[], _options?: ChatOptions): Promise<string> {
    const reply = this.script[Math.min(this.calls, this.script.length - 1)]!;
    this.calls++;
    return reply;
  }
}

const BOUNCER: NPCPersonality = {
  name: "酒吧保镖",
  role: "酒吧保镖",
  personality: "话不多，态度强硬粗鲁。",
  background: "维森酒吧的保安。",
  goals: ["维持秩序"],
  speech_style: "话不多，态度强硬粗鲁。",
  knowledge: ["不清楚客人的事，问了也白问——有事去问前台。"],
  secrets: [],
};

describe("dialogue_fabricated_character：正确/错误行为红线/反向判据/变异检验", () => {
  it("**错误行为红线（真实案例）**：LLM 坚持编造，重生成一次仍命中 → 退回不点名任何人的安全兜底，绝不把「老板」这三个字放出去", async () => {
    const llm = new ScriptedLLM([FABRICATED_LINE, FABRICATED_LINE]);
    const agent = new NPCAgent(BOUNCER, llm);
    const reply = await agent.respond("名单的事你知道吗？", [], {
      sceneId: "weisen_bar",
      sceneFabricableCharacterNouns: ["老板"],
    });
    expect(llm.calls).toBe(2); // 第一次生成 + 重生成一次，不会无限重试
    expect(reply).not.toContain("老板");
    expect(reply).not.toContain("抽屉");
  });

  it("**正确**：LLM 重生成后改口了（不再提「老板」）→ 采用重生成的干净版本，不是硬套安全兜底", async () => {
    const llm = new ScriptedLLM([FABRICATED_LINE, CLEAN_LINE]);
    const agent = new NPCAgent(BOUNCER, llm);
    const reply = await agent.respond("名单的事你知道吗？", [], {
      sceneId: "weisen_bar",
      sceneFabricableCharacterNouns: ["老板"],
    });
    expect(llm.calls).toBe(2);
    expect(reply).toBe(CLEAN_LINE);
  });

  it("**反向判据（防过度拦截，至少三条正样本）**：只提到本场景真实存在角色的对话必须不被拦", async () => {
    const samples = [
      "有事去问前台，别烦我。", // 提到"前台"——weisen_bar 真实存在
      "我是这里的保镖，谁闹事我揍谁。", // 提到自己的身份，不是登记表词
      "你要问包场的事，去找前台。", // 同上，"前台"合法存在
    ];
    for (const line of samples) {
      const llm = new ScriptedLLM([line]);
      const agent = new NPCAgent(BOUNCER, llm);
      const reply = await agent.respond("随便问点什么", [], {
        sceneId: "weisen_bar",
        // "前台"不在这里——它是 weisen_bar 真实存在的角色，不该被当成
        // 可编造的词传进来；这正是 unrepresentedCharacterNouns() 会
        // 算出的结果（前台已被 bar_receptionist 代表）。
        sceneFabricableCharacterNouns: ["老板"],
      });
      expect(llm.calls).toBe(1); // 没有被拦，没有触发重生成
      expect(reply).toBe(line);
    }
  });

  it("**目标行为错误的对照**：不传 sceneFabricableCharacterNouns（既有调用点未升级时）——即使 LLM 编了「老板」也不拦，行为与改动前一致", async () => {
    const llm = new ScriptedLLM([FABRICATED_LINE]);
    const agent = new NPCAgent(BOUNCER, llm);
    const reply = await agent.respond("名单的事你知道吗？", []); // 不传第三参
    expect(llm.calls).toBe(1);
    expect(reply).toBe(FABRICATED_LINE); // 未升级的调用点行为不变——向后兼容
  });
});
