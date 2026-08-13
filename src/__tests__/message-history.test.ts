// 回合消息必须进入会话历史
//
// 根因：act() 把本回合的玩家行动、KP 叙述、系统提示只推进局部数组 turnMessages，
// buildActionResponse() 将其映射为 events 返回，整个 act() 从不调用
// addMessage() / session.push()。PlayerSession.messageHistory 因此只收得到
// 回合流程之外的消息（KP 面板 sendMessage、模组加载器、流血提示）。
//
// 后果：GET /history 在正常跑团后恒空、getSummary().messageCount 恒 0、
// 前端 resumeSession() 恢复出空日志；语音层要消费的消息流也缺了
// KP 叙述与玩家行动（见 docs/voice-readiness.md §二「该不该念 / 谁来念」）。
//
// bun test src/__tests__/message-history.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

function makeSession(archetypeId?: string): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("history-session", "cosmic-horror", LLM, archetypeId, "调查员");
}

let session: GameSession;

beforeEach(() => {
  session = makeSession("investigator");
});

describe("回合消息进入会话历史", () => {
  it("玩家行动在一个回合后可从历史读回", async () => {
    await session.act("观察四周");
    const contents = session.getHistory().messages.map((m) => m.content);
    expect(contents).toContain("观察四周");
  });

  // 不断言某个具体 type 必然出现：输入命中意图处理器时 act() 会在叙述之前短路返回，
  // 该回合本就没有 narration。真正的不变量是 events ⊆ history，与走哪条处理路径无关。
  it("本回合返回的每条 event 都能在历史中找到", async () => {
    const res = await session.act("观察四周");
    expect(res.events.length).toBeGreaterThan(0);

    const history = session.getHistory().messages;
    for (const ev of res.events) {
      const hit = history.find(
        (m) => m.speaker === ev.speaker && m.content === ev.content && m.type === ev.type,
      );
      expect(hit).toBeDefined();
    }
  });

  it("落入 KP 叙述路径的回合，叙述同样进历史", async () => {
    // 自由文本不匹配任何意图处理器，会走到 kp.narrateOutcome 的叙述分支
    const res = await session.act("我对着空气哼了一段没人听过的调子");
    const narrationEvent = res.events.find((e) => e.type === "narration");
    expect(narrationEvent).toBeDefined();

    const history = session.getHistory().messages;
    const narrationInHistory = history.find(
      (m) => m.type === "narration" && m.content === narrationEvent!.content,
    );
    expect(narrationInHistory).toBeDefined();
  });

  it("getSummary().messageCount 与历史长度一致且非零", async () => {
    await session.act("观察四周");
    const total = session.getHistory().total;
    expect(total).toBeGreaterThan(0);
    expect(session.getSummary().messageCount).toBe(total);
  });

  it("同一条消息不被重复写入历史", async () => {
    await session.act("观察四周");
    const contents = session.getHistory().messages.map((m) => m.content);
    const dup = contents.filter((c) => c === "观察四周");
    expect(dup.length).toBe(1);
  });

  it("多回合按顺序累积，不覆盖不丢失", async () => {
    await session.act("观察四周");
    const afterFirst = session.getHistory().total;
    await session.act("检查地面");
    const contents = session.getHistory().messages.map((m) => m.content);

    expect(session.getHistory().total).toBeGreaterThan(afterFirst);
    expect(contents).toContain("观察四周");
    expect(contents).toContain("检查地面");
    expect(contents.indexOf("观察四周")).toBeLessThan(contents.indexOf("检查地面"));
  });
});

// 跨工作流回归保护：verbatim 是语音层区分「预制朗读」与「实时合成」的判据
// （docs/voice-readiness.md §四）。回合消息入历史后，不得把已有的 verbatim 标记冲掉。
describe("回合消息入历史不影响 verbatim 标记", () => {
  it("带 verbatim 的消息与回合消息共存于历史", async () => {
    session.addMessage("KP", "模组原文段落", "narration", "public", undefined, true);
    await session.act("观察四周");

    const history = session.getHistory().messages;
    const verbatim = history.filter((m) => m.verbatim === true);
    expect(verbatim.length).toBe(1);
    expect(verbatim[0]!.content).toBe("模组原文段落");

    // 回合消息不应被误标为原文
    const turnMsg = history.find((m) => m.content === "观察四周");
    expect(turnMsg).toBeDefined();
    expect(turnMsg!.verbatim).toBeUndefined();
  });
});
