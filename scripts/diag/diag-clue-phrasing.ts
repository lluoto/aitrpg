// 量「玩家这句话对到场景里哪条线索」有多准。
//
// 背景：BARN_OF_PREMIER 32 条线索里只有 5 条的 findMethods 描述带 "/" 分隔
// 位置和动作，其余 27 条是自由文本（"购买报纸阅读""向其他人打听艾德里安，
// 需判断幸运"）。这仓库在模糊匹配上栽过——第一版移动匹配的 phrasing 判据
// 「12 种说法里 8 种含完整地名 → 100%」，看着像匹配很好，实际只测了最简单
// 的情形（见 diag-phrasing.ts 头注释）。线索匹配的数据形状更不规整，
// 误匹配率不能靠肉眼估计。
//
// 用例分正例 / 反例 / 歧义三类（见 src/diagnostics/clue-phrasing.ts，
// 有正反例校准测试）。数据源就是真实的 BARN_OF_PREMIER，不用构造夹具——
// 用例的"难"是数据本来的形状带来的，不是我们造出来的。
process.env.LLM_DISABLED = "true";

import { BARN_OF_PREMIER } from "../../src/module/barn-of-premier";
import { matchSceneClues, splitKeys, stripSearchVerbs, decideClueMatch, type ClueMatchCandidate } from "../../src/investigation/clue-match";
import {
  addCluePhraseResult, newCluePhraseReport, pct,
  type CluePhraseCase, type CluePhraseOutcome,
} from "../../src/diagnostics/clue-phrasing";
import { writeReport } from "../../src/diagnostics/report";

function toCandidate(clue: { id: string; name: string; findMethods: { description: string }[] }): ClueMatchCandidate {
  return { id: clue.id, texts: [clue.name, ...clue.findMethods.map((f) => f.description)] };
}

/**
 * 给一条目标线索、它所在的候选组造一批用例。
 *
 * 正例：从它自己的 matchTexts 切出的每个短语段（去掉描述里的动词后缀，
 * 因为玩家更可能只说"卫生间"而不是整句"侦查卫生间/仔细检查洗漱用具"）。
 * 反例：用"已经搜过了"排除掉别的候选，指名要这一条。
 * 歧义：裸的调查动词，不带任何位置提示。
 */
function buildCases(target: ClueMatchCandidate, group: ClueMatchCandidate[]): CluePhraseCase[] {
  const cases: CluePhraseCase[] = [];
  const mySegments = splitKeys(target.texts);
  const otherSegments = group.filter((c) => c.id !== target.id).flatMap((c) => splitKeys(c.texts));

  // 正例：每个属于自己的短语段，原样照说（真实数据本来的样子，不额外加动词）
  for (const seg of mySegments) {
    if (seg.length < 2 || seg.length > 20) continue; // 太短没区分力，太长不像玩家会照念的话
    cases.push({ id: `p-${seg.length <= 6 ? "短语" : "长句"}`, kind: "positive", desc: `照说线索自身描述片段（${seg.length}字）`, said: seg, wantClueId: target.id });
  }

  // 正例（更难）：只说自己描述片段"剥掉调查动词之后"那部分内容的前 2/3
  // 字——玩家不太可能照念整句，更常见的是掐一小段。这类比"原样照说"难，
  // 专门用来暴露 no-key/rival-only 这两类失败——27/32 条自由文本里，很多
  // 根本没有干净的位置名词可摘，缩写之后大概率连自己都对不上，那正是真实
  // 的匹配缺口，不该被"原样照说"这种最简单的用例盖过去。
  //
  // ⚠ 必须先用 stripSearchVerbs() 剥掉动词再取前缀，不能直接切原始片段。
  // 很多 findMethods 描述以调查动词开头（"搜查二层杂物室""检查杂物室中的
  // 婴儿车"），直接掐前 2/3 字掐出来的是"搜查""检查"这类裸动词本身——
  // 按 matchSceneClues 的设计，裸动词没有位置/对象信号，理应报歧义，
  // 拿它当"正例"（要求精确命中）用例本身就是错的，这类用例注定失败，
  // 把命中率往下拉的同时又不提供任何真实的匹配质量信息。剥完动词再切，
  // 缩写用例才是在测"内容部分缩写后还认不认得出"，这才是真正想量的东西。
  const contentSegments = mySegments.map((s) => stripSearchVerbs(s)).filter((s) => s.length >= 2);
  const longestContent = [...contentSegments].sort((a, b) => b.length - a.length)[0];
  if (longestContent && longestContent.length >= 4) {
    for (const len of [2, 3]) {
      const abbr = longestContent.slice(0, len);
      cases.push({ id: `p-掐前${len}字`, kind: "positive", desc: `只说内容部分（剥掉调查动词）的前 ${len} 字`, said: abbr, wantClueId: target.id });
    }
  }

  // 反例：指名要目标，同时提一句"已经搜过"排除掉别的候选（如果有干扰段可用）
  const rivalSeg = otherSegments.find((s) => s.length >= 2 && s.length <= 8);
  const mySeg = mySegments.find((s) => s.length >= 2 && s.length <= 8);
  if (rivalSeg && mySeg && rivalSeg !== mySeg) {
    cases.push({
      id: "n-已搜过排除",
      kind: "negative",
      desc: "已完成语境排除一个候选，指名要另一个",
      said: `${rivalSeg}已经搜过了，${mySeg}还没看过`,
      wantClueId: target.id,
      forbidClueId: group.find((c) => c.id !== target.id && splitKeys(c.texts).includes(rivalSeg))?.id ?? null,
    });
  }

  return cases;
}

