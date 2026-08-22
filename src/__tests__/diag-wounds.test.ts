// 判据校准：「伤势分级 / 重伤体质检定 / 惩罚骰是否生效」。
//
// 上一版拿 `lines.filter(l => /惩罚骰/.test(l))` 当证据。播报里带这三个字的
// 至少三种来源（伤势 / 环境 / 战斗疲劳），混成一堆之后，
// **把 `recordWound()` 整个删掉，计数照样非零** —— 判据不会变红。
// 下面「变异检验」那一组就是钉这件事的。

import { describe, test, expect, afterEach } from "bun:test";
import { reduceWounds, mergeWounds } from "../diagnostics/wounds";
import { runCtx, type RunContext } from "../play/narration";
import { applyDamage, check, healWound } from "../play/checks";
import type { PlayEvent } from "../play/events";
import type { WoundSeverity } from "../combat/wound-effects";
import type { CoCGeneratedCharacter } from "../character/coc-character";

const scene = (id = "barn"): PlayEvent => ({ type: "scene-enter", sceneId: id, sceneName: id, revisit: false });

const dmg = (who: string, from: number, to: number, severity: WoundSeverity): PlayEvent =>
  ({ type: "damage", who, from, to, maxHp: 12, amount: from - to, severity });

const wound = (who: string, severity: WoundSeverity, penaltyDice: number): PlayEvent =>
  ({ type: "wound", who, severity, penaltyDice });

const healed = (who: string): PlayEvent => ({ type: "wound-healed", who });

const chk = (
  actor: string, skill: string,
  o: Partial<Extract<PlayEvent, { type: "check" }>> = {},
): PlayEvent => ({
  type: "check", actor, actorKind: "pc", skill, skillValue: 50,
  envPenalty: 0, woundPenalty: 0, totalPenalty: 0, ignoreWound: false,
  woundAware: true, roll: 40, success: true, level: "regular", ...o,
});

/** 重伤结算检定：豁免自身伤势 */
const conCheck = (actor: string, o: Partial<Extract<PlayEvent, { type: "check" }>> = {}) =>
  chk(actor, "体质（重伤）", { ignoreWound: true, woundPenalty: 0, ...o });

/** 一次「完全正确」的重伤流程 */
function correctFlow(): PlayEvent[] {
  return [
    scene(),
    dmg("李默", 12, 5, "deep"),      // 7/12 ≥ 50% → deep
    wound("李默", "deep", 1),         // recordWound 写进去了
    conCheck("李默"),                 // 恰好一次，且不被自己罚
    chk("李默", "侦查", { woundPenalty: 1, totalPenalty: 1 }), // 后续检定带伤势惩罚
    healed("李默"),                   // 急救处理掉
    chk("李默", "图书馆使用"),          // 惩罚骰消失
  ];
}

describe("W1 — deep/grievous 之后恰有一次重伤体质检定", () => {
  test("正确输入：一次伤害 → 一次体质检定 → 无破例", () => {
    const r = reduceWounds(correctFlow());
    expect(r.majorWoundsStanding).toBe(1);
    expect(r.conChecks).toBe(1);
    expect(r.breaches).toEqual([]);
  });

  test("**错误输入**：删掉重伤体质检定 → 报 missing-con", () => {
    const evts = correctFlow().filter((e) => !(e.type === "check" && e.ignoreWound));
    const r = reduceWounds(evts);
    expect(r.conChecks).toBe(0);
    expect(r.breaches.map((b) => b.kind)).toContain("missing-con");
  });

  test("错误输入：同一次重伤掷了两次体质检定 → 报 duplicate-con", () => {
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1),
      conCheck("李默"), conCheck("李默"),
      chk("李默", "侦查", { woundPenalty: 1, totalPenalty: 1 }),
    ];
    expect(reduceWounds(evts).breaches.map((b) => b.kind)).toContain("duplicate-con");
  });

  test("干扰输入：轻伤（flesh）不该要求体质检定 → 不报", () => {
    const r = reduceWounds([scene(), dmg("李默", 12, 8, "flesh"), chk("李默", "侦查")]);
    expect(r.majorWoundsStanding).toBe(0);
    expect(r.breaches).toEqual([]);
  });

  test("干扰输入：重伤但当场昏迷（to=0）→ 单列不断言，不报破例", () => {
    // 引擎在陷阱主路径上会补掷，在挣脱/持续伤害路径上不掷，口径本身不一致。
    // 判据在这里**不下结论**，但必须把数量报出来，不能当没看见。
    const r = reduceWounds([scene(), dmg("李默", 6, 0, "grievous")]);
    expect(r.majorWoundsWhileDown).toBe(1);
    expect(r.majorWoundsStanding).toBe(0);
    expect(r.breaches).toEqual([]);
  });
});

