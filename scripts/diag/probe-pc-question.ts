// PC 问出来的那句话现在长什么样。
//
// 你原话：「论起来也不万能，显得非常机械」。
//   「关于**这一点**，您还记得什么吗？」
//   「**这件事**的具体情况，您还知道些什么吗？」
// 指代词代替了具体的人和地方 —— 侦探不会这么说话。
//
// 判据只判**形状**，不判好不好听：
//   · 是不是逐字来自 fallbackQuestion 的写死池子
//   · 问句里有没有出现任何具体名词（人名/地名/物件），还是通篇指代词
//   · 同一句问话一局里重复了几次
//   · 走 LLM 还是降级为模板（降级原因一并抓出来，不然会误判成「模型写得平庸」）
//
// 用法：bun scripts/diag/probe-pc-question.ts [局数，默认 1]

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runModule } from "../../src/play-module";
import { writeReport } from "../../src/diagnostics/report";
import type { PlayerDecision } from "../../src/agent/player-agent";

const N = Number(process.argv[2] ?? 1);

/** fallbackQuestion 里写死的池子 —— 逐字命中就说明这一问根本没走 LLM */
const CANNED = [
  "这件事的具体情况，您还知道些什么吗？",
  "能跟我们细说说当时的情形吗？",
  "关于这一点，您还记得什么吗？",
  "关于这个案子，你们还知道些什么吗？",
  "能再说说你们知道的情况吗？",
];

/** 只有指代词没有实词的问句：「这一点」「这件事」「那个」…… */
const VAGUE = ["这一点", "这件事", "这个案子", "当时的情形", "你们知道的情况", "那件事", "这方面"];

/** 模组里的具体名词：人名 + 地名。问句提到其中之一才算「问到了点子上」 */
const CONCRETE = [
  ...BARN_OF_PREMIER.npcs.map((n) => n.name.replace(/[（(].*?[）)]/g, "").trim()),
  ...BARN_OF_PREMIER.scenes.map((s) => s.name),
]
  .flatMap((n) => (n.includes("·") ? [n, n.split("·")[0]!, n.split("·")[1]!] : [n]))
  .filter((n) => n.length >= 2);

const warnings: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(" ")); };

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
console.warn = realWarn;

