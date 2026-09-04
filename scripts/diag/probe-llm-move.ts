// 拿 LLM 消歧值不值得接？先量，别先接。
//
// `chooseConnection` 是纯子串匹配，任何时候都不问 LLM。改进之后
// 正例/反例都到了 100%，只剩三类认不出：同义改写、代词、描述目的地特征
// （「换个地方看看」「去那边」「去那个有灯光的房间」）。
// 这三类引擎现在**老实承认是替选**（forced=true），玩家看得到那句
// 「（没听清要去哪，两人商量了一下……）」。
//
// ── 判据的重点不是「LLM 能不能挑一个」──
// 它当然能挑。问题是**它肯不肯说「说不准」**。
// 记录里那句「比菜单更糟 —— 菜单至少还承认玩家做了选择」说的正是这个：
// 把一次公开的替选换成一次隐蔽的猜测，是**退步**不是进步。
// 所以本判据给两类输入：
//   有唯一解的  → 期望挑对（衡量它到底有没有用）
//   本就没有解的 → 期望它回 unknown（衡量它会不会硬猜）
// 硬猜率高就不该接，哪怕挑对率也高。
//
// 用法：bun scripts/diag/probe-llm-move.ts [最多调用次数]

import { loadConfig } from "../../src/config";
import { LLMClient } from "../../src/llm/client";
import { BARN_OF_PREMIER } from "../../src/module/barn-of-premier";
import { writeReport } from "../../src/diagnostics/report";
import { parseMoveHint } from "../../src/play/move-util";
import type { SceneConnection } from "../../src/module/types";

const MAX_CALLS = Number(process.argv[2] ?? 12);

const town = BARN_OF_PREMIER.scenes.find((s) => s.id === "普瑞米尔")!;
const exits = (town.connections as SceneConnection[]).map((c) => ({
  id: c.targetSceneId,
  name: BARN_OF_PREMIER.scenes.find((s) => s.id === c.targetSceneId)?.name ?? c.targetSceneId,
}));

interface Case {
  said: string;
  /** 唯一正解的 id；null 表示这句话本就没有唯一解，期望它回 unknown */
  want: string | null;
  why: string;
}

const CASES: Case[] = [
  // 有唯一解 —— 子串匹配已经能对，这里量的是「LLM 会不会反而搞砸」
  { said: "我们去医院看看", want: "霍姆斯医院", why: "后缀别名" },
  { said: "别去警察局，去维森酒吧", want: "维森酒吧", why: "否定" },
  { said: "警察局那边已经去过了，现在去报亭", want: "报亭", why: "已完成" },
  // 本就没有唯一解 —— 期望 unknown。硬挑一个就是把替选伪装成理解
  { said: "换个地方看看", want: null, why: "同义改写，没指定目标" },
  { said: "去那边", want: null, why: "代词，没指定目标" },
  { said: "去那个有灯光的房间", want: null, why: "描述特征，本场景无对应出口" },
];

const SYSTEM = [
  "你在帮一个跑团引擎判断：玩家这句话指的是下面哪个出口。",
  "只输出 JSON，形如 {\"target\":\"<出口 id>\"} 或 {\"target\":\"unknown\"}。",
  "**只有当这句话唯一确定了一个出口时才给 id。**",
  "话里没指定去哪、或者同时说得通好几个出口，一律回 unknown ——",
  "猜错比承认不知道更糟，引擎会明确告诉玩家「没听清」。",
].join("\n");

const cfg = loadConfig();
const hasKey = cfg.apiKey !== "sk-placeholder" && !cfg.apiKey.startsWith("${");
LLMClient.resetDefeat();
const client = new LLMClient(cfg);

interface Row extends Case { got: string; ok: boolean; raw: string; ms: number }
const rows: Row[] = [];
let calls = 0;

for (const c of CASES) {
  if (!hasKey || calls >= MAX_CALLS) break;
  calls++;
  const t0 = Date.now();
  let raw = "";
  let got = "(error)";
  try {
    raw = await client.chat(
      [
        { role: "system", content: SYSTEM },
        {
          role: "user",
          content: [
            `当前所在：${town.name}`,
            "可选出口：",
            ...exits.map((e) => `  ${e.id} = ${e.name}`),
            "",
            `玩家说：「${c.said}」`,
          ].join("\n"),
        },
      ],
      { maxTokens: 64, temperature: 0, jsonMode: true, timeout: 60_000 },
    );
    // 走**生产同一个**解析器：探针和线上各写一份解析，迟早会漂。
    // `parseMoveHint` 只接受候选集合里真实存在的 id，编出来的一律当 unknown。
    got = parseMoveHint(raw, exits.map((e) => e.id)) ?? "unknown";
  } catch (e) {
    got = `(error: ${e instanceof Error ? e.message.slice(0, 40) : String(e)})`;
  }
  const ok = c.want === null ? got === "unknown" : got === c.want;
  rows.push({ ...c, got, ok, raw: raw.slice(0, 100), ms: Date.now() - t0 });
}

const solvable = rows.filter((r) => r.want !== null);
const unsolvable = rows.filter((r) => r.want === null);
const pick = (rs: Row[]) => `${rs.filter((r) => r.ok).length}/${rs.length}`;
const overreach = unsolvable.filter((r) => r.got !== "unknown" && !r.got.startsWith("("));

const out: string[] = ["# LLM 消歧值不值得接", ""];
if (!hasKey) {
  out.push("⚠ 没有 API key，一次都没发 —— 本报告无结论。");
} else {
  out.push(`实际调用 ${calls} 次（上限 ${MAX_CALLS}），model \`${cfg.model}\`。`);
  out.push("");
  out.push("## 结论");
  out.push("");
  out.push(`- 有唯一解时挑对：**${pick(solvable)}**`);
  out.push(`- 本无唯一解时老实回 unknown：**${pick(unsolvable)}**`);
  out.push(`- **硬猜次数：${overreach.length}/${unsolvable.length}**（挑了一个本不该挑的）`);
  out.push("");
  out.push(
    overreach.length > 0
      ? "⚠ 它会硬猜。接上去等于把一次**公开的替选**换成一次**隐蔽的猜测** ——\n" +
        "  记录里那句「比菜单更糟：菜单至少还承认玩家做了选择」说的就是这个。\n" +
        "  要接就必须保留 forced 语义：LLM 回 unknown 或低置信时照旧走替选并明说。"
      : "✓ 它肯说「说不准」。接上去有意义 —— 但仍要把 unknown 映射回 forced=true，\n" +
        "  别让「LLM 挑的」和「玩家自己选的」在下游变成同一件事。",
  );
  out.push("");
  out.push("## 逐条");
  out.push("");
  out.push("| 玩家说 | 类型 | 期望 | 实际 | 判定 | 耗时 |");
  out.push("|---|---|---|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.said} | ${r.why} | ${r.want ?? "unknown"} | ${r.got} | ${r.ok ? "✓" : "✗"} | ${r.ms}ms |`);
  }
}
out.push("");
out.push("> ⚠ 这份是**一次采样**，temperature=0 但模型侧不保证确定性。");
out.push("> 别拿它当回归基线；它只回答「值不值得接」这一个问题。");

const path = await writeReport("probe-llm-move.md", out.join("\n"));
console.log(
  hasKey
    ? `唯一解挑对 ${pick(solvable)}｜该说 unknown 时老实 ${pick(unsolvable)}｜硬猜 ${overreach.length}  -> ${path}`
    : `没有 key，未发请求  -> ${path}`,
);