const report = newCluePhraseReport();
const caseIds = new Set<string>();
let scenesWithMultiClue = 0;

for (const scene of BARN_OF_PREMIER.scenes) {
  if (scene.clues.length < 2) continue; // 单线索场景没有"选哪条"的问题，不算数
  scenesWithMultiClue++;
  const group = scene.clues.map(toCandidate);

  for (const target of group) {
    const cases = buildCases(target, group);
    for (const c of cases) caseIds.add(`${c.kind}/${c.id}`);
    for (const c of cases) {
      const r = matchSceneClues(c.said, group);
      const outcome: CluePhraseOutcome = {
        chosenClueId: r.hit,
        ambiguousIds: r.ambiguous,
        matched: r.trace.matched.map((m) => ({ clueId: m.id, key: m.key })),
        noSignal: r.trace.noSignal, // 原样转发，供 classifyClueFailure 分清 no-signal 与 no-key
      };
      addCluePhraseResult(report, c, outcome, `${scene.name}·${target.id}`);
    }
  }

  // 歧义：场景内裸调查动词，不给任何位置提示。
  //
  // ⚠ 这里不能直接调 matchSceneClues()——生产路径（GameSession.
  // resolveSceneClueMatch）对裸动词从入口短路就返回 fallback（取候选
  // 首条，不问不猜），压根不会走到 matchSceneClues 内部。之前这里直接调
  // matchSceneClues("侦查", group)，测的是生产从不会执行到的一条路：
  // matchSceneClues 自己的 no-signal 早退会报"ambiguous=全部候选"，判据
  // 一看 chosenClueId===null 就判过，可实际生产行为是静默挑了候选首条——
  // 判据全绿，行为却是它想禁止的那个。改用 decideClueMatch()（与
  // resolveSceneClueMatch 共用同一份决策），如实拿到 fallback，
  // 判据据此判"设计如此"而不是"侥幸没抢答"。
  const bare: CluePhraseCase = { id: "a-裸动词", kind: "ambiguous", desc: "不带任何位置提示的裸调查动词（生产正确行为是 fallback：取候选首条，不问不猜）", said: "侦查", wantClueId: null };
  caseIds.add(`${bare.kind}/${bare.id}`);
  const decision = decideClueMatch(bare.said, group);
  const r = matchSceneClues(stripSearchVerbs(bare.said), group); // 仅用于 trace/matched 展示，判定本身看 decision
  addCluePhraseResult(report, bare, {
    chosenClueId: decision.kind === "resolve" ? decision.clueId : null,
    ambiguousIds: decision.kind === "ask" ? decision.clueIds : [],
    noSignal: r.trace.noSignal,
    matched: r.trace.matched.map((m) => ({ clueId: m.id, key: m.key })),
    decisionKind: decision.kind,
  }, `${scene.name}`);
}

