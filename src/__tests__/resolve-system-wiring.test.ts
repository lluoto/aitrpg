// 决心系统（暗黑地牢式 resolve check）接上了没有。
//
// 接之前：`checkResolve` / `tickResolve` / `getCommandObeyState` 三个方法
// **各自只出现一次 —— 都是它们自己的定义**。没人调用，连测试都没有。
// 也就是说：
//   · 恐慌与疯狂两种状态永远进不去
//   · 因而 `getCommandObeyState` 的 afflicted / berserk 分支是死代码
//   · 而 `tickResolve` 就算进去了也出不来（没人递减）
//   · `checkResolve` 的 `difficulty` 参数**收了完全不用**，
//     「队友阵亡」和「擦破点皮」掷的是同一个难度
//
// 参数存在却不起作用，比没有这个参数更坏：调用方以为自己调得动。

import { describe, test, expect } from "bun:test";
import { CompanionManager } from "../combat/companion-manager";
import { WorldStateManager } from "../state/world-state-manager";
import type { CompanionConfig } from "../types";

function setup(traits?: { courage?: number; loyalty?: number }) {
  // 不传路径 —— 跟 companion.test.ts 一样用默认库，传 `:memory:xxx` 打不开
  const world = new WorldStateManager();
  const mgr = new CompanionManager();
  const cfg = {
    id: "ally1", name: "老李", type: "npc", archetype: "investigator",
    behavior: "balanced", hp: 10, maxHp: 10, ac: 10,
    traits: { courage: traits?.courage ?? 5, loyalty: traits?.loyalty ?? 5 },
  } as unknown as CompanionConfig;
  mgr.recruit(cfg, world, "tavern");
  return { mgr, world };
}

describe("difficulty 必须真的影响检定", () => {
  // ⚠ 这条我第一版写成了统计判据（各跑 400 次比较崩溃率），**它是闪的**（1/8）。
  //   而且更糟的是：它第一版是靠运气过的 —— 当时 difficulty 的实现
  //   （`resolvePower - (difficulty-50)*0.5`）根本不影响任何结局，
  //   两组本来就是同分布。是变异检验里这条无端变红，才把实现的问题逼出来。
  //
  //   随机量上的差异要么钉住随机数、要么别测。这里钉住。
  test("**错误行为的红线**：同一掷骰，难度不同结果必须不同", () => {
    const real = Math.random;
    try {
      // roll = 80。决心值 146（勇气8×8 + 忠诚8×4 + 士气10×5）：
      //   难度 10  → shift=+20   → 恐慌线 85，80 没到 → 保持镇定
      //   难度 100 → shift=+11.5 → 恐慌线 76.5，80 越线 → 恐慌
      Math.random = () => 0.80;
      const { mgr: easy } = setup({ courage: 8, loyalty: 8 });
      const { mgr: hard } = setup({ courage: 8, loyalty: 8 });
      expect(easy.checkResolve("ally1", 10).state).toBe("normal");
      expect(hard.checkResolve("ally1", 100).state).toBe("afflicted");
    } finally {
      Math.random = real;
    }
  });

  test("**正确**：两头都留活口 —— 再稳的人也可能失手", () => {
    // shift 夹在 ±20，所以极低难度下 berserkAt 最多 105（掷不出），
    // 但恐慌线仍在 85，掷 90 照样崩。一个「决心够高就永不失手」的实现
    // 会让这条红 —— 那种设定下高属性队友的检定就没有意义了。
    const real = Math.random;
    try {
      Math.random = () => 0.90;
      const { mgr } = setup({ courage: 10, loyalty: 10 });
      expect(mgr.checkResolve("ally1", 1).state).not.toBe("normal");
    } finally {
      Math.random = real;
    }
  });

  test("**干扰输入**：不给 difficulty 时用默认值，不炸也不改变原有行为", () => {
    const { mgr } = setup();
    const r = mgr.checkResolve("ally1");
    expect(["normal", "steadfast", "afflicted", "berserk"]).toContain(r.state);
  });

  test("**干扰输入**：不存在的队友返回 normal，不抛", () => {
    const { mgr } = setup();
    expect(mgr.checkResolve("查无此人").state).toBe("normal");
  });
});

