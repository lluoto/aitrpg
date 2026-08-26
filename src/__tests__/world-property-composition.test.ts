// composition（幂等/可加/取极值/互斥）的合并语义。
//
// 起因：docs/world-property-falsification.md §发现三——德鲁伊光环叠加
// 规则的原文自己都要专门加一条「极限规则」兜底「可加」的指数爆炸，说明
// composition 不能靠约定，必须是能拦下「偷懒写成可加」的机器判据。
//
// 每种 composition 都测三侧：行为正确 / 目标行为错误（该拒绝的没拒绝）
// / 文本相似但合法（不能因为长得像别的 composition 就误判）。

import { describe, test, expect } from "bun:test";
import { composePropertyValues } from "../rules/world-property";

describe("composePropertyValues — additive（可加）", () => {
  test("**正确**：多个来源直接相加", () => {
    // 对照 forensic_rules.yaml §八 原文："医学 65% -20% → 有效医学 45%"
    expect(composePropertyValues("additive", [-20, -10])).toBe(-30);
    expect(composePropertyValues("additive", [10, -20, -10])).toBe(-20);
  });

  test("**正确**：单个来源就是它自己（不因为「只有一个值」就走别的分支）", () => {
    expect(composePropertyValues("additive", [-10])).toBe(-10);
  });

  test("**干扰**：包含 0 的来源不能被悄悄丢弃（0 不是「没有这个来源」）", () => {
    // 如果实现把 falsy 值当成"跳过"处理（比如用 values.filter(Boolean)），
    // 0 会被吃掉——这里合计仍然对，但换一种错误实现（比如用 0 当
    // "忽略"的哨兵）就会漏掉这条线索。
    expect(composePropertyValues("additive", [10, 0, -5])).toBe(5);
  });
});

describe("composePropertyValues — extremum（取极值）", () => {
  test("**正确**：多个来源取最大值，不叠加", () => {
    // 对照德鲁伊光环叠加规则："同源光环不叠加（取最高）"
    expect(composePropertyValues("extremum", [10, 30, 20])).toBe(30);
  });

  test("**错误行为的红线**：三个同源光环的强度不能被错误地按 additive 处理", () => {
    // 如果实现偷懒把 extremum 也写成相加，这里会算出 60 而不是 30——
    // 这条断言就是用来拦住"两种 composition 共用一段相加逻辑"的合并错误。
    const result = composePropertyValues("extremum", [10, 30, 20]);
    expect(result).not.toBe(60); // 60 = 10+30+20，是把 extremum 误当 additive 会得到的错误值
    expect(result).toBe(30);
  });

  test("**干扰**：负数也要正确取最大（不是取绝对值最大）", () => {
    expect(composePropertyValues("extremum", [-5, -20, -1])).toBe(-1);
  });
});

describe("composePropertyValues — idempotent（幂等）", () => {
  test("**正确**：多个来源给出相同的值，直接返回该值", () => {
    expect(composePropertyValues("idempotent", [1, 1, 1])).toBe(1);
  });

  test("**错误行为的红线**：多个来源给出不一致的值必须抛错，不能悄悄取其一", () => {
    // 幂等变量表达的是"是否发生"，两个来源给出不同的值说明有一方的
    // 声明本身就是错的——不该静默地取第一个/最后一个糊弄过去。
    expect(() => composePropertyValues("idempotent", [1, 2])).toThrow();
  });

  test("**干扰**：单个来源不该被「多来源不一致」的检查误伤", () => {
    expect(composePropertyValues("idempotent", [5])).toBe(5);
  });
});

describe("composePropertyValues — exclusive（互斥）", () => {
  test("**正确**：唯一来源直接返回", () => {
    expect(composePropertyValues("exclusive", [42])).toBe(42);
  });

  test("**错误行为的红线**：出现第二个来源必须抛错，不能取最后一个/取最大值蒙混过去", () => {
    expect(() => composePropertyValues("exclusive", [1, 2])).toThrow();
  });

  test("**干扰**：两个来源恰好数值相同，也必须抛错——问题在「有几个来源」，不在「值是否一致」", () => {
    // 这条专门区分 exclusive 和 idempotent：idempotent 允许多个来源只要
    // 值一致，exclusive 不允许多个来源，哪怕值凑巧一样。
    expect(() => composePropertyValues("exclusive", [7, 7])).toThrow();
  });
});

describe("composePropertyValues — 干扰：空输入", () => {
  test("**应报**：没有任何来源时抛错，不能返回 0 或 undefined 假装合并成功", () => {
    for (const c of ["idempotent", "additive", "extremum", "exclusive"] as const) {
      expect(() => composePropertyValues(c, [])).toThrow();
    }
  });
});
