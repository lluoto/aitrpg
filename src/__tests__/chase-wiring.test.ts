// 追逐系统接上了没有。
//
// `src/rules/coc-chase.ts` 731 行、CoC 7e 整套追逐规则，写完之后
// **在依赖图上只有测试引用** —— 玩起来根本没有追逐。战斗里敌人受伤过半会逃走，
// 逃走那一支只印一句「撞破通风管道独自逃走了」就完了。
//
// 规则在、缺陷也在，只是两者从没接上。这个文件测的是接口层（`play/chase.ts`）。

import { describe, test, expect } from "bun:test";
import { runChase, environmentFromScene, type Chaser } from "../play/chase";
import { rangeFromDistance, canAttackInChase, shootingPenaltyForRange } from "../rules/coc-chase";

const FAST: Chaser[] = [{ name: "甲", con: 80, dex: 80, skill: 90 }];
const SLOW: Chaser[] = [{ name: "乙", con: 15, dex: 15, skill: 10 }];

describe("追逐一定会收场", () => {
  test("**错误行为的红线**：不得跑不完 —— 主循环挂死比任何结局都糟", () => {
    // maxRounds 是硬闸。规则实现要是不收敛，这里必须以 timeout 收场而不是转圈。
    for (let i = 0; i < 40; i++) {
      const r = runChase(FAST, { name: "怪物", con: 50, dex: 50 }, "urban");
      expect(r.rounds).toBeGreaterThan(0);
      expect(r.rounds).toBeLessThanOrEqual(8);
      expect(r.caught || r.escaped).toBe(true);
    }
  });

  test("**干扰输入**：没人能追时立刻收场，不算一次追逐", () => {
    const r = runChase([], { name: "怪物", con: 50, dex: 50 }, "urban");
    expect(r).toEqual({ caught: false, escaped: true, rounds: 0 });
  });

  test("**正确**：追不上和追上都出现得了 —— 结果不是写死的", () => {
    // 一个永远返回同一个结局的「追逐」等于没接。两端各跑一批看分布。
    const fast = Array.from({ length: 30 }, () =>
      runChase(FAST, { name: "慢怪", con: 10, dex: 10 }, "urban", 6).caught);
    const slow = Array.from({ length: 30 }, () =>
      runChase(SLOW, { name: "快怪", con: 90, dex: 90 }, "urban", 40).caught);
    expect(fast.some(Boolean)).toBe(true);
    expect(slow.some((c) => !c)).toBe(true);
  });
});

describe("环境识别", () => {
  test("**正确**：认得出的几类", () => {
    expect(environmentFromScene("下水道", "")).toBe("underground");
    expect(environmentFromScene("普瑞米尔的谷仓", "昏暗的仓库内部")).toBe("indoor");
    expect(environmentFromScene("密林深处", "")).toBe("wilderness");
    expect(environmentFromScene("码头", "河水拍打着船身")).toBe("water");
    expect(environmentFromScene("农场外围", "")).toBe("rural");
  });

  test("**错误行为的红线**：认不出来必须回退，不得靠关键词硬凑", () => {
    // 障碍表按环境查。猜错了会把「下水道」的障碍发到麦田里，
    // 那比回退到最常见的一种更糟。
    expect(environmentFromScene("某个说不清的地方", "")).toBe("urban");
    expect(environmentFromScene("", "")).toBe("urban");
  });
});

describe("射程段规则本身", () => {
  test("**正确**：距离 → 射程段", () => {
    expect(rangeFromDistance(0)).toBe("melee");
    expect(rangeFromDistance(2)).toBe("melee");
    expect(rangeFromDistance(3)).toBe("close");
    expect(rangeFromDistance(26)).toBe("long");
    expect(rangeFromDistance(999)).toBe("lost");
  });

  test("**正确**：脱离之后打不着，惩罚随距离变大", () => {
    expect(canAttackInChase("melee")).toBe(true);
    expect(canAttackInChase("lost")).toBe(false);
    // 惩罚骰是「越远越多」，数值大 = 更难
    expect(shootingPenaltyForRange("long")).toBeGreaterThanOrEqual(shootingPenaltyForRange("close"));
  });
});

describe("叙述与机制不得相反", () => {
  test("**错误行为的红线**：逃亡方成功不得说成「缩短了距离」", () => {
    // 障碍表里的文案是**以追击方视角**写的（「你……成功缩短了距离」），
    // 原先原样套给逃亡方，于是印出来是
    //   `逃亡方【快怪】成功：你手脚并用地翻过市场摊位，成功缩短了距离`
    // 方向与机制相反（逃亡方成功时距离是增大的），人称也错（对 NPC 说「你」）。
    //
    // 这毛病一直没被发现，因为整套追逐规则从来没在游戏里跑过。
    const lines: string[] = [];
    const realLog = console.log;
    for (let i = 0; i < 60; i++) {
      runChase(SLOW, { name: "快怪", con: 90, dex: 90 }, "urban", 30);
    }
    console.log = realLog;
    // 直接查规则层：跑一批回合，把逃亡方那几行捞出来
    const { ChaseEngine } = require("../rules/coc-chase");
    const st = ChaseEngine.init(
      [{ name: "甲", con: 50, dex: 50, skill: 50, vehicleType: "foot" }],
      [{ name: "怪", con: 50, dex: 50, skill: 50, vehicleType: "foot" }],
      "urban", 15,
    );
    for (let i = 0; i < 40; i++) {
      const r = ChaseEngine.resolveRound(st);
      lines.push(...r.narration);
      if (r.caught || r.escaped) break;
    }
    const fugitiveLines = lines.filter((l) => l.startsWith("逃亡方"));
    expect(fugitiveLines.length).toBeGreaterThan(0); // 没捞到就是这条判据白测了
    for (const l of fugitiveLines) {
      if (l.includes("成功")) expect(l).not.toContain("缩短");
      expect(l).not.toContain("你");
    }
  });

  test("**正确**：追击方仍然用障碍表原文，没被一刀切掉", () => {
    const { ChaseEngine } = require("../rules/coc-chase");
    const st = ChaseEngine.init(
      [{ name: "甲", con: 90, dex: 90, skill: 95, vehicleType: "foot" }],
      [{ name: "怪", con: 10, dex: 10, skill: 10, vehicleType: "foot" }],
      "urban", 15,
    );
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = ChaseEngine.resolveRound(st);
      lines.push(...r.narration);
      if (r.caught || r.escaped) break;
    }
    const pursuerLines = lines.filter((l) => l.startsWith("追击方"));
    expect(pursuerLines.length).toBeGreaterThan(0);
    // 障碍表的文案是第二人称的，追击方就是玩家，保留是对的
    expect(pursuerLines.some((l) => l.includes("你"))).toBe(true);
  });
});
