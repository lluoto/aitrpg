// todo-41：维森酒吧两条 core 线索现在可达。
//
// 背景：analysis/sim/2026-08-30-barn-natural-play.md:58,86 记录的真实
// 撞坑——玩家用「用卡片」「问名单」「问包场者」「问马克/旧仓库」四种
// 自然问法都没能问出包场情报，酒吧保镖反而编出「老板锁进抽屉」这类
// 模组里不存在的东西。根因：场景里没有"前台"这个实体，两条线索也没
// 补充过 matchTexts，玩家的话从未被匹配器读到过。
//
// ⚠ 排查过程中发现的前置事实（不是本轮引入的机制，如实记录）：
// clue_bar_mass_booking 本身被 clue_card（加比拖车房餐厅里的那张
// 派对卡片，原文"使用卡片询问免费饮品的事情"）以 unlocks 声明为前置——
// 这条依赖关系一直都在，不是本轮新加的。真实撞坑记录里"用卡片"这个
// 措辞正对应这条前置：玩家得先在拖车房找到卡片，再拿去酒吧问，两步
// 都要走到才有意义。
//
// 本测试走纯自然语句（不调 markDiscovered、不出现内部 clue id/npc
// id），复刻真实撞坑用过的措辞之一（"问包场者的事"），与
// True End 回放同一标准（d141dd2 那条判据的做法）。
//
// bun test src/__tests__/weisen-bar-front-desk-reachability.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 512, temperature: 0.7,
};

async function atWeisenBar() {
  const session: any = new GameSession(`bar-reach-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
  await session.act("创建角色 investigator 甲");
  await session.act("加载模组 普瑞米尔的谷仓");
  // 先去拖车房找到卡片——clue_bar_mass_booking 的前置（见上方背景）。
  await session.act("去加比的拖车房");
  const real = Math.random;
  Math.random = () => 0;
  try {
    await session.act("侦查餐厅");
  } finally { Math.random = real; }
  await session.act("去维森酒吧");
  return session as GameSession & Record<string, any>;
}

describe("todo-41：维森酒吧两条 core 线索可达（纯自然语句，无 markDiscovered/内部 id）", () => {
  it("**正确**：进酒吧后用真实撞坑过的问法（问包场者的事）能拿到包场情报，再花钱套话能拿到贵客身份", async () => {
    const s = await atWeisenBar();
    const real = Math.random;
    Math.random = () => 0; // 逼两次检定都成功
    try {
      // 第一步：复刻实跑真实用过的措辞之一——「问包场者的事」。
      const r1 = await s.act("问包场者的事");
      expect(r1.narrative).toMatch(/包场|狂欢|登记/);
      expect(r1.narrative).not.toMatch(/老板|抽屉/); // 不该冒出编造的东西

      // 第二步：贵客身份线索被上一条 unlocks，此时才成为候选。
      const r2 = await s.act("花钱套出前台知道的贵客身份");
      expect(r2.narrative).toMatch(/艾德里安/);
    } finally { Math.random = real; }
  });

  it("**目标行为错误的对照**：向「其他人」打听（bonus 线索）走的是不同候选，不会跟前台两条混在一起被误判成歧义", async () => {
    const s = await atWeisenBar();
    const real = Math.random;
    Math.random = () => 0;
    try {
      const r = await s.act("向其他客人打听八卦");
      // 不该落进"需要问清楚"的 ask 分支（措辞清楚指向 ask_around，
      // 不该被前台那两条的 matchTexts 稀里糊涂地拉进候选里）。
      expect(r.narrative).not.toMatch(/说清楚|想找什么/);
    } finally { Math.random = real; }
  });
});
