// 车卡生成的背景不能借用模组 NPC 的名字。
//
// 起因：改完小传提示词之后**把输出读了一遍**（这一步不能省，改了不读
// 就是「看着改了但没验证」）。读出来第二段是：
//
//   「**克拉拉**去世后，亚瑟的生活被切割成两部分：白天是处理**艾米丽**
//     生活琐事……更加严苛地要求自己和女儿**艾米丽**遵守既定的生活规律」
//   还给这位调查员安了个「旧谷仓里的实验室」。
//
// 艾米丽是模组里的关键 NPC（缸中脑），谷仓实验室是反派艾德里安的设定。
// 提示词明说了不喂案件背景，所以这不是泄题 —— 是模型自己填人名时**撞上了**。
// 后果一样糟：玩家读到「女儿艾米丽」，之后在谷仓见到缸中脑艾米丽，
// 会以为这是伏笔，而它什么都不是。

import { describe, test, expect } from "bun:test";
import { collidesWithModuleNames } from "../play-module";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

const NPCS = BARN_OF_PREMIER.npcs.map((n) => n.name);

describe("collidesWithModuleNames", () => {
  test("**错误输入**：小传里出现模组 NPC 的名字 → 报出来", () => {
    const text = "克拉拉去世后，他更加严苛地要求自己和女儿艾米丽遵守既定的生活规律。";
    expect(collidesWithModuleNames(text, NPCS)).toBe("艾米丽");
  });

  test("**错误输入**：其它 NPC 同样认得出", () => {
    expect(collidesWithModuleNames("他每周去看望老友加比。", NPCS)).toBe("加比");
    expect(collidesWithModuleNames("菲碧是他多年的邻居。", NPCS)).toBe("菲碧");
  });

  test("**正确输入**：不撞名的小传放行", () => {
    const text = "1918 年冬，他在铁路工务段的弟弟托马斯带回两份烤猪肉，那是他记得的最后一个周日。";
    expect(collidesWithModuleNames(text, NPCS)).toBeUndefined();
  });

  test("**干扰输入**：只查给定名，不查姓 —— 姓太容易撞常用词", () => {
    // 「特里坎」既是姓也是镇名（范·特里坎镇），拿它当禁用词会把正常叙述毙掉
    expect(collidesWithModuleNames("他在范·特里坎镇住了十年。", NPCS)).toBeUndefined();
  });

  test("已知限制：模型自己编的名字若以 NPC 给定名开头，会被误判为撞名", () => {
    // 「米尔德丽德」以「米尔」开头，而米尔·特里坎是模组 NPC。
    // 判据在这里**会误报** —— 因为那个名字是模型现编的，不在任何封闭名单里，
    // 无从知道它是一个更长的名字还是真的点了米尔。
    // 中文没有词边界，靠「后面是不是汉字」判会连真阳性一起否掉
    //（「女儿艾米丽遵守规律」里艾米丽后面也是汉字）。
    //
    // 代价是可接受的：误报只导致**重写一次**，而漏报会让玩家把
    // 「女儿艾米丽」当成伏笔。这条测试把限制钉住，不假装它不存在。
    expect(collidesWithModuleNames("同事米尔德丽德每天最早到。", ["米尔·特里坎"])).toBe("米尔");
  });

  test("**干扰输入**：调查员自己的名字不在禁用名单里，不该被误伤", () => {
    // 禁用的是**模组 NPC**，不是本局调查员。小传当然会写到自己。
    expect(collidesWithModuleNames("亚瑟·彭德尔顿在旧谷仓里搭起了实验台。", NPCS)).toBeUndefined();
  });

  test("**干扰输入**：非人名的 NPC（警员、流浪汉）不参与撞名判定", () => {
    // 它们没有「·」，本来就是角色标签而不是名字；
    // 拿「警员」当禁用词会把「他做过两年警员」这类正常叙述毙掉。
    expect(collidesWithModuleNames("他年轻时做过两年警员，后来改行。", NPCS)).toBeUndefined();
    expect(collidesWithModuleNames("镇上的流浪汉都认得他。", NPCS)).toBeUndefined();
  });

  test("**干扰输入**：空文本 / 空名单不炸", () => {
    expect(collidesWithModuleNames("", NPCS)).toBeUndefined();
    expect(collidesWithModuleNames("随便一段话。", [])).toBeUndefined();
  });

  test("模组里确实有这些名字（别让上面几条测了个空）", () => {
    expect(NPCS.some((n) => n.includes("艾米丽"))).toBe(true);
    expect(NPCS.some((n) => n.includes("加比"))).toBe(true);
  });
});
