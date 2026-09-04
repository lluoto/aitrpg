// todo-57：霍姆斯医院（hospital）与维森酒吧/报亭同一形状的缺口——
// clue_emily_birth 的获取路径要求「问起其他医护人员」，但场景 npcIds
// 此前是空数组。N7 用 scene-npc-noun-registry.ts 扫出这处缺口，本轮
// （开发·约束层补角色实体域 N9 任务 D）按 N7 的 A/B 同样做法补上。
//
// ⚠ 如实记录：hospital 场景实际只有【一条】ClueDef
// （clue_emily_birth），不是两条——原文写的是"先幸运判定遇到愿意
// 开口的医护人员，再信誉/社交检定让对方说出真相"，是同一条线索的
// 两道可选检定方式（findMethods 数组两项），不是两条独立线索。
//
// bun test src/__tests__/hospital-staff-reachability.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { findModuleCharacterNounGaps } from "../investigation/scene-npc-noun-registry";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const CFG = {
  apiKey: "sk-placeholder", baseUrl: "http://localhost:9999",
  model: "mock", maxTokens: 512, temperature: 0.7,
};

describe("todo-57：hospital 的线索可达（纯自然语句，无 markDiscovered/内部 id）", () => {
  it("**正确**：进医院后用自然语句「问问其他医护人员艾德里安的情况」能拿到艾米丽难产事故的真相", async () => {
    const session: any = new GameSession(`hospital-reach-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
    await session.act("创建角色 investigator 甲");
    await session.act("加载模组 普瑞米尔的谷仓");
    await session.act("去霍姆斯医院");
    const real = Math.random;
    Math.random = () => 0; // 逼检定成功
    try {
      const r = await session.act("问问其他医护人员艾德里安的情况");
      expect(r.narrative).toMatch(/艾米丽|难产|大出血/);
      expect(r.narrative).not.toMatch(/说清楚|想找什么/); // 不该落进 ask 分支
    } finally { Math.random = real; }
  });

  it("**目标行为错误的对照**：换一种自然说法（打听艾德里安的情况）同样能命中，不依赖某一句固定措辞", async () => {
    const session: any = new GameSession(`hospital-reach2-${Math.random()}`, "cosmic-horror", CFG, undefined, "调查员");
    await session.act("创建角色 investigator 甲");
    await session.act("加载模组 普瑞米尔的谷仓");
    await session.act("去霍姆斯医院");
    const real = Math.random;
    Math.random = () => 0;
    try {
      const r = await session.act("跟医护人员打听打听艾德里安的事");
      expect(r.narrative).toMatch(/艾米丽|难产|大出血/);
    } finally { Math.random = real; }
  });
});

describe("scene-npc-noun-registry 扫描结果归零（任务 D）", () => {
  it("**正确**：补完 hospital_staff 之后，全模组扫描不再有任何缺口", () => {
    const gaps = findModuleCharacterNounGaps(BARN_OF_PREMIER);
    expect(gaps).toEqual([]);
  });
});
