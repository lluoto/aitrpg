// 把 review 请求 + 待审脚本打成一份，方便整段贴给另一个模型。
//
// 分开发多个文件容易漏、也容易让对方看不到上下文。
// 一份自足的文本，贴过去就能开始看。
//
// 用法：bun scripts/make-review-bundle.ts

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const TARGETS = [
  "tools/_diag-phrasing.ts",
  "tools/_diag-downed.ts",
  "tools/_diag-wounds.ts",
  "tools/_diag-combat.ts",
  "tools/_diag-fuzz.ts",
  "tools/_audit-backup.ts",
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
  "tools/diag-phrasing.md",
  "tools/diag-downed.txt",
  "tools/diag-wounds.txt",
  "tools/diag-combat.txt",
  "tools/audit-backup.md",
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
