// 实跑证据：输入「侦查卫生间」返回的是休息区的手枪线索；输入「侦查餐厅」
// 返回的是卫生间的毒品线索。不是偏移一位，是玩家输入从未被读取——引擎
// 只取场景里第一条未发现的线索，intent.target/input 一眼都不看。
//
// bun test src/__tests__/scene-clue-input-match.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 512, temperature: 0.7,
};

async function arenaAt(sceneName: string) {
  const session = new GameSession(`clue-match-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
  await session.act("创建角色 investigator 甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  (session as any).movePlayerToScene(sceneName);
  return session;
}

describe("实跑症状：加比的拖车房三条线索（手枪/毒品/卡片），玩家的话必须被读取", () => {
  it("「侦查卫生间」必须给出毒品线索，不是手枪", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0; // 逼骰子恒定成功，排除随机性
    try {
      const res = await session.act("侦查卫生间");
      expect(res.narrative).toMatch(/毒品/);
      expect(res.narrative).not.toMatch(/手枪/);
    } finally { Math.random = real; }
  });

  it("「侦查餐厅」必须给出卡片/派对线索，不是卫生间的毒品", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("侦查餐厅");
      expect(res.narrative).toMatch(/卡片|派对|酒吧/);
      expect(res.narrative).not.toMatch(/毒品/);
    } finally { Math.random = real; }
  });

  it("「侦查床底」必须给出手枪线索", async () => {
    // 不用「侦查休息区」——intent.ts 的 rest 分支比 skill_check 靠前，
    // "休息区"里的"休息"会先被判成休息动作，跟本轮要测的线索匹配无关，
    // 是意图解析层既有的一处收词过宽，不在本轮范围内顺手改。
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("侦查床底");
      expect(res.narrative).toMatch(/手枪/);
    } finally { Math.random = real; }
  });

  it("目标行为错误的对照：给了具体但对不上任何线索的提示，必须如实说没有，不能给下一条", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("侦查衣柜");
      expect(res.narrative).toBe("这里没什么特别的");
      expect(res.narrative).not.toMatch(/手枪|毒品|卡片/);
    } finally { Math.random = real; }
  });

  it("文本相似但合法：没给具体提示时（裸「侦查」）回落旧行为，仍然能查到一条线索", async () => {
    const session = await arenaAt("加比的拖车房");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("侦查");
      // 没给提示不等于"没什么特别的"——这是两种不同的情况，不该混淆
      expect(res.narrative).not.toBe("这里没什么特别的");
      expect(res.narrative).toMatch(/手枪|故障值90/);
    } finally { Math.random = real; }
  });
});

describe("命中多条时要问清楚，不能替玩家选", () => {
  it("同一句话能对应场景里两条线索时，回复要提示两个选项，且不直接给出任何一条的揭示文本", async () => {
    const session = await arenaAt("加比的拖车房");
    const investigation: any = (session as any).investigation;
    // 构造两条关键词重叠的合成线索，制造真实的歧义场景
    investigation.addClueType("clue_syn_a", {
      description: "测试线索甲", scene: "加比的拖车房",
      matchTexts: ["测试甲", "检查桌子上的东西"],
      displayName: "桌上的东西",
      coc_primary: { skill: "spot_hidden", regular: "甲的揭示文本", fail: "没找到" },
    });
    investigation.addClueType("clue_syn_b", {
      description: "测试线索乙", scene: "加比的拖车房",
      matchTexts: ["测试乙", "检查桌子下面的箱子"],
      displayName: "桌下的箱子",
      coc_primary: { skill: "spot_hidden", regular: "乙的揭示文本", fail: "没找到" },
    });

    const real = Math.random;
    Math.random = () => 0;
    try {
      const res = await session.act("检查桌子");
      const all = res.events.map((e) => e.content).join("\n");
      expect(all).not.toMatch(/甲的揭示文本|乙的揭示文本/);
      // 开发·对象名通向线索 任务2：不再直接报出候选展示名（"桌上的东西"/
      // "桌下的箱子"）——那是剧透，与行动锚点的"中"粒度标准不一致
      // （告诉玩家有东西、不说是什么）。改成只说"不止一样东西"，
      // 不带任何候选名字，见 applyClueDecision 的注释。
      expect(all).not.toMatch(/桌上的东西|桌下的箱子/);
      expect(all).toMatch(/不止一样东西/);
    } finally { Math.random = real; }
  });
});
