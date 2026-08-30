// GameSession（自由跑团路径）的确定性跑局装置。
//
// ── 为什么不能直接用 runSeeded ──
// runSeeded()（同目录 run-harness.ts）是剧本杀路径（play-module.ts）的
// 跑局装置：引擎给出一组选项，decide() 按种子随机挑一个——这是"选项驱动"
// 模型，适合剧本杀，因为剧本杀本来就是每一步都有限定选项。
// GameSession 的自由跑团路径没有选项可挑：玩家输入是自由文本
// （act(input, pcId?)）。给它接一个"随机挑输入"的策略没有意义——
// 那只会随机生成一堆引擎多半读不懂的字符串，测不出真实回归。
// 这里改成**输入脚本驱动**：调用方给一份固定的 {input, pcId?}[]，装置
// 逐条喂给 act()，只负责收集每一步的可观测状态快照，不参与"选什么"的
// 决策。脚本本身固定，才有"同 seed+同脚本两次跑一样"的回归价值——
// 若改成随机挑输入，比较两次跑的输出就失去意义（连输入都不一样）。
//
// ── 复用而非重造 ──
// withSeededRandom/DecisionCapError/RunTimeoutError 全部来自 run-harness.ts
// （现已导出），不是另写一份 LCG 或另定义一组同形状的错误类。步数上限与
// 超时的语义与 runSeeded 完全一致："超过上限"当作疑似死循环处理，不是
// 正常结束。
//
// ⚠ 同 withSeededRandom 本身的限制：不能嵌套/并发（Math.random 是全局
// 的，两局会互相串号）——runGameSessionScript() 内部只调用一次
// withSeededRandom，调用方也不能在它跑的时候另起一局或调用 runSeeded。
//
// 用它能钉住什么、钉不住什么：能钉住"同样的脚本、同样的种子，引擎产生
// 的骰子结果/叙述文本/场景状态是否一致"这类确定性回归（移动计时、复合句
// 回问、结局判定），钉不住"LLM 对自由文本的意图判断准不准"——这仍然
// 只有跑真实 LLM 的模拟能测（本仓测试默认离线，parseIntent 走 regex
// 兜底，与真实 LLM 判断不总一致，见 compound-move-reask.test.ts 头注释）。
//
// bun test src/__tests__/game-session-run-harness.test.ts

import type { GameSession, ActionResponse } from "../api/game-session";
import { withSeededRandom, DecisionCapError, RunTimeoutError } from "./run-harness";

/** 脚本里的一步：一段自由文本输入，可选指定以哪个 pcId 行动。 */
export interface GameSessionScriptStep {
  input: string;
  pcId?: string;
}

/** 每一步跑完后的可观测状态快照，不做任何解读，原样搬运 act() 的返回值。 */
export interface GameSessionStepSnapshot {
  step: number;
  input: string;
  pcId?: string;
  narrative: string;
  events: ActionResponse["events"];
  scene: string;
  round: number;
  gameTime: ActionResponse["state"]["gameTime"];
  party: ActionResponse["state"]["party"];
  dead: boolean;
}

export interface GameSessionScriptOptions {
  seed: number;
  /** 整个脚本最长耗时（毫秒）。在每一步之前检查，超了就抛 RunTimeoutError。 */
  timeoutMs: number;
  /** 最多跑多少步。超了就抛 DecisionCapError——脚本本身长度超限也算异常，不是静默截断。 */
  maxSteps: number;
}

export interface GameSessionScriptResult {
  seed: number;
  steps: GameSessionStepSnapshot[];
  /** 本局取了多少次随机数——复现性自检用，同 runSeeded 的 draws 同一用途。 */
  draws: number;
  elapsedMs: number;
  threw: boolean;
  timedOut: boolean;
  hitStepCap: boolean;
  errorMessage: string;
}

/**
 * 用给定的输入脚本，在确定性随机下跑一遍 GameSession。
 *
 * session 由调用方构造并传入（不是这个函数负责建会话），因为构造参数
 * （ruleset/llmConfig/archetype 等）与本装置无关——装置只管"喂脚本、
 * 收快照"，不管"怎么建一局"。
 */
export async function runGameSessionScript(
  session: GameSession,
  script: GameSessionScriptStep[],
  opts: GameSessionScriptOptions,
): Promise<GameSessionScriptResult> {
  const steps: GameSessionStepSnapshot[] = [];
  const started = Date.now();
  let timedOut = false;
  let hitStepCap = false;
  let threw = false;
  let errorMessage = "";
  let draws = 0;

  try {
    const r = await withSeededRandom(opts.seed, async () => {
      for (let i = 0; i < script.length; i++) {
        if (i >= opts.maxSteps) {
          hitStepCap = true;
          throw new DecisionCapError(opts.maxSteps);
        }
        if (Date.now() - started > opts.timeoutMs) {
          timedOut = true;
          throw new RunTimeoutError(opts.timeoutMs);
        }
        const stepDef = script[i];
        const res = await session.act(stepDef.input, stepDef.pcId);
        steps.push({
          step: i,
          input: stepDef.input,
          pcId: stepDef.pcId,
          narrative: res.narrative,
          events: res.events,
          scene: res.state.scene,
          round: res.state.round,
          gameTime: res.state.gameTime,
          party: res.state.party,
          dead: res.dead === true,
        });
      }
    });
    draws = r.draws;
  } catch (e) {
    threw = true;
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  return {
    seed: opts.seed, steps, draws,
    elapsedMs: Date.now() - started,
    // 超时/步数上限是专门的失败，不该混进"跑挂了"——与 runSeeded 的
    // threw 字段同一约定。
    threw: threw && !timedOut && !hitStepCap,
    timedOut, hitStepCap, errorMessage,
  };
}
