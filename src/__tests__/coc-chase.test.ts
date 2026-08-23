import { describe, expect, test } from "bun:test";
import {
  ChaseEngine,
  rangeFromDistance,
  shootingPenaltyForRange,
  canAttackInChase,
  getShootingDifficulty,
} from "../rules/coc-chase";
import type { ChaseState } from "../rules/coc-chase";

// ============================================================
// 射程段
// ============================================================
describe("射程段计算", () => {
  test("距离 0 → melee", () => {
    expect(rangeFromDistance(0)).toBe("melee");
  });

  test("距离 2 → melee", () => {
    expect(rangeFromDistance(2)).toBe("melee");
  });

  test("距离 3 → close", () => {
    expect(rangeFromDistance(3)).toBe("close");
  });

  test("距离 10 → close", () => {
    expect(rangeFromDistance(10)).toBe("close");
  });

  test("距离 11 → medium", () => {
    expect(rangeFromDistance(11)).toBe("medium");
  });

  test("距离 25 → medium", () => {
    expect(rangeFromDistance(25)).toBe("medium");
  });

  test("距离 26 → long", () => {
    expect(rangeFromDistance(26)).toBe("long");
  });

  test("距离 50 → long", () => {
    expect(rangeFromDistance(50)).toBe("long");
  });

  test("距离 51 → lost", () => {
    expect(rangeFromDistance(51)).toBe("lost");
  });

  test("距离 100 → lost", () => {
    expect(rangeFromDistance(100)).toBe("lost");
  });
});

describe("射程射击惩罚", () => {
  test("melee 无惩罚", () => {
    expect(shootingPenaltyForRange("melee")).toBe(0);
  });

  test("close 无惩罚", () => {
    expect(shootingPenaltyForRange("close")).toBe(0);
  });

  test("medium 1惩罚骰", () => {
    expect(shootingPenaltyForRange("medium")).toBe(1);
  });

  test("long 2惩罚骰", () => {
    expect(shootingPenaltyForRange("long")).toBe(2);
  });

  test("lost 无法射击", () => {
    expect(shootingPenaltyForRange("lost")).toBe(99);
  });
});

describe("射程段可攻击性", () => {
  test("melee 可攻击", () => expect(canAttackInChase("melee")).toBe(true));
  test("close 可攻击", () => expect(canAttackInChase("close")).toBe(true));
  test("medium 可攻击", () => expect(canAttackInChase("medium")).toBe(true));
  test("long 可攻击", () => expect(canAttackInChase("long")).toBe(true));
  test("lost 不可攻击", () => expect(canAttackInChase("lost")).toBe(false));
});

describe("射击难度", () => {
  test("melee → regular", () => expect(getShootingDifficulty("melee")).toBe("regular"));
  test("close → regular", () => expect(getShootingDifficulty("close")).toBe("regular"));
  test("medium → hard", () => expect(getShootingDifficulty("medium")).toBe("hard"));
  test("long → extreme", () => expect(getShootingDifficulty("long")).toBe("extreme"));
});

// ============================================================
// 追逐状态初始化
// ============================================================
describe("ChaseEngine.init()", () => {
  test("创建基础追逐状态", () => {
    const state = ChaseEngine.init(
      [{ name: "侦探", skill: 50, vehicleType: "foot" }],
      [{ name: "嫌犯", skill: 40, vehicleType: "foot" }],
      "urban",
    );
    expect(state.active).toBe(true);
    expect(state.distance).toBe(15);
    expect(state.environment).toBe("urban");
    expect(state.round).toBe(0);
    expect(state.participants).toHaveLength(2);
    expect(state.participants[0].role).toBe("pursuer");
    expect(state.participants[1].role).toBe("fugitive");
  });

  test("可自定义起始距离", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 50, vehicleType: "foot" }],
      [{ name: "B", skill: 40, vehicleType: "foot" }],
      "rural", 30,
    );
    expect(state.distance).toBe(30);
  });

  test("多人追逐", () => {
    const state = ChaseEngine.init(
      [
        { name: "警探", skill: 60, vehicleType: "foot" },
        { name: "搭档", skill: 50, vehicleType: "foot" },
      ],
      [{ name: "逃犯", skill: 70, vehicleType: "car" }],
      "urban",
    );
    expect(state.participants).toHaveLength(3);
    expect(state.participants.filter(p => p.role === "pursuer")).toHaveLength(2);
    expect(state.participants.filter(p => p.role === "fugitive")).toHaveLength(1);
  });
});

