// 哪些测试**可能一条断言都不执行**，或者只断言了永真的命题。
//
// 起因：修 `investigation-engine.test.ts` 时发现一条
//   for (…50 次…) { if (触发了) { expect(…); break; } }
// 一次都没触发时，循环跑完、**一条断言都没执行**，测试照样绿 ——
// 也就是说它**只在功能正常时才验东西，功能坏掉时反而静默通过**，正好是反的。
//
// 这类东西直接污染回归信号：`docs/test-baseline.json` 记的是测试**条数**，
// 而这个仓库把条数当唯一可靠的回归判据。空心测试让条数虚高。
//
// 判据（都只报**可疑**，最终要人读）：
//   ① 整个 test 块里没有 expect
//   ② 所有 expect 都嵌在 if / for / while / catch 里 —— 可能一条都不执行
//   ③ 所有 expect 都是永真式（toBeDefined / toBeTruthy / not.toThrow()
//      / expect(true).toBe(true)）
//
// ⚠ 扫描要跳过字符串与注释：测试里满是中文字面量和模板串，
//   裸数花括号会把块边界数歪（这个坑本轮踩过一次，把一个文件切坏了）。
//
// 用法：bun scripts/diag/probe-hollow-tests.ts

import { readFileSync } from "node:fs";
import { Glob } from "bun";
import { writeReport } from "../../src/diagnostics/report";

const ROOT = process.cwd();
const files = [...new Glob("src/**/*.test.ts").scanSync(ROOT)].map((f) => f.replace(/\\/g, "/"));

