// 致命伤的致残描写要真的播出来。
//
// 起因：你问「根据伤害描述效果有没有出来」。答案是**从来没出来过**。
//
// `getDisability()` 里那几句描写（「右臂遭受毁灭性打击，皮开肉绽，完全无法用力，
// 武器从无力手指中滑落」）写好了却**没有任何调用方** ——
// 在「死导出清零」那轮被当作死代码删掉了（全仓确实无人引用）。
// 也就是说从项目开始到现在，玩家一次都没见过这些话：
// 致命伤与普通重伤在播报上长得一模一样，只有 HP 数字不同。
//
// 现在接在 `play/combat.ts` 的伤害结算上。文字从 git 历史取回，一字未改。

import { describe, test, expect } from "bun:test";
import { getDisability } from "../combat/wound-effects";
import type { HitLocation } from "../combat/wound-effects";

const LOCS: HitLocation[] = ["右腿", "左腿", "腹部", "胸部", "右臂", "左臂", "头部"];

describe("致残只在致命伤时给", () => {
  test("**错误行为的红线**：deep 及以下不得致残", () => {
    expect(LOCS.length).toBeGreaterThan(0); // 空表会让下面的循环假绿
    for (const loc of LOCS) {
      expect(getDisability(loc, "deep")).toBeNull();
      expect(getDisability(loc, "flesh")).toBeNull();
      expect(getDisability(loc, "scratch")).toBeNull();
    }
  });

  test("**正确**：grievous 时每个部位都有描写，一个都不能漏", () => {
    for (const loc of LOCS) {
      const d = getDisability(loc, "grievous");
      expect(d).not.toBeNull();
      expect(d!.impairment.length).toBeGreaterThan(10); // 不能是占位空串
      expect(d!.location).toBe(loc);
    }
  });
});

describe("致残的后果分得开", () => {
  test("**正确**：伤臂是脱手，伤腿是倒地 —— 两种后果不该混", () => {
    expect(getDisability("右臂", "grievous")!.disarmed).toBe(true);
    expect(getDisability("右臂", "grievous")!.knockdown).toBe(false);
    expect(getDisability("右腿", "grievous")!.knockdown).toBe(true);
    expect(getDisability("右腿", "grievous")!.disarmed).toBe(false);
  });

  test("**正确**：躯干与头部都是倒地", () => {
    for (const loc of ["腹部", "胸部", "头部"] as HitLocation[]) {
      expect(getDisability(loc, "grievous")!.knockdown).toBe(true);
    }
  });

  test("**干扰输入**：左右两侧的描写要分得开，不能都写成「右」", () => {
    const l = getDisability("左臂", "grievous")!.impairment;
    const r = getDisability("右臂", "grievous")!.impairment;
    expect(l).toContain("左臂");
    expect(r).toContain("右臂");
    expect(l).not.toBe(r);
  });
});
