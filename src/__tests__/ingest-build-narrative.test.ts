// 摄取管线 · 创作层第一版（todo-52）
//
// 范围：只测 openingAtmosphere/prologue/partySetup 这三样，与
// build-narrative.ts 文件头「范围收窄」的说明一致——epilogues/
// narrative.entities 本轮没做，不测。
//
// 变异检验覆盖三档接线里实际进管线的两档 + checkNarrationText：
//   第一档（新造术语）、第二档（对象称呼必须能被 decideClueMatch 命中）、
//   checkNarrationText（时代错置）——任何一档不过，整批不采纳。

import { describe, test, expect } from "bun:test";
import {
  buildNarrative,
  applyNarrative,
  findMissingCreativeSourceRef,
  findRegisteredCreativeLayer,
  type BuildNarrativeInput,
} from "../ingest/build-narrative";
import type { ChatLike } from "../ingest/infer-connections";
import type { ModuleData } from "../module/types";

function fake(reply: string): ChatLike & { calls: number; lastPrompt: string } {
  const f = {
    calls: 0,
    lastPrompt: "",
    async chat(messages: Array<{ role: string; content: string }>): Promise<string> {
      f.calls++;
      f.lastPrompt = messages[0]?.content ?? "";
      return reply;
    },
  };
  return f as ChatLike & { calls: number; lastPrompt: string };
}

function throwingClient(): ChatLike {
  return { async chat(): Promise<string> { throw new Error("network down"); } };
}

const CORPUS = "在1921年某日，你们来到了普瑞米尔小镇的特里坎家，院子里有个拖车房。";

const INPUT: BuildNarrativeInput = {
  title: "普瑞米尔的谷仓",
  era: "1921",
  scenes: [
    { id: "scene_01", name: "特里坎家", description: "一栋美式小别墅。", clues: [] },
    {
      id: "scene_02",
      name: "谷仓大厅",
      description: "谷仓内部。",
      clues: [{ id: "clue_final_brain_jars", name: "母女的缸中脑", findMethods: [] }],
    },
  ],
};

const HAPPY_REPLY = JSON.stringify({
  openingAtmosphere: [{ sceneId: "scene_01", text: "院子里有个小女孩正在拍球。", objectMentions: [] }],
  prologueLines: ["{pl1_name}收到了一封信。", "{pl1_motive}。{pl2_motive}。"],
  partySetup: {
    context: ["1921年，普瑞米尔镇。"],
    hooks: ["{name}是{occupation}，{pronoun}接下了这个案子。"],
    closing: ["调查从这里开始。"],
  },
});

describe("happy path：三样都产出，provenance 全部登记为创作层", () => {
  test("生成成功，accepted=true", async () => {
    const r = await buildNarrative(INPUT, fake(HAPPY_REPLY), CORPUS);
    expect(r.accepted).toBe(true);
    expect(r.openingAtmosphereByScene.get("scene_01")).toBe("院子里有个小女孩正在拍球。");
    expect(r.prologueLines).toHaveLength(2);
    expect(r.partySetup?.context).toEqual(["1921年，普瑞米尔镇。"]);
  });

  test("provenance：每个生成的字段都有一条 by:llm、无 sourceRef 的记录", async () => {
    const r = await buildNarrative(INPUT, fake(HAPPY_REPLY), CORPUS);
    expect(r.provenance).toHaveLength(3); // openingAtmosphere(1) + prologue + partySetup
    for (const p of r.provenance) {
      expect(p.by).toBe("llm");
      expect(p.sourceRef ?? "").toBe("");
    }
  });

  test("**创作层登记表判据**：缺 sourceRef 的集合与显式登记的集合精确相等", async () => {
    const r = await buildNarrative(INPUT, fake(HAPPY_REPLY), CORPUS);
    const missing = findMissingCreativeSourceRef(r.provenance);
    const registered = findRegisteredCreativeLayer(r.provenance);
    expect(new Set(missing)).toEqual(new Set(registered));
    expect(missing.length).toBeGreaterThan(0);
  });
});

