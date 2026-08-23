// NPC 说话前那一句「引导」现在长什么样。
//
// 你原话点的两条：
//   「**面带忧色，**菲碧·特里坎声音发颤地说：」—— 舞台指示式开头，以前要求改过
//   「**孩子**米尔·特里坎眨巴着眼睛说：」—— 角色标签被写进了正文
// 这两条都在对话层，前面几轮改的是开场，没碰到它们。
//
// 判据只判**形状**，不判好不好听：
//   · 开头是不是「神态词 + 逗号」（舞台指示）
//   · 名字前面是不是挂了个角色标签（孩子/警员/教授…）
//   · 同一句引导在一局里重复了几次
// 好不好听要人读，所以原文一并打出来。
//
// 用法：bun scripts/diag/probe-dialogue-lead.ts [局数，默认 1]

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runModule } from "../../src/play-module";
import { writeReport } from "../../src/diagnostics/report";
import type { PlayerDecision } from "../../src/agent/player-agent";

const N = Number(process.argv[2] ?? 1);

/** NPC 名字 → 角色标签，用来查「标签被写进正文」 */
const ROLE_WORDS = ["孩子", "小孩", "儿童", "警员", "警察", "教授", "保镖", "流浪汉", "医生", "职员", "母亲", "父亲"];

async function once(seed: number): Promise<string[]> {
  const lines: string[] = [];
  let n = seed;
  const rnd = () => { n = (Math.imul(n, 1103515245) + 12345) & 0x7fffffff; return n / 0x7fffffff; };
  try {
    await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
      onLine: (l) => lines.push(l),
      decide: async (_c, options): Promise<PlayerDecision> => {
        const chose = options[Math.floor(rnd() * options.length)] ?? "";
        return { action: chose, intent: chose.startsWith("调查") ? "investigate" : "move" };
      },
    });
  } catch { /* 跑挂了也把已采到的行拿去分析 */ }
  return lines;
}

const all: string[] = [];
for (let i = 0; i < N; i++) all.push(...(await once((i + 1) * 7919)));

// 引导句 = 以「说：/问：/道：」收尾、且下一行是引号台词的那种叙述
const leads = all
  .map((l) => l.trim())
  .filter((l) => /[说问道][：:]$/.test(l) && l.length < 60);

const npcNames = BARN_OF_PREMIER.npcs.map((n) => n.name.replace(/[（(].*?[）)]/g, "").trim());

// ① 舞台指示式开头：句首是「神态词，」而不是人
const stageDirection = leads.filter((l) => /^[^，,。]{2,6}[，,]/.test(l) && !npcNames.some((n) => l.startsWith(n)));
// ② 角色标签挂在名字前
const labelled = leads.filter((l) => ROLE_WORDS.some((w) => npcNames.some((n) => l.includes(`${w}${n}`))));
// ③ 神态与语调桥同义反复（「态度公事公办，用公事公办的口吻说：」）
//    两者都从同一批 traits 抽，撞车是必然而不是偶发 —— 形状修对了不代表内容不重复。
const tautology = leads.filter((l) => {
  const i = l.indexOf("，");
  if (i <= 0) return false;
  const head = l.slice(0, i);
  const tail = l.slice(i + 1);
  for (let k = 0; k + 2 <= head.length; k++) if (tail.includes(head.slice(k, k + 2))) return true;
  return false;
});
// ④ 重复
const seen = new Map<string, number>();
for (const l of leads) seen.set(l, (seen.get(l) ?? 0) + 1);
const repeated = [...seen.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);

// ⑤ NPC 台词的收尾语复读（「……我知道的就这些了。」连着两句）
//    引导句是「说话前」，这条量的是「说话本身」—— 同一个人每开口一次就总结一次，
//    既是复读机，语义也错（第一条就说「就这些了」，可他还会接着说）。
const CLOSINGS = ["我知道的就这些了", "就这些，别再问了", "我能想起来的就这么多", "案卷上就是这么记的", "我知道的就这么多啦"];
const spoken = all.map((l) => l.trim()).filter((l) => /^[“"].*[”"]$/.test(l) || /[“"].+[”"]/.test(l));
const closingCount = new Map<string, number>();
for (const l of spoken) for (const c of CLOSINGS) if (l.includes(c)) closingCount.set(c, (closingCount.get(c) ?? 0) + 1);
const repeatedClosings = [...closingCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);

