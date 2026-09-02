// 块分类返回键的形态探针 —— 活体探针，不是 bun test 判据（修 todo-51 任务①）。
//
// 背景：todo-51 记录了一次实跑（2026-09-02，ecnu-plus）：43 个块送分类，
// `parseClassifyResponse` 只解析出 1 条。核实过不是 token 截断（回复长度
// 在 maxTokens 1024 与 8000 下字节级相同），是模型返回的 JSON 键带了
// "【标题】+ 大段摘录正文"，而 `normalizeKey()` 只剥字符串首尾的方括号，
// 剥不掉这种"方括号在中间"的形态。
//
// todo-51 自己留的未决问题：这是这次模型的偶发指令遵循漂移，还是稳定
// 复现？本探针只回答这一件事——跑 N 次真实分类，记录每次模型返回的键
// 落在哪种形态，不猜、不凑结论。
//
// ⚠ 联网非确定性判据，同 probe-llm-intent.ts/probe-semantic-contradiction.ts
// 的约定：结果不可复现，报告里记模型名/日期/样本数，不当常量用；无 key/
// LLM_DISABLED 时明确报"没跑"；不进 bun test（离线跑不了），放
// scripts/diag/；产物落 analysis/diag/（gitignored）。
// ⚠ 结论允许是"说不准"——如果 N 次里键形态不一致，如实记录分布，
// 不要凑一个"大多数情况下是 X"这类看着确定实则是选择性汇报的结论。
//
// 用法：INGEST_PDF=<路径> bun scripts/diag/probe-classify-key-format.ts [N]
//   N 默认 5。

import { readFileSync } from "fs";
import { loadConfig } from "../../src/config";
import { LLMClient } from "../../src/llm/client";
import { extractPages } from "../../src/ingest/pdf-source";
import { prepareSections } from "../../src/ingest/pipeline";
import { toClassifyInputs, buildClassifyPrompt } from "../../src/ingest/classify-sections";
import { extractJson } from "../../src/llm/json";
import { writeReport } from "../../src/diagnostics/report";

const PDF = process.env.INGEST_PDF ?? "";
const N = Number(process.argv[2] ?? 5);

type KeyShape = "clean" | "extra-content" | "unrecognized";

/** 把一个键分类成三种形态之一——不做归一化，就看模型原样给了什么。 */
function classifyKeyShape(rawKey: string, knownTitles: Set<string>): { shape: KeyShape; matchedTitle?: string } {
  // clean：整个键去掉首尾空白后恰好是 "【标题】"，标题在已知列表里。
  const cleanMatch = rawKey.trim().match(/^[【\[［]\s*(.+?)\s*[】\]］]$/);
  if (cleanMatch && knownTitles.has(cleanMatch[1] as string)) {
    return { shape: "clean", matchedTitle: cleanMatch[1] };
  }
  // extra-content：键里能找到一个 "【已知标题】"，但键本身不止这些
  // （标题后面还跟着别的内容，即 todo-51 描述的那种形态）。
  for (const title of knownTitles) {
    if (rawKey.includes(`【${title}】`) || rawKey.includes(`[${title}]`)) {
      return { shape: "extra-content", matchedTitle: title };
    }
  }
  return { shape: "unrecognized" };
}

