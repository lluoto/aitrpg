// 语音路由与预制清单
// bun test src/__tests__/speech-plan.test.ts

import { describe, it, expect } from "bun:test";
import { planSpeech, speechRouteFor, voiceKey, collectPrebakeEntries, splitStageDirections, voiceKeyFor } from "../voice/speech-plan";
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

// 提示词第 7 条主动要求台词带括号神态，允许穿插句中。送进 TTS 会被照着念出来，
// 但它们是现有最好的韵律提示（voice-readiness.md 第五节），所以切分而不是删除。
describe("舞台指示切分", () => {
  // 样本取自实跑日志 play-logs/run-2026-08-18T03-41-30.txt
  it("摘掉句中的括号神态，台词本身不动", () => {
    const { spoken, directions } = splitStageDirections(
      "睡得安稳？（她神经质地笑了笑，眼神游离）我哪知道，他连门都不让我进。",
    );
    expect(spoken).toBe("睡得安稳？我哪知道，他连门都不让我进。");
    expect(directions).toEqual(["她神经质地笑了笑，眼神游离"]);
  });

  it("一句里有多处就按出现顺序全摘出来", () => {
    const { spoken, directions } = splitStageDirections(
      "我哪知道。（声音压低）有几次半夜，我好像听见拖车里传出奇怪的嘶嘶声。（打了个寒战）",
    );
    expect(spoken).toBe("我哪知道。有几次半夜，我好像听见拖车里传出奇怪的嘶嘶声。");
    expect(directions).toEqual(["声音压低", "打了个寒战"]);
  });

  it("没有括号就原样返回", () => {
    const { spoken, directions } = splitStageDirections("加比比较叛逆，喜欢出去玩。");
    expect(spoken).toBe("加比比较叛逆，喜欢出去玩。");
    expect(directions).toEqual([]);
  });

  it("整句都是舞台指示时没有可念的内容", () => {
    expect(splitStageDirections("（长久的沉默）").spoken).toBe("");
  });

  it("只认全角括号 —— 半角括号里多是英文缩写，不是神态", () => {
    const { spoken, directions } = splitStageDirections("那东西叫米-戈 (Mi-Go)。");
    expect(spoken).toBe("那东西叫米-戈 (Mi-Go)。");
    expect(directions).toEqual([]);
  });
});

// 旁白里的括号是正文的一部分。实测已烘的 80 条里有 9 条带全角括号，
// 装的是 （Mi-Go）（陷阱区）（右侧有亮光）（被床头柜压住）—— 全是内容，
// 一刀切会把它们从旁白里删掉。所以判据取消息类型，不靠正则猜括号里装的是什么。
describe("只切对白，不切旁白", () => {
  const 夹注 = "在一旁可以看到一个拖车车房（可搭载拖车移动的房屋，在美国还算常见）。";

  it("旁白的解释性夹注保留在合成文本里", () => {
    const p = planSpeech(msg({ type: "narration", content: 夹注 }));
    expect(p.text).toBe(夹注);
    expect(p.directions).toEqual([]);
  });

  it("同一段文字若是对白就会被切", () => {
    const p = planSpeech(msg({ type: "dialogue", content: 夹注 }));
    expect(p.text).not.toContain("（");
    expect(p.directions).toHaveLength(1);
  });

  it("旁白的预制键不因本次改动变化 —— 已烘的音频不能失效", () => {
    expect(voiceKeyFor({ type: "narration", content: 夹注, verbatim: true })).toBe(voiceKey(夹注));
  });

  it("整句都是舞台指示的对白不给预制键，也不去合成空音频", () => {
    const m = msg({ type: "dialogue", content: "（长久的沉默）", verbatim: true });
    expect(voiceKeyFor(m)).toBeUndefined();
    expect(planSpeech(m).route).toBe("silent");
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