const out: string[] = ["# 线索匹配：玩家这句话对到哪条线索", ""];
out.push(`拿 BARN_OF_PREMIER 里每个多线索场景（共 ${scenesWithMultiClue} 个）× 每条线索，`);
out.push(`用 **${caseIds.size} 种用例类型**（正例/反例/歧义三类）跑一遍真实数据——`);
out.push("32 条线索里只有 5 条 findMethods 描述带 \"/\"，其余 27 条是自由文本，误匹配率不能靠肉眼估计。");
out.push("");
out.push("判据（见 `src/diagnostics/clue-phrasing.ts`，有正反例校准测试）：");
out.push("");
out.push("| 类别 | 通过条件 | 进不进命中率 |");
out.push("|---|---|---|");
out.push("| 正例 | 精确命中目标（不是报成歧义） | 进 |");
out.push("| 反例 | 不命中被排除的那个，且命中指定目标 | 不进 |");
out.push("| 歧义 | 报出多个候选或压根没命中（不擅自选一个） | 不进 |");
out.push("");
out.push("## 汇总");
out.push("");
out.push(`- **目标命中率（仅正例）：${report.hitRate.hit}/${report.hitRate.total} = ${pct(report.hitRate)}**`);
out.push(`- 反例通过率：${report.negative.hit}/${report.negative.total} = ${pct(report.negative)}`);
out.push(`- 歧义"不擅自选一个"率：${report.ambiguous.hit}/${report.ambiguous.total} = ${pct(report.ambiguous)}`);
out.push("");
out.push("## 逐条用例类型");
out.push("");
out.push("| 类别 | 用例 | 通过 | 总数 | 通过率 |");
out.push("|---|---|---|---|---|");
for (const [id, v] of [...report.byId.entries()].sort()) {
  out.push(`| ${v.kind} | ${id} ${v.desc} | ${v.tally.hit} | ${v.tally.total} | ${pct(v.tally)} |`);
}
out.push("");
out.push("## 失败按成因分类");
out.push("");
out.push("五类的修法完全不同，混在一个「命中率」里等于知道有病不知道病在哪。");
out.push("`no-signal` 不需要修——那是用例本身写错了（该标成歧义用例），不是匹配器的缺口。");
out.push("");
const FAIL_LABEL: Record<string, string> = {
  "no-signal": "输入本身没有位置/对象信号（裸动词一类）—— 不用修，用例该改标成 ambiguous",
  "no-key": "给了信号但一个键都没命中 —— 切词方式太窄（缺同义词/简称）",
  "rival-only": "只命中了别处的键 —— 子串比对认错了人",
  "ambiguous": "自己和别处都命中 —— 靠候选顺序抢先或真的有歧义",
  "forced-hit": "目标在候选里但没被精确选中 —— 是蒙对的，不是听懂的",
  "other": "其它",
};
out.push("| 成因 | 条数 |");
out.push("|---|---|");
for (const [k, n] of [...report.failKinds.entries()].sort((a, b) => b[1] - a[1])) {
  out.push(`| ${FAIL_LABEL[k] ?? k} | ${n} |`);
}
out.push("");
out.push(`## 没通过的例子（共 ${report.failures.length} 条，列前 30）`);
out.push("");
for (const f of report.failures.slice(0, 30)) out.push(`- ${f}`);

await writeReport("diag-clue-phrasing.md", out.join("\n") + "\n");
console.log(
  `目标命中率 ${report.hitRate.hit}/${report.hitRate.total} = ${pct(report.hitRate)}｜` +
  `反例 ${report.negative.hit}/${report.negative.total}｜歧义 ${report.ambiguous.hit}/${report.ambiguous.total}` +
  `  -> analysis/diag/diag-clue-phrasing.md`,
);
