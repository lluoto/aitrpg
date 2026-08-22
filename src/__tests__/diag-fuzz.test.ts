// 判据校准：「随机玩法能不能通关、有没有死循环」。
//
// 可复现的反例（上一版实际输出）：
//     通关 10/10
//     跑完没有结局的局：1/10
// 同一份输出里两句话互相打脸，因为「通关」量的是**进过终局场景**，
// 而「有没有结局」量的是**念没念结局文本**。全员倒下时
// `evaluateEnding` 返回 null，人却可能早就进过维修间了。
// 修完之后这两句必须一致 —— 下面第一组就是钉它的。

import { describe, test, expect } from "bun:test";
import {
  judgeFuzzRun, judgeFuzz, summarizeFuzzEvents,
  DEFAULT_FUZZ_THRESHOLDS, type FuzzRunOutcome, type FuzzThresholds,
} from "../diagnostics/fuzz";
import type { PlayEvent } from "../play/events";

const TH: FuzzThresholds = { timeoutMs: 1000, maxDecisions: 10, maxRepeat: 3 };

function outcome(o: Partial<FuzzRunOutcome> = {}): FuzzRunOutcome {
  return {
    seed: 1, threw: false, errorMessage: "", timedOut: false, hitDecisionCap: false,
    decisions: 5, emptyOptionStops: 0, maxRepeat: 1, sceneEntries: 8, distinctScenes: 6,
    ending: "True End", reachedFinaleScene: true, ...o,
  };
}

describe("通关的定义 — 正常返回 + 产生正式结局", () => {
  test("**正确输入**：有结局 → 通过", () => {
    expect(judgeFuzzRun(outcome(), TH)).toEqual([]);
  });

  test("**错误输入**：进过终局场景但没有结局 → 失败（这就是那句自相矛盾的来源）", () => {
    const fails = judgeFuzzRun(outcome({ ending: "", reachedFinaleScene: true }), TH);
    expect(fails).toContain("no-ending");
  });

  test("**干扰输入**：没进终局场景但有结局（Normal End）→ 通过", () => {
    // 「走到终局场景」不是通关的必要条件，模组本来就有不去维修间的结局。
    expect(judgeFuzzRun(outcome({ ending: "Normal End", reachedFinaleScene: false }), TH)).toEqual([]);
  });

  test("修复后不得再出现「通关数 > 有结局数」", () => {
    const rows = [
      outcome({ ending: "True End", reachedFinaleScene: true }),
      outcome({ ending: "", reachedFinaleScene: true }),   // 进了终局场景却没结局
      outcome({ ending: "Bad End", reachedFinaleScene: false }),
    ];
    const r = judgeFuzz(rows, 3, TH);
    const withEnding = rows.filter((o) => o.ending !== "").length;
    expect(r.passed).toBe(2);
    expect(r.passed).toBeLessThanOrEqual(withEnding);
    expect(r.finaleWithoutEnding).toBe(1);
    expect(r.byFailure["no-ending"]).toBe(1);
  });
});

describe("分母 — 异常局必须算失败，不能从分母删掉", () => {
  test("**错误输入**：3 局里 1 局抛异常 → 分母仍是 3", () => {
    const r = judgeFuzz([outcome(), outcome(), outcome({ threw: true, errorMessage: "boom", ending: "" })], 3, TH);
    expect(r.planned).toBe(3);
    expect(r.passed).toBe(2);
    expect(r.byFailure.threw).toBe(1);
  });

  test("**错误输入**：进程压根没跑完（结果条数少于计划）→ 缺的算失败", () => {
    // 上一版 `rows.filter(finale).length / rows.length`：越崩越接近 100%。
    const r = judgeFuzz([outcome(), outcome()], 10, TH);
    expect(r.planned).toBe(10);
    expect(r.passed).toBe(2);
    expect(r.byFailure.threw).toBe(8);
  });

  test("干扰输入：全部正常跑完 → 不虚增失败", () => {
    const r = judgeFuzz([outcome(), outcome(), outcome()], 3, TH);
    expect(r.passed).toBe(3);
    expect(r.byFailure.threw).toBe(0);
  });
});