describe("W2 — 重伤体质检定不受本次伤势惩罚", () => {
  test("正确输入：ignoreWound=true 且 woundPenalty=0 → 通过", () => {
    expect(reduceWounds(correctFlow()).breaches).toEqual([]);
  });

  test("**错误输入**：把 ignoreWound 去掉，体质检定被自己这处伤罚 → 报 con-self-penalized", () => {
    // 实跑抓到过：「体质（重伤）51% [1惩罚骰·伤势]」，那个惩罚骰正是同一处伤给的。
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1),
      conCheck("李默", { woundPenalty: 1, totalPenalty: 1 }),
    ];
    const r = reduceWounds(evts);
    expect(r.breaches.map((b) => b.kind)).toContain("con-self-penalized");
  });
});

describe("W3 — 后续适用检定带伤势惩罚", () => {
  test("正确输入：有伤时的侦查检定带 1 个伤势惩罚骰", () => {
    const r = reduceWounds(correctFlow());
    expect(r.woundPenalizedChecks).toBe(1);
    expect(r.breaches).toEqual([]);
  });

  test("**错误输入**：`recordWound()` 被删（没有 wound 事件、惩罚骰恒为 0）", () => {
    // 这是上一版最致命的漏洞：删掉 recordWound 之后
    // 「惩罚骰播报次数」照样非零（环境/疲劳还在打），判据一点反应都没有。
    // 现在按角色顺序验证，同一段日志直接变红。
    const evts = correctFlow()
      .filter((e) => e.type !== "wound")
      .map((e) => (e.type === "check" && !e.ignoreWound
        ? { ...e, woundPenalty: 0, totalPenalty: 0 }
        : e));
    const r = reduceWounds(evts);
    expect(r.woundsRecorded).toBe(0);
    expect(r.woundPenalizedChecks).toBe(0);
    // 专门为这个变异准备的破例：重伤发生过、人还站着，却没把伤记下来。
    expect(r.breaches.map((b) => b.kind)).toContain("missing-wound-record");
  });

  test("**错误输入**：记了伤，但后续检定没带伤势惩罚 → 报 wound-penalty-missing", () => {
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1), conCheck("李默"),
      chk("李默", "侦查"), // woundPenalty 缺省 0
    ];
    expect(reduceWounds(evts).breaches.map((b) => b.kind)).toContain("wound-penalty-missing");
  });

  test("**干扰输入**：环境惩罚骰不能充数", () => {
    // 只有 envPenalty、没有 woundPenalty —— 上一版会把它计进「惩罚骰播报」，
    // 当成伤势机制生效的证据。
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1), conCheck("李默"),
      chk("李默", "侦查（夜色）", { envPenalty: 1, totalPenalty: 1, woundPenalty: 0 }),
    ];
    const r = reduceWounds(evts);
    expect(r.woundPenalizedChecks).toBe(0);
    expect(r.breaches.map((b) => b.kind)).toContain("wound-penalty-missing");
  });

  test("干扰输入：身上没伤时的环境惩罚骰 → 计进 envOnly，不报破例", () => {
    const r = reduceWounds([scene(), chk("李默", "侦查（夜色）", { envPenalty: 1, totalPenalty: 1 })]);
    expect(r.envOnlyPenalizedChecks).toBe(1);
    expect(r.breaches).toEqual([]);
  });

  test("干扰输入：**不读伤势的掷骰路径**单列，既不算生效也不算破例", () => {
    // `woundAware=false` 表示「这条掷骰路径压根不查角色身上的伤势」。
    // 战斗攻击曾经就是这样（绕过 `check()` 直接调 `CoCEngine.skillCheck`），
    // 现已接上；这条留着守回归 —— 再有谁另开一条绕过去的路，
    // 判据要能把它单列出来，而不是当成「没伤所以没罚」悄悄放过。
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1), conCheck("李默"),
      chk("李默", "格斗(肉搏)", { envPenalty: 2, totalPenalty: 2, woundAware: false }),
    ];
    const r = reduceWounds(evts);
    expect(r.woundPenalizedChecks).toBe(0);
    expect(r.woundBlindRolls).toBe(1);
    expect(r.breaches).toEqual([]);             // 不冤枉它，但也不当成生效
  });

  test("**正例**：战斗攻击现在会带伤势惩罚（接线之后）", () => {
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1), conCheck("李默"),
      chk("李默", "格斗(肉搏)", { envPenalty: 1, woundPenalty: 1, totalPenalty: 2, woundAware: true }),
    ];
    const r = reduceWounds(evts);
    expect(r.woundPenalizedChecks).toBe(1);
    expect(r.woundBlindRolls).toBe(0);
    expect(r.breaches).toEqual([]);
  });
});

