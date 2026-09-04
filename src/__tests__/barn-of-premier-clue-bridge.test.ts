// P2 — 谷仓模组线索可达性桥接
// 背景见 game-session.ts 的 bridgeBarnOfPremierClues() 注释：
// premiers_barn.ts 自带的 10 条线索里 clue_0/clue_1/clue_8/clue_9 的 scene
// 字段填的是 NPC 名/事件名，不是玩家能走到的场景，而且合成的 ClueDef 没有
// 技能/难度梯度。BARN_OF_PREMIER（32 条，带 findMethods/revelation）挂在真实
// 场景下，桥接进 InvestigationEngine 后应与原有 10 条并存、都可查到。
//
// bun test src/__tests__/barn-of-premier-clue-bridge.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { GameSession } from "../api/game-session";

let session: GameSession;

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("barn-bridge-test", "cosmic-horror", {
    apiKey: "sk-placeholder",
    baseUrl: "http://localhost:9999",
    model: "mock",
    maxTokens: 1024,
    temperature: 0.7,
  }, undefined, "调查员");
});

describe("BARN_OF_PREMIER 线索桥接 — 注册", () => {
  it("加载模组后，BARN_OF_PREMIER 的专属线索 id 应被注册进 InvestigationEngine", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    // clue_pistol_in_bag 只存在于 BARN_OF_PREMIER，不在 premiers_barn.ts 的 10 条老线索里
    expect(investigation.hasClueType("clue_pistol_in_bag")).toBe(true);
    expect(investigation.hasClueType("clue_drugs")).toBe(true);
    expect(investigation.hasClueType("clue_bar_guest_identity")).toBe(true);
  });

  it("新线索与 premiers_barn.ts 原有 10 条线索并存，不覆盖不删除", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    // 老 10 条线索的 id 格式是 clue_0..clue_9
    expect(investigation.hasClueType("clue_2")).toBe(true);
    expect(investigation.hasClueType("clue_3")).toBe(true);
    // 同一场景下新老线索都在列表里
    const gabiClues: string[] = investigation.getSceneClues("加比的拖车房");
    expect(gabiClues).toContain("clue_2");
    expect(gabiClues).toContain("clue_pistol_in_bag");
    expect(gabiClues).toContain("clue_drugs");
    expect(gabiClues).toContain("clue_card");
  });

  it("场景名括号后缀会被归一化，桥接后的线索挂在不带括号的场景 id 下", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    // BARN_OF_PREMIER 里这个场景叫"农场外围（陷阱区）"，但运行时 state.scene
    // 用的是不带括号的"农场外围"（mythos-module.ts registerScene 用短名）。
    const trapped = investigation.getSceneClues("农场外围");
    expect(trapped.length).toBeGreaterThan(0);
    // 带括号的原名不应该单独占一个桥
    const withBracket = investigation.getSceneClues("农场外围（陷阱区）");
    expect(withBracket.length).toBe(0);
  });

  it("步骤 2a-2 后：clue_0/clue_1 已从伪场景节点「菲碧_特里坎」迁移到真实场景「特里坎家」", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    // 步骤 2a-2 把 clue_0/clue_1 的 scene 从 "菲碧_特里坎"（已删伪场景节点）
    // 改为 "特里坎家"（菲碧的真实所在场景）。
    expect(investigation.getSceneClues("特里坎家")).toContain("clue_0");
    expect(investigation.getSceneClues("特里坎家")).toContain("clue_1");
    // 旧的伪场景节点下不再有任何线索。
    expect(investigation.getSceneClues("菲碧_特里坎")).toHaveLength(0);
  });
});

describe("BARN_OF_PREMIER 线索桥接 — 技能映射", () => {
  it("findMethods 里的中文技能名应正确翻译成 CoC 英文技能 key", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    // clue_bar_guest_identity 的 findMethod 技能是"社交" → fast_talk
    const clue = investigation.clueTypes.get("clue_bar_guest_identity");
    expect(clue.coc_primary.skill).toBe("fast_talk");
  });

  it("图书馆技能线索应映射到 library_use", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    const clue = investigation.clueTypes.get("clue_newspaper_kidnapper");
    expect(clue).toBeDefined();
    expect(clue.coc_primary.skill).toBe("library_use");
  });

  it("只有属性型 findMethod（幸运/力量）时退回属性代理 key，不是乱猜的技能名", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    const clue = investigation.clueTypes.get("clue_bar_ask_around");
    expect(clue.coc_primary.skill).toBe("luck");
  });

  it("多个 findMethod 里同时有真技能与属性时，优先选真技能而非属性", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    // clue_barn_victims 有 力量(属性) 和 急救(first_aid) 两条 skill findMethod，
    // 应该选 first_aid 而不是 strength
    const clue = investigation.clueTypes.get("clue_barn_victims");
    expect(clue).toBeDefined();
    expect(clue.coc_primary.skill).toBe("first_aid");
  });

  it("INVESTIGATIVE_SKILLS 已扩容，覆盖 32 条线索用到的技能，否则玩家用对应技能也触发不了场景线索解析", () => {
    const skills: Set<string> = (GameSession as any).INVESTIGATIVE_SKILLS;
    for (const s of ["spot_hidden", "charm", "fast_talk", "library_use", "credit_rating", "psychoanalysis", "medicine", "first_aid", "language_own", "luck", "strength"]) {
      expect(skills.has(s)).toBe(true);
    }
  });
});

