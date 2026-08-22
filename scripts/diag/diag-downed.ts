// 量「昏迷的调查员是不是还在**自己掷骰**」。
//
// ── 范围（上一版没写清，名称/实现/报告三处不一致）──
// 只管该角色**自己发起的技能检定**。不管 SAN 检定（被动反应，单列计数）、
// 不管同伴替他做的事（急救掷骰的人是施救者）、不管说话和被拖走（引擎里没有对应掷骰）。
//
// ── 上一版为什么不可信 ──
// 它认 `❤ X HP n → 0（昏迷` 这一行。但昏迷有两条路径：
//   1. 伤害把 HP 打到 0        → 有那行
//   2. 重伤体质检定失败        → **没有那行**（HP 还剩着，人先倒了）
// 第 2 条整条漏掉，「违规 0 次」于是既可能是真没问题、也可能是根本没在看，
// 两种情况输出一模一样。现在改读结构化事件（src/play/events.ts），
// 判据在 src/diagnostics/downed.ts，有正例/反例/干扰项校准测试。
process.env.LLM_DISABLED = "true";

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runSeeded } from "../../src/diagnostics/run-harness";
import { writeReport } from "../../src/diagnostics/report";
import { reduceDowned, mergeDowned, type DownedReport } from "../../src/diagnostics/downed";

// 用法：bun scripts/diag/diag-downed.ts [局数] [起始局号]
// 起始局号让「每次最多跑 N 局」也能覆盖到不同的种子段：
//   bun scripts/diag/diag-downed.ts 3 1   → 第 1~3 局
//   bun scripts/diag/diag-downed.ts 3 4   → 第 4~6 局（与上面不重叠）
const N = Number(process.argv[2] ?? 20);
const FROM = Number(process.argv[3] ?? 1);
const TIMEOUT_MS = 120_000;
const MAX_DECISIONS = 200;

async function main() {
  const per: DownedReport[] = [];
  let koRuns = 0, bothRuns = 0, abnormal = 0, ambiguous = 0;
  const abnormalNotes: string[] = [];
  const ambiguityNotes: string[] = [];

  for (let i = FROM; i < FROM + N; i++) {
    const r = await runSeeded(BARN_OF_PREMIER, BARN_SUPPORT, {
      seed: i * 7919, timeoutMs: TIMEOUT_MS, maxDecisions: MAX_DECISIONS,
    });
    if (r.threw || r.timedOut || r.hitDecisionCap) {
      // 异常局照样要报出来。上一版直接 continue，等于把坏局从分母里删掉。
      abnormal++;
      abnormalNotes.push(`  #${i} ${r.timedOut ? "超时" : r.hitDecisionCap ? "决策步数打满" : "抛异常"}：${r.errorMessage}`);
    }
    const d = reduceDowned(r.events);
    per.push(d);
    if (d.everDown.length > 0) koRuns++;
    if (d.allDown) bothRuns++;
    if (d.ambiguousIdentity) {
      ambiguous++;
      ambiguityNotes.push(`  #${i}（seed ${i * 7919}）${d.ambiguityReason}`);
    }
  }

  const m = mergeDowned(per);
  const out = [
    `范围：**昏迷期间该角色自己发起的技能检定**。`,
    `SAN 检定（被动反应）、同伴代做的检定、受伤那一刻的重伤结算检定都不算违规，但都单列计数。`,
    ``,
    `第 ${FROM}~${FROM + N - 1} 局，共 ${N} 局（异常 ${abnormal} 局，已计入）：出现昏迷 ${koRuns} 局，两人同时倒下 ${bothRuns} 局`,
    ...abnormalNotes,
    ``,
    `倒下成因：HP 直接归零 ${m.byCause["hp-zero"]} 次，重伤体质检定失败 ${m.byCause["major-wound-con"]} 次`,
    `急救唤醒成功 ${m.revives} 次；苏醒后本人正常检定 ${m.checksAfterRevive} 次（这些**不是**违规）`,
    `昏迷期间同伴代做的检定 ${m.byPartnerWhileDown} 次（不是违规）`,
    `昏迷期间的 SAN 检定 ${m.sanWhileDowned} 次（范围外，被动反应）`,
    `受伤当场的重伤结算检定豁免 ${m.settlementExempt} 次`,
    ``,
    `**${ambiguous > 0 ? "疑似违规（见下方身份不可分辨）" : "违规（昏迷期间本人掷骰）"}：${m.violations.length} 次**`,
    ...m.violations.slice(0, 8).map((v) => `    ${v.actor} 【${v.skill}】（倒下成因：${v.cause}）`),
    ...(ambiguous > 0
      ? ["", `⚠ 有 ${ambiguous} 局**身份不可分辨**，这些局的违规计数既不能算通过也不能算违规：`, ...ambiguityNotes]
      : []),
    ``,
    ambiguous > 0
      ? "◻ 本轮**不可判定** —— 先把重名那几局排除掉再看结论"
      : m.byCause["hp-zero"] + m.byCause["major-wound-con"] === 0
        ? "· 本轮没有人倒下 —— 这不等于判据通过，只是没有可判的样本"
        : m.violations.length === 0
          ? "✓ 昏迷期间没有本人发起的技能检定"
          : "⚠ 仍有倒下的人在掷骰",
  ].join("\n");

  await writeReport("diag-downed.txt", out + "\n");
  console.log(out);
}

main().catch((e) => { console.error(e); process.exit(1); });