describe("W4 — 治疗后伤势惩罚消失", () => {
  test("正确输入：healed 之后检定不带伤势惩罚", () => {
    expect(reduceWounds(correctFlow()).breaches).toEqual([]);
    expect(reduceWounds(correctFlow()).woundsHealed).toBe(1);
  });

  test("**错误输入**：治疗过了还在扣伤势惩罚 → 报 penalty-after-heal", () => {
    const evts = [
      scene(), dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1), conCheck("李默"),
      healed("李默"),
      chk("李默", "侦查", { woundPenalty: 1, totalPenalty: 1 }),
    ];
    expect(reduceWounds(evts).breaches.map((b) => b.kind)).toContain("penalty-after-heal");
  });
});

describe("伤势分级 — 不看播报标签", () => {
  test("**HP 归零时分级不丢**（播报标签被「昏迷/濒死」盖掉）", () => {
    // 上一版按 `HP a → b（标签）` 分档，归零那一行的标签是「昏迷/濒死！」，
    // 于是最重的那一档永远是 0。
    const r = reduceWounds([scene(), dmg("李默", 6, 0, "grievous")]);
    expect(r.severityBuckets.grievous).toBe(1);
  });

  test("各档按事件里的 severity 计数", () => {
    const r = reduceWounds([
      scene(),
      dmg("李默", 12, 10, "scratch"),
      dmg("李默", 10, 6, "flesh"),
      dmg("周舒", 12, 5, "deep"), wound("周舒", "deep", 1), conCheck("周舒"),
      chk("周舒", "侦查", { woundPenalty: 1, totalPenalty: 1 }),
    ]);
    expect(r.severityBuckets.scratch).toBe(1);
    expect(r.severityBuckets.flesh).toBe(1);
    expect(r.severityBuckets.deep).toBe(1);
    expect(r.damages).toBe(3);
  });
});

describe("按角色分账 — 不能把两个人的事混着算", () => {
  test("A 受重伤、B 掷骰，不能拿 B 的检定充当 A 的体质检定", () => {
    const evts = [
      scene(),
      dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1),
      conCheck("周舒"),   // 掷的是**另一个人**
      chk("李默", "侦查", { woundPenalty: 1, totalPenalty: 1 }),
    ];
    const r = reduceWounds(evts);
    expect(r.conChecks).toBe(1);
    expect(r.breaches.map((b) => b.kind)).toContain("missing-con"); // 李默那次没人替他掷
  });

  test("两个人各自一次重伤各自一次体质检定 → 无破例", () => {
    const evts = [
      scene(),
      dmg("李默", 12, 5, "deep"), wound("李默", "deep", 1), conCheck("李默"),
      dmg("周舒", 12, 4, "deep"), wound("周舒", "deep", 1), conCheck("周舒"),
      chk("李默", "侦查", { woundPenalty: 1, totalPenalty: 1 }),
      chk("周舒", "侦查", { woundPenalty: 1, totalPenalty: 1 }),
    ];
    expect(reduceWounds(evts).breaches).toEqual([]);
  });
});