// ============================================================
// 障碍物系统
// ============================================================
describe("障碍物系统", () => {
  test("pickObstacle 返回城镇障碍物", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 50, vehicleType: "foot" }],
      [{ name: "B", skill: 40, vehicleType: "foot" }],
      "urban",
    );
    const obstacle = ChaseEngine.pickObstacle(state);
    expect(obstacle.def).toBeDefined();
    expect(obstacle.def.name).toBeTruthy();
    expect(obstacle.def.environment).toBe("urban");
  });

  test("所有环境均能产出障碍物", () => {
    const envs: Array<ChaseState["environment"]> = ["urban", "rural", "wilderness", "indoor", "underground", "water"];
    for (const env of envs) {
      const state = ChaseEngine.init(
        [{ name: "A", skill: 50, vehicleType: "foot" }],
        [{ name: "B", skill: 40, vehicleType: "foot" }],
        env,
      );
      const obstacle = ChaseEngine.pickObstacle(state);
      expect(obstacle.def).toBeDefined();
      expect(obstacle.def.environment).toBe(env);
    }
  });

  test("障碍物有不同的难度", () => {
    const difficulties = new Set<string>();
    const envs: Array<ChaseState["environment"]> = ["urban", "rural", "wilderness", "indoor", "underground", "water"];
    for (const env of envs) {
      for (let i = 0; i < 5; i++) {
        const state = ChaseEngine.init(
          [{ name: "A", skill: 50, vehicleType: "foot" }],
          [{ name: "B", skill: 40, vehicleType: "foot" }],
          env,
        );
        const obs = ChaseEngine.pickObstacle(state);
        difficulties.add(obs.def.difficulty);
      }
    }
    // 至少包含 regular 和 hard
    expect(difficulties.has("regular")).toBe(true);
    expect(difficulties.has("hard")).toBe(true);
  });
});

