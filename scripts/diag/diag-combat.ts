// 量 Boss 到底还不还手、玩家掉不掉血。
//
// ── 上一版为什么不可信 ──
// `inCombat.filter(l => /【格斗】/.test(l)).length` 当敌人挥击次数，
// 然后 `swings === 0 ? 报警 : 通过`。三个洞：
//   1. **不验攻击者**：玩家若有个正好叫「格斗」的技能，判据直接变绿。
//   2. **认死技能名**：敌人技能改叫「触手」或「格斗(钳肢)」就一次都不认，
//      静默掉到 0 —— 真报警和漏报长得一模一样。
//   3. **跨局求和**：10 局里 1 局打了 1 下，另外 9 局全程发呆也算「会还手了」。
// 战斗段的行范围也是猜的（`findIndex(/战斗轮/)` 到下一条 `═{10,}`，
// 而 `═` 分隔线在战斗开始处就有三条）。
//
// 现在按 combat-start / combat-round 事件划分战斗与轮次，敌人还手直接读
// `enemy-attack` 事件（自带攻击者与目标）。判据见 src/diagnostics/combat.ts。
process.env.LLM_DISABLED = "true";

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runSeeded } from "../../src/diagnostics/run-harness";
import { writeReport } from "../../src/diagnostics/report";
import { reduceCombat, judgeCombat, type CombatReport } from "../../src/diagnostics/combat";

const N = Number(process.argv[2] ?? 10);
const TIMEOUT_MS = 120_000;
const MAX_DECISIONS = 200;

async function main() {
  const per: CombatReport[] = [];
  let abnormal = 0;
  const abnormalNotes: string[] = [];
  const perRun: string[] = [];

  for (let i = 1; i <= N; i++) {
    const r = await runSeeded(BARN_OF_PREMIER, BARN_SUPPORT, {
      seed: i * 7919, timeoutMs: TIMEOUT_MS, maxDecisions: MAX_DECISIONS,
    });
    if (r.threw || r.timedOut || r.hitDecisionCap) {
      abnormal++;
      abnormalNotes.push(`  #${i} ${r.timedOut ? "超时" : r.hitDecisionCap ? "决策步数打满" : "抛异常"}：${r.errorMessage}`);
    }
    const c = reduceCombat(r.events);
    per.push(c);
    for (const enc of c.encounters) {
      const swings = enc.rounds.reduce((a, rd) => a + rd.enemyAttacks.length, 0);
      const pcAtk = enc.rounds.reduce((a, rd) => a + rd.pcAttacks.length, 0);
      perRun.push(
        `  #${i} vs ${enc.enemy}：${enc.rounds.length} 轮，敌人挥击 ${swings} 次，` +
        `调查员攻击 ${pcAtk} 次，玩家掉血 ${enc.pcHpLost}，结果 ${enc.result}` +
        (swings === 0 ? "   ⚠ 这一局敌人一次都没动" : ""),
      );
    }
  }

  const v = judgeCombat(per);
  const out: string[] = [];
  out.push(`${N} 局（异常 ${abnormal} 局，已计入）：发生战斗 ${v.fights} 局`);
  out.push(...abnormalNotes);
  out.push("");
  out.push("## 敌人还手（按攻击者身份认，不按技能名）");
  out.push("");
  out.push(`  敌人挥击 ${v.enemySwings} 次：命中 ${v.enemyHits}，被闪开 ${v.dodged}，没掷中 ${v.missed}`);
  out.push(`  调查员攻击掷骰 ${v.pcAttacks} 次`);
  out.push(`  战斗中玩家掉血合计 ${v.pcHpLost} 点`);
  out.push(`  攻击者身份对不上的事件 ${v.misattributed} 次（应恒为 0，非 0 说明事件源出问题）`);
  out.push("");
  out.push("## 判据：按**发生战斗的那一局**看，不看跨局总数");
  out.push("");
  if (v.fights === 0) {
    out.push("  · 本轮一局都没打起来 —— 无从判断敌人会不会还手（不是通过，也不是失败）");
  } else if (v.silentFights > 0) {
    out.push(`  ⚠ ${v.silentFights}/${v.fights} 局的敌人一次都没挥击`);
  } else {
    out.push(`  ✓ ${v.fights}/${v.fights} 局敌人都还手了`);
  }
  out.push("");
  out.push("## 战斗中的昏迷（两条成因都认）");
  out.push("");
  const byCause = { "hp-zero": 0, "major-wound-con": 0 };
  for (const k of v.knockouts) byCause[k.cause]++;
  out.push(`  HP 直接归零 ${byCause["hp-zero"]} 次，重伤体质检定失败 ${byCause["major-wound-con"]} 次`);
  out.push("  · 第二条在播报里**没有** `HP n → 0` 那一行，只按文本找必然漏。");
  out.push("");
  out.push("## 战斗结果分布");
  out.push("");
  for (const [k, n] of Object.entries(v.results)) out.push(`  ${k.padEnd(10)} ${n}`);
  out.push("");
  out.push("## 逐局");
  out.push("");
  out.push(...perRun);

  await writeReport("diag-combat.txt", out.join("\n") + "\n");
  console.log(out.join("\n"));
}

main().catch((e) => { console.error(e); process.exit(1); });