describe("第一档变异检验：新造术语必须被拦下", () => {
  test("生成文本里出现【共鸣特质】（原文查无出处）→ 整批不采纳", async () => {
    const reply = JSON.stringify({
      openingAtmosphere: [{ sceneId: "scene_01", text: "他感受到一种奇怪的【共鸣特质】。", objectMentions: [] }],
      prologueLines: [],
      partySetup: null,
    });
    const r = await buildNarrative(INPUT, fake(reply), CORPUS);
    expect(r.accepted).toBe(false);
    expect(r.openingAtmosphereByScene.size).toBe(0);
    expect(r.warnings.some((w) => w.includes("第一档拦下") && w.includes("共鸣特质"))).toBe(true);
  });

  test("对照组：同样的场景描述，但没有新造术语 → 正常通过", async () => {
    const r = await buildNarrative(INPUT, fake(HAPPY_REPLY), CORPUS);
    expect(r.accepted).toBe(true);
  });

  test("未提供原文语料时第一档跳过，不是通过——warnings 里说清楚区别", async () => {
    const r = await buildNarrative(INPUT, fake(HAPPY_REPLY), undefined);
    expect(r.accepted).toBe(true);
    expect(r.warnings.some((w) => w.includes("第一档") && w.includes("跳过"))).toBe(true);
  });
});

describe("第二档变异检验：模拟「培养缸」bug，声明的对象称呼必须能被 decideClueMatch 命中", () => {
  test("声明称呼「培养缸」指代 clue_final_brain_jars，但线索候选文本里没有这个词 → 整批不采纳", async () => {
    const reply = JSON.stringify({
      openingAtmosphere: [
        {
          sceneId: "scene_02",
          text: "角落里放着一个培养缸。",
          objectMentions: [{ phrase: "培养缸", clueId: "clue_final_brain_jars" }],
        },
      ],
      prologueLines: [],
      partySetup: null,
    });
    const r = await buildNarrative(INPUT, fake(reply), CORPUS);
    expect(r.accepted).toBe(false);
    expect(r.warnings.some((w) => w.includes("第二档拦下") && w.includes("培养缸"))).toBe(true);
  });

  test("对照组：声明称呼直接用线索本名「母女的缸中脑」→ decideClueMatch 认得，正常通过", async () => {
    const reply = JSON.stringify({
      openingAtmosphere: [
        {
          sceneId: "scene_02",
          text: "角落里放着母女的缸中脑。",
          objectMentions: [{ phrase: "母女的缸中脑", clueId: "clue_final_brain_jars" }],
        },
      ],
      prologueLines: [],
      partySetup: null,
    });
    const r = await buildNarrative(INPUT, fake(reply), CORPUS);
    expect(r.accepted).toBe(true);
    expect(r.openingAtmosphereByScene.get("scene_02")).toBe("角落里放着母女的缸中脑。");
  });

  test("声明指向一条不存在的线索 id（该场景没有这条线索）→ 同样不采纳", async () => {
    const reply = JSON.stringify({
      openingAtmosphere: [
        {
          sceneId: "scene_01",
          text: "角落里放着某样东西。",
          objectMentions: [{ phrase: "某样东西", clueId: "clue_final_brain_jars" }],
        },
      ],
      prologueLines: [],
      partySetup: null,
    });
    const r = await buildNarrative(INPUT, fake(reply), CORPUS);
    expect(r.accepted).toBe(false);
  });
});

describe("checkNarrationText 变异检验：时代错置必须被拦下", () => {
  test("生成文本提到「手机」（1920 年代不该出现）→ 整批不采纳", async () => {
    const reply = JSON.stringify({
      openingAtmosphere: [],
      prologueLines: ["{pl1_name}掏出手机看了一眼。"],
      partySetup: null,
    });
    const r = await buildNarrative(INPUT, fake(reply), CORPUS);
    expect(r.accepted).toBe(false);
    expect(r.warnings.some((w) => w.includes("checkNarrationText"))).toBe(true);
  });
});