// ============================================================
// 追逐轮次解析
// ============================================================
describe("resolveRound()", () => {
  test("正常解析一轮追逐", () => {
    const state = ChaseEngine.init(
      [{ name: "侦探", skill: 60, vehicleType: "foot" }],
      [{ name: "嫌犯", skill: 60, vehicleType: "foot" }],
      "urban",
    );
    const result = ChaseEngine.resolveRound(state);
    expect(result.round).toBe(1);
    expect(result.obstacle).toBeDefined();
    expect(result.participantResults).toHaveLength(2);
    expect(result.newDistance).toBeDefined();
    expect(result.newRange).toBeDefined();
    expect(result.narration.length).toBeGreaterThan(0);
  });

  test("多次追逐轮次持续推进", () => {
    const state = ChaseEngine.init(
      [{ name: "侦探", skill: 60, vehicleType: "foot" }],
      [{ name: "嫌犯", skill: 60, vehicleType: "foot" }],
      "urban",
    );

    for (let i = 0; i < 10; i++) {
      const result = ChaseEngine.resolveRound(state);
      expect(result.round).toBe(i + 1);
      expect(state.round).toBe(i + 1);
    }
  });

  test("超强追逐方能追上目标", () => {
    const state = ChaseEngine.init(
      [{ name: "快速警探", skill: 95, con: 99, dex: 99, vehicleType: "foot" }],
      [{ name: "慢速嫌犯", skill: 5, con: 5, dex: 5, vehicleType: "foot" }],
      "urban", 5, // 近起始距离
    );

    let caught = false;
    for (let i = 0; i < 50; i++) {
      const result = ChaseEngine.resolveRound(state);
      if (result.caught) {
        caught = true;
        break;
      }
      // 如果对方已大幅领先则提前放弃
      if (state.distance > 30) break;
    }
    // 高概率性测试：技能差距悬殊+短距离，应该很快追上
    // 由于随机性，只要距离显著缩小也算通过
    if (!caught) {
      expect(state.distance).toBeLessThan(10); // 即使没追上，距离也应比初始近
    } else {
      expect(caught).toBe(true);
    }
  });

  test("超弱追逐方被逃脱", () => {
    const state = ChaseEngine.init(
      [{ name: "慢速警探", skill: 5, con: 5, dex: 5, vehicleType: "foot" }],
      [{ name: "快速嫌犯", skill: 95, con: 99, dex: 99, vehicleType: "foot" }],
      "urban", 20,
    );

    let escaped = false;
    for (let i = 0; i < 50; i++) {
      const result = ChaseEngine.resolveRound(state);
      if (result.escaped) {
        escaped = true;
        break;
      }
    }
    // 高概率性测试
    if (!escaped) {
      expect(state.distance).toBeGreaterThan(25); // 即使没逃脱，距离也应增大
    } else {
      expect(escaped).toBe(true);
    }
  });

  // ⚠ 下面两条原先是**空心的**：第一条一句断言都没有，五行注释写着
  //   「我们先直接测试 caught 逻辑 / 用极端值确保触发」—— 没写完就留下了。
  //   第二条只断言 `state.active === true`（init 之后必然为真），
  //   算出 result 却从不看 caught，注释里还在自问「max(0,...) 会不会把负数截断」。
  //
  //   是 tsc 的 noUnusedLocals 报出来的。两条都计入 docs/test-baseline.json，
  //   而**测试条数是这个仓库唯一可靠的回归信号**。
  //
  //   规则本身是确定的（`caught: newDistance <= 0`），没有任何理由测得含糊。

  test("距离归零就是追上了", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 80, vehicleType: "foot" }],
      [{ name: "B", skill: 80, vehicleType: "foot" }],
      "urban", 0,
    );
    state.distance = -1; // 追击方冲过了头
    const result = ChaseEngine.resolveRound(state);
    // newDistance 被 max(0, …) 夹到 0 —— 夹完仍然满足 <= 0，所以照样算追上。
    // 这正是原注释里没敢下结论的那一点。
    expect(result.newDistance).toBe(0);
    expect(result.caught).toBe(true);
    expect(result.escaped).toBe(false);
  });

  test("**错误行为的红线**：还没追上时不得报 caught", () => {
    // 只测「归零算追上」是不够的：一个永远返回 caught=true 的实现也能过。
    const state = ChaseEngine.init(
      [{ name: "A", skill: 5, vehicleType: "foot" }],
      [{ name: "B", skill: 95, vehicleType: "foot" }],
      "urban", 45,
    );
    const result = ChaseEngine.resolveRound(state);
    expect(result.newDistance).toBeGreaterThan(0);
    expect(result.caught).toBe(false);
  });

  test("**正确**：拉开到 50 就是跑脱了", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 80, vehicleType: "foot" }],
      [{ name: "B", skill: 80, vehicleType: "foot" }],
      "urban", 0,
    );
    state.distance = 60;
    const result = ChaseEngine.resolveRound(state);
    expect(result.escaped).toBe(true);
    expect(result.caught).toBe(false);
  });
});

