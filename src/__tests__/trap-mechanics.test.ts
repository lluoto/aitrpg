// 陷阱机制结构化的回归测试
//
// 这批测试锁的是一件事：陷阱数值从模组数据读，不再由人工抄进引擎。
// 最要紧的一条是「模组里每个陷阱的骰子表达式都必须解析得动」——
// 此前 play-module 里硬编码的是 1+rand(3)（1~3 点），连模组写的 1D4+1（最少 2 点）
// 都够不到，而且没有任何测试会发现这件事。

import { describe, test, expect } from "bun:test";
import { rollDice, trapsInScene, attributeValue, isMajorWound } from "../play-module";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { ModuleItem } from "../module/types";

describe("rollDice — 骰子表达式", () => {
  // rng 固定成 0 → 每颗骰子出最小面；固定成 0.999… → 出最大面
  const minRng = () => 0;
  const maxRng = () => 0.9999999;

  test("认大写 D —— 模组写的就是 1D4+1", () => {
    expect(rollDice("1D4+1", minRng)).toBe(2);
    expect(rollDice("1D4+1", maxRng)).toBe(5);
  });

  test("认小写 d", () => {
    expect(rollDice("1d6", minRng)).toBe(1);
    expect(rollDice("1d6", maxRng)).toBe(6);
  });

  test("省略骰子个数视为 1 颗", () => {
    expect(rollDice("d4", minRng)).toBe(1);
    expect(rollDice("d4", maxRng)).toBe(4);
  });

  test("多颗骰子累加", () => {
    expect(rollDice("2D6+2", minRng)).toBe(4);
    expect(rollDice("2D6+2", maxRng)).toBe(14);
  });

  test("支持负修正，且不会掉到 0 以下", () => {
    expect(rollDice("1d3-1", minRng)).toBe(0);
    expect(rollDice("1d3-5", minRng)).toBe(0);
  });

  test("非法表达式抛错，而不是静默返回 0", () => {
    // 静默的 0 会让捕兽夹变成「咬住了却不掉血」，且日志上一个字都不会提
    expect(() => rollDice("")).toThrow();
    expect(() => rollDice("abc")).toThrow();
    expect(() => rollDice("1d")).toThrow();
    expect(() => rollDice("0d6")).toThrow();
  });

  test("落在声明的区间内（重复投，防边界写反）", () => {
    for (let i = 0; i < 200; i++) {
      const v = rollDice("1D4+1");
      expect(v).toBeGreaterThanOrEqual(2);
      expect(v).toBeLessThanOrEqual(5);
    }
  });
});

