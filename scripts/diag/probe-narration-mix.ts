// 玩家读到的字，有多少是**写死的**。
//
// 起因：「是不是把太多叙述直接写入，导致没有 LLM 的灵性」。
// 这件事不用猜 —— 播报层早就给每一行标了来源（`LineOrigin`）：
//     verbatim  模组原文 / 引擎写死的句子
//     llm       这一局现生成的
//     mech      检定、HP、分隔线这类机械播报
// 那个标记本来是给语音层分预制/实时用的，正好也是回答这个问题的仪器。
//
// ⚠ 判据要看**字数**不是行数。写死的句子往往一行很短（「你堪堪避开了。」），
// LLM 那段可能一行几百字 —— 按行数算会把结论反过来。
//
// 用法：bun scripts/diag/probe-narration-mix.ts [局数，默认 1] [起始局号]

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runModule, type LineOrigin } from "../../src/play-module";
import { writeReport } from "../../src/diagnostics/report";
import type { PlayerDecision } from "../../src/agent/player-agent";

const N = Number(process.argv[2] ?? 1);
const FROM = Number(process.argv[3] ?? 1);

interface Row { origin: LineOrigin; text: string }

async function once(seed: number): Promise<Row[]> {
  const rows: Row[] = [];
  let n = seed;
  const rnd = () => { n = (Math.imul(n, 1103515245) + 12345) & 0x7fffffff; return n / 0x7fffffff; };
  try {
    await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
      onLine: (text, origin) => rows.push({ origin, text }),
      decide: async (_c, options): Promise<PlayerDecision> => {
        const chose = options[Math.floor(rnd() * options.length)] ?? "";
        return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
      },
    });
  } catch (e) {
    rows.push({ origin: "mech", text: `（本局提前结束：${e instanceof Error ? e.message : String(e)}）` });
  }
  return rows;
}

const all: Row[] = [];
for (let i = FROM; i < FROM + N; i++) all.push(...(await once(i * 7919)));

/** 只算玩家真正读的叙述：机械播报与分隔线不参与「有没有灵性」这个问题 */
const isProse = (r: Row) => r.origin !== "mech" && r.text.trim() && !/^[━═─]{3,}$/.test(r.text.trim());
const prose = all.filter(isProse);
const chars = (rs: Row[]) => rs.reduce((a, r) => a + r.text.replace(/\s/g, "").length, 0);

const verbatim = prose.filter((r) => r.origin === "verbatim");
const llm = prose.filter((r) => r.origin === "llm");
const totalChars = chars(prose) || 1;

// 写死的句子里，哪些**反复出现** —— 复用次数越高越像模板腔
const repeat = new Map<string, number>();
for (const r of verbatim) {
  const key = r.text.trim().replace(/\s+/g, " ");
  if (key.length < 6) continue;
  repeat.set(key, (repeat.get(key) ?? 0) + 1);
}

// ── verbatim 还要再拆 ──
//
// 「写死」有两种，性质完全不同：
//   模组原文 —— 作者写的场景描写、结局文本。**本来就该写死**，那是模组的内容
//   引擎写死 —— 引擎自己编的过渡句、提示句。这才是「读起来没有灵性」的来源
// 不拆开的话，一个 26% 说明不了任何事。
// 语料要**两个都收**：场景/NPC/线索在 module 上，
// 而遭遇战台词、胜负台词、结局文本在 support 上。
// 只收 module 的话，米戈战的每一句都会被算成「引擎写死」——
// 第一版就是这样，6.9% 里有一多半是模组内容。
const moduleCorpus = (JSON.stringify(BARN_OF_PREMIER) + JSON.stringify(BARN_SUPPORT))
  .replace(/\\n/g, "").replace(/\s+/g, "");
/**
 * 这一行是不是模组原文。
 *
 * ⚠ 不能只比开头。引擎常给模组文本加壳（「就在你们面前，{描写}——似乎无法…」），
 * 前 24 字比对会把整段模组描写判成「引擎写死」——
 * 第一版就是这样，把米戈联络术的解释、结局台词、菲碧的外貌描写
 * 全算到引擎头上，6.9% 这个数当场就不可信了。
 * 改成：只要行内**任意一段足够长的连续文字**出现在模组里，就算模组原文。
 */
