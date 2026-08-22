// 两名调查员不能重名。
//
// `shortName` 是播报与日志里**唯一的身份标记**。撞名之后：
//   · 日志出现「亨利半跪下来，检查亨利的伤势……」
//   · `➜ 亨利 【急救】` 无法归属 —— 是伤者自己在掷，还是同伴在掷？
//   · `scripts/diag/diag-downed.ts` 把同伴的急救算到伤者头上，报出 2 次假违规
//     （实测 seed 95028；当时差点据此去改引擎）
// 车卡是随机的，名字池有限，撞名是迟早的事，不能指望实跑撞出来。

import { describe, test, expect } from "bun:test";
import { pickDistinctName } from "../play-module";

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
