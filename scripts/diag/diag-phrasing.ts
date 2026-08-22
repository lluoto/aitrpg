// 量「玩家说的话没被匹配上、引擎替他挑了」有多频繁。
//
// ⚠ 判据本身返工过一次（见 docs/review-request.md 第 6 条）。上一版的问题：
//   1. 12 种说法里 8 种都含完整地名 → 跑出 100%，看着像匹配很好，
//      其实只说明用例太容易。补进会掉的用例后是 66.9%。
//   2. 「换个地方看看」「去那边」这种句子**根本没指定目标**，
//      却被算进「目标命中率」的分母。分子必然是 0，指标不度量任何东西。
//      这类输入唯一能要求的是：引擎必须承认自己是替玩家挑的（forced=true）。
//   3. 报告写着「8 种说法」，实际列了 12 种。
//   4. 只按模组给的连接顺序跑一遍 —— 干扰项恰好排在目标之后时全绿，
//      实现改错也发现不了（同一份 review 的第 3 条错就是这么来的）。
//
// 现在：用例分正例 / 反例 / 歧义三类，各有各的判据（见 src/diagnostics/phrasing.ts，
// 那边有正反例校准测试）；每条用例按原序和逆序各跑一遍。
process.env.LLM_DISABLED = "true";

import { chooseConnection, type MoveWorldView } from "../../src/play-module";
import { matchKeys } from "../../src/play/move-util";
import { BARN_OF_PREMIER } from "../../src/module/barn-of-premier";
import type { SceneConnection } from "../../src/module/types";
import {
  addPhraseResult, newPhraseReport, pct,
  type PhraseCase, type PhraseOutcome,
} from "../../src/diagnostics/phrasing";
import { writeReport } from "../../src/diagnostics/report";

const view: MoveWorldView = {
  isSceneVisited: () => false,
  visitCount: () => 0,
  sceneExists: (id) => BARN_OF_PREMIER.scenes.some((s) => s.id === id),
  sceneName: (id) => BARN_OF_PREMIER.scenes.find((s) => s.id === id)?.name ?? "",
};

const nameOf = (c: SceneConnection) => view.sceneName(c.targetSceneId);
const stripVerb = (s: string) => s.replace(/^(前往|进入|返回|回到|离开|去|到)\s*/, "").trim();

/**
 * 这个说法在这组连接里是不是只对应**一个目标场景**。
 *
 * ⚠ 数的是**目的地**不是连接。`maintenance_room` 有两条连接都通向 `sewer`
 * （「返回下水道」/「通过奇怪管道」），按连接数算会把「去下水」判成歧义 ——
 * 可玩家想去哪儿一点都不含糊，两条路通同一个地方。
 * 这跟前面「别去下水道，去下水道」是同一个错：拿连接当身份，而身份是场景。
 */
function uniqueAmong(phrase: string, conns: SceneConnection[], target: SceneConnection): boolean {
  if (phrase.length < 2) return false;
  const hits = conns.filter((c) => matchKeys(c, view).some((k) => k.includes(phrase) || phrase.includes(k)));
  const targets = new Set(hits.map((c) => c.targetSceneId));
  return targets.size === 1 && targets.has(target.targetSceneId);
}

/**
 * 别的连接里有没有哪个键是这句话的子串 —— 有就是「重叠地名」陷阱。
 *
 * 比的是 `targetSceneId` 而不是连接对象：同一个场景可以挂两条连接
 * （`maintenance_room` 有两条都通向 `sewer`），拿另一条当干扰项
 * 会造出「别去下水道，去下水道」这种判不出东西的用例。
 */
function overlappingRival(said: string, conns: SceneConnection[], target: SceneConnection): SceneConnection | null {
  for (const c of conns) {
    if (c.targetSceneId === target.targetSceneId) continue;
    if (matchKeys(c, view).some((k) => k.length >= 2 && said.includes(k))) return c;
  }
  return null;
}

/**
 * 给一个「目标连接 + 它所在的连接组」造出一批用例。
 *
 * 前 8 条是含完整地名的正例（上一版就只有这些，所以 100%）；
 * 后面几条是**会掉的**：唯一简称、唯一别名、否定、提及非目标、重叠地名、
 * 同义改写、代词、描述特征。判据要有区分力，就得有会掉的。
 */
