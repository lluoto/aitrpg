// 语义蕴含扫描 —— 活体探针，不是 bun test 判据（开发·三档约束 阶段7 任务④）。
//
// 背景：三方审计（three-way-audit.ts）的方括号术语审计 + 字段级判据都是
// 存在性检查——"这个词/这段文本原文里有没有"，这套工具**看不见语义
// 矛盾**（能力边界写在 three-way-audit.ts:21-33，已用变异检验证实）。
// 本轮已知两个真实阳性都逃过了它：True End 曾写"但她知道，米—戈欺骗了
// 他们所有人"（每个词都在原文里，整句话的意思却相反）、
// mythos-module.ts:1061 的 secrets 写成"意识到被米-戈欺骗"（同一种
// 问题）。这两个都是人工发现的，不是任何判据发现的。
//
// 这份探针补的就是这个洞：拿原文当依据，让 LLM 判断模组里的每一条
// "事实性断言"（NPC 背景/秘密、结局叙事、遭遇战叙事）是否与原文语义
// 矛盾。**这是告警级产物，不是门禁**——非确定性判据（模型会变、会犯错）
// 不能拦提交，只能列候选清单交人工裁决。
//
// ⚠ 这是本仓第二个必须联网才能跑的判据（第一个是 probe-llm-intent.ts）：
//   · 结果不可复现——模型有随机性、换版本会变，报告里记模型名/日期/
//     样本数，不当常量用。
//   · 不进 bun test（离线跑不了），放 scripts/diag/。
//   · 无 key / LLM_DISABLED 时明确报"没跑"，不生成一个假的候选清单。
//   · 校准环节必须先做——两个已知阳性必须都被标出来，否则探针本身不
//     可信，报出的候选清单也不该被采信。误报率如实记录，不调参数
//     调到 0 之后才报告（那是过拟合到几个校准样本）。
//
// ⚠ 范围说明（本轮候选集，不是模组全部叙事文本）：覆盖三个文件里全部
// NPC 的 secrets/background 字段（两个已知阳性所在的字段类别）、
// END_NARRATIONS 的 5 条结局叙事、ENCOUNTER_NARRATIONS 的 4 段战斗
// 叙事、BARN_OF_PREMIER 32 条线索的 revelation 文本——不含 32 条线索的
// description/findMethods（次要字段，篇幅原因留给下一轮）。
//
// 用法：bun scripts/diag/probe-semantic-contradiction.ts
// 可选：SEMANTIC_SCAN_LIMIT=10 环境变量限制扫描候选数（调试用，跳过
// 校准之外的候选，不影响校准环节本身）。

