// 判据校准：「昏迷的调查员是不是还在自己掷骰」。
//
// 上一版的结论是「违规 0 次」。但它只认 `❤ X HP n → 0（昏迷` 这一行，
// 而昏迷有两条路径，第二条（重伤体质检定失败）**根本没有那一行**。
// 「0 次」于是既可能是真没问题，也可能是根本没在看 —— 这两种情况
// 输出一模一样，判据就是坏的。
//
// 下面每组都给三种输入：行为正确 / 行为错误 / 文本相似但合法。

import { describe, test, expect } from "bun:test";
import { reduceDowned, mergeDowned } from "../diagnostics/downed";
import type { PlayEvent } from "../play/events";

// ── 夹具构造器 ─────────────────────────────────────────────────
const scene = (id = "barn", name = "谷仓"): PlayEvent =>
  ({ type: "scene-enter", sceneId: id, sceneName: name, revisit: false });

const chk = (
  actor: string, skill: string,
  o: Partial<Extract<PlayEvent, { type: "check" }>> = {},
): PlayEvent => ({
  type: "check", actor, actorKind: "pc", skill, skillValue: 50,
  envPenalty: 0, woundPenalty: 0, totalPenalty: 0, ignoreWound: false,
  woundAware: true, roll: 40, success: true, level: "regular", ...o,
});

const dmg = (
  who: string, from: number, to: number,
  severity: Extract<PlayEvent, { type: "damage" }>["severity"] = "deep",
): PlayEvent => ({ type: "damage", who, from, to, maxHp: 12, amount: from - to, severity });

const downedHp = (who: string): PlayEvent => ({ type: "downed", who, cause: "hp-zero" });
const downedCon = (who: string): PlayEvent => ({ type: "downed", who, cause: "major-wound-con" });
const revived = (who: string, by: string): PlayEvent => ({ type: "revived", who, by });
const con = (actor: string) => chk(actor, "体质（重伤）", { ignoreWound: true, success: false });

// ── 1. 昏迷的两条路径都要认出来 ────────────────────────────────

describe("成因识别 — 两条路径", () => {
  test("HP 直接归零", () => {
    const r = reduceDowned([scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默")]);
    expect(r.everDown).toEqual(["李默"]);
    expect(r.byCause["hp-zero"]).toBe(1);
  });

  test("**重伤 CON 失败昏迷** —— HP 还剩着，没有 `HP n → 0` 那一行", () => {
    // 上一版整条漏掉的就是这个：日志上只有一句「因伤势过重昏迷过去！」。
    const r = reduceDowned([
      scene(),
      dmg("李默", 12, 5, "deep"),   // 掉到 5 点，**不是 0**
      con("李默"),                   // 体质检定失败
      downedCon("李默"),
    ]);
    expect(r.byCause["major-wound-con"]).toBe(1);
    expect(r.everDown).toEqual(["李默"]);
  });

  test("干扰：伤害没打昏人 → 不算倒下", () => {
    const r = reduceDowned([scene(), dmg("李默", 12, 5, "deep"), chk("李默", "侦查")]);
    expect(r.everDown).toEqual([]);
    expect(r.violations).toEqual([]);
  });
});

// ── 2. 昏迷期间本人掷骰 = 违规 ──────────────────────────────────

describe("违规判定 — 昏迷期间本人掷骰", () => {
  test("**错误输入**：倒下之后本人还在掷侦查 → 报违规", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("李默", "侦查"),
    ]);
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.actor).toBe("李默");
    expect(r.violations[0]!.skill).toBe("侦查");
  });

  test("重伤 CON 路径倒下之后再掷骰，同样报违规（上一版这条完全看不见）", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 12, 5, "deep"), con("李默"), downedCon("李默"),
      scene("sewer", "下水道"),
      chk("李默", "图书馆使用"),
    ]);
    expect(r.violations.length).toBe(1);
    expect(r.violations[0]!.cause).toBe("major-wound-con");
  });

  test("**正确输入**：倒下之后本人什么都不掷 → 零违规", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("周舒", "急救"), // 同伴在忙
    ]);
    expect(r.violations).toEqual([]);
  });
});

// ── 3. 干扰项：三种「看着像违规其实合法」的输入 ──────────────────

describe("干扰项 — 合法行为不得误报", () => {
  test("干扰 1：昏迷那一刻的重伤结算检定（同一次受伤的一部分）", () => {
    // 陷阱/战斗里 HP 归零之后仍会补一次「体质（重伤）」。
    // 它是这次受伤的结算，不是「倒下后又行动」。
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      con("李默"),
    ]);
    expect(r.violations).toEqual([]);
    expect(r.settlementExempt).toBe(1); // 豁免要**显式计数**，否则 0 违规看不出原因
  });

  test("干扰 1 的边界：换了场景还在掷「体质（重伤）」→ 不再豁免", () => {
    // 结算窗口只开到本场景结束。跨场景还在掷，就不是结算了。
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      scene("sewer", "下水道"),
      con("李默"),
    ]);
    expect(r.violations.length).toBe(1);
    expect(r.settlementExempt).toBe(0);
  });

  test("干扰 2：昏迷期间**同伴**掷急救 —— 掷骰人是施救者，不是伤者", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("周舒", "急救", { success: true }),
      revived("李默", "周舒"),
    ]);
    expect(r.violations).toEqual([]);
    expect(r.byPartnerWhileDown).toBe(1);
    expect(r.revives).toBe(1);
  });

  test("干扰 3：**苏醒之后本人正常行动** —— 上一版把这些算违规，于是永远报警", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("周舒", "急救", { success: true }),
      revived("李默", "周舒"),
      chk("李默", "侦查"),
      chk("李默", "图书馆使用"),
    ]);
    expect(r.violations).toEqual([]);
    expect(r.checksAfterRevive).toBe(2);
  });

  test("干扰 4：敌人的掷骰不进本判据（敌人不会「昏迷」）", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("米戈", "格斗", { actorKind: "enemy" }),
    ]);
    expect(r.violations).toEqual([]);
  });

  test("干扰 5：SAN 检定是被动反应，单列计数不判违规（范围声明的一部分）", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      { type: "san-check", actor: "李默", roll: 80, loss: 3, passed: false },
    ]);
    expect(r.violations).toEqual([]);
    expect(r.sanWhileDowned).toBe(1);
  });

  test("苏醒后再次倒下 → 之后的掷骰重新算违规", () => {
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("周舒", "急救", { success: true }), revived("李默", "周舒"),
      chk("李默", "侦查"),
      dmg("李默", 1, 0, "grievous"), downedHp("李默"),
      chk("李默", "侦查"),
    ]);
    expect(r.violations.length).toBe(1);
    expect(r.checksAfterRevive).toBe(1);
  });
});

