// 摄取管线 · 陷阱机制抽取
//
// 样本是《普瑞米尔的谷仓》PDF 的**原文**，逐字取自 sectionize 的输出，不是转述。
// 这一段是整条线的起点：陷阱数值原本只存在于散文里，引擎读不到，
// 于是被人工抄进 play-module.ts，抄错了也没有任何测试会发现。

import { describe, test, expect } from "bun:test";
import { extractTrapMechanics } from "../ingest/extract-trap";

// ── 原文样本（p9-p10）──
const 捕兽夹 =
  "体形小于 35 的角色会免疫这种陷阱，当踩中时陷阱会牢牢咬住被害者的腿，造成 1D4+1 的伤害。挣脱需要困难成功的力量来打开陷阱，如果力量出现了大失败或者 RP 了乱动的情况，捕兽夹会造成额外的 1d3 伤害。";
const 霰弹枪 =
  "踩到这种陷阱的调查员有一个困难敏捷的机会来躲过这次袭击。霰弹枪会朝着拌锁的位置开火，造成 1d6的伤害，这种霰弹枪没有备弹并且后托和前枪管都被锯掉了，无法作为调查员的武器再利用。";
const 音响陷阱 =
  "这种陷阱本来是警报作用的陷阱，但是现在艾德里安已经被捕，这种陷阱也失去了作用，但是坏心眼的 KP 仍然可以以突然的巨大响声为由对所有调查员造成 sc0/1d3的惩罚，而且因为分心，所有调查员的下一个侦查骰会有额外的惩罚骰。";
const 硫酸陷阱 =
  "会从门上直接倒下一瓶硫酸，根据可选部位规则命中调查员的部位。硫酸会造成 1D4+1 的伤害，并且如果调查员没有摆脱硫酸，它会一直伤害这名调查员 1D3，直至调查员昏迷。它不会造成重伤，所以调查员不会因此死亡。可以通过一个闪避技能来躲避硫酸的袭击。";

describe("捕兽夹", () => {
  const r = extractTrapMechanics("捕兽夹", 捕兽夹);

  test("伤害骰", () => {
    expect(r?.mech.damage).toBe("1D4+1");
  });

  test("体型免疫阈值", () => {
    expect(r?.mech.sizImmunityBelow).toBe(35);
  });

  test("挣脱检定：困难难度的力量", () => {
    expect(r?.mech.escape).toMatchObject({ skill: "力量", difficulty: "hard" });
  });

  test("大失败的额外伤害", () => {
    expect(r?.mech.escape?.fumbleDamage).toBe("1d3");
  });

  test("原文没写截肢，就不能凭空生成 maimAtHpRatio", () => {
    // 手写版的 description 里有"伤害大于耐久半值有截肢风险"，但 PDF 原文没有这句。
    // 抽取只能照着原文来，多出来的东西必须是人显式加的、并且留痕。
    expect(r?.mech.maimAtHpRatio).toBeUndefined();
  });

  test("是挣脱不是躲避 —— 已经咬住了，没得躲", () => {
    expect(r?.mech.avoid).toBeUndefined();
  });
});

describe("锯短霰弹枪拌锁陷阱", () => {
  const r = extractTrapMechanics("锯短霰弹枪拌锁陷阱", 霰弹枪);

  test("骰子紧贴中文也认得出（原文是「1d6的伤害」，没有空格）", () => {
    expect(r?.mech.damage).toBe("1d6");
  });

  test("躲避检定：困难难度的敏捷", () => {
    expect(r?.mech.avoid).toMatchObject({ skill: "敏捷", difficulty: "hard" });
  });

  test("是躲避不是挣脱", () => {
    expect(r?.mech.escape).toBeUndefined();
  });
});

describe("硫酸陷阱", () => {
  const r = extractTrapMechanics("硫酸陷阱", 硫酸陷阱);

  test("初始伤害", () => {
    expect(r?.mech.damage).toBe("1D4+1");
  });

  test("持续伤害", () => {
    expect(r?.mech.ongoing?.damage).toBe("1D3");
  });

  test("躲避用的是闪避技能，不是敏捷 —— 原文写的是「闪避技能」", () => {
    expect(r?.mech.avoid?.skill).toBe("闪避");
  });
});

describe("音响陷阱", () => {
  const r = extractTrapMechanics("音响陷阱", 音响陷阱);

  test("原文说它失效了，但 KP 仍可判 SAN —— 不能简单当作无机制", () => {
    // 手写版把它标成"已失效，不结算"。原文其实留了个 sc0/1d3 的口子。
    expect(r).not.toBeNull();
  });

  test("SAN 消耗按 CoC 的「成功/失败」格式取出", () => {
    expect(r?.mech.sanCost).toBe("0/1d3");
  });

  test("没有物理伤害", () => {
    expect(r?.mech.damage).toBeUndefined();
  });
});

describe("难度词", () => {
  test("困难 → hard", () => {
    expect(extractTrapMechanics("x", "需要困难成功的力量来挣脱")?.mech.escape?.difficulty).toBe("hard");
  });
  test("极难 → extreme", () => {
    expect(extractTrapMechanics("x", "需要极难成功的力量来挣脱")?.mech.escape?.difficulty).toBe("extreme");
  });
  test("没写难度词 → regular", () => {
    expect(extractTrapMechanics("x", "需要成功的力量来挣脱")?.mech.escape?.difficulty).toBe("regular");
  });
});

describe("无机制的文本", () => {
  test("纯叙述返回 null，不硬凑出一个空壳", () => {
    expect(extractTrapMechanics("杂物堆", "聪明的调查员可以通过爬上这些杂物来到屋顶。")).toBeNull();
  });
  test("空文本返回 null", () => {
    expect(extractTrapMechanics("x", "")).toBeNull();
  });
});

describe("留痕", () => {
  test("每个抽出的字段都记一条 Provenance", () => {
    const r = extractTrapMechanics("捕兽夹", 捕兽夹, "raw/section_08.txt:L13");
    const paths = r?.provenance.map((p) => p.path) ?? [];
    expect(paths).toContain("trap.damage");
    expect(paths).toContain("trap.sizImmunityBelow");
    expect(paths).toContain("trap.escape");
  });

  test("留痕带原文片段与出处，且标明是规则抽取而非 LLM", () => {
    const r = extractTrapMechanics("捕兽夹", 捕兽夹, "raw/section_08.txt:L13");
    const p = r?.provenance.find((x) => x.path === "trap.damage");
    expect(p?.by).toBe("rule");
    expect(p?.sourceRef).toBe("raw/section_08.txt:L13");
    expect(p?.source).toContain("1D4+1");
    expect(p?.reason.length).toBeGreaterThan(0);
  });
});
