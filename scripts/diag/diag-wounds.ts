// 量伤势分级 / 重伤体质检定 / 惩罚骰到底有没有生效。
//
// ── 上一版为什么不可信 ──
// 1. `lines.filter(l => /惩罚骰/.test(l))` 当成「伤势惩罚生效」的证据。
//    播报里带这三个字的至少三种来源：伤势 `[1惩罚骰·伤势]`、
//    环境 `[1惩罚骰]`、战斗疲劳 `[惩罚骰×2]`。混成一堆之后
//    **把 `recordWound()` 整个删掉，计数照样非零** —— 判据不会变红。
// 2. 只按播报标签分档。HP 归零那行的后缀被写死成「（昏迷/濒死！）」，
//    把伤势标签盖掉了，最该统计的那一档必然漏。
// 3. 「40 局 74 次伤害，≥50% 有 4 次」是**跨局汇总**，没有按角色、按顺序
//    验证「这 4 次各自后面跟了一次体质检定」。前者成立不代表后者成立。
//
// 现在按角色、按事件顺序跑状态机验四条不变量（见 src/diagnostics/wounds.ts，
// 那边有正例/反例/干扰项校准测试，删 recordWound / 删 CON 检定 / 去 ignoreWound
// 三种变异各有一条测试抓住）。
process.env.LLM_DISABLED = "true";

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runSeeded } from "../../src/diagnostics/run-harness";
import { writeReport } from "../../src/diagnostics/report";
import { reduceWounds, mergeWounds, type WoundReport } from "../../src/diagnostics/wounds";

const N = Number(process.argv[2] ?? 12);
const TIMEOUT_MS = 120_000;
const MAX_DECISIONS = 200;

const BREACH_LABEL: Record<string, string> = {
  "missing-con": "重伤之后没有体质检定",
  "duplicate-con": "同一次重伤掷了多次体质检定",
  "con-self-penalized": "体质检定被它自己结算的那处伤罚（双重计算）",
  "wound-penalty-missing": "身上有伤，读伤势的检定却没带惩罚骰",
  "penalty-after-heal": "伤势已处理，却还在扣伤势惩罚骰",
  "missing-wound-record": "重伤且人还站着，却没把伤势记下来（recordWound 没生效）",
};

async function main() {
  const per: WoundReport[] = [];
  let abnormal = 0;
  const abnormalNotes: string[] = [];

  for (let i = 1; i <= N; i++) {
    const r = await runSeeded(BARN_OF_PREMIER, BARN_SUPPORT, {
      seed: i * 7919, timeoutMs: TIMEOUT_MS, maxDecisions: MAX_DECISIONS,
    });
    if (r.threw || r.timedOut || r.hitDecisionCap) {
      abnormal++;
      abnormalNotes.push(`  #${i} ${r.timedOut ? "超时" : r.hitDecisionCap ? "决策步数打满" : "抛异常"}：${r.errorMessage}`);
    }
    per.push(reduceWounds(r.events));
  }

  const m = mergeWounds(per);
  const byKind = new Map<string, number>();
  for (const b of m.breaches) byKind.set(b.kind, (byKind.get(b.kind) ?? 0) + 1);

  const out: string[] = [];
  out.push(`${N} 局（异常 ${abnormal} 局，已计入）`);
  out.push(...abnormalNotes);
  out.push("");
  out.push("## 伤势分级（按引擎算出的 severity，不看播报标签）");
  out.push("");
  out.push(`  伤害事件 ${m.damages} 次`);
  for (const [k, v] of Object.entries(m.severityBuckets)) out.push(`  ${k.padEnd(9)} ${v}`);
  out.push("");
  out.push("  ⚠ HP 归零那一行的播报后缀是「昏迷/濒死！」，按文本分档会把这一档整个漏掉。");
  out.push("");
  out.push("## 重伤流程");
  out.push("");
  out.push(`  deep/grievous 且人还站着：${m.majorWoundsStanding} 次 → 应有同样次数的重伤体质检定`);
  out.push(`  deep/grievous 但当场昏迷：${m.majorWoundsWhileDown} 次 → **不该**掷体质检定（人已经躺下，那一掷没什么可决定的）`);
  out.push("    · 口径由 `needsMajorWoundCheck()` 一处说了算。四个调用点原先两种写法，");
  out.push("      判据当时只能把这一档单列出来不下结论 —— 判据被实现的不一致逼哑了。");
  out.push(`  实际重伤体质检定：${m.conChecks} 次`);
  out.push(`  记下的伤势：${m.woundsRecorded} 次，处理掉：${m.woundsHealed} 次`);
  out.push("");
  out.push("## 惩罚骰来源必须分开");
  out.push("");
  out.push(`  真被伤势罚到的检定：${m.woundPenalizedChecks} 次   ← 这是伤势机制生效的**唯一**证据`);
  out.push(`  只带环境/疲劳惩罚的检定：${m.envOnlyPenalizedChecks} 次   ← 不许拿它充数`);
  out.push(`  有伤但该掷骰路径不读伤势：${m.woundBlindRolls} 次   ← 应为 0，见下`);
  out.push("");
  out.push("  · 战斗里调查员的攻击掷骰原先直接调 `CoCEngine.skillCheck`，绕过 `checks.ts` 的");
  out.push("    `check()`，伤势惩罚在战斗攻击上一点作用都没有。这个缺口正是「按来源分账」");
  out.push("    之后露出来的：记下的伤势有好几处，真被伤势罚到的检定却几乎为零。");
  out.push("    现已接上（疲劳与伤势分别标注，合计仍受 CoC 7e 的 2 颗上限约束）。");
  out.push("    这一行留着守回归：再有谁另开一条绕过 `check()` 的路，它会立刻非零。");
  out.push("");
  out.push("## 不变量破例");
  out.push("");
  if (m.breaches.length === 0) {
    out.push(`  ✓ 无破例（${m.majorWoundsStanding} 次重伤各自恰有一次不受自身伤势影响的体质检定，`);
    out.push(`    ${m.woundPenalizedChecks} 次后续检定带伤势惩罚，${m.woundsHealed} 次处理后惩罚消失）`);
    if (m.majorWoundsStanding === 0) {
      out.push("  · 但本轮 0 次重伤 —— 「无破例」在这里只说明没有可判的样本，不说明机制生效");
    }
  } else {
    out.push(`  ✗ ${m.breaches.length} 处破例：`);
    for (const [k, v] of byKind) out.push(`    ${v} × ${BREACH_LABEL[k] ?? k}`);
    out.push("");
    for (const b of m.breaches.slice(0, 10)) out.push(`    ${JSON.stringify(b)}`);
  }

  await writeReport("diag-wounds.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