function buildCases(target: SceneConnection, conns: SceneConnection[]): PhraseCase[] {
  const name = nameOf(target);
  const want = target.targetSceneId;
  // ⚠ 干扰项必须指向**别的场景**，不能只是「别的连接」。
  // `maintenance_room` 有两条连接都通向 `sewer`（「返回下水道」/「通过奇怪管道」），
  // 按「别的连接」取就会造出「别去下水道，去下水道」这种句子 ——
  // forbid 与 want 是同一个地方，判据必然失败，而那是用例的错不是引擎的错。
  // 这正是这轮要修的那类毛病：用例没有区分力，跑出来的数说明不了任何事。
  const other = conns.find((c) => c.targetSceneId !== want && nameOf(c));
  const otherName = other ? nameOf(other) : "";
  const cases: PhraseCase[] = [
    { id: "p1-原文", kind: "positive", desc: "照抄选项原文", said: target.condition, wantSceneId: want },
    { id: "p2-地名", kind: "positive", desc: "只说地名", said: name, wantSceneId: want },
    { id: "p3-去地名", kind: "positive", desc: "「去」+地名", said: `去${name}`, wantSceneId: want },
    { id: "p4-我们去", kind: "positive", desc: "「我们去」+地名", said: `我们去${name}看看`, wantSceneId: want },
    { id: "p5-前往", kind: "positive", desc: "「前往」+地名", said: `前往${name}`, wantSceneId: want },
    { id: "p6-那边", kind: "positive", desc: "地名+「那边」", said: `${name}那边应该有线索`, wantSceneId: want },
    { id: "p7-犹豫", kind: "positive", desc: "带犹豫的口语", said: `嗯……先去${name}吧`, wantSceneId: want },
    { id: "p8-句中", kind: "positive", desc: "地名在句中", said: `我觉得${name}值得看看，走吧`, wantSceneId: want },
  ];

  // 唯一简称：地名的最短唯一前缀（如「维森酒吧」→「维森」）
  for (let len = 2; len < name.length; len++) {
    const abbr = name.slice(0, len);
    if (uniqueAmong(abbr, conns, target)) {
      cases.push({ id: "p9-唯一简称", kind: "positive", desc: "唯一简称", said: `先去${abbr}那边`, wantSceneId: want });
      break;
    }
  }

  // 唯一别名：选项文案去掉动词之后与场景真名不同的那种（「返回镇上」→ 场景叫「普瑞米尔」）
  const alias = stripVerb(target.condition).replace(/[（(][^）)]*[）)]/g, "").trim();
  if (alias && alias !== name && uniqueAmong(alias, conns, target)) {
    cases.push({ id: "p10-唯一别名", kind: "positive", desc: "唯一别名", said: `我们去${alias}`, wantSceneId: want });
  }

  // 唯一后缀：中文地名的中心词在后面（「霍姆斯**医院**」「维森**酒吧**」），
  // 玩家最常省掉的正是前面的专名。前缀那一支覆盖不到它。
  const bare = name.replace(/[（(][^）)]*[）)]/g, "").trim();
  for (let len = 2; len < bare.length; len++) {
    const suffix = bare.slice(bare.length - len);
    if (uniqueAmong(suffix, conns, target)) {
      cases.push({ id: "p11-唯一后缀", kind: "positive", desc: "唯一后缀（中心词）", said: `我们去${suffix}看看`, wantSceneId: want });
      break;
    }
  }

  if (other) {
    // 否定式：「别去 A，去 B」。判据要求**不能**选中 A。
    cases.push({
      id: "n1-否定", kind: "negative", desc: "否定一个目标同时指定另一个",
      said: `别去${otherName}，去${name}`, wantSceneId: want, forbidSceneId: other.targetSceneId,
    });
    // 提及非目标：「A 已经去过了，现在去 B」
    cases.push({
      id: "n2-提及非目标", kind: "negative", desc: "提到别处但目标是自己点名的那个",
      said: `${otherName}那边已经去过了，现在去${name}`, wantSceneId: want, forbidSceneId: other.targetSceneId,
    });
  }

  // 重叠地名：别的连接的键正好是这句话的子串
  const rival = overlappingRival(`去${name}`, conns, target);
  if (rival) {
    cases.push({
      id: "n3-重叠地名", kind: "negative", desc: "别处的地名是本句的子串",
      said: `去${name}`, wantSceneId: want, forbidSceneId: rival.targetSceneId,
    });
  }

  cases.push(
    { id: "a1-同义改写", kind: "ambiguous", desc: "同义改写（不含任何地名）", said: "换个地方看看", wantSceneId: null },
    { id: "a2-代词", kind: "ambiguous", desc: "代词指代", said: "去那边", wantSceneId: null },
    { id: "a3-描述特征", kind: "ambiguous", desc: "描述目的地特征", said: "去那个有灯光的房间", wantSceneId: null },
  );
  // 只说前两字：唯一时算正例（唯一简称已单列），不唯一时是歧义
  const two = name.slice(0, 2);
  if (!uniqueAmong(two, conns, target)) {
    cases.push({ id: "a4-前两字", kind: "ambiguous", desc: "只说地名前两字（不唯一）", said: `去${two}`, wantSceneId: null });
  }
  return cases;
}

function runOnce(said: string, conns: SceneConnection[]): PhraseOutcome {
  const r = chooseConnection({ action: said }, conns, view);
  // `trace.matched` 让判据说得出**为什么**没对上：一个键都没命中、
  // 只命中了别人的键、还是自己和别人都命中靠顺序抢先。三类修法完全不同。
  return { chosenSceneId: r.conn?.targetSceneId ?? null, forced: r.forced, matched: r.trace.matched };
}

