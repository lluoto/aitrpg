// 尺度门：推广 grail-engine.ts 的 TierSuppressionResult 到尺度轴
// （personal/local/regional/world）。跨尺度在规则层直接判定，不掷骰；
// 同尺度才掷骰，永远不做乘法——PLAN.md:745-749 对位阶压制的描述，
// 原样搬到尺度轴。
//
// ⚠ 尺度 ≠ 位阶：docs/world-property-falsification.md §发现二证明了
// 这是两个独立的轴（传奇阶的终极剑技可以是纯局部效果，非最高位阶的
// 存在也可能有区域级的背景效应）。这里只测尺度门本身，不牵涉 GrailRank。

import { describe, test, expect } from "bun:test";
import { calcScaleSuppression } from "../rules/world-property";

describe("calcScaleSuppression — 同尺度：不压制，交给正常掷骰", () => {
  test("**正确**：personal vs personal", () => {
    const r = calcScaleSuppression("personal", "personal");
    expect(r.applicable).toBe(false);
    expect(r.suppressed).toBe(false);
    expect(r.outcome).toBeUndefined();
  });

  test("**正确**：world vs world——最高档同级也不压制", () => {
    const r = calcScaleSuppression("world", "world");
    expect(r.applicable).toBe(false);
    expect(r.suppressed).toBe(false);
  });
});

describe("calcScaleSuppression — 跨尺度：规则层直接判定，不掷骰", () => {
  test("**正确**：更宏观的一方对更局部的一方——碾压生效", () => {
    const r = calcScaleSuppression("world", "personal");
    expect(r.applicable).toBe(true);
    expect(r.suppressed).toBe(true);
    expect(r.outcome).toBe("actor_dominates");
    expect(r.scaleDifference).toBe(3); // world(3) - personal(0)
  });

  test("**正确**：更局部的一方对更宏观的一方——无效，不构成作用", () => {
    const r = calcScaleSuppression("personal", "world");
    expect(r.applicable).toBe(true);
    expect(r.suppressed).toBe(true);
    expect(r.outcome).toBe("actor_futile");
    expect(r.scaleDifference).toBe(-3);
  });

  test("**错误行为的红线**：跨尺度不能落到「同尺度掷骰」分支——applicable 必须是 true", () => {
    // 如果实现把 applicable 判断写反（比如 diff !== 0 时误判成
    // applicable=false），跨尺度的行动会被错误地送去掷骰，
    // 相当于让局部角色对世界级现象"碰运气"——这正是位阶压制要堵的洞，
    // 换成尺度轴同样要堵。
    const r = calcScaleSuppression("local", "regional");
    expect(r.applicable).toBe(true);
  });
});

describe("calcScaleSuppression — 干扰：相邻档位与非相邻档位都要算对差值", () => {
  test("相邻档位（local vs personal）差值是 1，不是被四舍五入成 0 或夸大成更大的数", () => {
    const r = calcScaleSuppression("local", "personal");
    expect(r.scaleDifference).toBe(1);
    expect(r.outcome).toBe("actor_dominates");
  });

  test("跨两档（regional vs personal）差值是 2，结果与跨一档（local vs personal）方向一致但幅度不同", () => {
    const oneStep = calcScaleSuppression("local", "personal");
    const twoStep = calcScaleSuppression("regional", "personal");
    expect(twoStep.scaleDifference).toBeGreaterThan(oneStep.scaleDifference);
    expect(twoStep.outcome).toBe(oneStep.outcome); // 方向一致，都是 actor_dominates
  });

  test("干扰：不存在的尺度名要显式报错，不能静默当成某个已知档位", () => {
    expect(() => calcScaleSuppression("galactic" as never, "personal")).toThrow();
  });
});
