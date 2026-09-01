// 开发·卧室线索修复 任务①②验收。
//
// 背景：analysis/sim/2026-08-31-barn-bedroom-intent-trace.md，实跑轨迹
// （非推测）：两句自然的卧室搜索（"翻开卧室书桌上的日记和旧文件"）都被
// clue-match.ts 判 deny，第三句换了措辞（"查看床头柜和日记夹页"）才 resolve
// clue_bedroom_diary。三句都走 skill_check，本局 [intent] 回落数为零——
// 不是 LLM 判错，是 clue gate 本身。
//
// 根因：clue_bedroom_diary 与 clue_bedroom_old_doc 的 matchTexts 名字高度
// 重叠（"日记本与老旧文件" vs "老旧文件（米-戈联络术）"），uniqueAbbrevs
// 找不出"日记""文件"这类短唯一片段，逼出"日记本与"这种没人会说的碎片，
// 自然句被判 deny。而模组数据本就声明了依赖：
// clue_bedroom_diary.unlocks = ["clue_bedroom_old_doc"]——old_doc 本就该
// 在 diary 之后才拿到（模组原文"从日记本中取出老旧文件"）。
//
// 任务①：候选集尊重 unlocks 前置——被某条尚未发现的线索 unlocks 的线索，
// 不进候选集。只做前置门，不做自动连锁（世界状态 state.ts:discoverClue()
// 那种"发现 A 自动发现 B"）——clue_bedroom_old_doc 是 Good End / True End
// 的分界线，不可白送。
//
// 任务②：场景"维修间"——玩家会用模组自己教出去的"维修室"这个词（见
// clue_bedroom_diary 的 revelation），但场景表里的正式名字是"维修间"，
// resolveSceneTarget 曾经在"下水道"这个真场景名上抢先命中（同一句话
// 前半段），维修间这个别名连候选都进不去。
//
// bun test src/__tests__/bedroom-clue-prerequisite-gate.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { InvestigationEngine } from "../investigation/investigation-engine";
import { decideClueMatch, type ClueMatchCandidate } from "../investigation/clue-match";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 128, temperature: 0,
};

function makeSession(id: string): GameSession & Record<string, any> {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", CFG, "investigator", "甲") as any;
}

function toCandidate(clue: { id: string; name: string; findMethods: { description: string }[] }): ClueMatchCandidate {
  return { id: clue.id, texts: [clue.name, ...clue.findMethods.map((f) => f.description)] };
}

const bedroom = BARN_OF_PREMIER.scenes.find((s) => s.id === "adrian_bedroom")!;
const diaryClue = bedroom.clues.find((c) => c.id === "clue_bedroom_diary")!;
const oldDocClue = bedroom.clues.find((c) => c.id === "clue_bedroom_old_doc")!;

describe("InvestigationEngine.isLockedByUndiscoveredPrerequisite（任务①，单元级）", () => {
  it("old_doc 被 diary 的 unlocks 声明为下游，diary 未发现时 old_doc 被锁", () => {
    const inv = new InvestigationEngine();
    inv.addClueType("clue_bedroom_diary", { description: "x", unlocks: ["clue_bedroom_old_doc"] });
    inv.addClueType("clue_bedroom_old_doc", { description: "y" });
    expect(inv.isLockedByUndiscoveredPrerequisite("clue_bedroom_old_doc", "p1")).toBe(true);
    expect(inv.isLockedByUndiscoveredPrerequisite("clue_bedroom_diary", "p1")).toBe(false);
  });

  it("diary 发现后，old_doc 不再被锁", () => {
    const inv = new InvestigationEngine();
    inv.addClueType("clue_bedroom_diary", { description: "x", unlocks: ["clue_bedroom_old_doc"] });
    inv.addClueType("clue_bedroom_old_doc", { description: "y" });
    inv.markDiscovered("clue_bedroom_diary", "p1");
    expect(inv.isLockedByUndiscoveredPrerequisite("clue_bedroom_old_doc", "p1")).toBe(false);
  });

  it("没有任何线索把它列为 unlocks 时天然不锁", () => {
    const inv = new InvestigationEngine();
    inv.addClueType("clue_lonely", { description: "z" });
    expect(inv.isLockedByUndiscoveredPrerequisite("clue_lonely", "p1")).toBe(false);
  });

  it("发现前置不会连锁标记下游为已发现——只做门，不做自动解锁", () => {
    const inv = new InvestigationEngine();
    inv.addClueType("clue_bedroom_diary", { description: "x", unlocks: ["clue_bedroom_old_doc"] });
    inv.addClueType("clue_bedroom_old_doc", { description: "y" });
    inv.markDiscovered("clue_bedroom_diary", "p1");
    expect(inv.isDiscoveredBy("clue_bedroom_old_doc", "p1")).toBe(false);
  });
});

