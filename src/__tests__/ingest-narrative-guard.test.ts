// 摄取管线 · 创作层约束接线（todo-52 任务②a②b）
//
// 只测两档确定性判据本身（不依赖真实 LLM）：
//   第一档 findFabricatedTerms —— 复用 three-way-audit 的能力
//   第二档 findUnresolvedObjectMentions —— 复用 decideClueMatch
// 变异检验见对应 describe 块，要求判据能真的分辨对错两种情形
// （docs/todo.json rule-03：判据没验过就不算数）。

import { describe, test, expect } from "bun:test";
import { findFabricatedTerms, findUnresolvedObjectMentions, clueCandidatesForScene } from "../ingest/narrative-guard";
import type { ClueMatchCandidate } from "../investigation/clue-match";

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

describe("第二档 findUnresolvedObjectMentions —— 可交互对象称呼必须能被 decideClueMatch 命中", () => {
  const candidates: ClueMatchCandidate[] = clueCandidatesForScene([
    { id: "clue_final_brain_jars", name: "母女的缸中脑", findMethods: [] },
    { id: "clue_bedroom_gun", name: "枪械柜", findMethods: [] },
  ]);

  test("变异检验：模拟「培养缸」bug——用一个匹配器不认识的称呼指代线索，必须红", () => {
    const failed = findUnresolvedObjectMentions(
      [{ phrase: "培养缸", clueId: "clue_final_brain_jars" }],
      candidates,
    );
    expect(failed).toEqual([{ phrase: "培养缸", clueId: "clue_final_brain_jars" }]);
  });

  test("正例：称呼直接用线索本名，decideClueMatch 认得，必须绿", () => {
    const failed = findUnresolvedObjectMentions(
      [{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }],
      candidates,
    );
    expect(failed).toEqual([]);
  });

  test("称呼命中了，但命中的是别的线索——声明与实际所指对不上，同样要拦", () => {
    const failed = findUnresolvedObjectMentions(
      [{ phrase: "枪械柜", clueId: "clue_final_brain_jars" }],
      candidates,
    );
    expect(failed).toEqual([{ phrase: "枪械柜", clueId: "clue_final_brain_jars" }]);
  });

  test("没有声明任何对象称呼时，返回空数组——没有可查的东西不是过关，是没有断言", () => {
    expect(findUnresolvedObjectMentions([], candidates)).toEqual([]);
  });

  test("场景没有线索（candidates 为空）时，任何声明都必然命中失败——不能凭空声明一条线索", () => {
    const failed = findUnresolvedObjectMentions([{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }], []);
    expect(failed).toHaveLength(1);
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