describe("失败语义：出错就当没做，不半采纳", () => {
  test("LLM 调用失败 → accepted=false", async () => {
    const r = await buildNarrative(INPUT, throwingClient(), CORPUS);
    expect(r.accepted).toBe(false);
    expect(r.provenance).toEqual([]);
  });

  test("回复不是合法 JSON → accepted=false", async () => {
    const r = await buildNarrative(INPUT, fake("这不是 JSON"), CORPUS);
    expect(r.accepted).toBe(false);
  });

  test("openingAtmosphere 引用不存在的场景 id → 跳过该条并报 warning，不影响其余字段", async () => {
    const reply = JSON.stringify({
      openingAtmosphere: [{ sceneId: "scene_不存在", text: "……", objectMentions: [] }],
      prologueLines: ["{pl1_name}收到了一封信。"],
      partySetup: null,
    });
    const r = await buildNarrative(INPUT, fake(reply), CORPUS);
    expect(r.accepted).toBe(true);
    expect(r.openingAtmosphereByScene.size).toBe(0);
    expect(r.prologueLines).toHaveLength(1);
    expect(r.warnings.some((w) => w.includes("不存在的场景 id"))).toBe(true);
  });

  test("没有场景时直接返回空结果，不调用 LLM", async () => {
    const client = fake(HAPPY_REPLY);
    const r = await buildNarrative({ title: "x", era: "1921", scenes: [] }, client, CORPUS);
    expect(r.accepted).toBe(false);
    expect(client.calls).toBe(0);
  });
});

describe("applyNarrative —— 把创作层结果并入已装配好的模组", () => {
  const baseModule: ModuleData = {
    id: "m",
    title: "普瑞米尔的谷仓",
    version: "0.0.0",
    ruleset: "cosmic-horror",
    era: "1921",
    summary: "",
    scenes: [
      { id: "scene_01", name: "特里坎家", description: "一栋美式小别墅。", clues: [], npcIds: [], connections: [] },
    ],
    npcs: [],
    meta: { playerCount: "", expectedDuration: "", triggerWarnings: [] },
    endings: [],
    items: [],
  };

  test("accepted=true 时，openingAtmosphere/prologue/partySetup 都并入", async () => {
    const narrative = await buildNarrative(
      { title: baseModule.title, era: baseModule.era, scenes: baseModule.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description, clues: [] })) },
      fake(HAPPY_REPLY),
      CORPUS,
    );
    const merged = applyNarrative(baseModule, narrative);
    expect(merged.scenes[0]?.openingAtmosphere).toBe("院子里有个小女孩正在拍球。");
    expect(merged.prologue?.lines).toHaveLength(2);
    expect(merged.partySetup?.context).toEqual(["1921年，普瑞米尔镇。"]);
    expect(merged.provenance).toHaveLength(3);
  });

  test("accepted=false 时原样返回 module，不是「部分产出」", async () => {
    const narrative = await buildNarrative(
      { title: baseModule.title, era: baseModule.era, scenes: baseModule.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description, clues: [] })) },
      throwingClient(),
      CORPUS,
    );
    const merged = applyNarrative(baseModule, narrative);
    expect(merged).toEqual(baseModule);
  });

  test("不修改传入的 module（函数式风格，与 build-clues.ts 等一致）", async () => {
    const narrative = await buildNarrative(
      { title: baseModule.title, era: baseModule.era, scenes: baseModule.scenes.map((s) => ({ id: s.id, name: s.name, description: s.description, clues: [] })) },
      fake(HAPPY_REPLY),
      CORPUS,
    );
    const before = JSON.stringify(baseModule);
    applyNarrative(baseModule, narrative);
    expect(JSON.stringify(baseModule)).toBe(before);
  });
});
