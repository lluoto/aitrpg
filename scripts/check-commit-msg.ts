// commit-msg 钩子的实际逻辑，只负责读文件、打印、给退出码——判断逻辑在
// src/diagnostics/commit-msg.ts（入库、可测）。被 .githooks/commit-msg 调用：
//   bun scripts/check-commit-msg.ts <git 传进来的临时消息文件路径>
//
// 独立于 hook 之外也能直接跑，方便手动检查一条草稿消息：
//   bun scripts/check-commit-msg.ts <文件路径>

import { readFileSync } from "fs";
import { validateCommitMessage } from "../src/diagnostics/commit-msg";

const file = process.argv[2];
if (!file) {
  console.error("用法: bun scripts/check-commit-msg.ts <消息文件路径>");
  process.exit(2);
}

const raw = readFileSync(file, "utf8"); // 中文源码/消息一律走 fs，不经 PowerShell
const issues = validateCommitMessage(raw);

if (issues.length === 0) {
  process.exit(0);
}

console.error("提交信息不符合约定（docs/todo.json rule-04）：");
for (const issue of issues) {
  console.error(`  第 ${issue.line} 行：${issue.message}`);
}
console.error("");
console.error("约定细节见 docs/handoff.md「提交信息」一节，或直接读 docs/todo.json 的 rule-04。");
process.exit(1);
