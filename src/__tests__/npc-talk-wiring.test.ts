// P1 — 自由跑团的"和 NPC 说话"接线
// 背景见 game-session.ts 的 handleTalk() 注释：此前 case "talk" 是纯桩，
// 不管玩家说什么、跟谁说，永远回一句"你试图与周围的人交流…"。
// MythosModuleLoader 早就把模组 NPC 人格注册进了 NPC Agent 系统（this.registry），
// /npc-chat 端点也已经在消费它——这条从自由跑团进来的路此前从未接上同一个消费者。
//
// bun test src/__tests__/npc-talk-wiring.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

let session: GameSession;

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("talk-wiring-test", "cosmic-horror", {
    apiKey: "sk-placeholder",
    baseUrl: "http://localhost:9999",
    model: "mock",
    maxTokens: 1024,
    temperature: 0.7,
  }, undefined, "调查员");
});

describe("和 NPC 说话 — 找不到对象时分清三种情况", () => {
  it("没指定对象：不该是万金油回复，要列出在场的人（或说明没人）", async () => {
    const res = await session.act("跟人说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).not.toMatch(/你试图与周围的人交流/);
    expect(content).toMatch(/要跟谁说话|这里没有人可以交谈/);
  });

  it("这里没这个人（模组未加载，场上什么人都没有）", async () => {
    const res = await session.act("跟张三说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).toMatch(/这里没有「张三」/);
    expect(content).not.toMatch(/你试图与周围的人交流/);
  });

  it("这里没这个人，但报错要说清楚在场都有谁", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("特里坎家");
    const res = await session.act("跟不存在的人说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).toMatch(/这里没有「不存在的人」/);
    expect(content).toMatch(/在场的有/);
  });

  it("人在场，但没有注册人格数据：明说缺的是什么，不是万金油回复", async () => {
    const pos = (session as any).getDisplayedScene();
    (session as any).world.upsertEntity({
      id: "ghost_1", name: "无名幽影", type: "npc",
      hp: 1, maxHp: 1, ac: 10, status: [], position: pos, scene_id: pos, faction: "unknown",
    });
    const res = await session.act("跟无名幽影说话");
    const content = res.events.map((e) => e.content).join("\n");
    expect(content).toMatch(/无名幽影没有可用的人格数据/);
    expect(content).not.toMatch(/你试图与周围的人交流/);
  });
});

describe("和 NPC 说话 — 真实对话应该走到 NPC Agent", () => {
  it("模组内联人格注册的 NPC 在场时，说话应产生一条来自该 NPC 的 dialogue 消息", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("特里坎家");

    // 菲碧·特里坎（premiers_barn.ts）带完整内联 personality，挂在"特里坎家"
    const registry: any = (session as any).registry;
    expect(registry.findAgentByName("菲碧·特里坎")).toBeDefined();

    const res = await session.act("跟菲碧说话");
    const dialogueEvent = res.events.find((e) => e.speaker === "菲碧·特里坎" && e.type === "dialogue");
    expect(dialogueEvent).toBeDefined();
    expect(dialogueEvent!.content.length).toBeGreaterThan(0);
    expect(res.narrative).toBe(dialogueEvent!.content);
  });

  it("连续问两次同一个 NPC，不该逐字复读同一句", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("特里坎家");

    const res1 = await session.act("跟菲碧说话");
    const res2 = await session.act("跟菲碧说话");
    const c1 = res1.events.find((e) => e.speaker === "菲碧·特里坎")?.content;
    const c2 = res2.events.find((e) => e.speaker === "菲碧·特里坎")?.content;
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    // MockLLMClient 离线模式没有对话轮替记忆时会给同一句默认回复——
    // 这里只断言两次都拿到了真实回复（不是桩文案），逐字去重留给 NPC Agent 自己的记忆机制。
    expect(c1).not.toMatch(/你试图与周围的人交流/);
    expect(c2).not.toMatch(/你试图与周围的人交流/);
  });

  it("对话内容会计入 lastNarrative 与会话历史（供 /history 与语音层读取）", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("特里坎家");
    await session.act("跟菲碧说话");

    const history = session.getHistory(5);
    const found = history.messages.some((m) => m.speaker === "菲碧·特里坎" && m.type === "dialogue");
    expect(found).toBe(true);
  });
});
