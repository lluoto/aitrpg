// 检定播报印出来的数，玩家要能自己验算。
//
// 起因：实跑一局，战斗里出现这一行 ——
//
//     ➜ 埃利亚斯 【格斗(肉搏)】 71% → d100=55 → 失败
//
// 按 CoC 规则 55 ≤ 71 是成功，怎么算都不该失败。第一反应是判定写错了；
// 查下来**判定是对的** —— 战斗攻击用的是 `hard` 难度，实际阈值是半值 35，
// 55 > 35 所以失败。错的是**播报**：它只印技能原值，不印实际阈值。
//
// 数值播报的意义就是让人能自己验算。印一个算不出结果的数，比不印更糟 ——
// 它会把「规则如此」误报成「程序有 bug」，而下次真有 bug 时没人再信这行字。

import { describe, test, expect } from "bun:test";
import { runCtx, type RunContext } from "../play/narration";
import { check } from "../play/checks";

/** 收集一次检定的播报行 */
function linesOf(fn: () => void): string[] {
  const lines: string[] = [];
  const ctx: RunContext = {
    lines: [], origins: [],
    onLine: (l: string) => lines.push(l),
    wounds: new Map(),
  } as unknown as RunContext;
  runCtx.run(ctx, fn);
  return lines;
}

/** 从「d100=NN」与结果标签里判断这一行自不自洽 */
function parse(line: string) {
  const roll = Number(line.match(/d100=(\d+)/)?.[1] ?? NaN);
  const shown = Number(line.match(/】\s*(\d+)%/)?.[1] ?? NaN);
  const threshold = Number(line.match(/[困极][难]→(\d+)/)?.[1] ?? NaN);
  const failed = /失败/.test(line);
  return { roll, shown, threshold, failed };
}

describe("检定行要能自洽", () => {
  test("**错误行为的红线**：非常规难度必须印出实际阈值", () => {
    const real = Math.random;
    try {
      // d100 = 55；技能 71 的困难阈值是 35 → 必定失败
      Math.random = () => 0.54;
      const lines = linesOf(() => { check(71, "埃利亚斯", "格斗(肉搏)", "hard"); });
      expect(lines.length).toBeGreaterThan(0);
      const line = lines.join(" ");
      const p = parse(line);
      expect(p.roll).toBe(55);
      expect(p.failed).toBe(true);
      // 关键：这一行里必须有一个数，能解释 55 为什么算失败
      expect(Number.isNaN(p.threshold)).toBe(false);
      expect(p.roll).toBeGreaterThan(p.threshold);
    } finally { Math.random = real; }
  });

  test("**正确**：常规难度不必多印阈值 —— 技能值本身就是阈值", () => {
    const real = Math.random;
    try {
      Math.random = () => 0.54;
      const line = linesOf(() => { check(71, "埃利亚斯", "侦查", "regular"); }).join(" ");
      expect(line).toContain("71%");
      expect(line).not.toMatch(/[困极][难]→/);
      // 55 ≤ 71 → 成功，这一行自己就说得通
      expect(/失败/.test(line)).toBe(false);
    } finally { Math.random = real; }
  });

  test("**干扰输入**：极难难度印的是五分之一", () => {
    const real = Math.random;
    try {
      Math.random = () => 0.10; // d100 = 11
      const line = linesOf(() => { check(70, "埃利亚斯", "侦查", "extreme"); }).join(" ");
      expect(line).toContain("极难→14"); // floor(70/5)
    } finally { Math.random = real; }
  });
});
