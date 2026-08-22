// 两名调查员不能重名。
//
// `shortName` 是播报与日志里**唯一的身份标记**。撞名之后：
//   · 日志出现「亨利半跪下来，检查亨利的伤势……」
//   · `➜ 亨利 【急救】` 无法归属 —— 是伤者自己在掷，还是同伴在掷？
//   · `scripts/diag/diag-downed.ts` 把同伴的急救算到伤者头上，报出 2 次假违规
//     （实测 seed 95028；当时差点据此去改引擎）
// 车卡是随机的，名字池有限，撞名是迟早的事，不能指望实跑撞出来。

import { describe, test, expect } from "bun:test";
import { pickDistinctName, acceptGeneratedName } from "../play-module";

/** 按给定顺序吐名字的假随机源 */
function scripted(names: string[]): (id: string) => { full: string; short: string } {
  let i = 0;
  return () => {
    const n = names[Math.min(i, names.length - 1)]!;
    i++;
    return { full: `${n}·某`, short: n };
  };
}

describe("pickDistinctName", () => {
  test("**正确**：没撞名就直接用第一次抽到的", () => {
    const r = pickDistinctName("detective", ["周舒"], scripted(["李默", "王五"]));
    expect(r.short).toBe("李默");
  });

  test("**错误行为的红线**：撞名时必须重抽", () => {
    const r = pickDistinctName("detective", ["亨利"], scripted(["亨利", "托马斯"]));
    expect(r.short).toBe("托马斯");
  });

  test("连撞多次也要抽到不同的", () => {
    const r = pickDistinctName("detective", ["亨利"], scripted(["亨利", "亨利", "亨利", "欧内斯特"]));
    expect(r.short).toBe("欧内斯特");
  });

  test("**干扰**：名字池只有一个时不能死循环，退回加后缀", () => {
    // 池子小是实情（按职业分池），判据不能变成「转到天荒地老」。
    const r = pickDistinctName("detective", ["亨利"], scripted(["亨利"]), 5);
    expect(r.short).toBe("亨利2");
    expect(r.short).not.toBe("亨利");
  });

  test("后缀也撞时继续往后找", () => {
    const r = pickDistinctName("detective", ["亨利", "亨利2", "亨利3"], scripted(["亨利"]), 3);
    expect(r.short).toBe("亨利4");
  });

  test("**干扰**：已用名单为空时不做任何多余处理", () => {
    const r = pickDistinctName("detective", [], scripted(["亨利"]));
    expect(r.short).toBe("亨利");
    expect(r.full).toBe("亨利·某");
  });
});

// ── LLM 起的名字收不收 ────────────────────────────────────────
//
// 名字现在由 LLM 跟八项背景**同一次调用**给出（不额外打网络）：
// 模板名字池按职业收窄后只剩五六个（侦探永远是亨利/约翰/沃尔特…），重复感明显。
//
// 但名字是**整局叙述里唯一的身份标记** —— 日志、判据、玩家全靠它。
// 所以这一关比八项严得多：形状不对宁可退回模板名，
// 也不能让「调查员A」或者半截句子进到正文里。

describe("acceptGeneratedName — 把关比八项严", () => {
  test("**正确**：合格的名·姓收下", () => {
    expect(acceptGeneratedName("亨利·摩根", [])).toBe("亨利·摩根");
    expect(acceptGeneratedName("玛格丽特·希尔", [])).toBe("玛格丽特·希尔");
  });

  test("**正确**：顺手剥掉模型爱加的引号", () => {
    expect(acceptGeneratedName("「亨利·摩根」", [])).toBe("亨利·摩根");
    expect(acceptGeneratedName('  "亨利·摩根"  ', [])).toBe("亨利·摩根");
  });

  test("**错误输入**：没有「·」不是名·姓", () => {
    expect(acceptGeneratedName("亨利摩根", [])).toBeUndefined();
    expect(acceptGeneratedName("亨利", [])).toBeUndefined();
  });

  test("**错误输入**：占位词一律不收", () => {
    for (const bad of ["调查员·A", "某人·某", "姓名·未知"]) {
      expect(acceptGeneratedName(bad, [])).toBeUndefined();
    }
  });

  test("**错误输入**：混进拉丁字母或标点的不收", () => {
    expect(acceptGeneratedName("Henry·摩根", [])).toBeUndefined();
    expect(acceptGeneratedName("亨利·摩根（侦探）", [])).toBeUndefined();
    expect(acceptGeneratedName("亨利·摩根，一名侦探", [])).toBeUndefined();
  });

  test("**错误输入**：多个分隔符 / 过长过短", () => {
    expect(acceptGeneratedName("亨利·摩根·二世", [])).toBeUndefined();
    expect(acceptGeneratedName("亨·利", [])).toBe("亨·利"); // 3 字，刚好在下限
    expect(acceptGeneratedName("亚历山大罗维奇·冯德堡伯爵", [])).toBeUndefined();
  });

  test("**错误输入**：不是字符串", () => {
    for (const bad of [undefined, null, 42, {}, []]) {
      expect(acceptGeneratedName(bad, [])).toBeUndefined();
    }
  });

  test("**错误行为的红线**：与同伴撞名要拒 —— 重名会让日志无法归属", () => {
    // 实测踩过：两个调查员都叫「亨利」，同伴的急救被算到伤者头上。
    expect(acceptGeneratedName("亨利·摩根", ["亨利"])).toBeUndefined();
    expect(acceptGeneratedName("亨利·卡特", ["亨利·摩根"])).toBeUndefined();
  });

  test("**干扰**：同姓不同名可以收 —— 拒的是名，不是姓", () => {
    expect(acceptGeneratedName("玛丽·摩根", ["亨利·摩根"])).toBe("玛丽·摩根");
  });
});
