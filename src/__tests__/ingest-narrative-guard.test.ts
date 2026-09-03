// 摄取管线 · 创作层约束接线（todo-52 任务②a②b + 开发·别名迁移轮 D 组）
//
// 只测两档确定性判据本身（不依赖真实 LLM）：
//   第一档 findFabricatedTerms —— 复用 three-way-audit 的能力
//   第二档 evaluateObjectMentionClaims —— 从"拒绝"改为"学会"，三条
//     确定性条件（a 线索存在 / b 加入后唯一命中 / c 不与同场景其它
//     线索文本冲突）各自要有能红能绿的变异检验
// 变异检验见对应 describe 块，要求判据能真的分辨对错两种情形
// （docs/todo.json rule-03：判据没验过就不算数）。

import { describe, test, expect } from "bun:test";
import {
  findFabricatedTerms,
  evaluateObjectMentionClaims,
  clueCandidatesForScene,
  type SceneClueContext,
} from "../ingest/narrative-guard";

const CORPUS = "在1921年某日，你们来到了普瑞米尔小镇，看见谷仓与农场。米-戈联络术记载在老旧文件里。";

describe("第一档 findFabricatedTerms —— 禁止新造实体/专名", () => {
  test("反例基准：【共鸣特质】原文 0 命中，必须被拦下（变异检验：这是历史真实臆造案例）", () => {
    const text = "他感受到一种奇怪的【共鸣特质】，浑身战栗。";
    expect(findFabricatedTerms(text, CORPUS)).toEqual(["共鸣特质"]);
  });

  test("正例：【米-戈联络术】原文真的有，不该被拦下", () => {
    const text = "老旧文件里提到了【米-戈联络术】。";
    expect(findFabricatedTerms(text, CORPUS)).toEqual([]);
  });

  test("普通描述词（阴冷、潮湿）不受此限——没有方括号标注，压根不会被抽取", () => {
    const text = "房间里阴冷潮湿，弥漫着腐朽的气味。";
    expect(findFabricatedTerms(text, CORPUS)).toEqual([]);
  });

  test("没有任何方括号标注时返回空数组，不是漏检——判据只管标注过的术语", () => {
    expect(findFabricatedTerms("一段完全没有方括号的文本。", CORPUS)).toEqual([]);
  });

  test("多个术语时只报查无出处的那些，不是全部或全不报", () => {
    const text = "【普瑞米尔】小镇上流传着【共鸣特质】与【灵魂虹吸】两种说法。";
    // "普瑞米尔"在语料里（"普瑞米尔小镇"），另外两个不在
    expect(findFabricatedTerms(text, CORPUS).sort()).toEqual(["共鸣特质", "灵魂虹吸"].sort());
  });
});

