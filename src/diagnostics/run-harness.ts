// 诊断脚本共用的跑局脚手架：确定性随机、事件收集、超时与决策步数上限。
//
// ── 为什么要接管 `Math.random` ──
// 上一版每个诊断脚本自己写一个 LCG，然后**只用它挑选项**：
//     const chose = options[Math.floor(rnd() * options.length)]
// 车卡、骰子、伤害、敌人逃跑判定、叙事措辞全都还走 `Math.random()`。
// 于是 `seed` 只控制「走哪条路」，同一个 seed 两次跑出来的战斗结果不一样 ——
// 拿它当确定性回归依据是错的。
// 要么把整条 RNG 注进去，要么在报告里写明「不可复现」。这里选前者：
// 跑局期间整体替换 `Math.random`，跑完立刻还原。
//
// ⚠ 因为是全局替换，**同一时刻只能跑一局**。并发跑会互相串号，
//   `withSeededRandom` 里有断言拦着。

import { runModule } from "../play-module";
import type { ModuleData, ModuleSupport } from "../module/types";
import type { PlayEvent } from "../play/events";
import type { PlayerDecision } from "../agent/player-agent";

/** 决策步数打满 —— 当作疑似死循环，不是正常结束 */
export class DecisionCapError extends Error {
  constructor(public readonly cap: number) {
    super(`决策步数超过上限 ${cap}，疑似死循环`);
    this.name = "DecisionCapError";
  }
}

/** 单局超时 —— 在决策点协作式中断 */
export class RunTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`单局超过 ${ms}ms，疑似死循环`);
    this.name = "RunTimeoutError";
  }
}

let seededDepth = 0;

/**
 * 在整局期间用可复现的 LCG 顶替 `Math.random`。
 *
 * 返回值同时给出「这一局取了多少次随机数」—— 两次同 seed 的取数次数不同
 * 就说明还有别的随机源没被接管。
 */
export async function withSeededRandom<T>(seed: number, fn: () => Promise<T>): Promise<{ value: T; draws: number }> {
  if (seededDepth > 0) {
    throw new Error("withSeededRandom 不能嵌套/并发：Math.random 是全局的，两局会互相串号");
  }
  seededDepth++;
  const real = Math.random;
  let n = (seed >>> 0) || 1;
  let draws = 0;
  Math.random = () => {
    n = (Math.imul(n, 1103515245) + 12345) & 0x7fffffff;
    draws++;
    return n / 0x7fffffff;
  };
  try {
    const value = await fn();
    return { value, draws };
  } finally {
    Math.random = real;
    seededDepth--;
  }
}

export interface HarnessOptions {
  seed: number;
  /** 单局最长耗时（毫秒）。在决策点检查，超了就抛 RunTimeoutError */
  timeoutMs: number;
  /** 单局最多决策步数。超了就抛 DecisionCapError */
  maxDecisions: number;
  /** 要不要留播报文本。只看事件的诊断可以关掉省内存 */
  keepLines?: boolean;
}

export interface HarnessResult {
  seed: number;
  events: PlayEvent[];
  lines: string[];
  decisions: number;
  /** 本局取了多少次随机数 —— 复现性自检用 */
  draws: number;
  elapsedMs: number;
  threw: boolean;
  timedOut: boolean;
  hitDecisionCap: boolean;
  errorMessage: string;
}

/**
 * 跑一局，把事件流收回来。
 *
 * 决策器是「按种子随机挑一个选项」，最接近真人：既不是永远听引擎的，
 * 也不是永远对着干。空选项时返回空串并照实记一笔（引擎那边会当没选）。
 */
export async function runSeeded(
  module: ModuleData,
  support: ModuleSupport,
  opts: HarnessOptions,
): Promise<HarnessResult> {
  const events: PlayEvent[] = [];
  const lines: string[] = [];
  let decisions = 0;
  let timedOut = false;
  let hitDecisionCap = false;
  const started = Date.now();

  const decide = async (_ctx: string, options: string[]): Promise<PlayerDecision> => {
    decisions++;
    if (decisions > opts.maxDecisions) {
      hitDecisionCap = true;
      throw new DecisionCapError(opts.maxDecisions);
    }
    if (Date.now() - started > opts.timeoutMs) {
      timedOut = true;
      throw new RunTimeoutError(opts.timeoutMs);
    }
    const chose = options[Math.floor(Math.random() * options.length)] ?? "";
    return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
  };

  let threw = false;
  let errorMessage = "";
  let draws = 0;
  try {
    const r = await withSeededRandom(opts.seed, async () => {
      await runModule(module, support, {
        onEvent: (e) => events.push(e),
        onLine: opts.keepLines ? (l) => lines.push(l) : undefined,
        decide,
      });
    });
    draws = r.draws;
  } catch (e) {
    threw = true;
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return {
    seed: opts.seed, events, lines, decisions, draws,
    elapsedMs: Date.now() - started,
    // 超时/步数上限是**专门的失败**，不该混进「跑挂了」
    threw: threw && !timedOut && !hitDecisionCap,
    timedOut, hitDecisionCap, errorMessage,
  };
}
