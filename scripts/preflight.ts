// 改动前后各跑一次的自检。把反复犯的几类错做成机器判据，别靠记性。
//
// 用法：
//   bun scripts/preflight.ts            全查
//   bun scripts/preflight.ts --quick    只查快的（跳过测试）
//
// ⚠ 这份脚本自己返工过一次。上一版六项检查里，**五项能被同一段坏代码骗过**：
//   1. 切割残渣：只认 `return|await|赋值` 四种起手式 → 函数头被删后留下
//      `register()` / `if` / `for` 一个都不报；同时不看花括号深度 →
//      合法函数里「JSDoc + return」被当成切歪（这是 174 个假阳性的来源）。
//   3. 循环依赖：正则 `from ["']\.\.\/play-module["']` → dynamic import、
//      带扩展名的路径、别名、`export ... from`、`require()` 全漏；
//      而注释和字符串里的 import 文本反倒会误报。
//   4. PowerShell 风险：只查 `.ts`、只认 `spawnSync`，命中之后还只放进
//      `notes`，脚本照样 `exit 0` —— 报了等于没报。
//   5. typecheck：只 grep stdout 里的 `error TS`。进程没起来、被信号杀掉、
//      或者 tsc 换个输出格式，三种情况都是「炸了但报绿」。
//   6. 测试条数：只 print，不跟任何基线比 —— 那不是回归检查。
//
// 判据都抽到了 `src/diagnostics/source-scan.ts`，每一项有「应报」「不应报」
// 两侧测试（`src/__tests__/diag-preflight-checks.test.ts`）。

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { spawnSync } from "child_process";
import {
  findTruncatedBlocks, findPlaceholderResidue, findReverseImports, findShellRisks,
  judgeProcess, parseTestOutput, judgeTestCount,
  type Finding, type TestBaseline,
} from "../src/diagnostics/source-scan";

const quick = process.argv.includes("--quick");
const problems: string[] = [];
const notes: string[] = [];

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".codegraph", ".superpowers"]);

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => p.toLowerCase().endsWith(x))) out.push(p);
  }
  return out;
}

const read = (f: string) => readFileSync(f, "utf8"); // 中文源码必须走 fs，不能过 PowerShell
const push = (fs: Finding[]) => { for (const f of fs) problems.push(`${f.file}:${f.line}  ${f.message}`); };

const srcFiles = walk("src", [".ts"]);

// ── 1. 切割残渣：**顶层**块注释后面直接是语句 ──
//
// 收窄的关键是花括号深度必须为 0。深度 ≥ 1 的地方（接口字段、对象属性、
// switch case、联合类型续行、函数体内的说明）本来就允许注释后面跟非声明，
// 上一版没这一条，174 个假阳性淹掉 2 个真问题。
// 有了深度之后，判据可以反过来写：顶层注释后面**不是声明**就报，
// 于是 `register()` / `if` / `for` 这些残骸也一并认出来。
for (const f of srcFiles) push(findTruncatedBlocks(f, read(f)));

// ── 2. 搬运残渣：同一句占位注释出现多次 ──
for (const f of srcFiles) push(findPlaceholderResidue(f, read(f)));

// ── 3. 循环依赖：src/play/* 反向 import play-module ──
// 抽出来的模块反向 import 原文件就是环。tsc 不报，得自己看。
// 用 Bun 的解析器取 import（见 source-scan.scanImports）：静态/动态/require/
// `export ... from` 都认，注释与字符串里的 import 文本不认。
for (const f of srcFiles.filter((p) => p.includes("play") && !p.endsWith("play-module.ts"))) {
  push(findReverseImports(f, read(f), "play-module"));
}

// ── 4. 中文过 PowerShell ──
//
// 范围从「只有 scripts/*.ts」扩到仓库里真正在跑的脚本类型：
// `.ts/.js/.mjs/.cjs/.ps1`，覆盖 src、scripts、tools、frontend。
// `src/__tests__` 排除 —— 那里的坏样例是**判据的输入夹具**，不是真调用；
// 这条排除有明确理由，不是「让输出变绿」。
//
// 命中一律进 problems。上一版放进 notes 然后 exit 0，等于报了也没人拦。
const scriptExts = [".ts", ".js", ".mjs", ".cjs", ".ps1"];
const scriptFiles = [
  ...walk("src", scriptExts).filter((p) => !p.includes(join("src", "__tests__"))),
  ...walk("scripts", scriptExts),
  ...walk("tools", scriptExts),
  ...walk("frontend", scriptExts),
];
for (const f of scriptFiles) push(findShellRisks(f, read(f)));

// ── 5. typecheck ──
// 先看退出状态（error / signal / status），再看输出。
// 只 grep 输出的话，进程没起来时输出是空串，判据会当成「零个错」。
const tsc = spawnSync("bun", ["run", "typecheck"], { encoding: "utf8", shell: true });
const tscVerdict = judgeProcess("typecheck", tsc);
const tscOut = (tsc.stdout ?? "") + (tsc.stderr ?? "");
if (!tscVerdict.ok) {
  problems.push(tscVerdict.reason);
  const tsErrors = tscOut.split("\n").filter((l) => /error TS/.test(l));
  const syntax = tsErrors.filter((l) => /TS1\d{3}/.test(l));
  if (tsErrors.length) problems.push(`  输出里能认出 ${tsErrors.length} 条 error TS`);
  if (syntax.length) problems.push(`  其中 ${syntax.length} 条是**语法错** —— 通常意味着切歪了，不是缺 import`);
  for (const e of tsErrors.slice(0, 5)) problems.push("  " + e.trim());
} else {
  // 退出码 0 但输出里有 error TS = tsc 的行为变了，同样要拦
  const stray = tscOut.split("\n").filter((l) => /error TS/.test(l));
  if (stray.length) problems.push(`typecheck 退出码 0，输出里却有 ${stray.length} 条 error TS —— 判据与工具行为不一致，先查清楚`);
  else notes.push("typecheck 通过（退出码 0）");
}

// ── 6. 测试：退出状态 + 条数基线 ──
// 「只打印当前条数」不是检查 —— 跟什么比？有基线才有回归。
const BASELINE_PATH = "docs/test-baseline.json";
if (!quick) {
  const t = spawnSync("bun", ["test"], { encoding: "utf8", shell: true });
  const text = (t.stdout ?? "") + (t.stderr ?? "");
  const verdict = judgeProcess("bun test", t);
  const counts = parseTestOutput(text);

  if (!existsSync(BASELINE_PATH)) {
    problems.push(`缺少测试基线 ${BASELINE_PATH} —— 没有基线就没有回归检查；先跑一次并写入 {"tests":N,"files":M}`);
  } else {
    const base = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as TestBaseline;
    const r = judgeTestCount(counts, base);
    problems.push(...r.problems);
    notes.push(...r.notes);
  }
  // 退出码与条数是两条独立证据，都要看：
  // 条数对得上但进程非零退出（比如收尾时崩了）同样是坏的。
  if (!verdict.ok && (counts.failed ?? 0) === 0) {
    problems.push(`${verdict.reason}（输出里没解析到失败条数 —— 别因为「看着没 fail」就放过）`);
  } else if (!verdict.ok) {
    problems.push(verdict.reason);
  }
} else {
  notes.push("--quick：跳过测试与条数基线检查");
}

// ── 输出 ──
console.log(problems.length === 0 ? "✓ preflight 通过" : `✗ preflight 发现 ${problems.length} 个问题`);
for (const p of problems) console.log("  " + p);
if (notes.length) {
  console.log("");
  for (const n of notes) console.log("  · " + n);
}
process.exit(problems.length ? 1 : 0);