describe("trapsInScene — 按场景取陷阱", () => {
  const items: ModuleItem[] = [
    { id: "t1", name: "甲", sceneId: "s1", description: "", type: "trap", trap: { damage: "1d4" } },
    { id: "t2", name: "乙", sceneId: "s1", description: "", type: "trap", trap: { damage: "1d6" } },
    { id: "t3", name: "丙（失效）", sceneId: "s1", description: "", type: "trap" },
    { id: "t4", name: "丁", sceneId: "s2", description: "", type: "trap", trap: { damage: "1d8" } },
    { id: "k1", name: "钥匙", sceneId: "s1", description: "", type: "key" },
  ];

  test("同一场景的多个陷阱全部取到 —— 不再是只认一个", () => {
    expect(trapsInScene(items, "s1").map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  test("没有 trap 字段的条目被跳过（已失效的陷阱纯叙事）", () => {
    expect(trapsInScene(items, "s1").some((t) => t.id === "t3")).toBe(false);
  });

  test("不串场景", () => {
    expect(trapsInScene(items, "s2").map((t) => t.id)).toEqual(["t4"]);
  });

  test("非陷阱类型不会混进来", () => {
    expect(trapsInScene(items, "s1").some((t) => t.id === "k1")).toBe(false);
  });

  test("场景无陷阱时返回空数组", () => {
    expect(trapsInScene(items, "s99")).toEqual([]);
  });
});

describe("attributeValue — 中文属性名映射", () => {
  const attrs = { strength: 70, dexterity: 45, size: 30 };

  test("力量 / 敏捷 / 体型 都映射得到", () => {
    expect(attributeValue(attrs, "力量")).toBe(70);
    expect(attributeValue(attrs, "敏捷")).toBe(45);
    expect(attributeValue(attrs, "体型")).toBe(30);
  });

  test("属性缺值时回落", () => {
    expect(attributeValue({}, "力量")).toBe(50);
    expect(attributeValue({}, "力量", 33)).toBe(33);
  });

  test("认不出的名字回落（并在实现里出声告警）", () => {
    expect(attributeValue(attrs, "神秘学")).toBe(50);
  });
});

describe("模组数据 — 普瑞米尔的谷仓的陷阱", () => {
  const traps = BARN_OF_PREMIER.items.filter((i) => i.type === "trap");

  test("模组里确实有 4 个陷阱条目", () => {
    expect(traps.length).toBe(4);
  });

  test("farm_periphery 一个场景挂着不止一个会结算的陷阱", () => {
    // 改造前这里只有捕兽夹是活的，霰弹枪与音响是死数据
    expect(trapsInScene(BARN_OF_PREMIER.items, "farm_periphery").length).toBeGreaterThan(1);
  });

  test("每个陷阱的骰子表达式都解析得动", () => {
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    expect(traps.length).toBeGreaterThan(0);
    for (const t of traps) {
      const m = t.trap;
      if (!m) continue;
      if (m.damage) expect(() => rollDice(m.damage as string)).not.toThrow();
      if (m.escape?.fumbleDamage) expect(() => rollDice(m.escape!.fumbleDamage as string)).not.toThrow();
      if (m.ongoing) expect(() => rollDice(m.ongoing!.damage)).not.toThrow();
    }
  });

  test("捕兽夹按条目写的 1D4+1 结算，不是旧的 1~3 点", () => {
    const bear = traps.find((t) => t.id === "trap_bear");
    expect(bear?.trap?.damage).toBe("1D4+1");
    expect(bear?.trap?.sizImmunityBelow).toBe(35);
    expect(bear?.trap?.escape?.difficulty).toBe("hard");
    expect(bear?.trap?.escape?.fumbleDamage).toBe("1d3");
  });

  test("推断出来的字段有留痕，能和原文分开", () => {
    const bear = traps.find((t) => t.id === "trap_bear");
    // 模组没写体型免疫的理由，narration 是我们补的 —— 必须记在 inferred 里
    expect(bear?.trap?.inferred).toContain("immuneNarration");
  });

  test("霰弹枪是触发瞬间躲避，不是中招后挣脱", () => {
    const gun = traps.find((t) => t.id === "trap_shotgun");
    expect(gun?.trap?.avoid?.skill).toBe("敏捷");
    expect(gun?.trap?.avoid?.difficulty).toBe("hard");
    expect(gun?.trap?.escape).toBeUndefined();
  });

  test("硫酸陷阱带持续伤害", () => {
    const acid = traps.find((t) => t.id === "trap_sulfuric_acid");
    expect(acid?.trap?.damage).toBe("1D4+1");
    expect(acid?.trap?.ongoing?.damage).toBe("1D3");
  });

  test("陷阱区的两个活陷阱都声明了事先发现即规避", () => {
    // 旧引擎靠 support.trapClueId 这一个全局开关做这件事；删掉它时差点把语义一起弄丢，
    // 实跑里表现为调查员连踩两个陷阱 HP 10→1。现在由每个陷阱各自声明。
    for (const id of ["trap_bear", "trap_shotgun"]) {
      const t = traps.find((x) => x.id === id);
      expect(t?.trap?.detectedByClue).toBe("clue_trap_detected");
    }
  });

  test("已失效的音响陷阱不参与结算", () => {
    const sound = traps.find((t) => t.id === "trap_sound");
    expect(sound).toBeDefined();
    expect(sound?.trap).toBeUndefined();
  });
});

describe("isMajorWound — 截肢阈值边界", () => {
  test("恰好等于半值不算重伤", () => {
    expect(isMajorWound(6, 12)).toBe(false);
  });
  test("超过半值算重伤", () => {
    expect(isMajorWound(7, 12)).toBe(true);
  });
});