describe("BARN_OF_PREMIER 线索桥接 — clue_final_brain_jars 的叙事用词别名（开发·真相链路 任务①）", () => {
  const realRandom = Math.random;
  afterEach(() => {
    Math.random = realRandom;
  });

  it("matchTexts 应包含引擎自己叙事里用过的称呼，不只是 clue.name/findMethods 原文", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    const clue = investigation.clueTypes.get("clue_final_brain_jars");
    expect(clue).toBeDefined();
    for (const alias of ["培养缸", "玻璃缸", "一大一小", "营养液"]) {
      expect(clue.matchTexts).toContain(alias);
    }
  });

  it("**错误行为红线**：玩家用引擎自己教的「培养缸」/「一大一小」/「营养液」称呼，此前会被 deny，现在应能命中并成功", async () => {
    Math.random = () => 0; // 逼检定必成功，只验证匹配本身
    for (const sentence of [
      "陆川走近那两个培养缸，看清里面泡着什么",
      "陆川打量那一大一小两个玻璃缸",
      "陆川检查那些泡着营养液的容器",
    ]) {
      const sess = new GameSession(`brain-jars-alias-${Math.random()}`, "cosmic-horror", {
        apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
      }, undefined, "调查员");
      await sess.act("加载模组 普瑞米尔的谷仓");
      await sess.act("前往维修间");
      await sess.act(sentence);
      expect(sess.investigation.isDiscoveredBy("clue_final_brain_jars", "p1")).toBe(true);
    }
  });

  it("回归：过泛的词（设备/容器）不被收进别名，不该匹配的场景不会被误伤", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    const investigation: any = (session as any).investigation;
    const clue = investigation.clueTypes.get("clue_final_brain_jars");
    expect(clue.matchTexts).not.toContain("设备");
    expect(clue.matchTexts).not.toContain("容器");
  });

  it("不误伤 clue_final_coffin 的歧义回问——两条线索都可能命中的句子仍然 ask，不会被这次改动强行导向 brain_jars", async () => {
    Math.random = () => 0;
    const sess = new GameSession(`coffin-ambiguity-${Math.random()}`, "cosmic-horror", {
      apiKey: "sk-placeholder", baseUrl: "http://localhost:9999", model: "mock", maxTokens: 1024, temperature: 0.7,
    }, undefined, "调查员");
    await sess.act("加载模组 普瑞米尔的谷仓");
    await sess.act("前往维修间");
    const r = await sess.act("打开那口像冰箱一样的棺材");
    expect(sess.investigation.isDiscoveredBy("clue_final_brain_jars", "p1")).toBe(false);
    expect(sess.investigation.isDiscoveredBy("clue_final_coffin", "p1")).toBe(false);
    const sysReplies = r.events.filter((e) => e.speaker === "系统").map((e) => e.content).join("\n");
    expect(sysReplies).toContain("想找什么");
  });
});

describe("BARN_OF_PREMIER 线索桥接 — 端到端可达性", () => {
  const realRandom = Math.random;
  afterEach(() => {
    Math.random = realRandom;
  });

  it("站在加比的拖车房，真实调查动作应该能查到 BARN_OF_PREMIER 桥接进来的线索文本", async () => {
    await session.act("加载模组 普瑞米尔的谷仓");
    (session as any).movePlayerToScene("加比的拖车房");

    // 逼骰子恒定成功（roll=1），排除随机性，只验证可达性这一件事。
    Math.random = () => 0;

    const seen: string[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await session.act("侦查");
      seen.push(...res.events.map((e) => e.content));
    }
    const all = seen.join("\n");
    // BARN_OF_PREMIER 独有措辞（不带"为"字，且不含○粉/海○因原始描述），
    // 老 clue_2/clue_3 的合成文本不会产生这句。
    expect(all).toMatch(/故障值90，伤害d10\+2，贯穿属性/);
    expect(all).toMatch(/找到一些毒品，数量不多但足够定罪/);
  });
});