// PC 提问 = 引导桥以「问：/问道：」收尾、后面跟引号的那一行
const asks = all
  .map((l) => l.trim())
  .filter((l) => /[问][：:]?\s*["“]/.test(l) || /问道[：:]\s*["“]/.test(l))
  .map((l) => {
    const m = l.match(/["“]([^"”]+)["”]/);
    return m ? m[1]! : "";
  })
  .filter(Boolean);

const canned = asks.filter((q) => CANNED.some((c) => q.includes(c.replace(/[？?]$/, ""))));
const vagueOnly = asks.filter((q) => VAGUE.some((v) => q.includes(v)) && !CONCRETE.some((c) => q.includes(c)));
const concrete = asks.filter((q) => CONCRETE.some((c) => q.includes(c)));
const downgrades = warnings.filter((w) => w.includes("[pc-question]"));

const seen = new Map<string, number>();
for (const q of asks) seen.set(q, (seen.get(q) ?? 0) + 1);
const repeated = [...seen.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);

const out: string[] = ["# PC 问出来的那句话", ""];
out.push(`取样 ${N} 局，共 ${all.length} 行播报，其中 PC 提问 **${asks.length}** 句。`);
out.push("");

if (asks.length === 0) {
  out.push("⚠ **一句提问都没抓到** —— 这是取样失败，不是「都没问题」。");
  out.push("先确认提问行的形状（`名字 + 引导桥 + \"内容\"`）还成不成立，再看下面的结论。");
} else {
  const p = (n: number) => `${((n / asks.length) * 100).toFixed(0)}%`;
  out.push("| 形状问题 | 句数 | 占提问 |");
  out.push("|---|---|---|");
  out.push(`| 逐字来自写死池子（fallbackQuestion） | ${canned.length} | ${p(canned.length)} |`);
  out.push(`| 只有指代词、不含任何具体名词（「关于**这一点**」） | ${vagueOnly.length} | ${p(vagueOnly.length)} |`);
  out.push(`| 问到了具体的人/地（「关于**加比**」） | ${concrete.length} | ${p(concrete.length)} |`);
  out.push(`| 重复出现的问句（≥2 次） | ${repeated.reduce((a, [, c]) => a + c, 0)} | ${p(repeated.reduce((a, [, c]) => a + c, 0))} |`);
  out.push("");

  out.push(`## 降级为模板的次数：${downgrades.length}`);
  out.push("");
  if (downgrades.length === 0) {
    out.push("这一局 LLM 提问全部成功 —— 所以上面若还有「写死池子」命中，那是 LLM 自己写成了这样。");
  } else {
    out.push("降级会伪装成「模型写得平庸」，原因必须看：");
    out.push("");
    for (const d of downgrades.slice(0, 10)) out.push(`- ${d}`);
  }
  out.push("");

  if (repeated.length) {
    out.push("## 重复的问句");
    out.push("");
    out.push("| 次数 | 问句 |");
    out.push("|---|---|");
    for (const [q, c] of repeated.slice(0, 15)) out.push(`| ${c} | ${q} |`);
    out.push("");
  }

  out.push("## 全部提问（原样，机械不机械要人读）");
  out.push("");
  for (const q of asks) {
    // 标注口径必须和上表一致。先前这里只看「有没有具体名词」，
    // 于是把「他当时在笑吗？」这种自然的短追问也标成了问题句 ——
    // 一份报告里两套判据，比没有判据更坏。
    const tag = canned.includes(q) ? " ← 写死池子"
      : vagueOnly.includes(q) ? " ← 只有指代词"
      : "";
    out.push(`- ${q}${tag}`);
  }
}

// ── 写死池子本身长什么样（封闭取样，跟上面的跑局分开） ──
//
// 上面量的是「这一局实际问出了什么」。LLM 正常时 fallback 根本不触发，
// 所以那张表**量不到**写死池子的毛病。池子的形状要单独摊开看。
out.push("");
out.push("## fallbackQuestion 池子本身（封闭取样，与上面的跑局无关）");
out.push("");
out.push("LLM 失败时才走这里。上面那一局没触发，**不代表池子没问题**。");
out.push("");
const { fallbackQuestion } = await import("../../src/play/scene-pipeline");
// 传真模组 —— 专名锚定要靠 ctx.module 里的人名地名，传空 ctx 等于把这条判据关掉
const fakeCtx = { module: BARN_OF_PREMIER } as unknown as Parameters<typeof fallbackQuestion>[0];
// 用模组里真实存在的专名做话题，否则量的是「锚定失败时的样子」而不是锚定本身
const TOPIC = `${BARN_OF_PREMIER.npcs[0]!.name.replace(/[（(].*?[）)]/g, "").trim()}比较叛逆`;
const ANCHOR = BARN_OF_PREMIER.npcs[0]!.name.replace(/[（(].*?[）)]/g, "").trim();
const withTopic = new Set<string>();
const noTopic = new Set<string>();
const noAnchor = new Set<string>();
for (let i = 0; i < 200; i++) {
  withTopic.add(fallbackQuestion(fakeCtx, TOPIC));
  noAnchor.add(fallbackQuestion(fakeCtx, "镇上最近不太平"));
  noTopic.add(fallbackQuestion(fakeCtx));
}
out.push(`### 话题里有已知专名（\`${TOPIC}\`）—— ${withTopic.size} 种问法`);
out.push("");
for (const q of withTopic) out.push(`- ${q}${q.includes(ANCHOR) ? "" : "  ← **专名没进问句**"}`);
out.push("");
out.push(`### 话题里没有专名（\`镇上最近不太平\`）—— ${noAnchor.size} 种问法`);
out.push("");
out.push("这一支只能抽象地问：话题分句原样塞进问句会**提问即剧透**，所以宁可抽象。");
out.push("");
for (const q of noAnchor) out.push(`- ${q}${q.includes("镇上最近不太平") ? "  ← **话题正文被塞进了问句**" : ""}`);
out.push("");
out.push(`### 完全没有话题 —— ${noTopic.size} 种问法`);
out.push("");
for (const q of noTopic) out.push(`- ${q}`);

const path = await writeReport("probe-pc-question.md", out.join("\n"));
console.log(
  `提问 ${asks.length} 句｜写死池子 ${canned.length}｜只有指代词 ${vagueOnly.length}` +
  `｜问到具体人地 ${concrete.length}｜重复 ${repeated.length} 种｜降级 ${downgrades.length} 次` +
  `｜池子 ${withTopic.size}/${noAnchor.size}/${noTopic.size} 种` +
  `｜专名进问句 ${[...withTopic].filter((q) => q.includes(ANCHOR)).length}/${withTopic.size}  -> ${path}`,
);