const out: string[] = ["# NPC 说话前那一句引导", ""];
out.push(`取样 ${N} 局，共 ${all.length} 行播报，其中引导句 **${leads.length}** 句。`);
out.push("");
if (leads.length === 0) {
  out.push("⚠ **一句都没抓到** —— 不是「都没问题」，是这份取样没量到东西。");
  out.push("先确认引导句的形状（以「说：」收尾）还成不成立，再看下面的结论。");
} else {
  out.push("| 形状问题 | 句数 | 占引导句 |");
  out.push("|---|---|---|");
  const p = (n: number) => `${((n / leads.length) * 100).toFixed(0)}%`;
  out.push(`| 舞台指示式开头（「面带忧色，……」） | ${stageDirection.length} | ${p(stageDirection.length)} |`);
  out.push(`| 角色标签挂在名字前（「孩子米尔·特里坎……」） | ${labelled.length} | ${p(labelled.length)} |`);
  out.push(`| 神态与语调桥同义反复（「态度公事公办，用公事公办的口吻说」） | ${tautology.length} | ${p(tautology.length)} |`);
  out.push(`| 重复出现的引导句（≥2 次） | ${repeated.reduce((a, [, c]) => a + c, 0)} | ${p(repeated.reduce((a, [, c]) => a + c, 0))} |`);
  out.push("");

  if (stageDirection.length) {
    out.push("## 舞台指示式开头");
    out.push("");
    for (const l of stageDirection.slice(0, 12)) out.push(`- ${l}`);
    out.push("");
  }
  if (labelled.length) {
    out.push("## 角色标签写进了正文");
    out.push("");
    for (const l of labelled.slice(0, 12)) out.push(`- ${l}`);
    out.push("");
  }
  if (tautology.length) {
    out.push("## 神态与语调桥说了同一件事");
    out.push("");
    for (const l of tautology.slice(0, 12)) out.push(`- ${l}`);
    out.push("");
  }
  if (repeated.length) {
    out.push("## 重复的引导句");
    out.push("");
    out.push("| 次数 | 句子 |");
    out.push("|---|---|");
    for (const [l, c] of repeated.slice(0, 15)) out.push(`| ${c} | ${l} |`);
    out.push("");
  }
  out.push(`## NPC 台词的收尾语（采到 ${spoken.length} 句台词）`);
  out.push("");
  const totalClosings = [...closingCount.values()].reduce((a, b) => a + b, 0);
  if (spoken.length === 0) {
    out.push("⚠ **一句台词都没抓到** —— 这是取样失败，不是「没问题」。");
  } else if (totalClosings === 0) {
    // 「没重复」和「根本没走到这条路径」必须分开报，否则判据会假绿。
    out.push("⚠ **这一局没出现任何收尾语** —— 说明知识台词走的是 LLM 路径，");
    out.push("模板路径（`templateKnowledgeReveals`）这一局没被触发。**这条没量到**，");
    out.push("不等于没问题。模板路径的复读由 `src/__tests__/knowledge-reveal-shape.test.ts` 封闭校验。");
  } else if (repeatedClosings.length === 0) {
    out.push(`收尾语共出现 ${totalClosings} 次，无一重复。`);
  } else {
    out.push("| 次数 | 收尾语 |");
    out.push("|---|---|");
    for (const [c, n] of repeatedClosings) out.push(`| ${n} | ${c} |`);
  }
  out.push("");
  out.push("## 全部引导句（原样，好不好听要人读）");
  out.push("");
  for (const l of leads) out.push(`- ${l}`);
}

const path = await writeReport("probe-dialogue-lead.md", out.join("\n"));
console.log(
  `引导句 ${leads.length}｜舞台指示 ${stageDirection.length}｜标签入正文 ${labelled.length}` +
  `｜同义反复 ${tautology.length}｜重复 ${repeated.length} 种` +
  `｜台词 ${spoken.length} 句/收尾语复读 ${repeatedClosings.length} 种  -> ${path}`,
);
