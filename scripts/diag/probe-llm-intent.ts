// LLM 意图解析准确率 —— 活体探针，不是 bun test 判据。
//
// 背景：analysis/sim/2026-08-31-barn-good-end.md —— 22 回合拿到 Good End，
// 但「陈岳打开冰箱与储物柜，逐一清点里面的氧气罐、药品和袋装流食」被判成
// inventory（背包查询），回复「你的背包是空的」。`[intent] 回落 = 0`，
// 这句话是**真的走了 LLM**，regex 路径对同一句给的是 unknown（会被
// `act()` 的对象名闸门接住）——只有 LLM 判错了。
//
// probe-llm.ts 量「LLM 通不通」，从没量过「LLM 判得准不准」——
// intent-coverage.test.ts 只盖 regex 路径（parseIntent 在没有 setIntentLLM
// 时直接走 regex 兜底）。这个盲区正是 probe-llm.ts 文件头写的那句话：
// 「五个跑局诊断脚本全都 LLM_DISABLED=true，从没量过 LLM 路径」——
// 这份探针补的就是这个洞，但补的是「LLM 意图解析」这一段，不是全部行为。
//
// ⚠ 这是本仓第一个必须联网才能跑的判据：
//   · 结果不可复现（模型有随机性、换版本会变）——报告里记模型名/日期/样本数，
//     不当常量用。
//   · 不进 bun test（离线跑不了），放 scripts/diag/，和其它探针同侧。
//   · 无 key / LLM_DISABLED 时明确报「没跑」，不生成一个 0 或假绿——
//     probe-llm.ts 头部批评过的「拿测试输出当证据」不能在这里重演。
//
// 用法：bun scripts/diag/probe-llm-intent.ts

import { loadConfig } from "../../src/config";
import { LLMClient } from "../../src/llm/client";
import { setIntentLLM, parseIntent } from "../../src/llm/intent";
import { writeReport } from "../../src/diagnostics/report";

interface Case {
  readonly input: string;
  readonly wantAction: string;
  readonly note?: string;
}

// 数据源 1：intent-coverage.test.ts 里已标注的 24 条常见 CoC 动作输入
// （量过一次 regex 路径：认对 10、认错 3、不认识 11——这里复用同一批输入，
// 换一条判据去量 LLM 路径认不认得同一批话）。
const COVERAGE_CASES: Case[] = [
  { input: "潜行", wantAction: "skill_check" },
  { input: "潜行攻击 怪物", wantAction: "attack" },
  { input: "偷袭 怪物", wantAction: "attack" },
  { input: "查看背包", wantAction: "inventory" },
  { input: "背包", wantAction: "inventory" },
  { input: "聆听", wantAction: "skill_check" },
  { input: "恐吓 流浪汉", wantAction: "skill_check" },
  { input: "取悦 前台", wantAction: "skill_check" },
  { input: "话术", wantAction: "skill_check" },
  { input: "图书馆使用", wantAction: "skill_check" },
  { input: "查资料", wantAction: "skill_check" },
  { input: "侦查", wantAction: "skill_check" },
  { input: "恐吓他们", wantAction: "skill_check" },
  { input: "急救", wantAction: "first_aid" },
  { input: "给甲急救", wantAction: "first_aid" },
  { input: "包扎伤口", wantAction: "first_aid" },
  { input: "攻击 怪物", wantAction: "attack" },
  { input: "逃跑", wantAction: "flee" },
  { input: "休息", wantAction: "rest" },
  { input: "装填", wantAction: "reload" },
  { input: "san检定", wantAction: "san_check" },
  { input: "理智检定", wantAction: "san_check" },
  { input: "环顾四周", wantAction: "look" },
  { input: "说服 保镖", wantAction: "skill_check" },
  { input: "调查 谷仓", wantAction: "skill_check" },
  { input: "创建角色 investigator 甲", wantAction: "create_character" },
  { input: "加载模组 谷仓", wantAction: "load_module" },
  { input: "状态", wantAction: "status" },
];

// 数据源 2：本轮要修的真实实跑句子——冰箱/储物柜/拉杆这类场景容器操作，
// 期望不是 inventory（具体落在 unknown/skill_check 都算过，唯独不能是
// inventory；本探针只判 "是不是被误判成 inventory"，不苛求具体落在哪个
// action，那是 act() 对象名闸门和 intent.ts 各自的判断，不是本探针的职责）。
const OBJECT_CASES: Case[] = [
  {
    input: "陈岳打开冰箱与储物柜，逐一清点里面的氧气罐、药品和袋装流食。",
    wantAction: "!inventory",
    note: "analysis/sim/2026-08-31-barn-good-end.md 问题清单 1——本轮要修的真实误判",
  },
  { input: "打开冰箱", wantAction: "!inventory", note: "场景容器，非玩家背包" },
  { input: "看看储物柜", wantAction: "!inventory", note: "场景容器，非玩家背包" },
  { input: "拉一下拉杆", wantAction: "!inventory", note: "场景机关，非玩家背包" },
  { input: "清点冰箱里的东西", wantAction: "!inventory", note: "「清点」+ 场景容器" },
];