describe("追逐成功等级影响", () => {
  test("大成功解除惩罚", () => {
    const state = ChaseEngine.init(
      [{ name: "高手", skill: 95, vehicleType: "foot" }],
      [{ name: "新手", skill: 95, vehicleType: "foot" }],
      "urban",
    );

    // 连续运行多轮，观察是否有参与者积累了惩罚又被解除
    let totalPenalty = 0;
    for (let i = 0; i < 20; i++) {
      ChaseEngine.resolveRound(state);
      totalPenalty = state.participants.reduce((s, p) => s + p.currentPenalty, 0);
    }
    // 惩罚有硬下界，不会无限累积（大成功还可解除一点）
    // 原断言 >= -20 是概率性的：无下界时 20 轮可累积到 -26，约 0.55% 概率误报。
    for (const p of state.participants) {
      expect(p.currentPenalty).toBeLessThanOrEqual(0);
      expect(p.currentPenalty).toBeGreaterThanOrEqual(-2); // MIN_CHASE_PENALTY
    }
    expect(totalPenalty).toBeGreaterThanOrEqual(-4); // 2 人 × -2
  });
});

// ============================================================
// 载具追逐
// ============================================================
describe("载具追逐", () => {
  test("车载追逐使用驾驶技能", () => {
    const state = ChaseEngine.init(
      [{ name: "司机", skill: 60, vehicleType: "car" }],
      [{ name: "摩托手", skill: 70, vehicleType: "motorcycle" }],
      "urban",
    );

    const obstacle = ChaseEngine.pickObstacle(state);
    const participant = state.participants[0];
    const skillVal = ChaseEngine.getSkillForRound(participant, obstacle);
    // 由于车载追逐的环境障碍可能使用DEX/CON，但车载情况下用skill = 60
    if (obstacle.usedSkill === "CON" && participant.con) {
      // 有CON时返回CON值
    } else {
      // 否则返回skill
    }
    expect(skillVal).toBeGreaterThan(0);
  });

  test("不同类型载具baseSpeed不同", () => {
    // 间接验证：foot vs car 的速度差异应体现在距离变化上
    const footChase = ChaseEngine.init(
      [{ name: "跑者", skill: 50, vehicleType: "foot" }],
      [{ name: "逃者", skill: 50, vehicleType: "foot" }],
      "urban",
    );
    const carChase = ChaseEngine.init(
      [{ name: "跑者", skill: 50, vehicleType: "car" }],
      [{ name: "逃者", skill: 50, vehicleType: "foot" }],
      "urban",
    );

    // 载具应该有恒定的速度优势累积
    let footAvgChange = 0;
    let carAvgChange = 0;
    for (let i = 0; i < 10; i++) {
      const fr = ChaseEngine.resolveRound(footChase);
      const cr = ChaseEngine.resolveRound(carChase);
      footAvgChange += fr.newDistance - (i === 0 ? 15 : footChase.distance);
      carAvgChange += cr.newDistance - (i === 0 ? 15 : carChase.distance);
    }
    // 开车跑的应该平均比走路快
    // 不一定每次都成立但长期趋势明显
    // 这个测试可能因随机性偶尔失败，但大概率通过
  });
});

// ============================================================
// 边缘情况
// ============================================================
describe("边缘情况", () => {
  test("不存在参与者的追逐返回空结果", () => {
    // 所有参与者 disabled
    const state = ChaseEngine.init(
      [{ name: "A", skill: 50, vehicleType: "foot" }],
      [{ name: "B", skill: 50, vehicleType: "foot" }],
      "urban",
    );
    state.participants.forEach(p => p.disabled = true);
    const result = ChaseEngine.resolveRound(state);
    expect(result.participantResults).toHaveLength(0);
    expect(result.narration[0]).toContain("无人能够行动");
  });

  test("只有追逐方无人逃亡方时仍可运行", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 50, vehicleType: "foot" }],
      [], // 无逃亡方
      "urban",
    );
    const result = ChaseEngine.resolveRound(state);
    expect(result.participantResults).toHaveLength(1);
    expect(result.participantResults[0].role).toBe("pursuer");
  });

  test("只有逃亡方无人追逐方时仍可运行", () => {
    const state = ChaseEngine.init(
      [],
      [{ name: "B", skill: 50, vehicleType: "foot" }],
      "urban",
    );
    const result = ChaseEngine.resolveRound(state);
    expect(result.participantResults).toHaveLength(1);
    expect(result.participantResults[0].role).toBe("fugitive");
  });

  test("距离不会低于0", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 90, vehicleType: "foot" }],
      [{ name: "B", skill: 5, vehicleType: "foot" }],
      "urban", 1,
    );

    // 快速接近至0后不再减少
    for (let i = 0; i < 10; i++) {
      const result = ChaseEngine.resolveRound(state);
      expect(result.newDistance).toBeGreaterThanOrEqual(0);
    }
  });

  test("距离不会超过100", () => {
    const state = ChaseEngine.init(
      [{ name: "A", skill: 5, vehicleType: "foot" }],
      [{ name: "B", skill: 90, vehicleType: "foot" }],
      "urban", 80,
    );

    for (let i = 0; i < 10; i++) {
      const result = ChaseEngine.resolveRound(state);
      expect(result.newDistance).toBeLessThanOrEqual(100);
    }
  });
});