describe("恐慌/疯狂会自己恢复", () => {
  test("**错误行为的红线**：tickResolve 必须被回合边界调用，否则永远出不来", () => {
    const { mgr } = setup();
    // 直接把状态推进去（真实路径由士气触发，那条在下面测）
    const st = mgr.getAllStates().get("ally1")!;
    st.resolveState = "afflicted";
    st.resolveTurnsLeft = 2;

    mgr.newRound();
    expect(mgr.getAllStates().get("ally1")!.resolveTurnsLeft).toBe(1);
    mgr.newRound();
    expect(mgr.getAllStates().get("ally1")!.resolveState).toBe("normal");
  });

  test("**正确**：normal 状态不会被 tick 出负数", () => {
    const { mgr } = setup();
    for (let i = 0; i < 5; i++) mgr.newRound();
    const st = mgr.getAllStates().get("ally1")!;
    expect(st.resolveState).toBe("normal");
    expect(st.resolveTurnsLeft).toBe(0);
  });
});

describe("失控的队友不再乖乖听令", () => {
  test("**错误行为的红线**：berserk 时必须拒绝命令", async () => {
    const { mgr, world } = setup();
    mgr.getAllStates().get("ally1")!.resolveState = "berserk";
    let ran = false;
    const ok = await mgr.command("ally1", { action: "attack" } as never, world,
      async () => { ran = true; });
    expect(ok).toBe(false);
    expect(ran).toBe(false);                       // 动作**没有**被执行
    expect(mgr.takeLastRefusal()).toContain("疯狂"); // 而且说得出为什么
  });

  test("**正确**：normal 时照常执行", async () => {
    const { mgr, world } = setup();
    let ran = false;
    const ok = await mgr.command("ally1", { action: "attack" } as never, world,
      async () => { ran = true; });
    expect(ok).toBe(true);
    expect(ran).toBe(true);
    expect(mgr.takeLastRefusal()).toBe("");
  });

  test("**错误行为的红线**：被拒也算行动过 —— 不许同一轮反复下令直到它答应", async () => {
    const { mgr, world } = setup();
    mgr.getAllStates().get("ally1")!.resolveState = "berserk";
    await mgr.command("ally1", { action: "attack" } as never, world, async () => {});
    expect(mgr.hasActed("ally1")).toBe(true);
  });
});

describe("士气跌破阈值会触发决心检定", () => {
  test("**错误行为的红线**：掉进阈值必须掷一次，不能一声不响", () => {
    // `checkResolve` 的注释写着触发条件是「大伤害、低士气阈值、队友阵亡」，
    // 但接之前没有任何地方触发它。
    const { mgr } = setup();
    const r = mgr.adjustMorale("ally1", -7); // 10 → 3，跌破阈值 4
    expect(r.resolve).toBeDefined();
  });

  test("**正确**：没跌破阈值不掷", () => {
    const { mgr } = setup();
    expect(mgr.adjustMorale("ally1", -1).resolve).toBeUndefined(); // 10 → 9
  });

  test("**干扰输入**：加士气不掷 —— 触发条件是往下掉", () => {
    const { mgr } = setup();
    mgr.adjustMorale("ally1", -7);
    expect(mgr.adjustMorale("ally1", +2).resolve).toBeUndefined();
  });

  test("**干扰输入**：已经在阈值下再掉，不重复掷", () => {
    // 否则一路掉血会连掷好几次，每次都可能翻成疯狂。
    const { mgr } = setup();
    mgr.adjustMorale("ally1", -7);           // 跌破，掷一次
    expect(mgr.adjustMorale("ally1", -1).resolve).toBeUndefined();
  });
});
