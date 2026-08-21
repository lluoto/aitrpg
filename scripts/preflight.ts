// 改动前后各跑一次的自检。把我反复犯的几类错做成机器判据，别靠记性。
//
// 用法：
//   bun scripts/preflight.ts            全查
//   bun scripts/preflight.ts --quick    只查快的（跳过测试）
//
// 背景：一轮里连着犯了五次同类失误（机械切割截断语义单元、假绿测试、
// 判据写错），每次都要一个来回才发现。能变成检查项的就别留给注意力。

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";

const quick = process.argv.includes("--quick");
const problems: string[] = [];
const notes: string[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const srcFiles = walk("src");

// ── 1. 切割残渣：文档注释紧跟着**语句**（而不是声明） ──
//
// 机械切割最常见的后果：注释块留下、函数头被搬走，于是 `*/` 下面直接是
// 函数体的第一条语句。
//
// ⚠ 判据必须收窄。第一版写成「下一行不是声明就报警」，
// 结果 174 个假阳性 —— 接口字段、对象属性、switch case、联合类型的续行
// 全被算进去了，真问题（2 个）被淹没。判据没验就上，正是这轮反复犯的错。
//
// 现在只认最确定的一种：`*/` 紧跟 `return` / 赋值 / `await`，
// 那在文档注释后面出现几乎必然是切歪了。
const CUT_SIGNS = /^(return\b|await\b|const \w+ = (await )?\w+\(|\w+ = )/;
for (const f of srcFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.trim() !== "*/") continue;
    const next = (lines[i + 1] ?? "").trim();
    if (CUT_SIGNS.test(next)) {
      problems.push(`${f}:${i + 2}  文档注释后面直接是语句 —— 切割可能截断了函数头`);
    }
  }
}

// ── 2. 搬运残渣：同一句占位注释出现多次 ──
const PLACEHOLDER = /已抽到 src\/play\/[\w-]+\.ts（纯搬运/;
for (const f of srcFiles) {
  const lines = readFileSync(f, "utf8").split("\n");
  const hits = lines.map((l, i) => (PLACEHOLDER.test(l) ? i + 1 : 0)).filter(Boolean);
  if (hits.length > 1) {
    problems.push(`${f}  搬运占位注释残留 ${hits.length} 处（L${hits.join(", L")}）`);
  }
}

// ── 3. 循环依赖：src/play/* 反向 import play-module ──
// 抽出来的模块反向 import 原文件就是环。tsc 不报，得自己看。
for (const f of srcFiles.filter((p) => p.includes("play") && !p.endsWith("play-module.ts"))) {
  const t = readFileSync(f, "utf8");
  if (/from\s+["']\.\.\/play-module["']/.test(t)) {
    problems.push(`${f}  反向 import play-module —— 成环，把需要的东西也抽出来`);
  }
}

// ── 4. 中文过 PowerShell：脚本里不该用 Select-String 读源码 ──
// 排除本文件 —— 它是那个检查器，提到这两个词是判据本身。
// 只认**真调用**（spawnSync / 反引号命令串里出现），不认文案里提到这两个词 ——
// 否则连「警告不要用它」的文字本身都会被报，判据自己咬自己。
for (const f of walk("scripts")) {
  if (f.endsWith("preflight.ts")) continue;
  const t = readFileSync(f, "utf8");
  const realCall = /spawnSync\([^)]*(Select-String|Get-Content)|["'`][^"'`]*\|\s*(Select-String|Get-Content)/;
  if (realCall.test(t)) {
    notes.push(`${f}  真的在调 Select-String/Get-Content —— 读中文源码会 mojibake，用 fs.readFileSync`);
  }
}

// ── 5. typecheck ──
const tsc = spawnSync("bun", ["run", "typecheck"], { encoding: "utf8", shell: true });
const tsErrors = (tsc.stdout + tsc.stderr).split("\n").filter((l) => /error TS/.test(l));
if (tsErrors.length) {
  const syntax = tsErrors.filter((l) => /TS1\d{3}/.test(l));
  problems.push(`typecheck 报 ${tsErrors.length} 个错`);
  if (syntax.length) {
    problems.push(`  其中 ${syntax.length} 个是**语法错** —— 通常意味着切歪了，不是缺 import`);
  }
  for (const e of tsErrors.slice(0, 5)) problems.push("  " + e.trim());
}

// ── 6. 测试条数（只有条数是可靠回归信号） ──
if (!quick) {
  const t = spawnSync("bun", ["test"], { encoding: "utf8", shell: true });
  const ran = (t.stdout + t.stderr).match(/Ran (\d+) tests/);
  const failed = (t.stdout + t.stderr).match(/(\d+) fail/);
  if (ran) notes.push(`测试 ${ran[1]} 条`);
  if (failed && failed[1] !== "0") problems.push(`测试有 ${failed[1]} 条失败`);
}

// ── 输出 ──
console.log(problems.length === 0 ? "✓ preflight 通过" : `✗ preflight 发现 ${problems.length} 个问题`);
for (const p of problems) console.log("  " + p);
if (notes.length) {
  console.log("");
  for (const n of notes) console.log("  · " + n);
}
process.exit(problems.length ? 1 : 0);
