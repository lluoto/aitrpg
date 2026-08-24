// 判据校准：「Boss 是不是真的还手」。
//
// 上一版：`inCombat.filter(l => /【格斗】/.test(l)).length`，然后
// `swings === 0 ? 报警 : 通过`。三个洞各配一组测试：
//   · 不验攻击者 → 玩家有个叫「格斗」的技能就能让判据变绿
//   · 认死技能名 → 敌人技能改叫「触手」就一次都不认（漏报）
//   · 跨局求和   → 10 局里 1 局打过就算「会还手了」

import { describe, test, expect } from "bun:test";
import { reduceCombat, judgeCombat } from "../diagnostics/combat";
import type { PlayEvent } from "../play/events";

const start = (enemy = "米戈"): PlayEvent => ({ type: "combat-start", enemy });
const round = (round: number, enemy = "米戈"): PlayEvent => ({ type: "combat-round", enemy, round });
const end = (result: "defeated" | "fled" | "lost", enemy = "米戈"): PlayEvent =>
  ({ type: "combat-end", enemy, result });

const swing = (
  target: string,
  outcome: "miss" | "dodged" | "hit" = "hit",
  damage = 4,
  enemy = "米戈",
): PlayEvent => ({ type: "enemy-attack", enemy, target, outcome, damage });

const chk = (
  actor: string, skill: string,
  o: Partial<Extract<PlayEvent, { type: "check" }>> = {},
): PlayEvent => ({
  type: "check", actor, actorKind: "pc", skill, skillValue: 50,
  envPenalty: 0, woundPenalty: 0, totalPenalty: 0, ignoreWound: false,
  woundAware: true, roll: 40, success: true, level: "regular", ...o,
});

/** 调查员在战斗里攻击一次 —— 由专门的事件表示，不从技能名反推 */
const pcAttack = (actor: string, skill = "格斗(肉搏)", success = true): PlayEvent =>
  ({ type: "pc-attack", actor, skill, success, damage: success ? 4 : 0 });

const dmg = (who: string, amount: number): PlayEvent =>
  ({ type: "damage", who, from: 12, to: 12 - amount, maxHp: 12, amount, severity: "flesh" });

describe("敌人还手 — 攻击者身份必须验证", () => {
  test("**正确输入**：真有 enemy-attack 事件 → 算敌人还手", () => {
    const r = reduceCombat([start(), round(1), swing("李默"), end("defeated")]);
    const v = judgeCombat([r]);
    expect(v.fights).toBe(1);
    expect(v.enemySwings).toBe(1);
    expect(v.silentFights).toBe(0);
  });

  test("**错误输入**：整场只有玩家掷骰、敌人零动作 → 判「这一局没还手」", () => {
    const r = reduceCombat([start(), round(1), pcAttack("李默"), round(2), pcAttack("周舒"), end("defeated")]);
    const v = judgeCombat([r]);
    expect(v.enemySwings).toBe(0);
    expect(v.silentFights).toBe(1);
  });

  test("**干扰输入**：玩家用了一个正好叫「格斗」的技能 → 不得算成敌人还手", () => {
    // 上一版的 `/【格斗】/` 在这里直接变绿。
    const r = reduceCombat([start(), round(1), pcAttack("李默", "格斗"), end("lost")]);
    const v = judgeCombat([r]);
    expect(v.enemySwings).toBe(0);
    expect(v.silentFights).toBe(1);
    expect(v.pcAttacks).toBe(1); // 它是玩家攻击，归到玩家那栏
  });

  test("**干扰输入**：玩家的闪避/体质检定不算攻击", () => {
    // 闪避与重伤体质都走 `check()`，与攻击同为 `actorKind:"pc"`。
    // 靠 `woundAware` 之类的实现细节区分会在下一次接线时失效。
    const r = reduceCombat([
      start(), round(1),
      swing("李默", "dodged"),
      chk("李默", "闪避"),
      chk("李默", "体质（重伤）", { ignoreWound: true }),
      end("fled"),
    ]);
    expect(judgeCombat([r]).pcAttacks).toBe(0);
  });

  test("干扰输入：敌人自己的检定事件不重复计数（还手次数只由 enemy-attack 决定）", () => {
    const r = reduceCombat([
      start(), round(1),
      chk("米戈", "格斗", { actorKind: "enemy" }),
      swing("李默"),
      end("fled"),
    ]);
    expect(judgeCombat([r]).enemySwings).toBe(1);
  });

  test("敌人技能改名为「触手」/「格斗(钳肢)」→ 仍然认得出（不靠技能名）", () => {
    const skills = ["触手", "格斗(钳肢)", "钳肢横扫"];
    expect(skills.length).toBeGreaterThan(0); // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    for (const skill of skills) {
      const r = reduceCombat([
        start(), round(1),
        chk("米戈", skill, { actorKind: "enemy" }),
        swing("李默"),
        end("defeated"),
      ]);
      expect(judgeCombat([r]).enemySwings).toBe(1);
    }
  });

  test("攻击者身份对不上（事件里的 enemy 与本场战斗不符）→ 计进 misattributed", () => {
    const r = reduceCombat([start("米戈"), round(1), swing("李默", "hit", 3, "别的东西"), end("lost")]);
    expect(r.misattributed).toBe(1);
  });
});

