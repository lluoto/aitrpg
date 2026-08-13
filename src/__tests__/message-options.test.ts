// addMessage 的可选项契约
//
// 尾参从六个位置参数收成 options 对象（docs/voice-readiness.md §六 第 2 步）。
// 这里钉住两件事：可选项确实写进了消息，以及没传时不留空字段。
//
// bun test src/__tests__/message-options.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

let session: GameSession;

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("msg-opts", "cosmic-horror", LLM, undefined, "调查员");
});

const history = () => session.getHistory().messages;
const find = (content: string) => history().find((m) => m.content === content);

describe("默认值", () => {
  it("只给三个参数时按公开消息写入", () => {
    session.addMessage("KP", "门在你身后合上。", "narration");
    const m = find("门在你身后合上。");
    expect(m).toBeDefined();
    expect(m!.speaker).toBe("KP");
    expect(m!.type).toBe("narration");
  });

  it("不传可选项时不留下空字段", () => {
    session.addMessage("KP", "普通叙述", "narration");
    const m = find("普通叙述")!;
    // 不是 false / undefined，而是整个字段不存在 —— 每条消息都带
    // verbatim: false 会污染存档，也会让"有没有标记"变成"标记是不是真"
    expect("verbatim" in m).toBe(false);
    expect("mood" in m).toBe(false);
  });
});

describe("verbatim", () => {
  it("标记模组原文", () => {
    session.addMessage("KP", "模组原文段落", "narration", { verbatim: true });
    expect(find("模组原文段落")!.verbatim).toBe(true);
  });

  it("显式传 false 也不写字段", () => {
    session.addMessage("KP", "生成的叙述", "narration", { verbatim: false });
    expect("verbatim" in find("生成的叙述")!).toBe(false);
  });
});

describe("mood", () => {
  // 情绪必须在生成时刻固定：mood 是状态机，播放或回放时回查 NPCAgent
  // 拿到的是那时的情绪，不是说这句话时的情绪
  it("随台词一起固定下来", () => {
    session.addMessage("扎多克", "他们都在水下……", "dialogue", { mood: "fearful" });
    expect(find("他们都在水下……")!.mood).toBe("fearful");
  });

  it("同一 NPC 的两句话各自保留当时的情绪", () => {
    session.addMessage("扎多克", "第一句", "dialogue", { mood: "calm" });
    session.addMessage("扎多克", "第二句", "dialogue", { mood: "angry" });
    expect(find("第一句")!.mood).toBe("calm");
    expect(find("第二句")!.mood).toBe("angry");
  });
});

describe("verbatim 与 mood 互不干扰", () => {
  it("可以同时带", () => {
    session.addMessage("扎多克", "原文台词", "dialogue", { verbatim: true, mood: "sad" });
    const m = find("原文台词")!;
    expect(m.verbatim).toBe(true);
    expect(m.mood).toBe("sad");
  });

  it("只带一个时另一个字段不存在", () => {
    session.addMessage("KP", "只有原文标记", "narration", { verbatim: true });
    expect("mood" in find("只有原文标记")!).toBe(false);
  });
});
