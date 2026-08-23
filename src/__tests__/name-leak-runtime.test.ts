// 运行时那道「旁白不许提前叫出没见过的人的名字」的闸门。
//
// 起因：`namesLeakedInOpening` 这条判据写出来之后，**只有测试在用它** ——
// 它查的是模组里静态的 `openingAtmosphere`。而实际印给玩家看的场景过渡句
// （`generateOpeningTransition` / `generateNpcTransition`）是 LLM 现写的，
// 印在 NPC 被介绍**之前**，一直没人查。
//
// 判据存在、缺陷也存在，只是两者从没接上。这个文件测的是接上之后的那道闸门。

import { describe, test, expect } from "bun:test";
import { namesPerson, nameParts } from "../play/names";
import { namesLeakedInOpening } from "../diagnostics/narration";

const CAST = ["米尔·特里坎", "菲碧·特里坎", "艾德里安·埃斯特鲁姆"];

describe("namesPerson —— 运行时与判据共用的那一个", () => {
  test("**错误行为的红线**：过渡句叫出没见过的人的名字，必须判为穿帮", () => {
    expect(namesPerson("门开了，米尔·特里坎探出头来。", "米尔·特里坎", CAST)).toBeTruthy();
    expect(namesPerson("循声望去，米尔正抱着篮球。", "米尔·特里坎", CAST)).toBe("米尔");
  });

  test("**正确**：不点名的过渡句放行", () => {
    expect(namesPerson("门开了，一个女人站在门后。", "米尔·特里坎", CAST)).toBe("");
    expect(namesPerson("院子里空无一人。", "菲碧·特里坎", CAST)).toBe("");
  });

  test("**干扰输入**：调查员叫米尔德丽德，不得被当成米尔", () => {
    // 这套规则被打脸的第一次。名单必须给全，否则短名会认错人。
    const withPc = [...CAST, "米尔德丽德·罗德里格斯"];
    expect(namesPerson("米尔德丽德推开车门。", "米尔·特里坎", withPc)).toBe("");
    // 名单没给全时会误报 —— 这正是「otherKnownNames 要给全」的理由，写下来备查
    expect(namesPerson("米尔德丽德推开车门。", "米尔·特里坎", CAST)).toBe("米尔");
  });

  test("**干扰输入**：模组标题《普瑞米尔的谷仓》里的「米尔」不算点名", () => {
    const withTitle = [...CAST, "普瑞米尔的谷仓"];
    expect(namesPerson("这里是普瑞米尔的谷仓。", "米尔·特里坎", withTitle)).toBe("");
  });

  test("**干扰输入**：单字名不参与比对", () => {
    expect(nameParts("王")).toEqual([]);
    expect(namesPerson("他走了过来。", "王", CAST)).toBe("");
  });
});

describe("判据与运行时是同一份实现", () => {
  test("**错误行为的红线**：namesLeakedInOpening 与 namesPerson 结论必须一致", () => {
    // 各写一份迟早会漂到只有一边判得出来。这条把两边钉在一起。
    const scenes = [{ id: "s1", npcIds: ["n1"], openingAtmosphere: "循声望去，米尔正抱着篮球。" }];
    const npcs = [{ id: "n1", name: "米尔·特里坎" }];
    const viaCriterion = namesLeakedInOpening(scenes, npcs);
    const viaRuntime = namesPerson(scenes[0]!.openingAtmosphere, npcs[0]!.name, npcs.map((n) => n.name));
    expect(viaCriterion).toHaveLength(1);
    expect(viaCriterion[0]!.hit).toBe(viaRuntime);
  });

  test("**正确**：都放行时两边也一致", () => {
    const scenes = [{ id: "s1", npcIds: ["n1"], openingAtmosphere: "一个小女孩抱着篮球。" }];
    const npcs = [{ id: "n1", name: "米尔·特里坎" }];
    expect(namesLeakedInOpening(scenes, npcs)).toEqual([]);
    expect(namesPerson(scenes[0]!.openingAtmosphere, npcs[0]!.name, npcs.map((n) => n.name))).toBe("");
  });
});
