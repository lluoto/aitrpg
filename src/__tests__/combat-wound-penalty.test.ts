// 战斗攻击掷骰必须读角色身上的伤势。
//
// 缺口是 `scripts/diag/diag-wounds.ts` 把惩罚骰**按来源分账**之后露出来的：
// 「记下的伤势」有好几处，「真被伤势罚到的检定」却几乎为零。
// 原因是 `combat.ts` 的 `pcAttack` 直接调 `CoCEngine.skillCheck`，
// 绕过了 `checks.ts` 的 `check()` —— 而「让伤势/惩罚骰在战斗里生效」
// 正是敌人还手那次改动的目的。旧判据数 `/惩罚骰/` 的行数，
// 战斗里的 `[惩罚骰×N]`（疲劳）照样计数，所以从来没报出来过。
//
// 疲劳与伤势是两个独立来源，必须分别可见、合计受 CoC 7e 的 2 颗上限约束。

import { describe, test, expect, afterEach } from "bun:test";
import { runCombatEncounter } from "../play/combat";
import { runCtx, type RunContext } from "../play/narration";
import type { PlayEvent } from "../play/events";
import type { Cast } from "../play/run-state";
import type { CoCGeneratedCharacter } from "../character/coc-character";
import type { ModuleData, Scene, ModuleSupport } from "../module/types";
import type { WorldState } from "../world/state";
import type { WoundSeverity } from "../combat/wound-effects";

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

function pc(): CoCGeneratedCharacter {
  return {
    hp: 12, maxHp: 12,
    attributes: { constitution: 60, dexterity: 50, strength: 50, size: 60 },
    // 枪法低于格斗 → 一定用格斗，`usingGun` 那支不消耗随机数
    skillValues: { fighting: 50, firearms_pistol: 10, dodge: 30 },
  } as unknown as CoCGeneratedCharacter;
}

const fakeSan = () => ({
  state: { currentSAN: 50, maxSAN: 50, phobias: [], manias: [], temporaryInsanity: false, indefiniteInsanity: false },
  sanityCheck: () => ({
    passed: true, sanLoss: 0, roll: 50,
    temporaryInsanityTriggered: false, indefiniteInsanityTriggered: false,
  }),
}) as never;

function cast(): Cast {
  return {
    p0: { shortName: "甲" }, p1: { shortName: "乙" },
    c1: pc(), c2: pc(), san1: fakeSan(), san2: fakeSan(),
  };
}

const SCENE = { id: "s1", name: "谷仓" } as unknown as Scene;
const WORLD = { isClueFound: (id: string) => id === "need", discoverClue: () => {} } as unknown as WorldState;

const MODULE = {
  npcs: [{ id: "mi_go", description: "每回合攻击2次。格斗45%（1d6伤害）闪避35%\nHP11 MP15 DB无" }],
} as unknown as ModuleData;

const SUPPORT = {
  bossNpcIdPattern: /^mi_go$/,
  encounters: [{
    sceneId: "s1", requiredClue: "need", excludedClue: "never",
    enemyName: "米戈", encounterLines: [], victoryLines: [], defeatLines: [],
  }],
} as unknown as ModuleSupport;

/** 跑一场遭遇战，可预先给某人挂一处伤 */
async function fight(wounds: Array<[string, WoundSeverity]> = []): Promise<PlayEvent[]> {
  const events: PlayEvent[] = [];
  const ctx: RunContext = {
    lines: [], origins: [], wounds: new Map(wounds), onEvent: (e) => events.push(e),
  };
  await runCtx.run(ctx, () => runCombatEncounter(cast(), WORLD, MODULE, SCENE, SUPPORT));
  return events;
}

const attackChecks = (evts: PlayEvent[], who: string) =>
  evts.filter((e): e is Extract<PlayEvent, { type: "check" }> =>
    e.type === "check" && e.actor === who && /格斗\(肉搏\)|射击\(手枪\)/.test(e.skill));

describe("战斗攻击 — 伤势惩罚骰", () => {
  test("**正确**：身上有重伤时，攻击掷骰带 1 个伤势惩罚骰", async () => {
    Math.random = () => 0;
    const evts = await fight([["甲", "deep"]]);
    const a = attackChecks(evts, "甲");
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]!.woundPenalty).toBe(1);
    expect(a[0]!.totalPenalty).toBeGreaterThanOrEqual(1);
    expect(a[0]!.woundAware).toBe(true);
  });

  test("**错误行为的红线**：没接线时 woundPenalty 恒为 0", async () => {
    // 变异：把 `woundPenaltyOf(name)` 换成 0，这条立刻红。
    Math.random = () => 0;
    const evts = await fight([["甲", "grievous"]]);
    expect(attackChecks(evts, "甲")[0]!.woundPenalty).toBeGreaterThan(0);
  });

  test("**干扰**：没受伤的人不该凭空多出伤势惩罚", async () => {
    Math.random = () => 0;
    const evts = await fight([["甲", "deep"]]);
    const b = attackChecks(evts, "乙");
    expect(b.length).toBeGreaterThan(0);
    expect(b.every((e) => e.woundPenalty === 0)).toBe(true);
  });

  test("**干扰**：致命伤的 3 颗被截到 CoC 7e 的上限 2", async () => {
    Math.random = () => 0;
    const evts = await fight([["甲", "grievous"]]);
    const a = attackChecks(evts, "甲")[0]!;
    expect(a.woundPenalty).toBe(2);
    expect(a.totalPenalty).toBeLessThanOrEqual(2);
  });

  test("疲劳与伤势分别可见，合计仍不超过 2", async () => {
    Math.random = () => 0;
    const evts = await fight([["甲", "deep"]]);
    const checks = attackChecks(evts, "甲");
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空（这局要是一次攻击都没打，下面就什么都没验）
    expect(checks.length).toBeGreaterThan(0);
    for (const e of checks) {
      expect(e.totalPenalty).toBe(Math.min(2, e.envPenalty + e.woundPenalty));
      expect(e.totalPenalty).toBeLessThanOrEqual(2);
    }
  });

  test("攻击事件与检定事件成对出现（判据不靠技能名认攻击）", async () => {
    Math.random = () => 0;
    const evts = await fight();
    const attacks = evts.filter((e) => e.type === "pc-attack");
    expect(attacks.length).toBe(attackChecks(evts, "甲").length + attackChecks(evts, "乙").length);
  });
});