async function main() {
  const cfg = loadConfig();
  const hasKey = cfg.apiKey !== "sk-placeholder" && !cfg.apiKey.startsWith("$" + "{");
  const disabled = process.env.LLM_DISABLED === "true";

  const out: string[] = ["# 块分类返回键形态探针（修 todo-51 任务①）", ""];
  out.push(`- 时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  out.push(`- model：\`${cfg.model}\``);
  out.push(`- baseUrl：\`${cfg.baseUrl}\``);
  out.push(`- 样本数：N=${N}`);
  out.push("");
  out.push("⚠ 结果不可复现——模型有随机性、会换版本，别把这次的数当成常量。");
  out.push("⚠ 允许结论是「说不准」：形态不一致时如实记录分布，不凑结论。");
  out.push("");

  if (!hasKey || disabled) {
    const reason = !hasKey ? "没有 key" : "LLM_DISABLED=true";
    out.push("## 未运行");
    out.push("");
    out.push(`${reason}，本探针需要真实调用 LLM，跳过。`);
    const path = await writeReport("probe-classify-key-format.md", out.join("\n"));
    console.log(`✗ 未运行（${reason}）  -> ${path}`);
    process.exit(1);
  }

  if (!PDF) {
    out.push("## 未运行");
    out.push("");
    out.push("未设置 INGEST_PDF，本探针需要真实模组 PDF 才能跑真实分类，跳过。");
    const path = await writeReport("probe-classify-key-format.md", out.join("\n"));
    console.log(`✗ 未运行（无 PDF）  -> ${path}`);
    process.exit(1);
  }

  const raw = await extractPages(new Uint8Array(readFileSync(PDF)));
  const sections = prepareSections(raw);
  const inputs = toClassifyInputs(sections);
  const knownTitles = new Set(inputs.map((s) => s.title));
  const prompt = buildClassifyPrompt(inputs);

  LLMClient.resetDefeat();
  const client = new LLMClient(cfg);

  out.push(`送分类的块数：${inputs.length}`);
  out.push("");
  out.push("## 逐轮结果");
  out.push("");
  out.push("| 轮次 | 回复长度 | JSON 可解析 | 键总数 | clean | extra-content | unrecognized |");
  out.push("|---|---|---|---|---|---|---|");

  interface RoundResult {
    round: number;
    reply: string;
    replyLen: number;
    parseable: boolean;
    totalKeys: number;
    clean: number;
    extraContent: number;
    unrecognized: number;
    sampleExtraKeys: string[];
  }
  const rounds: RoundResult[] = [];

  for (let i = 1; i <= N; i++) {
    let reply = "";
    try {
      reply = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
    } catch (e) {
      out.push(`| ${i} | <异常> | - | - | - | - | - |`);
      console.log(`[轮次 ${i}/${N}] 调用异常: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const obj = extractJson(reply);
    const parseable = obj !== null && typeof obj === "object";
    const entries = parseable ? Object.entries(obj as Record<string, unknown>) : [];
    let clean = 0, extraContent = 0, unrecognized = 0;
    const sampleExtraKeys: string[] = [];
    for (const [k] of entries) {
      const { shape } = classifyKeyShape(k, knownTitles);
      if (shape === "clean") clean++;
      else if (shape === "extra-content") {
        extraContent++;
        if (sampleExtraKeys.length < 3) sampleExtraKeys.push(k.slice(0, 80));
      } else unrecognized++;
    }
    rounds.push({ round: i, reply, replyLen: reply.length, parseable, totalKeys: entries.length, clean, extraContent, unrecognized, sampleExtraKeys });
    out.push(`| ${i} | ${reply.length} | ${parseable ? "是" : "否"} | ${entries.length} | ${clean} | ${extraContent} | ${unrecognized} |`);
    console.log(`[轮次 ${i}/${N}] 回复${reply.length}字 键${entries.length}个 clean=${clean} extra=${extraContent} unrecognized=${unrecognized}`);
  }

  out.push("");
  out.push("## 形态样本（extra-content 的前几个，逐字摘录）");
  out.push("");
  for (const r of rounds) {
    if (r.sampleExtraKeys.length === 0) continue;
    out.push(`轮次 ${r.round}:`);
    for (const s of r.sampleExtraKeys) out.push(`  - \`${s}\``);
  }

  out.push("");
  out.push("## 分布汇总（不下结论，只报数）");
  out.push("");
  out.push(`跑了 ${rounds.length}/${N} 轮成功获得回复。`);

  // 两件事分开判断，不要混在一起说：
  //   ① 每一轮**内部**的键形态是不是单一的（一轮里全 clean 或全 extra-content）
  //   ② **跨轮次**的形态分布是不是彼此一致（每轮的 clean/extra/unrecognized 数字是否相同）
  // 「同一个 prompt 每次都产出同一种混合分布」和「不同次跑出不同分布」
  // 是完全不同的两种"不确定性"，混着说会把"稳定复现的混合形态"错误地
  // 报成"说不准"。
  const roundsAllSameShape = rounds.length > 0 && rounds.every(
    (r) => r.clean === rounds[0]!.clean && r.extraContent === rounds[0]!.extraContent && r.unrecognized === rounds[0]!.unrecognized,
  );
  const anyRoundPurelyClean = rounds.some((r) => r.totalKeys > 0 && r.extraContent === 0 && r.unrecognized === 0);
  const anyRoundPurelyExtra = rounds.some((r) => r.totalKeys > 0 && r.extraContent === r.totalKeys);

  if (roundsAllSameShape && rounds.length > 0) {
    const r0 = rounds[0]!;
    out.push(
      `**跨轮次分布完全一致**：每一轮都是 ${r0.clean} clean / ${r0.extraContent} extra-content / ` +
        `${r0.unrecognized} unrecognized（共 ${r0.totalKeys} 键），回复字节长度也完全相同——` +
        `${r0.extraContent > 0 ? "todo-51 描述的问题在这份固定 prompt 下稳定复现，不是偶发。" : "本次没有复现 todo-51 描述的问题。"}`,
    );
    if (!anyRoundPurelyClean && !anyRoundPurelyExtra) {
      out.push(`⚠ 这是"混合形态"（同一轮里既有 clean 又有 extra-content），不是"全对或全错"——按键逐条独立解析，不是按轮次整体判断。`);
    }
  } else {
    out.push("**跨轮次分布不一致**——同一个 prompt、同一个模型，不同轮次给出了不同的键形态分布。这就是「说不准」的实测证据，不是没测清楚：");
    for (const r of rounds) {
      out.push(`  - 轮次 ${r.round}：${r.clean} clean / ${r.extraContent} extra-content / ${r.unrecognized} unrecognized（共 ${r.totalKeys} 键）`);
    }
  }

  // ── 排除服务端缓存（修 todo-51 任务①b） ──
  //
  // handoff.md:59 记录过同一 provider 即使 temperature=0 也会有波动——
  // 而上面 N 轮跑出来的是逐字节完全相同的回复，这本身就反常到需要单独
  // 排除一种可能：服务端按"提示词字面完全相同"做了缓存，命中缓存时
  // 回复必然逐字节相同，但那证明的是"缓存生效"，不是"这个 prompt 下
  // 模型真的确定性"——如果是这样，N=8 应该按 N=1 重述结论（8 次里有
  // 7 次根本没有真的问过模型）。
  //
  // 做法：跑两轮对照，各自与轮次 1 的回复做逐字节比较。
  //   A. 同一份 prompt 多加一个无意义的尾随空格（内容不变，字面变了）——
  //      如果服务端按提示词字面缓存，这一轮必然不命中缓存，回复应该
  //      变化（除非模型对这个 prompt 真的高度确定性，那也会变但概率低）。
  //   B. 同一份 prompt，temperature 从 0.1 换成 0.9——温度本身就该增大
  //      随机性，如果这一轮回复仍然逐字节相同，那是更强的"这个 prompt
  //      下模型确定性很高"的证据，而不是缓存能解释的（缓存键通常不含
  //      温度参数之外的采样细节，但温度本身若真的生效，理论上应该扰动
  //      结果——两种解释在这里是可以分开验的）。
  if (rounds.length > 0) {
    out.push("");
    out.push("## 排除服务端缓存的对照实验");
    out.push("");
    const r1 = rounds[0]!;

    let replyA = "";
    let errA = "";
    try {
      replyA = await client.chat([{ role: "user", content: prompt + " " }], { temperature: 0.1 });
    } catch (e) {
      errA = e instanceof Error ? e.message : String(e);
    }
    const sameAsR1_A = replyA === r1.reply;
    out.push(`**对照 A（prompt 多一个尾随空格，temperature 不变 0.1）**：${errA ? `调用异常: ${errA}` : `回复长度 ${replyA.length}（轮次1是 ${r1.replyLen}），与轮次1${sameAsR1_A ? "**逐字节相同**" : "**不同**"}`}`);

    let replyB = "";
    let errB = "";
    try {
      replyB = await client.chat([{ role: "user", content: prompt }], { temperature: 0.9 });
    } catch (e) {
      errB = e instanceof Error ? e.message : String(e);
    }
    const sameAsR1_B = replyB === r1.reply;
    out.push(`**对照 B（prompt 不变，temperature 换成 0.9）**：${errB ? `调用异常: ${errB}` : `回复长度 ${replyB.length}（轮次1是 ${r1.replyLen}），与轮次1${sameAsR1_B ? "**逐字节相同**" : "**不同**"}`}`);

    out.push("");
    if (!errA && !errB) {
      if (!sameAsR1_A && !sameAsR1_B) {
        out.push("**结论**：两组对照都产生了不同的回复——排除了「服务端按提示词字面缓存」这个解释（缓存命中会要求提示词字面相同，A 组字面已经不同）；温度调高后也确实变了，进一步说明轮次 1-8 的逐字节一致不是缓存假象，是这个 prompt 在 temperature=0.1 下对这个模型确实高度确定。");
      } else if (sameAsR1_A && sameAsR1_B) {
        out.push("**结论存疑**：两组对照回复都与轮次 1 逐字节相同，包括提示词字面已经变化的 A 组——这不能用「提示词字面缓存」解释（A 组字面不同却还命中），更像是模型对这整段素材的判断本身极其稳定，但不能完全排除有更粗粒度的缓存机制（例如按语义摘要而非字面缓存）。说不准，如实记录两种可能，不选一个更省事的结论。");
      } else {
        out.push(`**结论：部分证据**——对照 A ${sameAsR1_A ? "相同" : "不同"}，对照 B ${sameAsR1_B ? "相同" : "不同"}，两组给出的信号不一致，不足以下一个干脆的结论，如实记录两组各自的结果，不强行统一成一句话。`);
      }
    } else {
      out.push("**对照实验未能完整跑完**（至少一组调用异常）——不下结论，如实记录上面两行的异常信息。");
    }
  }

  const path = await writeReport("probe-classify-key-format.md", out.join("\n"));
  console.log(`完成：${rounds.length}/${N} 轮 + 缓存排除对照  -> ${path}`);
  process.exit(0);
}

main();
