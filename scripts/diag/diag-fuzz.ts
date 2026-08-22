// 随机策略跑多局，找只在特定路径上冒出来的毛病。
//
// ── 上一版为什么不可信 ──
// 可复现的反例（它自己的输出）：
//     通关 10/10
//     跑完没有结局的局：1/10
// 两句话互相打脸，因为「通关」量的是**进过终局场景**，而「有没有结局」
// 量的是**念没念结局文本**。全员倒下时 `evaluateEnding` 返回 null，
// 一个结局字都不会念，但人可能早就进过维修间了。
//
// 另外三处：
//   · 分母是 `rows.length`，而 `rows` 只 push 成功的局 —— 越崩越接近 100%。
//   · `maxRepeat` / `emptyOptionStops` / `blank` 算了但从不判定也不打印。
//   · 「死循环」根本没测：既没超时也没决策步数上限，真死循环时脚本自己挂着。
//   · seed 只控制选项，骰子和战斗仍走 `Math.random()` —— 拿它当确定性依据是错的。
//
// 现在：通关 = 正常返回 **且** 发出 `ending` 事件；分母固定为计划局数；
// 每局有超时和决策步数上限；`maxRepeat`/空选项都参与判定并打印；
// 整条 RNG 注入（见 run-harness），并跑一次同 seed 复现自检把结论量出来。
process.env.LLM_DISABLED = "true";

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runSeeded } from "../../src/diagnostics/run-harness";
import { writeReport } from "../../src/diagnostics/report";
import {
  summarizeFuzzEvents, judgeFuzz, DEFAULT_FUZZ_THRESHOLDS,
  type FuzzRunOutcome,
} from "../../src/diagnostics/fuzz";

// 用法：bun scripts/diag/diag-fuzz.ts [局数] [起始局号]
// 起始局号让「每次最多跑 N 局」也能覆盖不同的种子段而不重叠。
const PLANNED = Number(process.argv[2] ?? 10);
const FROM = Number(process.argv[3] ?? 1);
const TH = { ...DEFAULT_FUZZ_THRESHOLDS, timeoutMs: 90_000, maxDecisions: 120 };
const FINALE = BARN_SUPPORT.finaleSceneId;

const FAIL_LABEL: Record<string, string> = {
  threw: "抛异常",
  timeout: "超时（疑似死循环）",
  "decision-cap": "决策步数打满（疑似死循环）",
  "no-ending": "跑完没有正式结局",
  "empty-options": "出现空选项岔口",
  "scene-loop": "同名场景连续进场超上限",
};

