// 自报家门那一句：不能一局重复六遍。
//
// 起因：`probe-narration-mix` 量出玩家读到的叙述里 77% 是 LLM 现生成的、
// 23% 是写死的（模组原文占大头，那是应该的）。真正刺眼的只有一条 ——
// 「你们上前，向对方表明了自己的身份与来意。」**一局原样出现 6 次**，
// 是全局唯一一句被反复复用的引擎叙述。
//
// 修法不是删掉它（NPC 的回应需要有东西可承接），而是让它由**这两个人是谁**决定。
// 仍是模板不打 LLM：这一句是敲门与回应之间的**节拍**，为它多打一次网络不划算。

import { describe, test, expect, afterEach } from "bun:test";
import { introduceParty } from "../play/scene-pipeline";
import type { PlayerAgent } from "../agent/player-agent";

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

const cast = (a: string, b: string) => ({ p0: { shortName: a }, p1: { shortName: b } });
const agents = (occA: string, occB: string) =>
  [{ pc: { occupation: occA } }, { pc: { occupation: occB } }] as unknown as readonly [PlayerAgent, PlayerAgent];

describe("introduceParty — 素材来自角色，不是固定句", () => {
  test("**正确**：两个名字都出现", () => {
    Math.random = () => 0;
    const s = introduceParty(cast("艾琳", "沃尔特"), agents("记者", "机械师"));
    expect(s).toContain("艾琳");
    expect(s).toContain("沃尔特");
  });

  test("**错误行为的红线**：不同的人不能说出同一句", () => {
    // 这是整条改动的目的。同一句复用 6 次正是「读起来没有灵性」的来源。
    Math.random = () => 0;
    const a = introduceParty(cast("艾琳", "沃尔特"), agents("记者", "机械师"));
    const b = introduceParty(cast("玛莎", "亚瑟"), agents("记者", "机械师"));
    expect(a).not.toBe(b);
  });

  test("**错误行为的红线**：职业不同，说辞也不同", () => {
    Math.random = () => 0;
    const 记者 = introduceParty(cast("甲", "乙"), agents("记者", "机械师"));
    const 警察 = introduceParty(cast("甲", "乙"), agents("警察", "机械师"));
    const 医生 = introduceParty(cast("甲", "乙"), agents("医生", "机械师"));
    expect(new Set([记者, 警察, 医生]).size).toBe(3);
  });

  test("靠说话吃饭的职业先开口", () => {
    Math.random = () => 0;
    // 记者在第二位，仍应由记者开口
    const s = introduceParty(cast("甲", "乙"), agents("机械师", "记者"));
    expect(s.startsWith("乙")).toBe(true);
  });

  test("**干扰输入**：两人都不是靠说话吃饭 → 按顺序，不报错", () => {
    Math.random = () => 0;
    const s = introduceParty(cast("甲", "乙"), agents("机械师", "农夫"));
    expect(s).toContain("甲");
    expect(s).toContain("乙");
  });

  test("**干扰输入**：职业缺失也要出得来一句完整的话", () => {
    Math.random = () => 0;
    const s = introduceParty(cast("甲", "乙"), agents("", ""));
    expect(s.length).toBeGreaterThan(8);
    expect(s).not.toContain("undefined");
  });

  test("同一组人也有多种说法（池子不止一句）", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      Math.random = () => i / 20;
      seen.add(introduceParty(cast("甲", "乙"), agents("记者", "机械师")));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("**干扰**：句子里不许残留模板占位符", () => {
    for (const occ of ["记者", "警察", "医生", "教授", "机械师", ""]) {
      Math.random = () => 0.5;
      const s = introduceParty(cast("甲", "乙"), agents(occ, "农夫"));
      expect(s).not.toContain("{");
      expect(s).not.toContain("undefined");
    }
  });
});