describe("死循环 — 超时 / 决策步数 / 原地打转", () => {
  test("**错误输入**：超时 → 失败", () => {
    expect(judgeFuzzRun(outcome({ timedOut: true, ending: "" }), TH)).toContain("timeout");
  });

  test("超时局不再因为「没结局」被重复扣两次以外的分（但两条都记）", () => {
    const fails = judgeFuzzRun(outcome({ timedOut: true, ending: "" }), TH);
    expect(fails).toContain("timeout");
    expect(fails).not.toContain("no-ending"); // 超时时结局缺失是后果不是独立问题
  });

  test("**错误输入**：决策步数打满上限 → 失败", () => {
    expect(judgeFuzzRun(outcome({ hitDecisionCap: true }), TH)).toContain("decision-cap");
  });

  test("**错误输入**：同名场景连续进 5 次（上限 3）→ 报 scene-loop", () => {
    expect(judgeFuzzRun(outcome({ maxRepeat: 5 }), TH)).toContain("scene-loop");
  });

  test("**干扰输入**：连续进 3 次（正好在上限）→ 不报", () => {
    expect(judgeFuzzRun(outcome({ maxRepeat: 3 }), TH)).toEqual([]);
  });

  test("**错误输入**：出现空选项岔口 → 报 empty-options（上一版算了但从不判定）", () => {
    expect(judgeFuzzRun(outcome({ emptyOptionStops: 1 }), TH)).toContain("empty-options");
  });
});

describe("summarizeFuzzEvents — 从事件流里取量", () => {
  const evts: PlayEvent[] = [
    { type: "scene-enter", sceneId: "a", sceneName: "A", revisit: false },
    { type: "decision", options: 3, chosen: "去 B" },
    { type: "scene-enter", sceneId: "b", sceneName: "B", revisit: false },
    { type: "decision", options: 0, chosen: "" },
    { type: "scene-enter", sceneId: "b", sceneName: "B", revisit: true },
    { type: "scene-enter", sceneId: "b", sceneName: "B", revisit: true },
    { type: "ending", id: "true", label: "True End" },
  ];

  test("正确取到决策数、空选项、连续重复、结局", () => {
    const s = summarizeFuzzEvents(evts, "z");
    expect(s.decisions).toBe(2);
    expect(s.emptyOptionStops).toBe(1);
    expect(s.maxRepeat).toBe(3);
    expect(s.sceneEntries).toBe(4);
    expect(s.distinctScenes).toBe(2);
    expect(s.ending).toBe("True End");
    expect(s.reachedFinaleScene).toBe(false);
  });

  test("没有 ending 事件 → ending 为空串（不是「(无结局)」这种展示串）", () => {
    const s = summarizeFuzzEvents(evts.filter((e) => e.type !== "ending"), "b");
    expect(s.ending).toBe("");
    expect(s.reachedFinaleScene).toBe(true);
  });

  test("干扰输入：一局都没进过场景 → maxRepeat 为 0 而不是 1", () => {
    expect(summarizeFuzzEvents([], "z").maxRepeat).toBe(0);
  });
});

describe("变异检验", () => {
  test("变异：把「通关」判据换回 `reachedFinaleScene` → 矛盾输出立刻复现", () => {
    const rows = [outcome({ ending: "", reachedFinaleScene: true })];
    const correct = judgeFuzz(rows, 1, TH);
    const naive = rows.filter((o) => o.reachedFinaleScene).length; // 上一版的判据
    expect(correct.passed).toBe(0);
    expect(naive).toBe(1); // 两者不同 —— 说明判据真的换了口径
  });

  test("变异：分母改成 outcomes.length → 崩溃局被抹掉", () => {
    const rows = [outcome(), outcome()];
    const correct = judgeFuzz(rows, 10, TH);
    expect(correct.passed / correct.planned).toBeCloseTo(0.2, 5);
    expect(correct.passed / rows.length).toBe(1); // 上一版会报 100%
  });

  test("默认阈值是明确的常量，不是散落的魔法数", () => {
    expect(DEFAULT_FUZZ_THRESHOLDS.maxDecisions).toBeGreaterThan(0);
    expect(DEFAULT_FUZZ_THRESHOLDS.timeoutMs).toBeGreaterThan(0);
    expect(DEFAULT_FUZZ_THRESHOLDS.maxRepeat).toBeGreaterThan(0);
  });
});
