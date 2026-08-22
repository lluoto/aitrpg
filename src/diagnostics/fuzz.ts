// 「随机玩法能不能通关、有没有死循环」——判据本身。
//
// ── 上一版的错 ──
// 1. 「通关」= `entries.includes(终局场景名)`。**进过终局场景不等于故事有收场**：
//    全员倒下时 `evaluateEnding` 返回 null，一个结局字都不会念，
//    但人可能早就进过维修间了。于是同一份输出里并排写着
//    「通关 10/10」和「跑完没有结局 1/10」——两句话互相打脸，都还在。
// 2. 分母是 `rows.length`，而 `rows` 只 push 成功的局。抛异常的局
//    直接从分母消失 —— 越崩越接近 100%。
// 3. `maxRepeat` / `emptyOptionStops` / `blank` 算了但从不判定，也不打印。
// 4. 「死循环」根本没测：既没有超时也没有决策步数上限，真死循环时脚本自己挂着。
//
// ── 现在的判据 ──
//   通关 = 正常返回（无异常、无超时、未触上限）**且**发出了 `ending` 事件。
//   分母 = 计划局数，异常/超时一律算失败。
//   死循环 = 超时 或 决策步数超上限 或 同名场景连续进场超上限。

import type { PlayEvent } from "../play/events";

export type FuzzFailure =
  | "threw"
  | "timeout"
  | "decision-cap"
  | "no-ending"
  | "empty-options"
  | "scene-loop";

export interface FuzzRunOutcome {
  seed: number;
  /** 跑挂了 */
  threw: boolean;
  errorMessage: string;
  /** 超时 */
  timedOut: boolean;
  /** 决策步数打满上限（当作疑似死循环） */
  hitDecisionCap: boolean;
  decisions: number;
  /** 出现过「一个选项都没有」的岔口 */
  emptyOptionStops: number;
  /** 连续进同一个场景的最大次数 */
  maxRepeat: number;
  sceneEntries: number;
  distinctScenes: number;
  /** 正式结局标签；没有就是空串 */
  ending: string;
  reachedFinaleScene: boolean;
}

export interface FuzzThresholds {
  /** 单局最长耗时（毫秒） */
  timeoutMs: number;
  /** 单局最多决策步数 */
  maxDecisions: number;
  /** 同名场景最多连续进几次 */
  maxRepeat: number;
}

export const DEFAULT_FUZZ_THRESHOLDS: FuzzThresholds = {
  timeoutMs: 120_000,
  maxDecisions: 200,
  maxRepeat: 3,
};

/** 从一局的事件流里抽出判据要用的量。与是否抛异常无关，所以单独一支 */
export function summarizeFuzzEvents(
  events: readonly PlayEvent[],
  finaleSceneId: string,
): Pick<FuzzRunOutcome, "decisions" | "emptyOptionStops" | "maxRepeat" | "sceneEntries" | "distinctScenes" | "ending" | "reachedFinaleScene"> {
  const entries: string[] = [];
  let decisions = 0;
  let emptyOptionStops = 0;
  let ending = "";
  for (const e of events) {
    if (e.type === "scene-enter") entries.push(e.sceneId);
    else if (e.type === "decision") {
      decisions++;
      if (e.options === 0) emptyOptionStops++;
    } else if (e.type === "ending") ending = e.label;
  }
  let maxRepeat = entries.length > 0 ? 1 : 0;
  let cur = entries.length > 0 ? 1 : 0;
  for (let i = 1; i < entries.length; i++) {
    if (entries[i] === entries[i - 1]) { cur++; maxRepeat = Math.max(maxRepeat, cur); }
    else cur = 1;
  }
  return {
    decisions,
    emptyOptionStops,
    maxRepeat,
    sceneEntries: entries.length,
    distinctScenes: new Set(entries).size,
    ending,
    reachedFinaleScene: entries.includes(finaleSceneId),
  };
}

/**
 * 一局算不算通过。
 *
 * ⚠ 「通关」的定义是**正常返回且产生正式结局**。
 * `reachedFinaleScene` 一个字都不参与判定 —— 它只在报告里当对照，
 * 用来把「走到了终局场景却没有结局」这种局显式点出来。
 */
export function judgeFuzzRun(o: FuzzRunOutcome, th: FuzzThresholds): FuzzFailure[] {
  const fails: FuzzFailure[] = [];
  if (o.threw) fails.push("threw");
  if (o.timedOut) fails.push("timeout");
  if (o.hitDecisionCap) fails.push("decision-cap");
  if (o.emptyOptionStops > 0) fails.push("empty-options");
  if (o.maxRepeat > th.maxRepeat) fails.push("scene-loop");
  if (!o.threw && !o.timedOut && o.ending === "") fails.push("no-ending");
  return fails;
}

export interface FuzzReport {
  planned: number;
  /** 通关 = 判据零失败项 */
  passed: number;
  byFailure: Record<FuzzFailure, number>;
  /** 走到终局场景却没结局的局 —— 上一版把这类算成「通关」 */
  finaleWithoutEnding: number;
  endings: Record<string, number>;
  rows: { outcome: FuzzRunOutcome; fails: FuzzFailure[] }[];
}

export function judgeFuzz(
  outcomes: readonly FuzzRunOutcome[],
  planned: number,
  th: FuzzThresholds,
): FuzzReport {
  const report: FuzzReport = {
    planned,
    passed: 0,
    byFailure: { threw: 0, timeout: 0, "decision-cap": 0, "no-ending": 0, "empty-options": 0, "scene-loop": 0 },
    finaleWithoutEnding: 0,
    endings: {},
    rows: [],
  };
  for (const o of outcomes) {
    const fails = judgeFuzzRun(o, th);
    report.rows.push({ outcome: o, fails });
    if (fails.length === 0) report.passed++;
    for (const f of fails) report.byFailure[f]++;
    if (o.reachedFinaleScene && o.ending === "") report.finaleWithoutEnding++;
    const key = o.ending || "(无结局)";
    report.endings[key] = (report.endings[key] ?? 0) + 1;
  }
  // 分母是**计划局数**：没跑出结果的局（进程崩了、被杀了）也是失败，
  // 不能从分母里消失。上一版用 rows.length，越崩越接近 100%。
  const missing = planned - outcomes.length;
  if (missing > 0) report.byFailure.threw += missing;
  return report;
}