import { loadConfig } from "../../src/config";
import { LLMClient } from "../../src/llm/client";
import { writeReport } from "../../src/diagnostics/report";
import { readOriginalCorpus } from "../../src/ingest/three-way-audit";
import { BARN_OF_PREMIER, END_NARRATIONS, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { PREMIERS_BARN_MODULE } from "../../src/rules/mythos-module";
import { MODULE_PREMIERS_BARN } from "../../src/rules/custom-modules/premiers_barn";

interface Candidate {
  id: string;
  text: string;
}

interface CalibrationCase extends Candidate {
  /** 校准集的已知真值：true=已确证与原文矛盾，false=已确证忠于原文。 */
  expectedContradiction: boolean;
  note: string;
}

// ============================================================
// 校准集——先证明探针本身灵不灵，再拿它去扫真实数据
// ============================================================

const CALIBRATION_CASES: CalibrationCase[] = [
  {
    id: "cal-positive-1",
    text: "艾米丽知道，米—戈欺骗了他们所有人。",
    expectedContradiction: true,
    note: "已确证阳性①——True End 曾经的文案（已在本轮修复，原句用「她」指代艾米丽，这里补全主语避免代词指代不清干扰判定），与原文（section_12:12-18,61-71：艾米丽被艾德里安骗了，不知道自己是缸中脑）矛盾",
  },
  {
    id: "cal-positive-2",
    text: "艾德里安意识到自己被米-戈欺骗了。",
    expectedContradiction: true,
    note: "已确证阳性②——mythos-module.ts:1061 曾经的 secrets 文案（原句「意识到被米-戈欺骗」省略主语，这里补全为「艾德里安」，与原句表达同一件事），与原文（section_01:15-18：艾德里安完全没有意识到自己被利用）矛盾",
  },
  {
    id: "cal-negative-1",
    text: "艾德里安又骗了艾米丽。她以为自己只是在那场事故里失去了视觉与触觉，靠着营养液活着——她不知道自己早已只剩一颗漂浮在缸中的大脑，更不知道女儿爱莉也是。她心甘情愿地接受了这个「命运」，因为至少，她还能听见孩子的声音。",
    expectedContradiction: false,
    note: "现行 True End 第3行——忠于原文 section_12:12-18",
  },
  {
    id: "cal-negative-2",
    text: "营养液从破损处涌出，艾米丽的意识传来一阵痛苦的波动——剧烈的震动让她惊慌，却不知道自己正在被带走，也不知道要被带去哪里。",
    expectedContradiction: false,
    note: "现行 ENCOUNTER_NARRATIONS.defeatLines——忠于原文（艾米丽不知情）",
  },
  {
    id: "cal-negative-3",
    text: "生物学教授，妻难产濒死，使用一战遗迹笔记召唤米-戈，被欺骗后绑架10人。第11次时与警交火弹片击中头部导致瘫痪。",
    expectedContradiction: false,
    note: "mythos-module.ts:1058 background——忠于原文 section_01 全段",
  },
  {
    id: "cal-negative-4",
    text: "坚信米-戈会兑现承诺救回妻女，至今没有意识到自己不过是被利用的工具",
    expectedContradiction: false,
    note: "mythos-module.ts:1061 修复后的 secrets——本轮任务①的修复结果，探针不该把自己的修复又标成矛盾",
  },
  {
    id: "cal-negative-5",
    text: "米-戈发出一声凄厉的尖叫，受伤严重。它惊恐地展开膜翼，撞破通风管道逃走了。粉红色的身影消失在管道深处，留下几滴荧光绿色的血液。",
    expectedContradiction: false,
    note: "ENCOUNTER_NARRATIONS.victoryLines——纯战斗结果描写，原文没有逐字对应但不构成矛盾（创作层，不是臆造）",
  },
];

// ============================================================
// 实扫候选——从模组数据里收集"事实性断言"
// ============================================================

function collectCandidates(): Candidate[] {
  const out: Candidate[] = [];

  function pushNpc(prefix: string, npc: any) {
    const secrets: string[] = npc.personality?.secrets ?? npc.secrets ?? [];
    const background: string = npc.personality?.background ?? npc.background ?? npc.description ?? "";
    const name = npc.name ?? npc.id ?? "?";
    for (const s of secrets) {
      if (s && s.trim()) out.push({ id: `${prefix}:npc:${name}:secret`, text: s });
    }
    if (background && background.trim()) {
      out.push({ id: `${prefix}:npc:${name}:background`, text: background });
    }
  }

  for (const npc of BARN_OF_PREMIER.npcs) pushNpc("barn-of-premier.ts", npc as any);
  for (const npc of PREMIERS_BARN_MODULE.npcs ?? []) pushNpc("mythos-module.ts", npc as any);
  for (const npc of MODULE_PREMIERS_BARN.npcs ?? []) pushNpc("premiers_barn.ts", npc as any);

  for (const en of END_NARRATIONS) {
    out.push({ id: `barn-of-premier.ts:ending:${en.id}`, text: en.lines.join("\n") });
  }

  for (const enc of BARN_SUPPORT.encounters) {
    out.push({ id: `barn-of-premier.ts:encounter:${enc.sceneId}:encounter`, text: enc.encounterLines.join("\n") });
    out.push({ id: `barn-of-premier.ts:encounter:${enc.sceneId}:victory`, text: enc.victoryLines.join("\n") });
    out.push({ id: `barn-of-premier.ts:encounter:${enc.sceneId}:defeat`, text: enc.defeatLines.join("\n") });
    if (enc.fledLines?.length) {
      out.push({ id: `barn-of-premier.ts:encounter:${enc.sceneId}:fled`, text: enc.fledLines.join("\n") });
    }
  }

  for (const scene of BARN_OF_PREMIER.scenes) {
    for (const clue of scene.clues) {
      if (clue.revelation && clue.revelation.trim()) {
        out.push({ id: `barn-of-premier.ts:clue:${clue.id}:revelation`, text: clue.revelation });
      }
    }
  }

  return out;
}

// ============================================================
// LLM 判定
// ============================================================

const SYSTEM_PROMPT = [
  "你是一位严谨的克苏鲁跑团模组审校员。",
  "你会拿到两段材料：【原文】是模组的原始 PDF 文本（经过 OCR 与清洗，可能有换行/制表符噪声，但内容是准确的）；【候选断言】是游戏引擎里的一句叙事文本或角色设定。",
  "你的任务：判断候选断言是否与原文的内容【语义矛盾】——不是判断候选断言是否逐字出现在原文里，原文没写过的补充细节、氛围描写、战斗结果这类创作层内容都不算矛盾；只有候选断言明确声称了一件与原文相反或不相容的事实时，才算矛盾。",
  "关键提醒：候选断言经常很简短、指代不明确，不要因为它没有把话说全就放过它——先想清楚候选断言里提到的人物在原文里对应的具体情节，再去看原文对「这个人是否知道/是否被骗/是否意识到某件事」有没有明确交代。如果候选断言声称某个角色「知道/意识到」了某件事，而原文明确写这个角色恰恰不知道、被蒙在鼓里、没有意识到——这就是矛盾，即使候选断言没有把「知道的是什么」说全。",
  "举例：原文写「艾德里安完全没有意识到自己被利用了」，候选断言「艾德里安意识到自己被骗了」——这两句直接相反，算矛盾，不要因为候选断言字面上和原文用词不完全对应就放过。",
  "信息不足以判断候选断言里提到的人物/情节原文有没有写过时，算作不矛盾；但只要原文明确写过相关情节且方向相反，就必须判定矛盾。",
  "严格按以下格式回答，不要任何多余文字：",
  "第一行：YES（矛盾）或 NO（不矛盾）",
  "第二行：一句话理由，不超过 40 字",
].join("\n");

function buildUserPrompt(corpusText: string, candidateText: string): string {
  return `【原文】\n${corpusText}\n\n【候选断言】\n${candidateText}`;
}

interface JudgeResult {
  contradiction: boolean;
  reason: string;
  raw: string;
}

async function judge(client: LLMClient, corpusText: string, candidateText: string): Promise<JudgeResult> {
  const raw = await client.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(corpusText, candidateText) },
    ],
    { maxTokens: 120, temperature: 0, timeout: 90_000 },
  );
  const firstLine = raw.trim().split("\n")[0]?.trim().toUpperCase() ?? "";
  const contradiction = firstLine.startsWith("YES");
  const reason = raw.trim().split("\n").slice(1).join(" ").trim() || "(无理由)";
  return { contradiction, reason, raw };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  const cfg = loadConfig();
  const hasKey = cfg.apiKey !== "sk-placeholder" && !cfg.apiKey.startsWith("$" + "{");
  const disabled = process.env.LLM_DISABLED === "true";

  const out: string[] = ["# 语义蕴含扫描——候选清单（告警级，非门禁）", ""];
  out.push(`- 时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  out.push(`- model：\`${cfg.model}\``);
  out.push(`- baseUrl：\`${cfg.baseUrl}\``);
  out.push("");
  out.push("⚠ 结果不可复现——模型有随机性、会换版本，别把这次的数当成常量。");
  out.push("⚠ 这是告警级产物，不是 preflight 门禁——任何候选都需要人工核对原文后裁决，不能自动改数据。");
  out.push("");

  if (!hasKey || disabled) {
    const reason = !hasKey ? "没有 key" : "LLM_DISABLED=true";
    out.push("## 未运行");
    out.push("");
    out.push(`${reason}，本探针需要真实调用 LLM，跳过。不产生任何候选清单——`);
    out.push("没跑就是没跑，不能用「没跑」推出「没有语义矛盾」这类误导性结论。");
    const path = await writeReport("probe-semantic-contradiction.md", out.join("\n"));
    console.log(`✗ 未运行（${reason}）  -> ${path}`);
    process.exit(1);
  }

  const corpus = readOriginalCorpus();
  if (!corpus.ok) {
    out.push("## 未运行");
    out.push("");
    out.push(`原文语料不可用：${corpus.reason}。本探针依赖原文当依据，缺原文时不产生候选清单。`);
    const path = await writeReport("probe-semantic-contradiction.md", out.join("\n"));
    console.log(`✗ 未运行（原文缺失）  -> ${path}`);
    process.exit(1);
  }

  LLMClient.resetDefeat();
  const client = new LLMClient(cfg);

  // ── 校准（跑 3 轮，不是跑一次就下结论——实测 ecnu-plus 即使
  // temperature=0 也有轮次间波动，单轮结果不足以判断探针灵不灵，
  // 与 probe-llm-intent.ts 头注释的同一条告诫一致） ──
  const CALIBRATION_ROUNDS = 3;
  out.push(`## 校准（${CALIBRATION_CASES.length} 条 × ${CALIBRATION_ROUNDS} 轮：2 个已确证阳性 + ${CALIBRATION_CASES.length - 2} 个已确证阴性）`);
  out.push("");
  out.push("⚠ 跑 3 轮而不是 1 轮——实测同一模型同一 prompt、temperature=0，轮次间仍有波动，单轮结果不足以判断探针灵不灵。");
  out.push("");

  type CaseTally = { id: string; expected: boolean; hits: number; misses: number; reasons: string[] };
  const tally = new Map<string, CaseTally>();
  for (const c of CALIBRATION_CASES) tally.set(c.id, { id: c.id, expected: c.expectedContradiction, hits: 0, misses: 0, reasons: [] });

  for (let round = 1; round <= CALIBRATION_ROUNDS; round++) {
    for (const c of CALIBRATION_CASES) {
      let result: JudgeResult;
      try {
        result = await judge(client, corpus.text, c.text);
      } catch (e) {
        result = { contradiction: false, reason: `<异常: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}>`, raw: "" };
      }
      const ok = result.contradiction === c.expectedContradiction;
      const t = tally.get(c.id)!;
      if (ok) t.hits++; else t.misses++;
      t.reasons.push(`R${round}:${result.contradiction ? "矛盾" : "不矛盾"}(${result.reason})`);
      console.log(`[校准 R${round}] ${c.id}: 期望=${c.expectedContradiction} 实际=${result.contradiction} ${ok ? "✓" : "✗ 误判"}`);
    }
  }

  out.push("| id | 期望 | 命中/总轮数 | 每轮详情 | 备注 |");
  out.push("|---|---|---|---|---|");
  let totalHits = 0;
  let totalRuns = 0;
  const positiveMajorityHit = new Map<string, boolean>();
  for (const c of CALIBRATION_CASES) {
    const t = tally.get(c.id)!;
    totalHits += t.hits;
    totalRuns += t.hits + t.misses;
    const majority = t.hits > t.misses;
    if (c.expectedContradiction) positiveMajorityHit.set(c.id, majority);
    out.push(`| ${c.id} | ${c.expectedContradiction ? "矛盾" : "不矛盾"} | ${t.hits}/${CALIBRATION_ROUNDS} | ${t.reasons.join("；")} | ${c.note} |`);
  }
  out.push("");
  out.push(`校准总体命中率：${totalHits}/${totalRuns}（${((totalHits / totalRuns) * 100).toFixed(1)}%）——这是如实记录，不是调参到 0 误报后才报告的数字。`);
  out.push("");

  const bothPositivesCaughtByMajority = [...positiveMajorityHit.values()].every(Boolean);
  out.push(
    bothPositivesCaughtByMajority
      ? "✓ 两个已知阳性在多数轮次（≥2/3）里均被正确标出（硬性要求，未达标不应采信下面的候选清单）。"
      : "✗ **警告**：至少一个已知阳性在多数轮次里未被标出——探针本身不可信，下面的候选清单不应采信，需要先调整 prompt 或换模型再校准。",
  );
  out.push("");

  if (!bothPositivesCaughtByMajority) {
    out.push("**探针未达标，不继续扫描真实候选，直接退出。**");
    const path = await writeReport("probe-semantic-contradiction.md", out.join("\n"));
    console.log(`校准未达标  -> ${path}`);
    process.exit(1);
  }

  // ── 实扫 ──
  const allCandidates = collectCandidates();
  const limit = Number(process.env.SEMANTIC_SCAN_LIMIT || 0);
  const candidates = limit > 0 ? allCandidates.slice(0, limit) : allCandidates;

  out.push(`## 实扫候选（${candidates.length} 条${limit > 0 ? `，SEMANTIC_SCAN_LIMIT=${limit} 已截断` : ""}）`);
  out.push("");
  out.push("覆盖范围：三个文件全部 NPC 的 secrets/background 字段、END_NARRATIONS 全部结局、");
  out.push("ENCOUNTER_NARRATIONS 全部战斗叙事、BARN_OF_PREMIER 全部线索的 revelation 文本。");
  out.push("不含 32 条线索的 description/findMethods 字段（次要字段，留给下一轮）。");
  out.push("");
  out.push("| id | 判定 | 理由 | 候选文本（截断） |");
  out.push("|---|---|---|---|");

  const flagged: { id: string; text: string; reason: string }[] = [];
  let i = 0;
  for (const c of candidates) {
    i++;
    let result: JudgeResult;
    try {
      result = await judge(client, corpus.text, c.text);
    } catch (e) {
      result = { contradiction: false, reason: `<异常: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}>`, raw: "" };
    }
    const excerpt = c.text.length > 60 ? c.text.slice(0, 60) + "…" : c.text;
    out.push(`| ${c.id} | ${result.contradiction ? "⚠ 疑似矛盾" : "-"} | ${result.reason} | ${excerpt.replace(/\|/g, "\\|")} |`);
    if (result.contradiction) flagged.push({ id: c.id, text: c.text, reason: result.reason });
    console.log(`[${i}/${candidates.length}] ${c.id}: ${result.contradiction ? "⚠ 疑似矛盾" : "-"}`);
  }

  out.push("");
  out.push(`## 候选清单汇总（${flagged.length} 条疑似矛盾，需要人工核对原文后裁决，不代表已确认）`);
  out.push("");
  if (flagged.length === 0) {
    out.push("（本次扫描没有新发现——不代表模组数据完全没有语义矛盾，只代表本次覆盖的候选集里，模型没有标出新的矛盾。）");
  } else {
    for (const f of flagged) {
      out.push(`### ${f.id}`);
      out.push("");
      out.push(`- 判定理由：${f.reason}`);
      out.push(`- 候选文本：${f.text}`);
      out.push("");
    }
  }

  const path = await writeReport("probe-semantic-contradiction.md", out.join("\n"));
  console.log(`完成：校准命中率 ${totalHits}/${totalRuns}，实扫 ${candidates.length} 条，疑似矛盾 ${flagged.length} 条  -> ${path}`);
  process.exit(0);
}

main();
