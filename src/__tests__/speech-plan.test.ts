// 语音路由与预制清单
// bun test src/__tests__/speech-plan.test.ts

import { describe, it, expect } from "bun:test";
import { planSpeech, speechRouteFor, voiceKey, collectPrebakeEntries } from "../voice/speech-plan";
import type { AgentMessage } from "../agent/types";
import type { MythosModule } from "../rules/mythos-module";

function msg(over: Partial<AgentMessage> = {}): AgentMessage {
  return { speaker: "守秘人", content: "门在你身后合上。", type: "narration", ...over };
}

function mod(over: Partial<MythosModule> = {}): MythosModule {
  return {
    id: "m1", name: "测试模组", version: "1.0", description: "",
    difficulty: "medium", activation: { type: "manual", condition: "" },
    ...over,
  } as MythosModule;
}

describe("该不该念", () => {
  it("骰点与状态变更不念", () => {
    expect(speechRouteFor({ type: "system" })).toBe("silent");
    expect(speechRouteFor({ type: "action" })).toBe("silent");
  });

  it("叙述与台词要念", () => {
    expect(speechRouteFor({ type: "narration" })).toBe("realtime");
    expect(speechRouteFor({ type: "dialogue" })).toBe("realtime");
  });

  // 分界看的是消息有没有经过 LLM，不是内容长得像不像固定文本
  it("模组原文走预制", () => {
    expect(speechRouteFor({ type: "narration", verbatim: true })).toBe("prebaked");
  });

  it("verbatim 不能把不该念的变成要念的", () => {
    expect(speechRouteFor({ type: "system", verbatim: true })).toBe("silent");
  });
});

describe("planSpeech", () => {
  it("带出说话人与情绪", () => {
    const p = planSpeech(msg({ speaker: "扎多克", type: "dialogue", mood: "fearful" }));
    expect(p.speaker).toBe("扎多克");
    expect(p.mood).toBe("fearful");
    expect(p.route).toBe("realtime");
  });

  it("没带情绪时按中性处理", () => {
    expect(planSpeech(msg()).mood).toBe("neutral");
  });
});

describe("voiceKey", () => {
  it("同文本同键", () => {
    expect(voiceKey("门在你身后合上。")).toBe(voiceKey("门在你身后合上。"));
  });

  it("首尾空白不影响", () => {
    expect(voiceKey("  门在你身后合上。 ")).toBe(voiceKey("门在你身后合上。"));
  });

  // 用编号做键的话，改了文案而编号没变就会继续命中旧音频
  it("文本改一个字就换键", () => {
    expect(voiceKey("门在你身后合上。")).not.toBe(voiceKey("门在你身后关上。"));
  });
});

describe("预制清单", () => {
  it("收集模组开场白", () => {
    const entries = collectPrebakeEntries([
      mod({ id: "a", introNarration: "铅灰色的海面无尽延伸。" }),
      mod({ id: "b", introNarration: "图书馆大厅弥漫着旧书的气味。" }),
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0].moduleId).toBe("a");
    expect(entries[0].kind).toBe("intro");
    expect(entries[0].key).toBe(voiceKey("铅灰色的海面无尽延伸。"));
  });

  it("没有开场白的模组不产生条目", () => {
    expect(collectPrebakeEntries([mod({ id: "a" })])).toHaveLength(0);
  });

  it("空白开场白不产生条目", () => {
    expect(collectPrebakeEntries([mod({ id: "a", introNarration: "   " })])).toHaveLength(0);
  });

  it("同一段文本只烘一次", () => {
    const entries = collectPrebakeEntries([
      mod({ id: "a", introNarration: "同样的开场。" }),
      mod({ id: "b", introNarration: "同样的开场。" }),
    ]);
    expect(entries).toHaveLength(1);
  });
});
