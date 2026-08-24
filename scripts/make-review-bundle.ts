// 把 review 请求 + 待审脚本打成一份，方便整段贴给另一个模型。
//
// 分开发多个文件容易漏、也容易让对方看不到上下文。
// 一份自足的文本，贴过去就能开始看。
//
// 用法：bun scripts/make-review-bundle.ts

import { readFileSync, existsSync } from "fs";

const TARGETS = [
  "scripts/diag/diag-phrasing.ts",
  "scripts/diag/diag-downed.ts",
  "scripts/diag/diag-wounds.ts",
  "scripts/diag/diag-combat.ts",
  "scripts/diag/diag-fuzz.ts",
  "scripts/diag/audit-backup.ts",
  "scripts/preflight.ts",
];

const out: string[] = [];
// ⚠ 必须自报家门。这份 38KB 的产物是 review-request.md 加脚本全文拼出来的，
//   开头照抄 review-request 的正文，**读起来跟手写文档一模一样** ——
//   preflight 把它列为生成文档（会被整份重写），而文件里没有任何一句话说过这件事。
//   下一个人在这儿改了字，下次 `bun scripts/make-review-bundle.ts` 就悄悄覆盖掉。
//   handoff.md 与 now.md 的头部都写了刷新命令，只有这份漏了。
out.push("> ⚠ **本文件由 `scripts/make-review-bundle.ts` 生成，手改会被覆盖。**");
out.push("> 要改正文请改 `docs/review-request.md`；要改附录请改被打包的那些脚本。");
out.push("");
out.push(readFileSync("docs/review-request.md", "utf8"));
out.push("");
out.push("=".repeat(70));
out.push("# 附：待审脚本全文");
out.push("=".repeat(70));
out.push("");

let missing = 0;
for (const t of TARGETS) {
  if (!existsSync(t)) { out.push(`## ${t}\n\n（文件不存在）\n`); missing++; continue; }
  const body = readFileSync(t, "utf8");
  out.push(`## ${t}`);
  out.push("");
  out.push("```ts");
  out.push(body.trimEnd());
  out.push("```");
  out.push("");
}

// 附上最近一次各脚本的产物，让对方能对照「判据说了什么」
out.push("=".repeat(70));
out.push("# 附：最近一次产物（供对照）");
out.push("=".repeat(70));
out.push("");
const ARTIFACTS = [
  "analysis/diag/diag-phrasing.md",
  "analysis/diag/diag-downed.txt",
  "analysis/diag/diag-wounds.txt",
  "analysis/diag/diag-combat.txt",
  "analysis/diag/audit-backup.md",
];
for (const a of ARTIFACTS) {
  if (!existsSync(a)) continue;
  const body = readFileSync(a, "utf8");
  out.push(`## ${a}`);
  out.push("");
  out.push("```");
  out.push(body.trimEnd().split("\n").slice(0, 40).join("\n"));
  out.push("```");
  out.push("");
}

const text = out.join("\n");
await Bun.write("docs/review-bundle.md", text);

const kb = (text.length / 1024).toFixed(0);
console.log(`docs/review-bundle.md  ${kb} KB  (${TARGETS.length - missing}/${TARGETS.length} 个脚本)`);
if (missing) console.log(`⚠ ${missing} 个文件不存在`);