describe("变异检验 — 正反两侧输出必须不同", () => {
  test("删 recordWound / 删 CON 检定 / 去 ignoreWound，三种变异各有一条判据抓住", () => {
    const base = reduceWounds(correctFlow());
    expect(base.breaches).toEqual([]);

    const noRecord = reduceWounds(correctFlow().filter((e) => e.type !== "wound")
      .map((e) => (e.type === "check" && !e.ignoreWound ? { ...e, woundPenalty: 0, totalPenalty: 0 } : e)));
    expect(noRecord.woundPenalizedChecks).toBe(0);
    expect(base.woundPenalizedChecks).toBe(1);
    expect(noRecord.breaches.map((b) => b.kind)).toContain("missing-wound-record");

    const noCon = reduceWounds(correctFlow().filter((e) => !(e.type === "check" && e.ignoreWound)));
    expect(noCon.breaches.map((b) => b.kind)).toContain("missing-con");

    const selfPenalized = reduceWounds(correctFlow().map((e) =>
      e.type === "check" && e.ignoreWound ? { ...e, woundPenalty: 1, totalPenalty: 1 } : e));
    expect(selfPenalized.breaches.map((b) => b.kind)).toContain("con-self-penalized");
  });
});

describe("多局汇总", () => {
  test("mergeWounds 累加分档与破例", () => {
    const m = mergeWounds([reduceWounds(correctFlow()), reduceWounds(correctFlow())]);
    expect(m.severityBuckets.deep).toBe(2);
    expect(m.conChecks).toBe(2);
    expect(m.breaches).toEqual([]);
  });
});

// ── 接上真实现 ────────────────────────────────────────────────
//
// 上面几组测的是**判据**（喂构造好的事件）。判据自己再准，
// 如果不接真实现，删掉 `recordWound()` 它照样全绿 —— 那就是这次要修的病本身。
// 下面这组走真的 `applyDamage` / `check` / `healWound`，
// 变异检验的红线落在这里。

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

/** 只装 applyDamage / check 会碰的字段 */
function fakePc(hp: number, maxHp: number): CoCGeneratedCharacter {
  return { hp, maxHp, attributes: { constitution: 60 } } as unknown as CoCGeneratedCharacter;
}

/** 在一个真实的 RunContext 里跑一段，把事件收回来 */
function inRun(fn: () => void): PlayEvent[] {
  const events: PlayEvent[] = [];
  const ctx: RunContext = { lines: [], origins: [], wounds: new Map(), onEvent: (e) => events.push(e) };
  runCtx.run(ctx, fn);
  return events;
}

