// 开发·线索闸门 任务3验收——前期检定失败给指向性降级信息。
//
// 背景：除了连续大失败以外，尽量不在前期阻止调查。检定失败时给指向性
// 明确的降级信息引导再查（"卫生间那边似乎还有东西"），不是直接给线索
// 内容。与行动锚点分工：锚点不点位置（免费的），失败一次才给方向
// （试出来的）。
//
// "前期"判定两条路：有 ModuleSupport 且声明 earlyGameEndSceneId 的模组
// （谷仓用 adrian_farm）按场景访问判；没有的模组按已发现/可文本匹配线索
// 总数 < 1/3 判。
//
// bun test src/__tests__/early-game-hint.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { extractLocationHint } from "../investigation/clue-match";
import { BARN_SUPPORT } from "../module/barn-of-premier";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 128, temperature: 0,
};

function makeSession(id: string): GameSession & Record<string, any> {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", CFG, "investigator", "甲") as any;
}

describe("extractLocationHint：从 findMethods 描述抽干净的位置名词", () => {
  it("真实数据：clue_drugs/clue_card/clue_pistol 各自的方向", () => {
    expect(extractLocationHint(["侦查卫生间/仔细检查洗漱用具"])).toBe("卫生间");
    expect(extractLocationHint(["侦查餐厅/宣言仔细检查餐桌：可以发现在披萨盒下面有一张小卡片"])).toBe("餐厅");
    expect(extractLocationHint(["侦查休息区/仔细检查床底"])).toBe("床底");
  });

  it("抽不出干净候选（全是长句或纯动词）时返回 null，不硬凑", () => {
    expect(extractLocationHint(["可以发现在披萨盒下面有一张小卡片"])).toBeNull(); // 无分隔符的长句
    expect(extractLocationHint(["侦查"])).toBeNull(); // 纯动词，剥完什么都不剩
  });
});

describe("谷仓：earlyGameEndSceneId=adrian_farm，到农场之前算前期", () => {
  it("BARN_SUPPORT 声明了这个字段", () => {
    expect(BARN_SUPPORT.earlyGameEndSceneId).toBe("艾德里安的农场");
  });

  it("开局在特里坎家：isEarlyGame() 为 true", async () => {
    const s = makeSession(`early-fresh-${Math.random()}`);
    await s.act("加载模组 普瑞米尔的谷仓");
    expect(s.isEarlyGame()).toBe(true);
  });

  it("到过「艾德里安的农场」（adrian_farm 的运行时名）之后：isEarlyGame() 为 false", async () => {
    const s = makeSession(`early-farm-${Math.random()}`);
    await s.act("加载模组 普瑞米尔的谷仓");
    (s as any).movePlayerToScene("艾德里安的农场");
    expect(s.isEarlyGame()).toBe(false);
  });

  it("端到端：前期在拖车房检定失败，revelation 含方向、不含线索内容/名字", async () => {
    const s = makeSession(`early-e2e-fail-${Math.random()}`);
    await s.act("加载模组 普瑞米尔的谷仓");
    (s as any).movePlayerToScene("加比的拖车房");
    expect(s.isEarlyGame()).toBe(true);

    const real = Math.random;
    Math.random = () => 0.99; // 逼检定失败
    try {
      const res = await s.act("检查卫生间", "p1");
      expect(res.narrative).toContain("卫生间那边似乎还有些什么");
      // 不泄露线索本身的名字/内容（"毒品"是 clue_drugs 的展示名）
      expect(res.narrative).not.toContain("毒品");
    } finally { Math.random = real; }
  });

  it("回归：过农场之后（非前期），检定失败恢复成原本的通用失败文案", async () => {
    const s = makeSession(`early-nonearly-${Math.random()}`);
    await s.act("加载模组 普瑞米尔的谷仓");
    (s as any).movePlayerToScene("艾德里安的农场");
    (s as any).movePlayerToScene("加比的拖车房"); // 再回拖车房触发同一条线索的检定
    expect(s.isEarlyGame()).toBe(false);

    const real = Math.random;
    Math.random = () => 0.99;
    try {
      const res = await s.act("检查卫生间", "p1");
      expect(res.narrative).not.toContain("那边似乎还有些什么");
      expect(res.narrative).toContain("你仔细搜查了一番，但这次没能看出什么名堂。");
    } finally { Math.random = real; }
  });

  it("回归：成功路径完全不受影响", async () => {
    const s = makeSession(`early-success-${Math.random()}`);
    await s.act("加载模组 普瑞米尔的谷仓");
    (s as any).movePlayerToScene("加比的拖车房");
    expect(s.isEarlyGame()).toBe(true);

    const real = Math.random;
    Math.random = () => 0; // 逼检定成功
    try {
      const res = await s.act("检查卫生间", "p1");
      expect(res.narrative).not.toContain("那边似乎还有些什么");
      expect(res.narrative).toContain("毒品"); // 成功时正常揭示内容
    } finally { Math.random = real; }
  });
});

describe("没有 ModuleSupport 的模组：已发现/可匹配线索总数 < 1/3", () => {
  it("阿卡姆档案检查（3 条线索，全无 matchTexts，退回数全部）：新开局是前期，发现 1 条后不再是", async () => {
    const s = makeSession(`arkham-early-${Math.random()}`);
    await s.act("加载模组 阿卡姆档案检查");
    expect(s.isEarlyGame()).toBe(true);
    s.investigation.markDiscovered("restricted_section", "p1");
    expect(s.isEarlyGame()).toBe(false);
  });
});
