// 车卡阶段的 LLM 到底跑没跑起来 —— 「背景像抄词条」的两种成因得分开。
//
// 八项背景与小传**本来就是 LLM 写的**（`enhanceBackgroundProfile` / `writeBackstory`），
// 模板只在失败时兜底。而兜底池**每个职业每项只有 3 句**
// （见 `probe-backstory-pools`），一旦悄悄回落，同职业两个角色必然撞句 ——
// 读起来就是「像直接抄那几个词条」。
//
// 所以要分清：
//   LLM 挂了 → 回落模板 → 撞句      （修 LLM 那条路）
//   LLM 跑通了但写得平淡              （修提示词）
// 过去这两种在产物上长得一模一样：`llmOnce` 把每条失败都咽了。
// 现在它发 `llm-call` 事件，这里把结果数出来。
//
// 用法：bun scripts/diag/probe-backstory.ts [取样局数，默认 1]

import { BARN_OF_PREMIER, BARN_SUPPORT } from "../../src/module/barn-of-premier";
import { runModule } from "../../src/play-module";
import { writeReport } from "../../src/diagnostics/report";
import type { PlayEvent } from "../../src/play/events";

const N = Number(process.argv[2] ?? 1);

interface Call { purpose: string; ok: boolean; reason: string; ms: number }

/** 从角色卡那一行里把小传原样抠出来 —— 「厚度够不够」只能人读 */
function extractBackstories(lines: readonly string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const i = l.indexOf("【背景小传】");
    if (i < 0) continue;
    const seg = l.slice(i + "【背景小传】".length);
    const end = seg.search(/【[^】]+】/);
    out.push((end > 0 ? seg.slice(0, end) : seg).trim());
  }
  return out;
}

async function sample(): Promise<{ calls: Call[]; stories: string[] }> {
  const calls: Call[] = [];
  const lines: string[] = [];
  try {
    await runModule(BARN_OF_PREMIER, BARN_SUPPORT, {
      onEvent: (e: PlayEvent) => {
        if (e.type === "llm-call") calls.push({ purpose: e.purpose, ok: e.ok, reason: e.reason, ms: e.ms });
      },
      onLine: (l) => lines.push(l),
      decide: async () => { throw new Error("__sampled__"); },
    });
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("__sampled__")) {
      calls.push({ purpose: "(本局提前结束)", ok: false, reason: e instanceof Error ? e.message : String(e), ms: 0 });
    }
  }
  return { calls, stories: extractBackstories(lines) };
}

const all: Call[] = [];
const stories: string[] = [];
for (let i = 0; i < N; i++) {
  const s = await sample();
  all.push(...s.calls);
  stories.push(...s.stories);
}

const byPurpose = new Map<string, { ok: number; fail: number; reasons: Map<string, number>; msTotal: number }>();
for (const c of all) {
  const slot = byPurpose.get(c.purpose) ?? { ok: 0, fail: 0, reasons: new Map(), msTotal: 0 };
  if (c.ok) slot.ok++; else { slot.fail++; slot.reasons.set(c.reason, (slot.reasons.get(c.reason) ?? 0) + 1); }
  slot.msTotal += c.ms;
  byPurpose.set(c.purpose, slot);
}

const okAll = all.filter((c) => c.ok).length;
const out: string[] = ["# 车卡阶段的 LLM 调用", ""];
out.push(`取样 ${N} 局，共 ${all.length} 次调用，成功 **${okAll}**，失败 **${all.length - okAll}**。`);
out.push("");
if (all.length === 0) {
  out.push("⚠ **一次调用都没记录到** —— 不是「都成功了」，是这份取样没量到东西。");
  out.push("先确认 `llmOnce` 真的在发 `llm-call` 事件，再看结论。");
} else {
  out.push("| 用途 | 成功 | 失败 | 平均耗时 | 失败原因 |");
  out.push("|---|---|---|---|---|");
  for (const [p, s] of byPurpose) {
    const reasons = [...s.reasons.entries()].map(([r, n]) => `${r}×${n}`).join("；") || "—";
    out.push(`| ${p} | ${s.ok} | ${s.fail} | ${Math.round(s.msTotal / (s.ok + s.fail))}ms | ${reasons} |`);
  }
  out.push("");
  const bg = byPurpose.get("background");
  const bs = byPurpose.get("backstory");
  const degraded = (bg?.fail ?? 0) + (bs?.fail ?? 0);
  out.push(degraded > 0
    ? `⚠ **有 ${degraded} 次回落到了模板**。兜底池每职业每项只有 3 句 —— 这就是「像抄词条」的来源，\n  要修的是 LLM 那条路（或提示词/超时），不是去扩模板池。`
    : "✓ 车卡阶段的 LLM 全部成功 —— 背景不是模板抄的。\n  若读起来仍单薄，那是**提示词**的问题，不是回落。");
}
out.push("");
out.push("## 小传原文（**厚度够不够只能人读**，机器判不了）");
out.push("");
if (stories.length === 0) {
  out.push("⚠ 一段都没抓到 —— 不是「都没写」，是这份取样没量到东西，先查 `【背景小传】` 这个标记还在不在。");
} else {
  for (const s of stories) {
    out.push(`**${s.replace(/\s/g, "").length} 字**`, "", s, "", "─".repeat(50), "");
  }
  const avg = Math.round(stories.reduce((a, s) => a + s.replace(/\s/g, "").length, 0) / stories.length);
  out.push(`平均 ${avg} 字。`);
  out.push("对照：提示词还写「3-5 句」时是 150-200 字，且基本在复述卡面上的八项。");
}
out.push("");
out.push("> 人名现在由 LLM 跟八项**同一次调用**给出（不额外打网络），");
out.push("> `acceptGeneratedName` 把关，给不出合格名字才退回硬编码名字池。");

const path = await writeReport("probe-backstory.md", out.join("\n"));
console.log(`LLM 调用 ${all.length} 次，成功 ${okAll}  -> ${path}`);
