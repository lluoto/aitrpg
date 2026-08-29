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

// 基线在 docs/test-baseline.json，preflight 拿它做回归判据。
// 这里一并打出来 —— 「当前条数」单看没有意义，得有个比较对象。
const baseline = existsSync("docs/test-baseline.json")
  ? (JSON.parse(readFileSync("docs/test-baseline.json", "utf8")) as { tests: number; files: number })
  : null;

let tests = "（未跑）";
if (!process.argv.includes("--no-test")) {
  const t = spawnSync("bun", ["test"], { encoding: "utf8", shell: true });
  const text = (t.stdout ?? "") + (t.stderr ?? "");
  const m = text.match(/Ran (\d+) tests across (\d+) files/);
  const f = text.match(/(\d+) fail/);
  // 退出状态也要看：只 grep 输出的话，进程没起来时输出是空串，会被当成「跑过了」
  const died = t.error ? `启动失败：${t.error.message}` : t.signal ? `被信号 ${t.signal} 终止` : "";
  const vs = baseline && m ? `（基线 ${baseline.tests}${Number(m[1]) < baseline.tests ? " —— **回退了**" : Number(m[1]) > baseline.tests ? " —— 记得上调" : "，一致"}）` : "";
  tests = died
    ? `（${died}）`
    : m
      ? `${m[1]} 条 / ${m[2]} 文件${f && f[1] !== "0" ? `（${f[1]} 失败）` : "，全绿"}${vs}`
      : `（没解析到条数 —— 不等于通过，退出码 ${t.status}）`;
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

## 启动后端做实跑（模拟局/手动测试）

**不要**用 \`start "" /b bun run server > out.log 2> err.log\`——这条写法
两个毛病占全了：\`bun run server\` 是包装脚本，会再 spawn 一个子进程，
杀掉包装脚本后真正监听端口的那个变成孤儿；\`start /b\` 不脱离控制台，
子孙进程继承调用者的 stdout/stderr 句柄，等的是"管道关闭"不是"进程退出"，
工具会永远等不到 EOF、空转。正确用法已经写进仓库（这条已经在模拟 prompt
里丢过一次，模拟 prompt 每轮重写不算数，脚本才算）：

\`\`\`
bun run dev-server:start     启动，PID 落 .dev-server.pid，日志落 server-out.log / server-err.log
bun run dev-server:stop      按 PID 干净地杀掉，不留孤儿
bun run dev-server:status    看还在不在
\`\`\`

服务端口默认 **3099**（不是 3000），见 \`src/api/server.ts:1037\`，用环境变量
\`PORT\` 覆盖。脚本本体：\`scripts/dev-server.ps1\`。

## 环境坑

- **PowerShell 5.1**。仓库源码 UTF-8 **无 BOM**，\`Select-String\`/\`Get-Content\`
  读中文会 mojibake → 用 Read/Grep 工具或 \`fs.readFileSync\`
- \`bun run x.ts *> file\` 会把 UTF-8 写坏。诊断脚本一律走回调在内存收，
  自己 \`Bun.write\` 落盘。**曾因此得出「12 局 0 次触发」的假结论**
- \`git checkout <sha> -- <file>\` 会**同时改索引**。变异检验后用 \`Copy-Item\` 还原即可，
  多跑一句 \`git checkout HEAD --\` 会把未提交的改动冲掉（踩过）
- 测试**只有条数是可靠回归信号**，基线在 \`docs/test-baseline.json\`；
  \`expect()\` 计数会被无种子的随机测试搅动。已知两条偶发假红：
  \`coc-engine.test.ts:131\`、\`npc-reaction.test.ts\` 的「高稳定性减少负面情绪」
- \`typescript@7.0.2\` 是 native preview，\`require("typescript")\` **没有** \`createSourceFile\`。
  要解析 TS 就用 \`Bun.Transpiler\`（\`scanImports()\` 是真解析器）

## 验证手段（离线，不用 API key）

| 脚本 | 量什么 | 判据在哪 | 校准测试 |
|---|---|---|---|
| \`scripts/diag/diag-fuzz.ts\` | 通关率（= 正常返回**且**有正式结局）、死循环 | \`src/diagnostics/fuzz.ts\` | \`diag-fuzz.test.ts\` |
| \`scripts/diag/diag-wounds.ts\` | 伤势分级／重伤检定／惩罚骰 | \`src/diagnostics/wounds.ts\` | \`diag-wounds.test.ts\` |
| \`scripts/diag/diag-combat.ts\` | Boss 还手（按攻击者身份，不按技能名）、玩家掉血 | \`src/diagnostics/combat.ts\` | \`diag-combat.test.ts\` |
| \`scripts/diag/diag-downed.ts\` | 昏迷期间本人是否还在**掷骰** | \`src/diagnostics/downed.ts\` | \`diag-downed.test.ts\` |
| \`scripts/diag/diag-phrasing.ts\` | 玩家说法能否匹配到场景 | \`src/diagnostics/phrasing.ts\` | \`diag-phrasing.test.ts\` |
| \`scripts/diag/audit-backup.ts\` | 哪些数据丢了不可再生 | \`src/diagnostics/backup-classify.ts\` | \`diag-backup-classify.test.ts\` |
| \`scripts/diag/probe-llm.ts\` | LLM 通不通（**实际发一次请求**） | — | — |
| \`scripts/diag/probe-llm-move.ts\` | LLM 消歧值不值得接（重点是它肯不肯说「说不准」） | — | — |

⚠ 上面五个跑局脚本都写死 \`LLM_DISABLED=true\` —— **它们量的是离线行为**。
这不是缺陷（要可复现），但别把结论当成「整个引擎都这样」。
判断 LLM 通不通**必须实际发一次请求**：\`bun scripts/diag/probe-llm.ts\`。
\`bun test\` 输出里那句 \`[config] No LLM_API_KEY set\` 是**测试在验证无 key 的降级路径**，
跟真实可用性无关，最容易被当成证据。

⚠ **这些判据本身出过六次错**（详见 \`docs/review-request.md\`）。已做的返工：

1. **判据与脚本分开**。判断逻辑抽成纯函数放 \`src/diagnostics/\`（入库、可测），
   \`scripts/diag/*\` 只负责跑局和排版。早先脚本本体放在 \`tools/\`（.gitignore
   排除），判据留在那里等于没人守——后来整批搬进了 \`scripts/diag/\` 并入库。
2. **每条判据三种输入都有测试**：行为正确 → 通过；目标行为错误 → 失败；
   文本相似但合法 → 不误报。少了第二种就是「永远通过」，少了第三种就是「永远报警」。
3. **不再猜自然语言**。诊断读 \`src/play/events.ts\` 的结构化事件流，
   因为有些事实**文本里根本不存在**：重伤体质检定失败导致的昏迷没有 \`HP n → 0\` 那行，
   \`➜ 米戈 【格斗】\` 看不出攻击者是敌是我。补正则只会补出下一个假阳性。
4. **seed 现在控制整局**（\`src/diagnostics/run-harness.ts\` 接管 \`Math.random\`）。
   实测：同 seed 的事件流与播报文本**都可复现**，可作确定性回归依据。
   \`scripts/diag/diag-fuzz.ts\` 每次都把这条自检的结果打出来 —— 它是量出来的，不是声称的。

用它们之前仍然先确认能区分对错两种情形，别信「全绿」。
判据自己会说明三种「不算通过」的情形：
样本数为 0（没有可判的样本）、身份不可分辨（两名调查员重名）、以及本轮有异常局。

**这套判据上线后立刻报出真缺陷，都已修**（各带正/反/干扰三侧测试 + 变异检验）：

| 缺陷 | 谁报出来的 | 旧判据为什么看不见 |
|---|---|---|
| \`askCounts\` 模块级 Map 跨局残留 | fuzz 的复现自检 | 旧脚本没有复现自检 |
| 昏迷者还在掷「挣脱陷阱」 | downed | 那条昏迷路径没有 \`HP n → 0\` 播报 |
| 昏迷的同伴还在掷急救 | downed | 同上（且两人重名时无法归属） |
| 战斗攻击不读伤势惩罚 | wounds 的惩罚骰分账 | 旧判据数 \`/惩罚骰/\` 行数，疲劳的照样计数 |
| 两名调查员可能重名 | downed 的身份不可分辨检测 | 名字是日志里唯一的身份标记 |

用法：跑局类脚本都收 \`[局数] [起始局号]\`，
\`bun scripts/diag/diag-downed.ts 3 4\` = 第 4~6 局，便于分批跑而不重叠。

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