describe("接真实现 — 变异检验的红线", () => {
  test("真的走一遍「重伤 → 体质检定 → 后续检定带惩罚 → 急救解除」", () => {
    // 固定骰子：让体质检定与后续检定都成功，避免随机性搅动断言
    Math.random = () => 0.0;
    const pc = fakePc(12, 12);
    const events = inRun(() => {
      applyDamage(pc, "李默", 7);                                  // 7/12 ≥ 50% → deep
      check(pc.attributes.constitution, "李默", "体质（重伤）", "regular", 0, true);
      check(50, "李默", "侦查");
      healWound("李默");
      check(50, "李默", "图书馆使用");
    });

    const r = reduceWounds(events);
    expect(r.severityBuckets.deep).toBe(1);
    expect(r.woundsRecorded).toBe(1);       // ← 删掉 recordWound() 这里变 0
    expect(r.conChecks).toBe(1);
    expect(r.woundPenalizedChecks).toBe(1); // ← 删掉 recordWound() 这里也变 0
    expect(r.woundsHealed).toBe(1);
    expect(r.breaches).toEqual([]);
  });

  test("**变异：把 `recordWound()` 的调用去掉** → 判据必须变红", () => {
    Math.random = () => 0.0;
    const pc = fakePc(12, 12);
    // 模拟 applyDamage 里少了 recordWound 那两行：只掉血、只播报，不记伤势
    const events = inRun(() => {
      pc.hp -= 7;
      // 手工发一条与真 applyDamage 等价的伤害事件（severity 由 calcSeverity 算）
      check(pc.attributes.constitution, "李默", "体质（重伤）", "regular", 0, true);
      check(50, "李默", "侦查");
    });
    const withDamage: PlayEvent[] = [
      { type: "damage", who: "李默", from: 12, to: 5, maxHp: 12, amount: 7, severity: "deep" },
      ...events,
    ];
    const r = reduceWounds(withDamage);
    expect(r.woundsRecorded).toBe(0);
    expect(r.woundPenalizedChecks).toBe(0);
    expect(r.breaches.map((b) => b.kind)).toContain("missing-wound-record");
  });

  test("**变异：重伤体质检定不传 `ignoreWound`** → 被自己这处伤罚，判据必须变红", () => {
    Math.random = () => 0.0;
    const pc = fakePc(12, 12);
    const events = inRun(() => {
      applyDamage(pc, "李默", 7);
      // 少了最后那个 true
      check(pc.attributes.constitution, "李默", "体质（重伤）", "regular", 0, false);
      check(50, "李默", "侦查");
    });
    const r = reduceWounds(events);
    // 这一掷不再豁免伤势 → 它既算不上结算检定，又带上了伤势惩罚
    expect(r.conChecks).toBe(0);
    expect(r.breaches.map((b) => b.kind)).toContain("missing-con");
  });

  test("**变异：删掉重伤体质检定那一支** → 报 missing-con", () => {
    Math.random = () => 0.0;
    const pc = fakePc(12, 12);
    const events = inRun(() => {
      applyDamage(pc, "李默", 7);
      check(50, "李默", "侦查"); // 直接跳到下一次检定，没掷体质
    });
    expect(reduceWounds(events).breaches.map((b) => b.kind)).toContain("missing-con");
  });

  test("**变异：`healWound()` 不生效** → 治疗后仍带惩罚，报 penalty-after-heal", () => {
    Math.random = () => 0.0;
    const pc = fakePc(12, 12);
    const events = inRun(() => {
      applyDamage(pc, "李默", 7);
      check(pc.attributes.constitution, "李默", "体质（重伤）", "regular", 0, true);
      // 这里本该 healWound("李默")，变异掉了
      check(50, "李默", "图书馆使用");
    });
    // 没有 wound-healed 事件 → 后面那次检定仍带伤势惩罚 → 状态机认为「有伤且罚了」，不算破例；
    // 真正的证据是：一次治疗都没有，而伤势一直挂着。
    const r = reduceWounds(events);
    expect(r.woundsHealed).toBe(0);
    expect(r.woundPenalizedChecks).toBe(1);

    // 对照：真的调 healWound 之后，惩罚必须消失
    const ok = inRun(() => {
      const pc2 = fakePc(12, 12);
      applyDamage(pc2, "李默", 7);
      check(pc2.attributes.constitution, "李默", "体质（重伤）", "regular", 0, true);
      healWound("李默");
      check(50, "李默", "图书馆使用");
    });
    const r2 = reduceWounds(ok);
    expect(r2.woundsHealed).toBe(1);
    expect(r2.woundPenalizedChecks).toBe(0);
    expect(r2.breaches).toEqual([]);
  });

  test("**HP 归零时事件仍带正确分级**（播报标签被「昏迷/濒死」覆盖，事件不受影响）", () => {
    Math.random = () => 0.0;
    const pc = fakePc(6, 12);
    const events = inRun(() => { applyDamage(pc, "李默", 10); });
    const dmgEvt = events.find((e) => e.type === "damage") as Extract<PlayEvent, { type: "damage" }>;
    expect(dmgEvt.severity).toBe("grievous");   // 10/12 ≥ 75%
    expect(dmgEvt.to).toBe(0);
    expect(events.some((e) => e.type === "downed" && e.cause === "hp-zero")).toBe(true);
    expect(reduceWounds(events).severityBuckets.grievous).toBe(1);
  });
});
