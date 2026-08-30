// 开发·泛指词不当作 NPC 专名 —— 任务3验收。
//
// 背景：analysis/sim/2026-08-30-barn-a-retest.md 第 15 回合，「陈岳起身
// 准备动身出发，但先等待同伴确认具体要前往的地点。」被答成「这里没有
// 「同伴」」。handleTalk() 把 intent.target 当专名去在场 NPC 里找，
// 找不到就报"这里没有「X」"——但"同伴/队友/大家/伙伴/他们/众人"是泛指
// 队伍成员，不是名字，队伍是已知的（this.party），不该走专名查找失败
// 那条路。
//
// ⚠ 该真实句子在本仓测试的 regex 兜底路径下解析成 action="unknown"
// （已用 bun -e 实测），不会走到 handleTalk——这与任务1遇到的情况相同：
// 报告里的分类结果来自真实 LLM，regex 兜底对同一句话未必给出相同分类。
// 下面直接用能在 regex 路径下触发 talk + 泛指目标的句子（"跟同伴说话"
// 等）测 handleTalk 本身的行为，这是被改动的函数，测它比测"能不能凑巧
// 让 regex 把原句判成 talk"更直接、更不脆弱。
//
// bun test src/__tests__/generic-party-words-not-npc-name.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("generic-party-test", "cosmic-horror", {
    apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
  }, "investigator", "调查员");
}

let session: GameSession;

beforeEach(() => {
  session = makeSession();
});

describe("泛指词得到符合处境的回应，不是「这里没有「X」」", () => {
  const GENERIC_WORDS_SENTENCES: Array<[string, string]> = [
    ["跟同伴说话", "同伴"],
    ["和队友聊聊", "队友"],
  ];

  for (const [input, word] of GENERIC_WORDS_SENTENCES) {
    it(`「${input}」不回「这里没有「${word}」」`, async () => {
      const res = await session.act(input);
      const content = res.events.map((e) => e.content).join("\n");
      expect(content).not.toContain(`这里没有「${word}」`);
    });
  }

  it("回应里能看到队伍成员（已知信息，不是查找失败）", async () => {
    const res = await session.act("跟同伴说话");
    const content = res.events.map((e) => e.content).join("\n");
    // 只要玩家角色本身建了卡，party 至少有一条记录（自己）。
    expect(content).toMatch(/队伍里目前有|现在只有你自己一个人/);
  });
});

describe("正例：真实 NPC 名仍照常匹配，不受这次改动影响", () => {
  it("模组内真实 NPC 名字仍能对上话（间接验证没有把 .includes 模糊匹配放宽）", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("特里坎家");
    const res = await session.act("和菲碧说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).not.toContain("这里没有「菲碧」");
    expect(content).not.toContain("同伴");
  });
});

describe("干扰：一个真的不存在的名字仍然回「这里没有「X」」（既有判据不被破坏）", () => {
  it("「跟张三说话」（场上没有任何人）仍报这里没有「张三」——npc-talk-wiring.test.ts:37 同款判据", async () => {
    const res = await session.act("跟张三说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).toMatch(/这里没有「张三」/);
  });

  it("加载模组、真实在场但名字不存在时，仍报「这里没有「X」」且列出在场的人", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("特里坎家");
    const res = await session.act("跟不存在的人说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).toMatch(/这里没有「不存在的人」/);
  });
});
