// 开发·线索闸门 任务2验收——deny 收窄（方案 B）。
//
// 背景：现在只要给了具体提示而匹配不上就 deny 到底、不掷骰。改成：只有
// 玩家明确指向此处没有的东西时才 deny；说的是此处有、只是措辞没对上→
// 照常走到检定。
//
// 顺带修好行动锚点自己的建议：`getSuggestions()` 给的"仔细搜查这里"
// （见 game-session.ts）抠掉"搜查"剩"仔细这里"（4字，过阈值）——但
// "这里"不指代任何具体名词，不该算"给了提示"。指代词纳入无信号判定后，
// "仔细搜查这里"走裸动词那条（fallback→首条候选），不是 deny：锚点自己
// 推荐的动作不再必然失败。
//
// bun test src/__tests__/clue-match-deny-narrowing.test.ts

import { describe, it, expect } from "bun:test";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { GameSession } from "../api/game-session";
import { decideClueMatch, matchSceneClues, stripLocationFillers, type ClueMatchCandidate } from "../investigation/clue-match";

function toCandidate(clue: { id: string; name: string; findMethods: { description: string }[] }): ClueMatchCandidate {
  return { id: clue.id, texts: [clue.name, ...clue.findMethods.map((f) => f.description)] };
}

const trailer = BARN_OF_PREMIER.scenes.find((s) => s.id === "加比的拖车房")!;
const group = trailer.clues.map(toCandidate);

describe("stripLocationFillers：指代词本身不携带信号", () => {
  it("这里/那里/那儿/四周/周围都会被抠掉", () => {
    for (const filler of ["这里", "那里", "那儿", "四周", "周围"]) {
      expect(stripLocationFillers(`仔细搜查${filler}`)).not.toContain(filler);
    }
  });

  it("真实位置名词不受影响", () => {
    expect(stripLocationFillers("卫生间")).toBe("卫生间");
  });
});

describe("行动锚点自己的建议「仔细搜查这里」不再必然 deny", () => {
  it("decideClueMatch 走 fallback，不是 deny", () => {
    expect(decideClueMatch("仔细搜查这里", group)).toEqual({ kind: "fallback" });
  });

  it("matchSceneClues 内部同样判定无信号（noSignal=true）", () => {
    const r = matchSceneClues("仔细搜查这里", group);
    expect(r.trace.noSignal).toBe(true);
  });

  it("端到端：GameSession 里点这条建议真的走到检定，拿到实际结果，不是「这里没什么特别的」", async () => {
    process.env.LLM_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const session: any = new GameSession(`deny-narrow-${Math.random()}`, "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 512, temperature: 0.7,
    }, "investigator", "甲");
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("加比的拖车房");
    const suggestions: string[] = session.getSuggestions("p1");
    expect(suggestions).toContain("仔细搜查这里");

    const real = Math.random;
    Math.random = () => 0; // 逼检定成功，确认真的掷骰、有产出，不是巧合空过
    try {
      const res = await session.act("仔细搜查这里", "p1");
      expect(res.narrative).not.toBe("你仔细找了找，这里没什么特别的。");
      expect(res.events.some((e: any) => e.content.includes("手枪") || e.content.includes("卫生") || e.content.includes("餐"))).toBe(true);
    } finally { Math.random = real; }
  });
});

describe("明确指向此处没有的东西——仍然 deny", () => {
  it("拖车房搜「保险柜」（场景里任何线索都没提过）依旧 deny", () => {
    expect(decideClueMatch("检查保险柜", group)).toEqual({ kind: "deny" });
  });

  it("端到端：明确说没有的东西仍然如实说没有，不是被强行塞进某条线索", async () => {
    process.env.LLM_API_KEY = "";
    process.env.OPENAI_API_KEY = "";
    const session: any = new GameSession(`deny-keep-${Math.random()}`, "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 512, temperature: 0.7,
    }, "investigator", "甲");
    await session.act("加载模组 普瑞米尔的谷仓");
    session.movePlayerToScene("加比的拖车房");
    const res = await session.act("检查保险柜", "p1");
    expect(res.narrative).toBe("这里没什么特别的");
  });
});

describe("回归：裸动词、真实位置提示都不受本次收窄影响", () => {
  it("裸「侦查」依旧 fallback（未变）", () => {
    expect(decideClueMatch("侦查", group)).toEqual({ kind: "fallback" });
  });

  it("真实位置提示依旧精确命中", () => {
    expect(decideClueMatch("检查卫生间", group)).toEqual({ kind: "resolve", clueId: "clue_drugs" });
  });
});
