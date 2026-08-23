// 有没有「根本没用上」的东西。
//
// 起因：fallbackQuestion 解构了 ctx 的九个字段一个都没用，
// 其中一个还让这个纯函数能抛异常。那不是孤例的话，就该整体查一遍。
//
// 查三层，从大到小：
//   ① 整个文件没人 import —— 死模块
//   ② 文件被 import 了，但某个 export 没人用 —— 死导出
//   ③ 函数体内声明了没读 —— 由 tsc 的 noUnusedLocals/noUnusedParameters 负责，这里只统计
//
// ⚠ typescript@7 是 native preview，没有 createSourceFile，
//   所以 import 关系用 Bun.Transpiler.scanImports() 拿，不自己写解析。
//
// 用法：bun scripts/diag/probe-dead-code.ts

import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { writeReport } from "../../src/diagnostics/report";

const ROOT = process.cwd();
const files = [
  ...new Glob("src/**/*.ts").scanSync(ROOT),
  ...new Glob("scripts/**/*.ts").scanSync(ROOT),
].map((f) => f.replace(/\\/g, "/"));

const isTest = (f: string) => f.includes("/__tests__/") || f.endsWith(".test.ts");
const isScript = (f: string) => f.startsWith("scripts/");

/** 入口：不需要被别人 import 也算活的 */
const ENTRIES = new Set(["src/index.ts", "src/api/server.ts"]);

// ── ① 谁 import 了谁 ──
const transpiler = new Bun.Transpiler({ loader: "ts" });
const importedBy = new Map<string, string[]>();
const rawImports = new Map<string, string[]>();

for (const f of files) {
  const src = readFileSync(f, "utf8");
  // ⚠ `scanImports` 看不见 `import type { X } from "./y"` —— 类型 import 会被抹掉。
  //   只用它的话，纯类型模块（src/module/types.ts 之流）会被误报成死模块，
  //   照着删就出事了。第一版就是这么误报的，所以再补一遍文本扫描取并集。
  let specs: string[] = [];
  try {
    specs = transpiler.scanImports(src).map((i) => i.path);
  } catch { /* 解析不了就当没有 import，下面会体现为「没人引用」，宁可多报 */ }
  for (const m of src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;\n]*?from\s*["']([^"']+)["']/g)) {
    specs.push(m[1]!);
  }
  for (const m of src.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)) specs.push(m[1]!);
  specs = [...new Set(specs)];
  rawImports.set(f, specs);
  for (const spec of specs) {
    if (!spec.startsWith(".")) continue;
    // 相对路径 → 仓库路径。补 .ts / /index.ts 两种写法。
    const dir = f.slice(0, f.lastIndexOf("/"));
    const parts = `${dir}/${spec}`.split("/");
    const stack: string[] = [];
    for (const p of parts) {
      if (p === "." || p === "") continue;
      if (p === "..") stack.pop();
      else stack.push(p);
    }
    const base = stack.join("/");
    for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) {
      if (files.includes(cand)) {
        importedBy.set(cand, [...(importedBy.get(cand) ?? []), f]);
        break;
      }
    }
  }
}

// 死模块 = 没人 import，且不是入口、不是测试、不是脚本
const deadModules = files.filter((f) =>
  !isTest(f) && !isScript(f) && !ENTRIES.has(f) && (importedBy.get(f) ?? []).length === 0);

// `src/diagnostics/*` 是**判据**，被测试和诊断脚本用就是它的本分，
// 不该跟「写了没接上的功能模块」混在一张表里。第一版混在一起，
// 于是 narration.ts 被标成「生产码不要了」—— 判据本来就不该有生产调用方。
const isCriterion = (f: string) => f.startsWith("src/diagnostics/");

// 只有测试在用的模块 —— 生产码里已经没人要了
const testOnly = files.filter((f) => {
  if (isTest(f) || isScript(f) || isCriterion(f) || ENTRIES.has(f)) return false;
  const users = importedBy.get(f) ?? [];
  return users.length > 0 && users.every(isTest);
});

// 只有诊断脚本在用的模块
const scriptOnly = files.filter((f) => {
  if (isTest(f) || isScript(f) || isCriterion(f) || ENTRIES.has(f)) return false;
  const users = importedBy.get(f) ?? [];
  return users.length > 0 && users.every((u) => isScript(u) || isTest(u)) && users.some(isScript);
});

// ── ② 没人用的导出 ──
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm;
type DeadExport = { file: string; name: string };
const deadExports: DeadExport[] = [];