/** 把字符串/模板/注释里的内容抹成空格，只留结构字符 —— 花括号才数得准 */
function mask(src: string): string {
  const out = src.split("");
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") { while (i < n && src[i] !== "\n") { out[i] = " "; i++; } continue; }
    if (c === "/" && next === "*") {
      out[i] = " "; out[i + 1] = " "; i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] !== "\n") out[i] = " "; i++; }
      if (i < n) { out[i] = " "; out[i + 1] = " "; i += 2; }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out[i] = " "; i++;
      while (i < n) {
        if (src[i] === "\\") { out[i] = " "; out[i + 1] = " "; i += 2; continue; }
        if (src[i] === q) { out[i] = " "; i++; break; }
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

const TRIVIAL = /\.\s*(toBeDefined|toBeTruthy)\s*\(\s*\)|not\s*\.\s*toThrow\s*\(\s*\)|expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/;

type Hit = { file: string; line: number; title: string; why: string };
const hits: Hit[] = [];
let scanned = 0;

for (const f of files) {
  const raw = readFileSync(`${ROOT}/${f}`, "utf8");
  const masked = mask(raw);
  const lines = raw.split("\n");
  const mlines = masked.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*(it|test)\s*\(/.test(mlines[i]!)) continue;
    // 块边界：从这一行起花括号配平
    let depth = 0, started = false, end = i;
    for (let j = i; j < lines.length; j++) {
      for (const ch of mlines[j]!) {
        if (ch === "{") { depth++; started = true; }
        else if (ch === "}") depth--;
      }
      if (started && depth <= 0) { end = j; break; }
      end = j;
    }
    scanned++;
    const bodyRaw = lines.slice(i, end + 1).join("\n");
    const bodyMask = mlines.slice(i, end + 1).join("\n");
    const title = (lines[i]!.match(/["'`](.+?)["'`]/) ?? [])[1] ?? "?";

    const expects = [...bodyMask.matchAll(/expect\s*\(/g)];
    if (expects.length === 0) { hits.push({ file: f, line: i + 1, title, why: "块内没有 expect" }); continue; }

    // 每个 expect 相对 test 块的嵌套深度：>0 说明包在 if/for/while/catch 里
    let unconditional = 0;
    for (const m of expects) {
      const before = bodyMask.slice(0, m.index!);
      const opens = (before.match(/\{/g) ?? []).length;
      const closes = (before.match(/\}/g) ?? []).length;
      // `try { … } finally { … }` 的 try 块**不是条件** —— 里面的断言照样必定执行。
      // 判据第三版把它算成了条件层，于是误伤了本轮刚写的几条
      // （钉住 Math.random 的那些标准写法就是 try/finally）。
      // 试块很少嵌套，按「出现过几次 try {」把允许深度抬高就够用。
      const tries = (before.match(/\btry\s*\{/g) ?? []).length;
      if (opens - closes <= 1 + tries) unconditional++;   // 1 = test 回调本身那层
    }
    if (unconditional === 0) {
      // ⚠ 判据第一版到这里就报，结果 157 条里绝大多数是误报：
      //   `for (const s of COC_SKILLS) { expect(...) }` —— 遍历的是常量表，
      //   断言必定执行。连我自己写的 chase-wiring 也被误伤。
      //
      //   真正危险的形态更窄，分两种：
      //     · 断言只在 `if` 里 —— 条件不成立就一条都不跑（最危险）
      //     · 断言只在循环里，**且块内没有任何「非空」守卫** ——
      //       集合空了就静默全过。守卫长这样：
      //       `expect(xs.length).toBeGreaterThan(0)` / `toHaveLength(n)`。
      //   遍历常量表的那些，本仓库的写法本来就该补一句非空守卫
      //   （见 knowledge-reveal-shape.test.ts 的「别让下面测了个空」），
      //   所以「有守卫就不报」既压掉误报，又指向了正确写法。
      const hasGuard = /expect\s*\([^;]*\.length[^;]*\)\s*\.\s*(toBeGreaterThan|toBe|toBeGreaterThanOrEqual)|toHaveLength\s*\(/.test(bodyMask);
      // 计数循环（`for (let i = 0; i < 40; i++)`，上界是字面量）必定跑满，
      // 不需要非空守卫 —— 第二版判据把这种也报了，误伤了本轮自己写的用例。
      // 需要守卫的是**遍历集合**：for..of / forEach / map / filter。
      const countedLoop = /\bfor\s*\(\s*(let|var)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\d+\s*;/.test(bodyMask);
      const iteratesCollection = /\bfor\s*\([^;)]*\bof\b|\.\s*(forEach|map|filter|some|every)\s*\(/.test(bodyMask);
      const onlyInIf = !/\b(for|while)\s*\(/.test(bodyMask) && !/\.\s*forEach\s*\(/.test(bodyMask);
      if (onlyInIf) {
        hits.push({ file: f, line: i + 1, title, why: `${expects.length} 条断言**只在 if 里**，条件不成立就一条都不执行` });
      } else if (iteratesCollection && !countedLoop && !hasGuard) {
        hits.push({ file: f, line: i + 1, title, why: `${expects.length} 条断言只在遍历集合的循环里，且**没有非空守卫** —— 集合空了会静默全过` });
      }
      continue;
    }
    // 全是永真式？逐条断言看
    const stmts = bodyRaw.split(/;\s*\n/).filter((s) => /expect\s*\(/.test(s));
    if (stmts.length > 0 && stmts.every((s) => TRIVIAL.test(s))) {
      hits.push({ file: f, line: i + 1, title, why: "只有永真断言（toBeDefined / toBeTruthy / not.toThrow / true===true）" });
    }
  }
}

const out: string[] = ["# 可能什么都没验的测试", ""];
out.push(`扫了 ${files.length} 个测试文件、${scanned} 个 test 块。`);
out.push("");
if (scanned === 0) {
  out.push("⚠ **一个 test 块都没扫到** —— 这是扫描失败，不是「都没问题」。");
} else if (hits.length === 0) {
  out.push("没有可疑项。");
} else {
  out.push(`可疑 **${hits.length}** 条（都要人读，判据只负责挑出来）：`);
  out.push("");
  out.push("| 文件:行 | 标题 | 为什么可疑 |");
  out.push("|---|---|---|");
  for (const h of hits) out.push(`| \`${h.file}:${h.line}\` | ${h.title} | ${h.why} |`);
}

const path = await writeReport("probe-hollow-tests.md", out.join("\n"));
console.log(`test 块 ${scanned} 个｜可疑 ${hits.length} 条  -> ${path}`);