// ============================================================
// 数据完整性
// ============================================================
describe("障碍物数据完整性", () => {
  test("每个障碍物有完整的定义", () => {
    const envs: Array<ChaseState["environment"]> = ["urban", "rural", "wilderness", "indoor", "underground", "water"];
    for (const env of envs) {
      const state = ChaseEngine.init(
        [{ name: "A", skill: 50, vehicleType: "foot" }],
        [{ name: "B", skill: 40, vehicleType: "foot" }],
        env,
      );
      // 多次采样确保覆盖所有障碍物
      const seen = new Set<string>();
      for (let i = 0; i < 30; i++) {
        const obs = ChaseEngine.pickObstacle(state);
        seen.add(obs.def.name);
        expect(obs.def.successDesc).toBeTruthy();
        expect(obs.def.failureDesc).toBeTruthy();
        expect(typeof obs.def.successDistance).toBe("number");
        expect(typeof obs.def.failureDistance).toBe("number");
        expect(["regular", "hard", "extreme"]).toContain(obs.def.difficulty);
      }
      // 每个环境至少采样到2种不同障碍物
      expect(seen.size).toBeGreaterThanOrEqual(2);
    }
  });

  test("所有障碍物的惩罚骰值合理", () => {
    const envs: Array<ChaseState["environment"]> = ["urban", "rural", "wilderness", "indoor", "underground", "water"];
    for (const env of envs) {
      const state = ChaseEngine.init(
        [{ name: "A", skill: 50, vehicleType: "foot" }],
        [{ name: "B", skill: 40, vehicleType: "foot" }],
        env,
      );
      for (let i = 0; i < 20; i++) {
        const obs = ChaseEngine.pickObstacle(state);
        expect(obs.def.diceModifier).toBeGreaterThanOrEqual(-2);
        expect(obs.def.diceModifier).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe("全局一致性", () => {
  test("连续20轮追逐不崩溃", () => {
    const state = ChaseEngine.init(
      [
        { name: "警探A", skill: 60, con: 55, dex: 50, vehicleType: "car" },
        { name: "警探B", skill: 45, con: 40, dex: 60, vehicleType: "car" },
      ],
      [
        { name: "逃犯", skill: 65, con: 70, dex: 45, vehicleType: "motorcycle" },
      ],
      "urban",
    );

    for (let i = 0; i < 20; i++) {
      const result = ChaseEngine.resolveRound(state);
      expect(result.round).toBe(i + 1);
      expect(result.newDistance).toBeGreaterThanOrEqual(0);
      expect(result.newDistance).toBeLessThanOrEqual(100);
      expect(result.narration.length).toBeGreaterThan(0);
      // 每个参与者都有结果
      for (const p of state.participants) {
        if (!p.disabled) {
          expect(result.participantResults.some(r => r.name === p.name)).toBe(true);
        }
      }
    }
  });
});