describe("第二档 evaluateObjectMentionClaims —— 从「拒绝」改为「学会」，三条确定性条件", () => {
  const scene: SceneClueContext[] = [
    {
      id: "clue_final_brain_jars",
      name: "母女的缸中脑",
      description: "那婴儿与那位女性正是一大一小两个缸中脑，正静静地漂浮在缸中。",
      findMethods: [{ description: "打开光源观察房间" }],
    },
    {
      id: "clue_final_workbench",
      name: "手工桌",
      description: "上面放着一些制作缸中脑设备的材料，看起来是某种精密仪器设备。",
      findMethods: [{ description: "观察房间内" }],
    },
    { id: "clue_bedroom_gun", name: "枪械柜", description: "三只手枪整齐摆放。", findMethods: [] },
  ];

  test("正例：称呼直接用线索本名，三条件全过，自动接纳", () => {
    const [r] = evaluateObjectMentionClaims([{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }], scene);
    expect(r?.accepted).toBe(true);
  });

  test("**核心行为**：模拟「培养缸」bug 原本会被拒的称呼，改成「学会」后应被自动接纳为别名", () => {
    // 与旧版 findUnresolvedObjectMentions 的行为对照：那个函数会把这条判定为失败，
    // 新函数应该把它判定为接纳——这正是本轮"从拒绝改为学会"的核心行为变化。
    const [r] = evaluateObjectMentionClaims([{ phrase: "培养缸", clueId: "clue_final_brain_jars" }], scene);
    expect(r?.accepted).toBe(true);
    expect(r?.reason).toContain("满足三条确定性条件");
  });

  describe("条件 a：声明指代的线索必须真实存在", () => {
    test("变异检验：声明一个不存在的线索 id，必须红——第一版实测两次真实撞见的失败模式", () => {
      const [r] = evaluateObjectMentionClaims([{ phrase: "培养缸", clueId: "clue_nonexistent" }], scene);
      expect(r?.accepted).toBe(false);
      expect(r?.reason).toContain("不在本场景线索列表里");
    });

    test("对照组：线索 id 真实存在时，这一条件不拦（其余条件仍会各自判断）", () => {
      const [r] = evaluateObjectMentionClaims([{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }], scene);
      expect(r?.reason).not.toContain("不在本场景线索列表里");
    });
  });

  describe("条件 c：称呼不能出现在同场景其它线索自己的文本里（过泛代理）", () => {
    test("变异检验：用 7d9e6f1 明确排除过的「设备」类过泛词，必须红——它出现在 clue_final_workbench 自己的描述里", () => {
      const [r] = evaluateObjectMentionClaims([{ phrase: "设备", clueId: "clue_final_brain_jars" }], scene);
      expect(r?.accepted).toBe(false);
      expect(r?.reason).toContain("太泛");
    });

    test("对照组：称呼只出现在目标线索自己身上，不在别的线索文本里，这一条件不拦", () => {
      const [r] = evaluateObjectMentionClaims([{ phrase: "培养缸", clueId: "clue_final_brain_jars" }], scene);
      expect(r?.reason).not.toContain("太泛");
    });
  });

  describe("条件 b：加入候选池后必须唯一命中声明的那条线索", () => {
    // 与条件 c 区分：c 只查 name/description/findMethods，b 的候选池还
    // 包含 matchTexts（已学会的别名）——用一个只存在于别的线索
    // matchTexts 里的词，才能让 b 单独失败而不被 c 提前拦下（c 查不到
    // matchTexts，所以不会在这条用例上先动手）。
    const sceneWithLearnedAlias: SceneClueContext[] = [
      ...scene,
    ];
    sceneWithLearnedAlias[2] = { ...scene[2]!, matchTexts: ["武器架"] };

    test("变异检验：称呼命中的是别的线索的已学别名（声明与实际所指对不上），必须红", () => {
      const [r] = evaluateObjectMentionClaims(
        [{ phrase: "武器架", clueId: "clue_final_brain_jars" }],
        sceneWithLearnedAlias,
      );
      expect(r?.accepted).toBe(false);
      expect(r?.reason).toContain("未能唯一命中");
    });

    test("对照组：称呼命中回声明的那条线索本身，这一条件不拦", () => {
      const [r] = evaluateObjectMentionClaims([{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }], scene);
      expect(r?.reason).not.toContain("未能唯一命中");
    });
  });

  test("场景没有线索时，任何声明都必然命中条件 a 失败——不能凭空声明一条线索", () => {
    const [r] = evaluateObjectMentionClaims([{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }], []);
    expect(r?.accepted).toBe(false);
  });

  test("没有声明任何对象称呼时，返回空数组——没有可查的东西不是过关，是没有断言", () => {
    expect(evaluateObjectMentionClaims([], scene)).toEqual([]);
  });

  test("同一批次内，后面的声明能看到前面刚学会的别名（条件 b 用的候选池会累加）", () => {
    const results = evaluateObjectMentionClaims(
      [
        { phrase: "培养缸", clueId: "clue_final_brain_jars" },
        { phrase: "玻璃缸", clueId: "clue_final_brain_jars" },
      ],
      scene,
    );
    expect(results.every((r) => r.accepted)).toBe(true);
  });
});

describe("clueCandidatesForScene —— 候选文本组装与 game-session.ts 的 matchTexts 同一个字段来源", () => {
  test("texts = [name, ...findMethods 描述]", () => {
    const cands = clueCandidatesForScene([
      { id: "c1", name: "日记本", findMethods: [{ description: "翻看床头柜" }, { description: "查看抽屉" }] },
    ]);
    expect(cands).toEqual([{ id: "c1", texts: ["日记本", "翻看床头柜", "查看抽屉"] }]);
  });

  test("build-clues.ts 产的线索 findMethods 恒为空——候选文本此时只有线索名一项", () => {
    const cands = clueCandidatesForScene([{ id: "c1", name: "床头柜", findMethods: [] }]);
    expect(cands).toEqual([{ id: "c1", texts: ["床头柜"] }]);
  });

  test("texts = [name, ...findMethods 描述, ...matchTexts]——已经学会的别名（开发·别名迁移轮 C 组）也进候选池", () => {
    const cands = clueCandidatesForScene([
      { id: "c1", name: "母女的缸中脑", findMethods: [], matchTexts: ["培养缸", "玻璃缸"] },
    ]);
    expect(cands).toEqual([{ id: "c1", texts: ["母女的缸中脑", "培养缸", "玻璃缸"] }]);
  });

  test("没有 matchTexts 时（字段缺省）不报错，不产生 undefined 混进 texts 数组", () => {
    const cands = clueCandidatesForScene([{ id: "c1", name: "床头柜", findMethods: [] }]);
    expect(cands[0]?.texts.every((t) => typeof t === "string")).toBe(true);
  });
});
