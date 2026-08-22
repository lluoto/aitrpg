// 开场叙述实跑取样 —— 只跑到序章为止，不打完整局。
//
// 起因：实跑开场读起来不对劲，具体三条
//   · 「玛丽·布朗……作为飞行员，**他**见过太多案子」——代词错、履历是编的
//   · 「循声望去，只见**米尔·特里坎**正抱着篮球」——名字在见面前就出现了
//   · 开场骨架每局一模一样
// 前两条已经做成单测（`prologue-hooks.test.ts` / `name-before-introduction.test.ts`），
// 但那两条测的是**模板与模组数据**。真正送到玩家眼前的是 LLM 改写之后的文本，
// 模板对不代表输出对 —— 所以还得实际取样看。
//
// 用法：bun scripts/diag/probe-opening.ts [取样局数，默认 2]

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runModule } from "../../src/play-module";
import { writeReport } from "../../src/diagnostics/report";
import { FEMALE_FIRST_NAMES } from "../../src/character/background-profile";


const N = Number(process.argv[2] ?? 2);

/** 只要开场那一段：跑到第一个场景标题出现就够了 */
async function sampleOpening(): Promise<string[]> {
  const lines: string[] = [];
  let done = false;
  try {
    await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
      onLine: (l) => {
        if (done) return;
        lines.push(l);
        // ⚠ 停止条件必须是**场景标题**（`\n━ 特里坎家`：一个 ━ 加空格加名字），
        // 不是分隔线（`divider()` 打的是 60 个 ━ 连成一条）。
        // 第一版写成 `/^\n?━/`，开局第一行分隔线就命中，于是**一行都没采到**，
        // 而报告照样输出「机器判据无异常」—— 这正是这一整轮在修的那种假绿。
        if (/^\n?━ \S/.test(l)) done = true;
      },
      decide: async () => {
        // 开场取到了就别往下跑了，抛出去中断整局
        throw new Error("__opening_sampled__");
      },
    });
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("__opening_sampled__")) {
      lines.push(`（本局提前结束：${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  return lines;
}

const out: string[] = ["# 开场叙述取样", ""];
out.push("模板与模组数据已有单测把关；这里看的是**LLM 改写之后真正送到玩家眼前的文本**。");
out.push("");

let flagged = 0;

for (let i = 1; i <= N; i++) {
  const lines = await sampleOpening();
  const text = lines.join("\n");
  out.push(`## 第 ${i} 局`);
  out.push("");
  out.push("```");
  out.push(...lines.map((l) => l.replace(/\n/g, " ")).filter((l) => l.trim()));
  out.push("```");
  out.push("");

  // 自动挑刺：这几条是可机器判的
  const notes: string[] = [];
  // 本局调查员的名字 —— 名字比对要拿它排除误认。
  // 第一版没取，于是「米尔德丽德·罗德里格斯」里的「米尔」被当成 NPC 米尔·特里坎，
  // 报了个假阳性：子串匹配认错人，判据自己犯了它要查的那种病。
  // （下面的名字检查只认全名，不再需要这份排除名单；保留是为了报告里能说清是谁在跑）
  const pcNames = [...text.matchAll(/武器携带评估 · ([^：:]+)[：:]/g)].map((m) => m[1]!.trim());
  if (pcNames.length) out.push(`本局调查员：${pcNames.join("、")}`, "");
  // 采样为空时**绝不能**报「无异常」—— 那是「什么都没量」，不是「量过了没问题」。
  const prose = lines.filter((l) => l.trim() && !/^[━═]{10,}$/.test(l.trim()));
  if (prose.length < 3) {
    notes.push(`✗ 只采到 ${prose.length} 行正文 —— 本局取样失败，下面的判据结果无效`);
  }
  // NPC 名字提前出现。判据与单测共用 `mentionsName`（见 diagnostics/narration.ts）。
  //
  // ⚠ 要分清「没被告知」和「接案时就知道」：案件简报里写着
  //   「菲碧·特里坎的儿子加比已经失踪半个月了。两名调查员接下了这个案子。」
  // 所以菲碧、加比、特里坎这几个名字调查员**本来就知道**，出现在开场完全正常。
  // 判据第一版没排除简报，把这三个也报了 —— 又一次「判据太宽」。
  // 真正的泄漏是简报没提、又还没见面的那些（比如妹妹米尔）。
  // ⚠ 运行时**只认全名**（带「·」的那种），不认单独的名或姓。
  //
  // 这条限制是被打脸三次打出来的。判据先后把这三样误报成「NPC 米尔·特里坎」：
  //   1. 调查员**米尔德丽德**·罗德里格斯（全名在排除名单里，但正文用的是短名）
  //   2. 短名摊开后仍中招 —— 序章写「米尔德丽德下意识地……」
  //   3. 模组标题《普瑞**米尔**的谷仓》
  // 每修一次就冒出下一个碰撞。结论不是「再补一个排除项」，
  // 而是：**中文短名的子串匹配在运行时不可靠**，排除名单永远列不全。
  // 全名带「·」，长度和结构都够独特，这才是运行时判得动的部分。
  //
  // 只用姓或只用名的泄漏由单测在**模组数据**上查（那里名单是封闭的，
  // 见 `name-before-introduction.test.ts`）—— 分工按「名单封不封闭」划，
  // 不按「哪个更严格」划。
  const briefed = (BARN_OF_PREMIER.partySetup?.context ?? []).join("\n");
  for (const npc of BARN_OF_PREMIER.npcs) {
    const full = npc.name.replace(/[（(].*?[）)]/g, "").trim();
    if (!full.includes("·")) continue; // 「警员」「流浪汉」这类不是人名，跳过
    if (!text.includes(full)) continue;
    if (briefed.includes(full)) continue; // 接案时就被告知了，出现是正常的
    notes.push(`⚠ 开场出现了全名「${full}」—— 案件简报没提过，调查员此时不该知道`);
  }
  if (/见过太多案子|办过.*案子/.test(text)) {
    notes.push("⚠ 出现「见过太多案子」这类侦探履历 —— 随机职业未必成立");
  }
  // 名字后紧跟错性别代词：只能粗查，作为人工复核的线索
  for (const f of FEMALE_FIRST_NAMES) {
    if (text.includes(f) && new RegExp(`${f}[^。！？]{0,24}他[^们]`).test(text)) {
      notes.push(`⚠ 「${f}」附近出现「他」—— 疑似代词与性别不符`);
      break;
    }
  }
  if (notes.length) { flagged++; out.push(...notes.map((n) => `- ${n}`), ""); }
  else out.push("- 机器判据无异常（措辞是否自然仍需人读）", "");
}

out.push("## 说明");
out.push("");
out.push("机器在这里只判得动三类：**全名**是否提前出现、有没有编侦探履历、代词是否明显不符。");
out.push("");
out.push("**只用名或只用姓的泄漏运行时判不了。** 中文短名的子串匹配在开放文本上不可靠 ——");
out.push("同一条判据先后把「米尔德丽德·罗德里格斯」（调查员）和《普瑞米尔的谷仓》（模组标题）");
out.push("误报成 NPC「米尔·特里坎」，排除名单永远列不全。那部分改由单测在**模组数据**上查，");
out.push("那里名单是封闭的（`src/__tests__/name-before-introduction.test.ts`）。");
out.push("");
out.push("**「读起来像不像抄词条」判不了** —— 那要人看。这份取样就是给人看的。");

const path = await writeReport("probe-opening.md", out.join("\n"));
console.log(`取样 ${N} 局，机器判据命中 ${flagged} 局  -> ${path}`);