const WINDOW = 16;
const fromModule = (r: Row) => {
  const s = r.text.replace(/\s+/g, "");
  if (s.length < WINDOW) return false;
  for (let i = 0; i + WINDOW <= s.length; i++) {
    if (moduleCorpus.includes(s.slice(i, i + WINDOW))) return true;
  }
  return false;
};
const modText = verbatim.filter(fromModule);
const engineText = verbatim.filter((r) => !fromModule(r));

const pct = (n: number) => `${((n / totalChars) * 100).toFixed(1)}%`;
const out: string[] = ["# 玩家读到的字，有多少是写死的", ""];
out.push(`取样第 ${FROM}~${FROM + N - 1} 局，共 ${all.length} 行播报，其中叙述 ${prose.length} 行。`);
out.push("");
out.push("| 来源 | 行数 | 字数 | 占叙述字数 |");
out.push("|---|---|---|---|");
out.push(`| **模组原文**（作者写的，本来就该写死） | ${modText.length} | ${chars(modText)} | ${pct(chars(modText))} |`);
out.push(`| **引擎写死**（引擎自己编的过渡/提示句） | ${engineText.length} | ${chars(engineText)} | ${pct(chars(engineText))} |`);
out.push(`| llm（这一局现生成） | ${llm.length} | ${chars(llm)} | ${pct(chars(llm))} |`);
out.push("");
out.push("> 「写死」有两种，性质完全不同：**模组原文**是模组的内容，写死是对的；");
out.push("> **引擎写死**才是「读起来没有灵性」的来源。不拆开的话一个总数说明不了任何事。");
out.push("");
out.push("> 按**字数**算，不按行数：写死的句子常常很短（「你堪堪避开了。」），");
out.push("> LLM 那段可能一行几百字，按行数会把结论反过来。");
out.push("");

out.push("## 引擎写死的句子（逐条，按字数排）");
out.push("");
out.push("这些是引擎自己编的，不是模组内容 —— 「灵性」问题就出在这一栏。");
out.push("");
for (const r of [...engineText].sort((a, b) => b.text.length - a.text.length).slice(0, 20)) {
  out.push(`- ${r.text.trim().replace(/\s+/g, " ").slice(0, 80)}`);
}
out.push("");

out.push("## 写死且反复出现的句子（复用 ≥2 次，按次数排）");
out.push("");
const repeated = [...repeat.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);
if (repeated.length === 0) {
  out.push("（没有重复出现的写死句子）");
} else {
  out.push("| 次数 | 句子 |");
  out.push("|---|---|");
  for (const [text, n] of repeated.slice(0, 25)) {
    out.push(`| ${n} | ${text.slice(0, 70).replace(/\|/g, "\\|")} |`);
  }
  out.push("");
  out.push(`复用句合计 ${repeated.reduce((a, [, n]) => a + n, 0)} 次，占 verbatim 行数的 `
    + `${((repeated.reduce((a, [, n]) => a + n, 0) / (verbatim.length || 1)) * 100).toFixed(0)}%。`);
}
out.push("");
out.push("## 最长的几段（看看厚度都花在哪儿）");
out.push("");
for (const r of [...prose].sort((a, b) => b.text.length - a.text.length).slice(0, 6)) {
  out.push(`- **[${r.origin}] ${r.text.replace(/\s/g, "").length} 字** ${r.text.trim().replace(/\s+/g, " ").slice(0, 100)}…`);
}

const path = await writeReport("probe-narration-mix.md", out.join("\n"));
console.log(
  `模组原文 ${pct(chars(modText))}｜引擎写死 ${pct(chars(engineText))}｜LLM ${pct(chars(llm))}` +
  `｜复用句 ${repeated.length} 种  -> ${path}`,
);