// ── 4. 变异检验 ───────────────────────────────────────────────

describe("变异检验 — 把实现改坏，判据必须变红", () => {
  test("变异：`traps.ts` 删掉重伤昏迷那一支（不再发 downed 事件）→ 违规漏报", () => {
    // 有 downed 事件时报 1 次违规；把它删掉，同一段日志报 0 次。
    // 两种输出不同，说明判据真的依赖那条实现。
    const withDown: PlayEvent[] = [
      scene(), dmg("李默", 12, 5, "deep"), con("李默"), downedCon("李默"), chk("李默", "侦查"),
    ];
    const mutated = withDown.filter((e) => e.type !== "downed");
    expect(reduceDowned(withDown).violations.length).toBe(1);
    expect(reduceDowned(mutated).violations.length).toBe(0);
  });

  test("变异：豁免条件从 `ignoreWound` 放宽成「所有体质检定」→ 边界用例会漏", () => {
    // 判据认的是结构位（ignoreWound=true），不是技能名。
    // 一次**普通**体质检定（不豁免伤势）在昏迷期间发生，必须算违规。
    const r = reduceDowned([
      scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"),
      chk("李默", "体质（重伤）", { ignoreWound: false }),
    ]);
    expect(r.violations.length).toBe(1);
  });

  test("判据对同一段日志给出的两种结论必须可区分（正/反例输出不同）", () => {
    const good = reduceDowned([scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"), chk("周舒", "侦查")]);
    const bad = reduceDowned([scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"), chk("李默", "侦查")]);
    expect(good.violations.length).not.toBe(bad.violations.length);
  });
});

// ── 身份不可分辨 ───────────────────────────────────────────────

describe("重名 — 判据必须说「不可判定」，不能报假违规", () => {
  test("**干扰输入**：两名调查员同名 → 同伴急救被算到伤者头上", () => {
    // 实测 seed 95028：两人都叫「亨利」。播报里只有名字，
    // 于是「同伴替他掷急救」和「他自己在掷急救」长得一模一样。
    // 判据靠一条结构性信号识别：昏迷的人不可能给自己做急救。
    const r = reduceDowned([
      scene(),
      dmg("亨利", 3, 0, "flesh"), downedHp("亨利"),
      chk("亨利", "化学（判断急救方式）"),
      chk("亨利", "急救", { success: true }),
      { type: "revived", who: "亨利", by: "亨利" },
    ]);
    expect(r.ambiguousIdentity).toBe(true);
    expect(r.ambiguityReason).toContain("显示名相同");
  });

  test("**正确输入**：名字不同 → 不报不可判定", () => {
    const r = reduceDowned([
      scene(),
      dmg("李默", 3, 0, "flesh"), downedHp("李默"),
      chk("周舒", "急救", { success: true }),
      revived("李默", "周舒"),
    ]);
    expect(r.ambiguousIdentity).toBe(false);
    expect(r.violations).toEqual([]);
  });

  test("**错误输入**：名字不同且真有人昏迷掷骰 → 照报违规，不被这条豁免掉", () => {
    // 防止「加了不可判定分支之后什么都不报了」——那是另一种假绿。
    const r = reduceDowned([
      scene(), dmg("李默", 3, 0, "flesh"), downedHp("李默"), chk("李默", "侦查"),
    ]);
    expect(r.ambiguousIdentity).toBe(false);
    expect(r.violations.length).toBe(1);
  });

  test("汇总时只要有一局不可分辨，整批就标不可判定", () => {
    const clean = reduceDowned([scene(), dmg("李默", 3, 0, "flesh"), downedHp("李默")]);
    const dirty = reduceDowned([
      scene(), dmg("亨利", 3, 0, "flesh"), downedHp("亨利"),
      { type: "revived", who: "亨利", by: "亨利" },
    ]);
    expect(mergeDowned([clean, dirty]).ambiguousIdentity).toBe(true);
    expect(mergeDowned([clean, clean]).ambiguousIdentity).toBe(false);
  });
});

describe("多局汇总", () => {
  test("mergeDowned 累加各项且不丢违规明细", () => {
    const a = reduceDowned([scene(), dmg("李默", 6, 0, "grievous"), downedHp("李默"), chk("李默", "侦查")]);
    const b = reduceDowned([scene(), dmg("周舒", 12, 5, "deep"), con("周舒"), downedCon("周舒")]);
    const m = mergeDowned([a, b]);
    expect(m.byCause["hp-zero"]).toBe(1);
    expect(m.byCause["major-wound-con"]).toBe(1);
    expect(m.violations.length).toBe(1);
    expect(m.everDown.sort()).toEqual(["周舒", "李默"].sort());
  });
});
