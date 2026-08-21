// 敌人战斗数值从模组描述里解析出来 —— 这条是承重逻辑。
//
// 背景：引擎原先只读了 HP，把「每回合攻击2次。格斗45%（1d6伤害）」那句丢了，
// 于是 Boss 战里敌人从头到尾不还手，玩家整场掉不了一点血，
// 伤势/重伤/惩罚骰那套机制在战斗中完全用不上。
//
// 这里钉的是解析本身：写错正则会静默退化成兜底默认值，
// 数值看着「有」但跟模组对不上，日志上一个字都不会提。

import { describe, test, expect } from "bun:test";
import { parseEnemyStats } from "../play/combat";

describe("parseEnemyStats — 从 NPC 描述读战斗数值", () => {
  // 模组 mi_go 条目的真实文本
  const REAL = [
    "HP11 MP15 DB无 体格0",
    "Str40 Con40 Siz70 Dex90 Int65 Pow85",
    "每回合攻击2次。格斗45%（1d6伤害）闪避35%",
    "护甲：无，但贯穿武器均造成最小伤害",
    "理智损失：0/1d6",
  ].join("\n");

  test("按模组原文读出格斗/伤害/次数", () => {
    expect(parseEnemyStats(REAL)).toEqual({ skill: 45, damage: "1d6", times: 2 });
  });

  test("**只在含「每回合攻击」的那行上匹配**", () => {
    // 判据要能区分「只搜那一行」与「全描述搜」。
    // 拿 REAL 测是假绿的：它的「格斗45%」正好就在那一行里，
    // 全描述搜也先命中同一处，改坏了测试照样绿（变异检验抓到过）。
    //
    // 所以构造一个别处先出现「格斗」的描述：只搜那一行才会读到 45。
    const tricky = [
      "背景：此物擅长格斗99%，曾撕碎整支小队",   // 干扰行，在前面
      "每回合攻击2次。格斗45%（1d6伤害）闪避35%",
    ].join("\n");
    expect(parseEnemyStats(tricky).skill).toBe(45);
  });

  test("**伤害也只认那一行**", () => {
    const tricky = [
      "特殊：吐息造成（9d9伤害）",                 // 干扰行，在前面
      "每回合攻击2次。格斗45%（1d6伤害）闪避35%",
    ].join("\n");
    expect(parseEnemyStats(tricky).damage).toBe("1d6");
  });

  test("伤害不会误取理智损失那个 1d6", () => {
    // 理智损失写作「0/1d6」，没有「（…伤害）」的包裹，不该命中
    const noDmg = "每回合攻击1次。格斗50%闪避20%\n理智损失：0/1d6";
    expect(parseEnemyStats(noDmg).damage).toBe("1d6"); // 走兜底而非误取
    expect(parseEnemyStats(noDmg).skill).toBe(50);
  });

  test("读不到就退回兜底，且兜底与模组一致", () => {
    expect(parseEnemyStats("")).toEqual({ skill: 45, damage: "1d6", times: 2 });
  });

  test("认全角与半角括号", () => {
    const half = "每回合攻击3次。格斗60%(2d4伤害)闪避10%";
    expect(parseEnemyStats(half)).toEqual({ skill: 60, damage: "2d4", times: 3 });
  });

  test("伤害带修正也读得出", () => {
    const plus = "每回合攻击1次。格斗70%（1d6+2伤害）闪避30%";
    expect(parseEnemyStats(plus).damage).toBe("1d6+2");
  });
});