const report = newPhraseReport();
// 顺序敏感性：同一批用例按原序和逆序各跑一遍。
// 只跑一种顺序时，「干扰项恰好排在目标之后」会让判据全绿。
const orders: { label: string; arrange: (c: SceneConnection[]) => SceneConnection[] }[] = [
  { label: "原序", arrange: (c) => c },
  { label: "逆序", arrange: (c) => [...c].reverse() },
];
const perOrder = new Map<string, { hit: number; total: number }>();
const caseIds = new Set<string>();

for (const scene of BARN_OF_PREMIER.scenes) {
  const conns = scene.connections as SceneConnection[];
  if (conns.length < 2) continue; // 单出口没得选，不算数

  for (const target of conns) {
    if (!nameOf(target)) continue;
    const cases = buildCases(target, conns);
    for (const c of cases) caseIds.add(`${c.kind}/${c.id}`);
    for (const o of orders) {
      const arranged = o.arrange(conns);
      for (const c of cases) {
        const j = addPhraseResult(report, c, runOnce(c.said, arranged), `${scene.name}→${nameOf(target)}·${o.label}`);
        const t = perOrder.get(o.label) ?? { hit: 0, total: 0 };
        t.total++; if (j.verdict === "pass") t.hit++;
        perOrder.set(o.label, t);
      }
    }
  }
}

const out: string[] = ["# 玩家说的话，引擎认不认", ""];
out.push(`拿模组里每个多出口场景 × 每个出口 × **${caseIds.size} 种说法**（正例/反例/歧义三类），`);
out.push("每种再按连接的原序与逆序各跑一遍 —— 只跑一种顺序时，干扰项恰好排在目标之后就会全绿。");
out.push("");
out.push("判据（见 `src/diagnostics/phrasing.ts`，有正反例校准测试）：");
out.push("");
out.push("| 类别 | 通过条件 | 进不进命中率 |");
out.push("|---|---|---|");
out.push("| 正例 | 选中目标且 `forced=false` | 进 |");
out.push("| 反例 | 不选中被否定/被提及的那个，且去了指定目标 | 不进 |");
out.push("| 歧义 | `forced=true`（引擎老实承认是替选） | 不进 |");
out.push("");
out.push("## 汇总");
out.push("");
out.push(`- **目标命中率（仅正例）：${report.hitRate.hit}/${report.hitRate.total} = ${pct(report.hitRate)}**`);
out.push(`- 反例通过率：${report.negative.hit}/${report.negative.total} = ${pct(report.negative)}`);
out.push(`- 歧义输入「老实承认替选」率：${report.ambiguous.hit}/${report.ambiguous.total} = ${pct(report.ambiguous)}`);
out.push("");
out.push("按连接顺序分：");
out.push("");
out.push("| 顺序 | 通过 | 总数 | 通过率 |");
out.push("|---|---|---|---|");
for (const [k, v] of perOrder) out.push(`| ${k} | ${v.hit} | ${v.total} | ${pct(v)} |`);
out.push("");
out.push("## 逐条说法");
out.push("");
out.push("| 类别 | 说法 | 通过 | 总数 | 通过率 |");
out.push("|---|---|---|---|---|");
for (const [id, v] of [...report.byId.entries()].sort()) {
  out.push(`| ${v.kind} | ${id} ${v.desc} | ${v.tally.hit} | ${v.tally.total} | ${pct(v.tally)} |`);
}
out.push("");
out.push("## 失败按成因分类");
out.push("");
out.push("三类的修法完全不同，混在一个「命中率」里等于知道有病不知道病在哪。");
out.push("");
const FAIL_LABEL: Record<string, string> = {
  "no-key": "一个键都没命中 —— 匹配方式太窄（缺简称/别名/同义词）",
  "rival-only": "只命中了别处的键 —— 子串比对认错了人（重叠地名、否定）",
  "ambiguous": "自己和别处都命中 —— 靠候选顺序抢先，换个顺序就翻车",
  "forced-hit": "目标对了但引擎标了替选 —— 是蒙对的，不是听懂的",
  "other": "其它",
};
out.push("| 成因 | 条数 |");
out.push("|---|---|");
for (const [k, n] of [...report.failKinds.entries()].sort((a, b) => b[1] - a[1])) {
  out.push(`| ${FAIL_LABEL[k] ?? k} | ${n} |`);
}
out.push("");
out.push(`## 没通过的例子（共 ${report.failures.length} 条，列前 25）`);
out.push("");
for (const f of report.failures.slice(0, 25)) out.push(`- ${f}`);

await writeReport("diag-phrasing.md", out.join("\n") + "\n");
console.log(
  `目标命中率 ${report.hitRate.hit}/${report.hitRate.total} = ${pct(report.hitRate)}｜` +
  `反例 ${report.negative.hit}/${report.negative.total}｜歧义承认 ${report.ambiguous.hit}/${report.ambiguous.total}` +
  `  -> analysis/diag/diag-phrasing.md`,
);