for (const f of files) {
  if (isTest(f) || isScript(f)) continue;
  const src = readFileSync(f, "utf8");
  const names: string[] = [];
  for (const m of src.matchAll(EXPORT_RE)) names.push(m[1]!);
  if (names.length === 0) continue;
  // 谁可能用到它：所有别的文件
  const others = files.filter((o) => o !== f);
  const otherSrc = others.map((o) => readFileSync(o, "utf8")).join("\n");
  for (const n of names) {
    // 用词边界找，避免 `pick` 命中 `pickAsker`
    const re = new RegExp(`(?<![\\w$])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`);
    if (!re.test(otherSrc)) deadExports.push({ file: f, name: n });
  }
}

// ── ③ tsc 的未使用统计（只汇总，不重复实现） ──
// ⚠ 命令行显式打开这两个开关，**不依赖 tsconfig.json**。
//   tsconfig 里它们是关着的（开了 typecheck 就红、preflight 过不去），
//   但那不该让这项检查跟着失明 —— 「构建不拦」和「没人量」是两回事。
const tsc = Bun.spawnSync(
  ["bunx", "tsc", "--noEmit", "--noUnusedLocals", "--noUnusedParameters", "-p", "tsconfig.json"],
  { cwd: ROOT },
);
const tscOut = new TextDecoder().decode(tsc.stdout) + new TextDecoder().decode(tsc.stderr);
const unusedLines = tscOut.split("\n").filter((l) => /error TS(6133|6196|6192)/.test(l));
const byFile = new Map<string, number>();
for (const l of unusedLines) {
  const f = l.slice(0, l.indexOf("(")).replace(/\\/g, "/");
  byFile.set(f, (byFile.get(f) ?? 0) + 1);
}

// ── 报告 ──
const out: string[] = ["# 有没有根本没用上的东西", ""];
out.push(`扫了 ${files.length} 个 .ts（src + scripts）。`);
out.push("");
out.push("| 层级 | 个数 |");
out.push("|---|---|");
out.push(`| 整个文件没人 import（死模块） | ${deadModules.length} |`);
out.push(`| 只有测试在 import（生产码已不用） | ${testOnly.length} |`);
out.push(`| 只有诊断脚本在 import | ${scriptOnly.length} |`);
out.push(`| 没人用的导出 | ${deadExports.length} |`);
out.push(`| 声明了没读（tsc TS6133/6192/6196） | ${unusedLines.length} |`);
out.push("");

const section = (title: string, xs: string[], note?: string) => {
  out.push(`## ${title}（${xs.length}）`);
  out.push("");
  if (note) { out.push(note); out.push(""); }
  if (xs.length === 0) out.push("无。");
  else for (const x of xs) out.push(`- \`${x}\``);
  out.push("");
};

section("整个文件没人 import", deadModules,
  "入口（`src/index.ts`、`src/api/server.ts`）、测试、脚本不算。");
section("只有测试在 import", testOnly,
  "**生产码里已经没人要了** —— 留着的话，测试在保护一段没人跑的代码。");
section("只有诊断脚本在 import", scriptOnly,
  "判据入库、跑局脚本入库是有意为之，这一类通常是正常的，列出来备查。");
section("判据模块（src/diagnostics/*）", files.filter(isCriterion),
  "**不参与上面两张表**：判据的调用方本来就是测试与诊断脚本，没有生产调用方是对的。");

out.push(`## 没人用的导出（${deadExports.length}）`);
out.push("");
if (deadExports.length === 0) out.push("无。");
else {
  const grouped = new Map<string, string[]>();
  for (const d of deadExports) grouped.set(d.file, [...(grouped.get(d.file) ?? []), d.name]);
  out.push("| 文件 | 没人用的导出 |");
  out.push("|---|---|");
  for (const [f, ns] of [...grouped.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(`| \`${f}\` | ${ns.map((n) => `\`${n}\``).join("、")} |`);
  }
}
out.push("");

out.push(`## 声明了没读，按文件（${unusedLines.length}）`);
out.push("");
out.push("这两个开关由本探针在命令行上强制打开，与 tsconfig 无关 ——");
out.push("tsconfig 里关着是为了让 typecheck 保持绿，不是因为这些不算问题。");
out.push("");
if (byFile.size === 0) {
  out.push("⚠ **一条都没抓到**。tsc 真的一条没报，还是根本没跑起来？");
  out.push("先手动跑一次 `bunx tsc --noEmit --noUnusedLocals --noUnusedParameters` 确认，");
  out.push("否则这是「没量到」而不是「没问题」。");
} else {
  out.push("| 处数 | 文件 |");
  out.push("|---|---|");
  for (const [f, c] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) out.push(`| ${c} | \`${f}\` |`);
}

const path = await writeReport("probe-dead-code.md", out.join("\n"));
console.log(
  `死模块 ${deadModules.length}｜只测试用 ${testOnly.length}｜只脚本用 ${scriptOnly.length}` +
  `｜死导出 ${deadExports.length}｜声明没读 ${unusedLines.length}  -> ${path}`,
);
