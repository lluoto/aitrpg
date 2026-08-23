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
