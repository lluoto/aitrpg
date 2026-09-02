// 生成 docs/now.md —— 每个会话**第一件事**读它，30 秒进入状态。
//
// 为什么要有：上下文被 compact 之后重新起步，如果只有一堆散文档，
// 得读半天才知道「现在在哪、手上是什么、下一步是什么」。
// 这份文件短到能整读，且大部分字段是脚本自动填的，不会跟代码脱节。
//
// 用法：bun scripts/now.ts            刷新（读 git + 测试数）
//       bun scripts/now.ts --no-test  跳过跑测试（快）

import { readFileSync, writeFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

const noTest = process.argv.includes("--no-test");
const sh = (cmd: string, args: string[]) =>
  spawnSync(cmd, args, { encoding: "utf8", shell: true }).stdout?.trim() ?? "";

const branch = sh("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const head = sh("git", ["log", "--oneline", "-1"]);
const dirty = sh("git", ["status", "--short"]).split("\n").filter(Boolean);
const recent = sh("git", ["log", "--oneline", "-8"]).split("\n").filter(Boolean);

let testLine = "（本次未跑）";
if (!noTest) {
  const t = spawnSync("bun", ["test"], { encoding: "utf8", shell: true });
  const all = t.stdout + t.stderr;
  const ran = all.match(/Ran (\d+) tests across (\d+) files/);
  const fail = all.match(/(\d+) fail/);
  testLine = ran
    ? `${ran[1]} 条 / ${ran[2]} 文件` + (fail && fail[1] !== "0" ? `  ⚠ ${fail[1]} 失败` : "  全绿")
    : "（没解析到）";
}

// 待办：从 todo.json 取 warn 级
let warns: string[] = [];
if (existsSync("docs/todo.json")) {
  const todo = JSON.parse(readFileSync("docs/todo.json", "utf8"));
  warns = todo.items.filter((i: any) => i.severity === "warn").map((i: any) => i.text);
}

// log 里状态为 open 的记录 = 已定位未修
let open: Array<{ title: string; file: string; line: number }> = [];
if (existsSync("docs/notes/index.json")) {
  const idx = JSON.parse(readFileSync("docs/notes/index.json", "utf8"));
  open = idx.records
    .filter((r: any) => r.status === "open" || r.status === "warn")
    .map((r: any) => ({ title: r.title, file: r.file, line: r.line }));
}

const md = `# 现在在哪

> 每个会话开头读这一份就够。刷新：\`bun scripts/now.ts\`
> 生成于 ${new Date().toISOString().slice(0, 16).replace("T", " ")}
>
> ⚠ 这份文件永远落后自己所在的那个提交一步：流程是先跑这个脚本生成
> 快照、再把快照本身提交，所以刷新时看到的 HEAD 就是"这次要提交的
> 上一个"，工作树里也总会看到 \`docs/now.md\`（有时还有 \`docs/handoff.md\`）
> 自己待提交。这是工具固有的生成顺序，不是 bug，也不代表遗漏了什么。

## 状态

| | |
|---|---|
| 分支 | \`${branch}\` |
| HEAD | ${head} |
| 测试 | ${testLine} |
| 工作树 | ${dirty.length === 0 ? "干净" : `**${dirty.length} 个文件未提交**`} |
${dirty.length ? "\n未提交：\n" + dirty.map((d) => "- `" + d.trim() + "`").join("\n") + "\n" : ""}
## 开工前

\`\`\`
bun scripts/preflight.ts     # 改动前后各跑一次，机器判据挡住反复犯的错
bun scripts/now.ts           # 收工前刷新这份文件
\`\`\`

## 已定位未修（${open.length}）

${open.length ? open.map((o) => `- ${o.title}\n  \`${o.file}:${o.line}\``).join("\n") : "（无）"}

## 动手前先扫一眼的坑（${warns.length}）

${warns.map((w) => "- " + w.replace(/\n/g, " ").slice(0, 150)).join("\n")}

## 最近提交

${recent.map((r) => "- " + r).join("\n")}

## 找东西

| 我想…… | 怎么做 |
|---|---|
| 看架构 | \`bun scripts/docs-index.ts arch <关键词>\` |
| 查某问题记录过没 | \`bun scripts/docs-index.ts log <关键词>\` |
| 看全部待办 | \`bun scripts/docs-index.ts todo\` |
| 读记录正文 | 按 \`log\` 给出的 \`file:line\` 用 Read 取 |

⚠ **不要用 \`Select-String\` / \`Get-Content\` 读仓库源码** —— UTF-8 无 BOM，
PowerShell 会退回 ANSI 码页，中文全成乱码。用 Read/Grep 工具或 \`fs.readFileSync\`。
`;

writeFileSync("docs/now.md", md, "utf8");
console.log(`docs/now.md 已刷新 —— ${branch} / ${testLine} / 未修 ${open.length} 项`);
