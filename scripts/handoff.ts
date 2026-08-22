// 生成 docs/handoff.md —— 交给下一个会话／另一个模型的接手说明。
//
// 与 now.md 的分工：
//   now.md   「现在在哪」—— 状态快照，每次收工刷新
//   handoff  「怎么接手」—— 项目是什么、纪律是什么、坑在哪、怎么验
//
// 做成脚本生成是为了让状态部分不会过期；叙述部分写死在模板里。

import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const sh = (c: string, a: string[]) =>
  spawnSync(c, a, { encoding: "utf8", shell: true }).stdout?.trim() ?? "";

const head = sh("git", ["log", "--oneline", "-1"]);
const recent = sh("git", ["log", "--oneline", "-12"]).split("\n").filter(Boolean);

let tests = "（未跑）";
if (!process.argv.includes("--no-test")) {
  const t = spawnSync("bun", ["test"], { encoding: "utf8", shell: true });
  const m = (t.stdout + t.stderr).match(/Ran (\d+) tests across (\d+) files/);
  const f = (t.stdout + t.stderr).match(/(\d+) fail/);
  tests = m ? `${m[1]} 条 / ${m[2]} 文件${f && f[1] !== "0" ? `（${f[1]} 失败）` : "，全绿"}` : "（没解析到）";
}

const rules = existsSync("docs/todo.json")
  ? JSON.parse(readFileSync("docs/todo.json", "utf8")).items
      .filter((i: any) => i.category === "工作约定")
  : [];

const openItems = existsSync("docs/notes/index.json")
  ? JSON.parse(readFileSync("docs/notes/index.json", "utf8")).records
      .filter((r: any) => r.status === "open" || r.status === "warn")
  : [];

const md = `# 接手说明

> 生成于 ${new Date().toISOString().slice(0, 16).replace("T", " ")}  ·  刷新：\`bun scripts/handoff.ts\`
> 状态快照看 \`docs/now.md\`；这份讲的是**怎么接手**。

## 这是什么

\`C:\\aitrpg\\poc\` —— CoC 7e 跑团引擎。核心是「模组数据 + 规则引擎 + LLM 叙事」
跑完一局《普瑞米尔的谷仓》。**当前 HEAD**：${head}  ·  **测试**：${tests}

三条并行的局面驱动是**有意为之**，不是重复实现：
剧本杀（\`play-module.ts\`）／自由跑团（\`api/game-session.ts\`）／命令行（\`index.ts\`）。

## 第一件事：读这三份

\`\`\`
docs/now.md                          现在在哪（30 秒）
bun scripts/docs-index.ts todo warn  动手前要扫的坑
bun scripts/preflight.ts             跑一次，确认接手时是干净的
\`\`\`

**不要整份读 \`docs/architecture.json\`**（36KB）。用查询：

\`\`\`
bun scripts/docs-index.ts arch <关键词>    架构里找模块
bun scripts/docs-index.ts log <关键词>     查某问题记录过没有（搜正文）
\`\`\`

## 工作纪律（踩出来的，不是规范文档）

${rules.map((r: any, i: number) => `${i + 1}. ${r.text}`).join("\n\n")}

## 环境坑

- **PowerShell 5.1**。仓库源码 UTF-8 **无 BOM**，\`Select-String\`/\`Get-Content\`
  读中文会 mojibake → 用 Read/Grep 工具或 \`fs.readFileSync\`
- \`bun run x.ts *> file\` 会把 UTF-8 写坏。诊断脚本一律走回调在内存收，
  自己 \`Bun.write\` 落盘。**曾因此得出「12 局 0 次触发」的假结论**
- \`git checkout <sha> -- <file>\` 会**同时改索引**。变异检验后用 \`Copy-Item\` 还原即可，
  多跑一句 \`git checkout HEAD --\` 会把未提交的改动冲掉（踩过）
- 测试**只有条数是可靠回归信号**。已知两条偶发假红：
  \`coc-engine.test.ts:131\`、\`npc-reaction.test.ts\` 的「高稳定性减少负面情绪」

## 验证手段（离线，不用 API key）

| 脚本 | 量什么 |
|---|---|
| \`tools/_diag-fuzz.ts\` | 随机玩法通关率、有无死循环 |
| \`tools/_diag-wounds.ts\` | 伤势分级／重伤检定／惩罚骰 |
| \`tools/_diag-combat.ts\` | Boss 还手、玩家掉血 |
| \`tools/_diag-downed.ts\` | 昏迷的人有没有还在行动 |
| \`tools/_diag-phrasing.ts\` | 玩家说法能否匹配到场景 |

⚠ **这些判据本身出过六次错**（详见 \`docs/review-request.md\`）。
用它们之前先确认能区分对错两种情形，别信「全绿」。

## 手上还挂着的（${openItems.length}）

${openItems.map((o: any) => `- ${o.title}\n  \`${o.file}:${o.line}\``).join("\n")}

## 最近做了什么

${recent.map((r) => "- " + r).join("\n")}

## 代码地图

拆分之后 \`play-module.ts\` 只剩骨架（车卡／世界初始化／主 while／结局结算）：

| 文件 | 装什么 |
|---|---|
| \`play/scene-pipeline.ts\` | 一次进场的完整流水线（进场→NPC→对话→线索→选下一步） |
| \`play/npc-dialogue.ts\` | 对话生成 |
| \`play/clue-check.ts\` | 线索检定（skill 优先、failback 兜底） |
| \`play/traps.ts\` / \`combat.ts\` | 陷阱 / Boss 战 |
| \`play/checks.ts\` | 检定、伤势、伤害 |
| \`play/run-state.ts\` | 本局状态，按「谁在写」分组（Cast/Cursor/Dedup/WorldModelCtx） |
| \`play/narration.ts\` | 播报输出层 |

**依赖单向**：\`play-module → play/*\`。子模块反向 import 就是环，
preflight 会报（tsc 不报）。
`;

writeFileSync("docs/handoff.md", md, "utf8");
console.log(`docs/handoff.md 已生成 —— ${md.split("\n").length} 行 / ${(md.length / 1024).toFixed(1)} KB`);