async function main() {
  const outcomes: FuzzRunOutcome[] = [];

  for (let i = FROM; i < FROM + PLANNED; i++) {
    const seed = i * 7919;
    const r = await runSeeded(BARN_OF_PREMIER, BARN_SUPPORT, {
      seed, timeoutMs: TH.timeoutMs, maxDecisions: TH.maxDecisions,
    });
    const s = summarizeFuzzEvents(r.events, FINALE);
    outcomes.push({
      seed,
      threw: r.threw, errorMessage: r.errorMessage,
      timedOut: r.timedOut, hitDecisionCap: r.hitDecisionCap,
      ...s,
      decisions: r.decisions, // 以脚手架计数为准（抛异常时事件可能没走完）
    });
  }

  const report = judgeFuzz(outcomes, PLANNED, TH);

  // 复现自检：同一个 seed 再跑一遍，比事件流。
  // 「seed 能不能当确定性回归依据」是个**可测量**的问题，不该靠声称。
  const a = await runSeeded(BARN_OF_PREMIER, BARN_SUPPORT, { seed: 7919, timeoutMs: TH.timeoutMs, maxDecisions: TH.maxDecisions, keepLines: true });
  const b = await runSeeded(BARN_OF_PREMIER, BARN_SUPPORT, { seed: 7919, timeoutMs: TH.timeoutMs, maxDecisions: TH.maxDecisions, keepLines: true });
  const eventsSame = JSON.stringify(a.events) === JSON.stringify(b.events);
  const linesSame = a.lines.join("\n") === b.lines.join("\n");

  const out: string[] = [];
  out.push(`# 随机玩法 fuzz（第 ${FROM}~${FROM + PLANNED - 1} 局，计划 ${PLANNED} 局）`);
  out.push("");
  out.push("判据：**通关 = 正常返回且产生正式结局**（`ending` 事件）。");
  out.push("「进过终局场景」不参与判定，只作对照 —— 上一版把它当通关，于是同一份输出里");
  out.push("「通关 10/10」和「跑完没有结局 1/10」同时成立。");
  out.push("");
  out.push(`阈值：单局超时 ${TH.timeoutMs}ms，最多决策 ${TH.maxDecisions} 步，同名场景最多连续进 ${TH.maxRepeat} 次。`);
  out.push("");
  out.push("## 结论");
  out.push("");
  out.push(`**通关 ${report.passed}/${report.planned}**`);
  out.push("");
  out.push("| 失败项 | 局数 |");
  out.push("|---|---|");
  for (const [k, n] of Object.entries(report.byFailure)) out.push(`| ${FAIL_LABEL[k] ?? k} | ${n} |`);
  out.push("");
  out.push(`走到终局场景却没有结局：${report.finaleWithoutEnding} 局`);
  out.push("（这个数**必然**已经包含在上面的「跑完没有正式结局」里；两者不再互相矛盾）");
  out.push("");
  out.push("结局分布：");
  out.push("");
  for (const [k, n] of Object.entries(report.endings)) out.push(`  ${k.padEnd(16)} ${n}`);
  out.push("");
  out.push("## 复现性自检（同 seed 连跑两局）");
  out.push("");
  out.push(`  事件流一致：${eventsSame ? "是" : "否"}（draws ${a.draws} vs ${b.draws}）`);
  out.push(`  播报文本一致：${linesSame ? "是" : "否"}`);
  out.push("");
  if (eventsSame && linesSame) {
    out.push("  ✓ 整条 RNG 已注入且没有跨局残留状态，事件流与播报文本都可复现，");
    out.push("    seed **可以**作确定性回归依据。");
  } else if (eventsSame) {
    out.push("  · 事件流可复现，可作回归依据；播报文本不可复现 —— 说明还有**跨局残留的状态**");
    out.push("    （不是随机源，随机源会连事件流一起打乱）。**不要用文本 diff 做回归**，");
    out.push("    并把残留的那份状态找出来收进 RunContext / Dedup。");
  } else {
    out.push("  ⚠ 事件流都不可复现 —— 还有未被 `withSeededRandom` 接管的随机源，");
    out.push("    seed 不能当确定性依据。先把它找出来，别拿 seed 做回归。");
  }
  out.push("");
  out.push("## 逐局");
  out.push("");
  out.push("| 局 | seed | 进场 | 不同场景 | 决策 | 最大连续同场景 | 空选项 | 到终局场景 | 结局 | 判定 |");
  out.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const { outcome: o, fails } of report.rows) {
    out.push(
      `| ${report.rows.indexOf(report.rows.find((r) => r.outcome === o)!) + 1} | ${o.seed} | ${o.sceneEntries} | ${o.distinctScenes} | ` +
      `${o.decisions} | ${o.maxRepeat} | ${o.emptyOptionStops} | ${o.reachedFinaleScene} | ${o.ending || "(无)"} | ` +
      `${fails.length === 0 ? "通关" : fails.map((f) => FAIL_LABEL[f] ?? f).join("、")} |`,
    );
  }

  await writeReport("diag-fuzz.md", out.join("\n") + "\n");
  console.log(`通关 ${report.passed}/${report.planned}｜没结局 ${report.byFailure["no-ending"]}｜走到终局场景却没结局 ${report.finaleWithoutEnding}｜事件流可复现 ${eventsSame}  -> analysis/diag/diag-fuzz.md`);
}

main().catch((e) => { console.error("跑挂了:", e); process.exit(1); });