describe("按局判定 — 不许跨局求和掩盖", () => {
  const fighting = reduceCombat([start(), round(1), swing("李默"), end("defeated")]);
  const silent = reduceCombat([start(), round(1), pcAttack("李默"), end("lost")]);

  test("**错误输入**：10 局里 1 局还手、9 局发呆 → 必须报出 9 局静默", () => {
    const v = judgeCombat([fighting, ...Array(9).fill(silent)]);
    expect(v.fights).toBe(10);
    expect(v.silentFights).toBe(9);
    expect(v.enemySwings).toBe(1); // 总数看着「>0」，但判据不看总数
  });

  test("正确输入：每局都还手 → 静默局为 0", () => {
    const v = judgeCombat(Array(10).fill(fighting));
    expect(v.silentFights).toBe(0);
  });

  test("干扰输入：没发生战斗的局不进分母", () => {
    const noFight = reduceCombat([{ type: "scene-enter", sceneId: "s", sceneName: "s", revisit: false }]);
    const v = judgeCombat([fighting, noFight, noFight]);
    expect(v.fights).toBe(1);
    expect(v.silentFights).toBe(0);
  });
});

describe("轮次与目标统计", () => {
  test("按战斗、轮次、攻击者、目标分账", () => {
    const r = reduceCombat([
      start(), round(1), swing("李默", "hit", 4), swing("周舒", "dodged", 0),
      round(2), swing("李默", "miss", 0), pcAttack("李默"), pcAttack("周舒"),
      end("fled"),
    ]);
    expect(r.encounters.length).toBe(1);
    expect(r.encounters[0]!.rounds.length).toBe(2);
    expect(r.encounters[0]!.rounds[0]!.enemyAttacks.map((a) => a.target)).toEqual(["李默", "周舒"]);
    expect(r.encounters[0]!.rounds[1]!.pcAttacks.length).toBe(2);
    const v = judgeCombat([r]);
    expect(v.enemyHits).toBe(1);
    expect(v.dodged).toBe(1);
    expect(v.missed).toBe(1);
  });

  test("两场战斗互不串账", () => {
    const r = reduceCombat([
      start("米戈"), round(1), swing("李默"), end("fled"),
      start("另一只"), round(1), swing("周舒", "hit", 2, "另一只"), end("defeated", "另一只"),
    ]);
    expect(r.encounters.length).toBe(2);
    expect(r.misattributed).toBe(0);
    expect(judgeCombat([r]).fights).toBe(2);
  });
});

describe("战斗中的昏迷 — 两条成因都要认", () => {
  test("HP 直接归零", () => {
    const r = reduceCombat([
      start(), round(1), swing("李默"), dmg("李默", 12),
      { type: "downed", who: "李默", cause: "hp-zero" },
      end("lost"),
    ]);
    expect(judgeCombat([r]).knockouts).toEqual([{ who: "李默", cause: "hp-zero" }]);
  });

  test("**重伤体质检定失败** —— 上一版按 `/昏迷过去|失去了意识/` 找文本，这条同样容易漏", () => {
    const r = reduceCombat([
      start(), round(1), swing("李默"), dmg("李默", 7),
      chk("李默", "体质（重伤）", { ignoreWound: true, success: false }),
      { type: "downed", who: "李默", cause: "major-wound-con" },
      end("lost"),
    ]);
    expect(judgeCombat([r]).knockouts).toEqual([{ who: "李默", cause: "major-wound-con" }]);
  });

  test("干扰输入：陷阱段的昏迷不算进战斗（战斗外的 downed 不计）", () => {
    const r = reduceCombat([
      start(), round(1), swing("李默"), end("fled"),
      dmg("周舒", 12), { type: "downed", who: "周舒", cause: "hp-zero" },
    ]);
    expect(judgeCombat([r]).knockouts).toEqual([]);
  });
});

describe("玩家掉血 — 只算战斗段", () => {
  test("战斗内的伤害计进 pcHpLost，战斗外的不计", () => {
    const r = reduceCombat([
      dmg("李默", 3),                       // 陷阱段
      start(), round(1), swing("李默"), dmg("李默", 5), end("fled"),
      dmg("周舒", 2),                       // 战斗后
    ]);
    expect(judgeCombat([r]).pcHpLost).toBe(5);
  });
});

describe("变异检验", () => {
  test("变异：`enemyAttack` 里删掉 applyDamage → 挥击还在但玩家不掉血，判据看得出来", () => {
    const normal = reduceCombat([start(), round(1), swing("李默"), dmg("李默", 4), end("fled")]);
    const mutated = reduceCombat([start(), round(1), swing("李默"), end("fled")]);
    expect(judgeCombat([normal]).pcHpLost).toBe(4);
    expect(judgeCombat([mutated]).pcHpLost).toBe(0);
  });

  test("变异：`for (let i = 0; i < enemyStats.times; i++)` 被去掉 → 挥击归零，静默局立刻出现", () => {
    const before = judgeCombat([reduceCombat([start(), round(1), swing("李默"), swing("周舒"), end("fled")])]);
    const after = judgeCombat([reduceCombat([start(), round(1), pcAttack("李默"), end("fled")])]);
    expect(before.silentFights).toBe(0);
    expect(after.silentFights).toBe(1);
  });
});