describe("decideClueMatch：old_doc 混进候选会搅浑 diary 的简称（离线复现根因）", () => {
  const withOldDoc: ClueMatchCandidate[] = [toCandidate(diaryClue), toCandidate(oldDocClue)];
  const withoutOldDoc: ClueMatchCandidate[] = [toCandidate(diaryClue)];
  const said = "林娜翻开卧室书桌上的日记和旧文件，想知道地下室里到底发生过什么。";

  it("两条候选都在时，自然句 deny（改前的真实症状）", () => {
    expect(decideClueMatch(said, withOldDoc).kind).toBe("deny");
  });

  it("排掉 old_doc 后，同一句立刻 resolve clue_bedroom_diary（证明候选集大小就是根因）", () => {
    expect(decideClueMatch(said, withoutOldDoc)).toEqual({ kind: "resolve", clueId: "clue_bedroom_diary" });
  });
});

describe("端到端：卧室线索按 unlocks 前置正确排候选（任务①主判据）", () => {
  it("实跑原句「林娜翻开卧室书桌上的日记和旧文件…」resolve clue_bedroom_diary（改前 deny）", async () => {
    const session = makeSession(`bedroom-diary-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("艾德里安的卧室");

    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("林娜翻开卧室书桌上的日记和旧文件，想知道地下室里到底发生过什么。", "p1");
      expect(res.narrative).not.toBe("你仔细找了找，这里没什么特别的。");
      expect(session.investigation.isDiscoveredBy("clue_bedroom_diary", "p1")).toBe(true);
    } finally { Math.random = real; }
  });

  it("回归：round 10 原句「陈岳查看床头柜和日记夹页…」仍 resolve clue_bedroom_diary", async () => {
    const session = makeSession(`bedroom-round10-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("艾德里安的卧室");

    const real = Math.random;
    Math.random = () => 0;
    try {
      await session.act("陈岳查看床头柜和日记夹页，寻找病人记录、维修间说明或被撕下的信纸。", "p1");
      expect(session.investigation.isDiscoveredBy("clue_bedroom_diary", "p1")).toBe(true);
    } finally { Math.random = real; }
  });

  it("clue_bedroom_old_doc 不会因为 diary 被发现而顺手发现——只做前置门，不做自动连锁", async () => {
    const session = makeSession(`bedroom-no-chain-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("艾德里安的卧室");

    const real = Math.random;
    Math.random = () => 0;
    try {
      await session.act("林娜翻开卧室书桌上的日记和旧文件，想知道地下室里到底发生过什么。", "p1");
      expect(session.investigation.isDiscoveredBy("clue_bedroom_diary", "p1")).toBe(true);
      expect(session.investigation.isDiscoveredBy("clue_bedroom_old_doc", "p1")).toBe(false);
    } finally { Math.random = real; }
  });

  it("diary 发现后，old_doc 自己的措辞重新有资格参与匹配（不是自动解锁，玩家还得自己说一句）", async () => {
    const session = makeSession(`bedroom-unlock-after-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("艾德里安的卧室");

    const real = Math.random;
    Math.random = () => 0;
    try {
      await session.act("林娜翻开卧室书桌上的日记和旧文件，想知道地下室里到底发生过什么。", "p1");
      expect(session.investigation.isDiscoveredBy("clue_bedroom_diary", "p1")).toBe(true);
      await session.act("陆川从日记本中取出老旧文件仔细查看。", "p1");
      expect(session.investigation.isDiscoveredBy("clue_bedroom_old_doc", "p1")).toBe(true);
    } finally { Math.random = real; }
  });
});

describe("端到端：场景「维修间」的别名解析（任务②主判据）", () => {
  it("「前往下水道维修室」在下水道时移动到「维修间」（改前原地留在「下水道」）", async () => {
    const session = makeSession(`maintenance-alias-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("下水道");

    const res = await session.act("前往下水道维修室", "p1");
    expect(session.getDisplayedScene()).toBe("维修间");
    expect(res.narrative).toContain("维修间");
  });

  it("直接说「维修间」正式场景名同样能到（回归，未受别名改动影响）", async () => {
    const session = makeSession(`maintenance-formal-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("下水道");

    await session.act("前往维修间", "p1");
    expect(session.getDisplayedScene()).toBe("维修间");
  });

  it("已经站在下水道时说「前往下水道」（模糊自匹配）不会假装移动成功", async () => {
    const session = makeSession(`sewer-self-match-${Math.random()}`);
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("下水道");

    const res = await session.act("前往下水道深处看看", "p1");
    // 场景没变这件事本身不够：移动到"当前所在的场景"本来就不会改变
    // getDisplayedScene() 的返回值，无论 tryResolveModuleScene 是真的
    // 判定"未命中"还是稀里糊涂"移动成功了但正好停在原地"，这个断言都会
    // 通过——不区分两种情况就测不出这条判据。真正要看的是有没有冒出
    // "你来到了「下水道」。"这句话：只有 tryResolveModuleScene 判定
    // "移动成功"才会设置这句 lastNarrative；判定"未命中"会转而落到
    // 对象名门/LLM 叙事，不会有这句话。
    expect(res.narrative).not.toBe("你来到了「下水道」。");
  });
});