// 数据源 3：对照组——玩家自己的背包依然必须判成 inventory，
// 不能因为改了措辞就连这条也改坏了。
const CONTROL_CASES: Case[] = [
  { input: "查看背包", wantAction: "inventory", note: "对照组：玩家自己的背包" },
  { input: "清点背包", wantAction: "inventory", note: "对照组：玩家自己的背包" },
];

const ALL_CASES: Case[] = [...COVERAGE_CASES, ...OBJECT_CASES, ...CONTROL_CASES];

function matches(got: string, want: string): boolean {
  if (want.startsWith("!")) return got !== want.slice(1);
  return got === want;
}

async function main() {
  const cfg = loadConfig();
  const hasKey = cfg.apiKey !== "sk-placeholder" && !cfg.apiKey.startsWith("${");
  const disabled = process.env.LLM_DISABLED === "true";

  const out: string[] = ["# LLM 意图解析准确率探针", ""];
  out.push(`- 时间：${new Date().toISOString().slice(0, 19).replace("T", " ")}`);
  out.push(`- model：\`${cfg.model}\``);
  out.push(`- baseUrl：\`${cfg.baseUrl}\``);
  out.push(`- 样本数：${ALL_CASES.length}（覆盖 ${COVERAGE_CASES.length} + 对象名 ${OBJECT_CASES.length} + 对照 ${CONTROL_CASES.length}）`);
  out.push("");
  out.push("⚠ 结果不可复现——模型有随机性、会换版本，别把这次的数当成常量。");
  out.push("每次跑都应该重新记录时间/模型名，不能拿旧报告里的数字当依据。");
  out.push("");

  if (!hasKey || disabled) {
    const reason = !hasKey ? "没有 key" : "LLM_DISABLED=true";
    out.push(`## 未运行`);
    out.push("");
    out.push(`${reason}，本探针需要真实调用 LLM，跳过。不产生任何准确率数字——`);
    out.push("没跑就是没跑，不能用「没跑」推出「0%」或「100%」这类误导性结论。");
    const path = await writeReport("probe-llm-intent.md", out.join("\n"));
    console.log(`✗ 未运行（${reason}）  -> ${path}`);
    process.exit(1);
  }

  // 熔断是进程级静态变量，探针里先复位，免得被同进程里的历史失败带偏。
  LLMClient.resetDefeat();
  setIntentLLM(new LLMClient(cfg));

  type Row = { input: string; want: string; got: string; ok: boolean; note?: string };
  const rows: Row[] = [];
  for (const c of ALL_CASES) {
    let got = "<异常>";
    try {
      const intent = await parseIntent(c.input);
      got = intent.action;
    } catch (e) {
      got = `<异常: ${e instanceof Error ? e.message.slice(0, 60) : String(e).slice(0, 60)}>`;
    }
    rows.push({ input: c.input, want: c.wantAction, got, ok: matches(got, c.wantAction), note: c.note });
  }

  const okCount = rows.filter((r) => r.ok).length;
  const pct = ((okCount / rows.length) * 100).toFixed(1);

  out.push(`## 准确率：${okCount}/${rows.length} = ${pct}%`);
  out.push("");
  out.push("| 输入 | 期望 | 实际 | 结果 | 备注 |");
  out.push("|---|---|---|---|---|");
  for (const r of rows) {
    out.push(`| ${r.input} | ${r.want} | ${r.got} | ${r.ok ? "✓" : "✗ 认错"} | ${r.note ?? ""} |`);
  }

  const wrong = rows.filter((r) => !r.ok);
  out.push("");
  out.push(`## 认错清单（${wrong.length} 条）`);
  out.push("");
  if (wrong.length === 0) {
    out.push("（无）");
  } else {
    for (const r of wrong) {
      out.push(`- \`${r.input}\` 期望 ${r.want}，实际 ${r.got}${r.note ? `（${r.note}）` : ""}`);
    }
  }

  const path = await writeReport("probe-llm-intent.md", out.join("\n"));
  console.log(`${okCount}/${rows.length} = ${pct}%（认错 ${wrong.length} 条）  -> ${path}`);
  process.exit(0);
}

main();
