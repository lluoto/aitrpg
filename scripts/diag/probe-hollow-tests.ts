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

/**
 * 「永真断言」判据。
 *
 * ⚠ 第一版把所有 `toBeDefined()` 都算永真，于是 46 条里大半是误报：
 *   `expect(res.events.find(e => …)).toBeDefined()` 是**真断言** ——
 *   找不到就是 undefined，它检查的正是「有没有这条事件」。
 *   而 `expect(res.narrative).toBeDefined()` 才是永真：
 *   那个字段本来就一直在。
 *
 *   区别在于**被断言的表达式会不会产出 undefined**。静态判不准，
 *   但有个够用的近似：表达式里带 `.find(` / `.match(` / 下标 / `?.` / 别的调用，
 *   就当它可能是 undefined；只有裸标识符或纯属性链才算永真。
 */
const MAYBE_UNDEFINED = /\.\s*(find|match|get|shift|pop|at)\s*\(|\[[^\]]*\]|\?\./;

/**
 * 标题里许诺了数量：「八个合法取值」「所有 8 个生物」「全部 5 本典籍」。
 *
 * 中文数字与阿拉伯数字都认。量词收得窄一点 —— 「3 次」「5 轮」说的是
 * 重复次数不是集合大小，那类不该报。
 */
// ⚠ 判据第一版只认「N 个」，报出 97 条，读下来绝大多数是误报 ——
//   「接受两个端点」「1 个惩罚骰 = 从 2 颗十位骰取劣」「同一 NPC 的两句话」
//   里的数字说的是**输入或规则**，不是某个集合的大小，本来就没什么可数的。
//
//   真正该报的形状是「**总括词 + 数量**」：宣称把一整张表都覆盖了。
//   「所有 8 个生物」「五个类别都在 prompt 里」「恰好有 7 个开关」。
//   代价是像「八个合法取值原样返回」这种没写总括词的会漏掉 —— 认了：
//   判据宁可漏报，也不能拿 97 条噪声把人淹了（这仓库栽过一次「174 个假阳性
//   淹掉 2 个真问题」）。
const COUNT_IN_TITLE = /(?:所有|全部|每一?个|恰好|共)[^，。]{0,8}(?:[0-9]+|[一二三四五六七八九十两]+)\s*(?:个|条|本|种|份|项|名|张|把|段|句|类)|(?:[0-9]+|[一二三四五六七八九十两]+)\s*(?:个|条|本|种|份|项|名|类)[^，。]{0,6}(?:都|全部|均)/;

/**
 * 块里有没有任何「查数量」的断言。有就放过 —— 断得对不对要人读，判据不越权。
 *
 * ⚠ 已知盲区：`expect(arr).toEqual([...])` 是**数组全等**，本身就把数量钉死了，
 *   但这里看不出来（它不含 `.length`）。实测误报过一条
 *   （`narrative-entity-recognition` 的「恰好这 7 个开门」，
 *     用的正是 `expect(opens).toEqual(OPENS)`）。
 *   要消掉得判「toEqual 的实参是不是字面量数组」，那已经接近写解析器了 ——
 *   报出来让人读一眼更划算。**判据的边界要写出来，不能假装没有。**
 */
const HAS_COUNT_ASSERT = /toHaveLength\s*\(|\.\s*(?:length|size)\s*\)\s*\.\s*(?:toBe|toEqual|toBeGreaterThan|toBeGreaterThanOrEqual|toBeLessThan|toBeLessThanOrEqual)|\.\s*(?:length|size)\s*\)\s*\.\s*not/;

function trivialAssertion(stmt: string, maybeUndefinedVars: ReadonlySet<string>): boolean {
  if (/expect\s*\(\s*true\s*\)\s*\.\s*toBe\s*\(\s*true\s*\)/.test(stmt)) return true;
  if (/not\s*\.\s*toThrow\s*\(\s*\)/.test(stmt)) return true;
  const m = stmt.match(/expect\s*\(([^;]*?)\)\s*\.\s*(?:toBeDefined|toBeTruthy)\s*\(\s*\)/);
  if (!m) return false;
  const arg = m[1]!.trim();
  if (MAYBE_UNDEFINED.test(arg)) return false;
  // ⚠ 真实写法多半分两行：
  //     const event = res.events.find(…);
  //     expect(event).toBeDefined();
  //   参数是个裸标识符，光看这一行判不出来历 —— 判据第二版就卡在这儿，
  //   46 条只降到 43。要往上追一步：这个变量是不是从可能返回 undefined 的表达式来的。
  if (/^[A-Za-z_$][\w$]*$/.test(arg) && maybeUndefinedVars.has(arg)) return false;
  return true;
}

/** 块内哪些局部变量来自「可能是 undefined」的表达式 */
function undefinableVars(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]+);/g)) {
    if (MAYBE_UNDEFINED.test(m[2]!)) out.add(m[1]!);
  }
  return out;
}

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
    // ④ 标题许诺了数量，断言却不查数量。
    //
    // 手工挖出来的一档，编成判据免得下次又靠运气：
    //   `it("所有 8 个生物均可通过中文名查到")` —— 遍历的是**测试里手写的 8 个名字**，
    //   而真实数据有 **40 个**。数据涨了五倍，标题里的「所有」早就不成立，
    //   新加的 32 个漏建索引也不会有人知道。
    //
    // 判据只看两件事：标题里有没有「N 个/条/本/种…」，块里有没有任何长度断言。
    // 有长度断言就放过 —— 是不是断得对要人读，判据不越权。
    // 「一个都不写进对象」「一个花括号都没有」「一个都不给」——
    // 这是「一个都没有」，说的是**零**，不是在许诺一张表有多大。
    const meansNone = /一\s*(?:个|条|本|字)?\s*都\s*(?:不|没)/.test(title);
    if (!meansNone && COUNT_IN_TITLE.test(title) && !HAS_COUNT_ASSERT.test(bodyMask)) {
      hits.push({ file: f, line: i + 1, title, why: "标题许诺了数量，块里却没有任何长度/条数断言 —— 表缩水或膨胀都不会被发现" });
      continue;
    }

    const undefinable = undefinableVars(bodyRaw);
    if (stmts.length > 0 && stmts.every((s) => trivialAssertion(s, undefinable))) {
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
