// 判据校准：preflight 的六项检查。
//
// 每一项都要两侧测试 —— 「应报」和「不应报」。
// 只有「应报」的检查会退化成永远报警，只有「不应报」的会退化成永远通过，
// 两种都等于没检查。

import { describe, test, expect } from "bun:test";
import {
  maskSource, findTruncatedBlocks, findPlaceholderResidue,
  scanImports, importPointsTo, findReverseImports,
  findShellRisks, judgeProcess, parseTestOutput, judgeTestCount,
} from "../diagnostics/source-scan";

// ── 底座：词法遮罩 ─────────────────────────────────────────────

describe("maskSource — 注释/字符串/正则不参与判据", () => {
  test("行注释与块注释被抹掉", () => {
    const m = maskSource(`const a = 1; // import x from "y"\n/* import z from "w" */\n`);
    expect(m.masked).not.toContain("import");
  });

  test("字符串内容被抹掉但长度与引号保留（偏移仍能换算行号）", () => {
    const src = `const s = "return 1";`;
    const m = maskSource(src);
    expect(m.masked.length).toBe(src.length);
    expect(m.masked).not.toContain("return 1");
    expect(m.strings[0]!.value).toBe("return 1");
  });

  test("**正则里的花括号不算深度** —— `/TS1\\d{3}/` 不该把后面的代码顶到嵌套层", () => {
    const src = `const re = /TS1\\d{3}/;\n/** doc */\nexport const x = 1;\n`;
    const m = maskSource(src);
    expect(m.blockComments[0]!.nest).toBe(0);
  });

  test("除号不会被当成正则开头", () => {
    const m = maskSource(`const half = total / 2;\nconst q = a / b;\n`);
    expect(m.masked).toContain("/ 2");
  });

  test("**函数参数上的 JSDoc 不是顶层** —— `()` 也要算嵌套层", () => {
    // 实跑在 `npc-reaction.ts` 上报过 4 个假阳性：只数 `{}` 时，
    // 带文档注释的函数参数被当成「顶层语句」。
    const src = [
      "export function f(",
      "  /** 力量对比 */",
      "  powerBalance: number = 0,",
      ") {",
      "  return powerBalance;",
      "}",
    ].join("\n");
    expect(maskSource(src).blockComments[0]!.nest).toBeGreaterThan(0);
    expect(findTruncatedBlocks("a.ts", src)).toEqual([]);
  });

  test("**模板字面量里的反引号与 `${}` 要按语法处理**", () => {
    // `scripts/handoff.ts` 生成 markdown：模板里既有 markdown 代码跨度的反引号，
    // 又有 `${...}` 表达式里的普通字符串。天真扫描会提前收尾，
    // 把后面的正文当代码，于是整段 markdown 被判成命令。
    const src = [
      "const md = `# 标题",
      "用 \\`bun x\\` 跑一次",
      '${items.map((r) => "- " + r).join("\\n")}',
      "`;",
      "/** doc */",
      "export const y = 1;",
    ].join("\n");
    const m = maskSource(src);
    expect(m.blockComments[0]!.nest).toBe(0);       // 模板已正确闭合，注释确实在顶层
    expect(findTruncatedBlocks("a.ts", src)).toEqual([]);
  });
});

// ── 检查 1：切割残渣 ───────────────────────────────────────────

describe("检查 1 · 切割残渣 — 应报", () => {
  test("顶层块注释后面直接是 `return`", () => {
    const f = findTruncatedBlocks("a.ts", `/**\n * doc\n */\nreturn value;\n`);
    expect(f.length).toBe(1);
    expect(f[0]!.rule).toBe("truncated-block");
  });

  test("**函数头被删后留下 `register()`** —— 上一版白名单只认 return/await/赋值，这条漏", () => {
    expect(findTruncatedBlocks("a.ts", `/** doc */\nregister();\n`).length).toBe(1);
  });

  test("**留下 `if`** —— 同样漏", () => {
    expect(findTruncatedBlocks("a.ts", `/** doc */\nif (ready) { go(); }\n`).length).toBe(1);
  });

  test("**留下 `for`** —— 同样漏", () => {
    expect(findTruncatedBlocks("a.ts", `/** doc */\nfor (const x of xs) { use(x); }\n`).length).toBe(1);
  });

  test("留下 `await` / 赋值（上一版能认的那几种也不能退化）", () => {
    expect(findTruncatedBlocks("a.ts", `/** doc */\nawait write(x);\n`).length).toBe(1);
    expect(findTruncatedBlocks("a.ts", `/** doc */\ntotal = total + 1;\n`).length).toBe(1);
  });
});

describe("检查 1 · 切割残渣 — 不应报", () => {
  test("**合法函数内 JSDoc 后接 return** —— 上一版的假阳性来源", () => {
    const src = [
      "export function f() {",
      "  /** 这段解释下面这句为什么这么写 */",
      "  return 1;",
      "}",
    ].join("\n");
    expect(findTruncatedBlocks("a.ts", src)).toEqual([]);
  });

  test("接口字段上的文档注释（174 个假阳性的主力）", () => {
    const src = [
      "export interface X {",
      "  /** 字段说明 */",
      "  a: number;",
      "  /** 另一个 */",
      "  b: string;",
      "}",
    ].join("\n");
    expect(findTruncatedBlocks("a.ts", src)).toEqual([]);
  });

  test("对象字面量属性 / switch case / 联合类型续行", () => {
    const src = [
      "const o = {",
      "  /** p */",
      "  p: 1,",
      "};",
      "function g(k: string) {",
      "  switch (k) {",
      "    /** c */",
      '    case "a": return 1;',
      "  }",
      "}",
      "export type U =",
      "  /** 一支 */",
      '  | { t: "a" }',
      '  | { t: "b" };',
    ].join("\n");
    expect(findTruncatedBlocks("a.ts", src)).toEqual([]);
  });

  test("顶层注释后面是正常声明", () => {
    for (const decl of [
      "export function f() {}", "function f() {}", "const x = 1;",
      "class C {}", "interface I { a: 1 }", "type T = 1;",
      "export default f;", "import x from \"y\";", "async function g() {}",
      "@dec", "export const y = 2;",
    ]) {
      expect(findTruncatedBlocks("a.ts", `/** doc */\n${decl}\n`)).toEqual([]);
    }
  });

  test("注释与声明之间隔着空行和行注释", () => {
    expect(findTruncatedBlocks("a.ts", `/** doc */\n\n// 补一句\nexport const x = 1;\n`)).toEqual([]);
  });

  test("文件结尾就是注释 → 不报", () => {
    expect(findTruncatedBlocks("a.ts", `export const x = 1;\n/** 尾注 */\n`)).toEqual([]);
  });
});

// ── 检查 2：搬运占位注释 ───────────────────────────────────────

describe("检查 2 · 占位注释残留", () => {
  const line = "// 已抽到 src/play/traps.ts（纯搬运）";
  test("应报：同一句出现两次以上", () => {
    expect(findPlaceholderResidue("a.ts", `${line}\ncode();\n${line}\n`).length).toBe(1);
  });
  test("不应报：只出现一次", () => {
    expect(findPlaceholderResidue("a.ts", `${line}\ncode();\n`)).toEqual([]);
  });
});

// ── 检查 3：反向 import ────────────────────────────────────────

describe("检查 3 · 反向 import — 应报", () => {
  test("静态 import", () => {
    expect(findReverseImports("p.ts", `import { a } from "../play-module";`, "play-module").length).toBe(1);
  });

  test("**dynamic import**（上一版漏）", () => {
    expect(findReverseImports("p.ts", `const m = await import("../play-module");`, "play-module").length).toBe(1);
  });

  test("**带扩展名的路径**（上一版漏）", () => {
    expect(findReverseImports("p.ts", `import { a } from "../play-module.ts";`, "play-module").length).toBe(1);
    expect(findReverseImports("p.ts", `import { a } from "../play-module.js";`, "play-module").length).toBe(1);
  });

  test("**别名路径**（上一版漏）", () => {
    expect(findReverseImports("p.ts", `import { a } from "@/play-module";`, "play-module").length).toBe(1);
    expect(findReverseImports("p.ts", `import { a } from "~/src/play-module";`, "play-module").length).toBe(1);
  });

  test("**`export ... from`**（上一版漏）", () => {
    expect(findReverseImports("p.ts", `export { a } from "../play-module";`, "play-module").length).toBe(1);
  });

  test("**`require()`**（上一版漏）", () => {
    expect(findReverseImports("p.cjs", `const a = require("../play-module");`, "play-module").length).toBe(1);
  });
});

describe("检查 3 · 反向 import — 不应报", () => {
  test("**注释里的 import 文本**（上一版会误报）", () => {
    const src = [
      '// 别写 import { x } from "../play-module"，那会成环',
      '/* import { y } from "../play-module"; */',
      'export const z = 1;',
    ].join("\n");
    expect(findReverseImports("p.ts", src, "play-module")).toEqual([]);
  });

  test("**字符串里的 import 文本**（上一版会误报）", () => {
    const src = `const tip = 'import { x } from "../play-module"';\n`;
    expect(findReverseImports("p.ts", src, "play-module")).toEqual([]);
  });

  test("名字相近但不是同一个模块", () => {
    expect(findReverseImports("p.ts", `import { a } from "../play-module-utils";`, "play-module")).toEqual([]);
    expect(findReverseImports("p.ts", `import { a } from "./narration";`, "play-module")).toEqual([]);
  });

  test("type-only import 不算运行时环（语义正确，不是漏报）", () => {
    expect(findReverseImports("p.ts", `import type { A } from "../play-module";`, "play-module")).toEqual([]);
  });

  test("importPointsTo 的边界", () => {
    expect(importPointsTo("../play-module", "play-module")).toBe(true);
    expect(importPointsTo("../play-module.mjs", "play-module")).toBe(true);
    expect(importPointsTo("../play-modules", "play-module")).toBe(false);
    expect(importPointsTo("../x/play-module/index", "play-module")).toBe(false);
  });

  test("scanImports 能同时认出四种形态", () => {
    const src = [
      'import a from "m1";',
      'const b = await import("m2");',
      'const c = require("m3");',
      'export { d } from "m4";',
    ].join("\n");
    const paths = scanImports(src).map((r) => r.path).sort();
    expect(paths).toEqual(["m1", "m2", "m3", "m4"]);
  });
});

// ── 检查 4：中文过 PowerShell ─────────────────────────────────

describe("检查 4 · PowerShell 读中文 — 应报", () => {
  test("execSync 里的 Get-Content 管道", () => {
    const src = `execSync("Get-Content src/a.ts | Select-String foo");`;
    expect(findShellRisks("s.ts", src).length).toBeGreaterThan(0);
  });

  test("**`Bun.spawn`**（上一版只认 spawnSync）", () => {
    const src = `Bun.spawn(["pwsh", "-c", "Get-Content src/a.ts"]);`;
    expect(findShellRisks("s.ts", src).length).toBeGreaterThan(0);
  });

  test("**`Bun.$` 模板串**", () => {
    const src = "await Bun.$`Get-Content src/a.ts | Select-String foo`;";
    expect(findShellRisks("s.ts", src).length).toBeGreaterThan(0);
  });

  test("**`.mjs` 文件也要查**（上一版只走 .ts）", () => {
    const src = `import { execSync } from "child_process";\nexecSync("Get-Content x.ts | Select-String y");`;
    expect(findShellRisks("s.mjs", src).length).toBeGreaterThan(0);
  });

  test("**`.ps1` 文件里的直接读取**（上一版完全不看）", () => {
    expect(findShellRisks("s.ps1", "Get-Content src\\a.ts | ForEach-Object { $_ }").length).toBe(1);
  });
});

describe("检查 4 · PowerShell 读中文 — 不应报", () => {
  test("**注释里提到这两个词**（判据不该咬自己）", () => {
    const src = `// 别用 Select-String / Get-Content 读中文源码，会 mojibake\nconst x = 1;`;
    expect(findShellRisks("s.ts", src)).toEqual([]);
  });

  test("**提示文案里提到**（不在命令位、没有管道）", () => {
    const src = `console.log("读中文请勿使用 Select-String");`;
    expect(findShellRisks("s.ts", src)).toEqual([]);
  });

  test("`.ps1` 的注释行", () => {
    expect(findShellRisks("s.ps1", "# 不要用 Get-Content 读中文")).toEqual([]);
  });

  test("正常的 fs.readFileSync 不报", () => {
    expect(findShellRisks("s.ts", `readFileSync("a.ts", "utf8");`)).toEqual([]);
  });

  test("**生成 markdown 的模板里提到这两个词**（handoff.ts / now.ts 的真实假阳性）", () => {
    // 竖线不能当判据 —— markdown 表格全是竖线。
    const src = [
      "const md = `# 接手说明",
      "",
      "| 脚本 | 量什么 |",
      "|---|---|",
      "| \\`tools/_diag-fuzz.ts\\` | 通关率 |",
      "",
      "- **PowerShell 5.1**。\\`Select-String\\`/\\`Get-Content\\` 读中文会 mojibake，",
      "  用 \\`fs.readFileSync\\`",
      "`;",
      'writeFileSync("docs/handoff.md", md, "utf8");',
    ].join("\n");
    expect(findShellRisks("handoff.ts", src)).toEqual([]);
  });

  test("同一个文件里若真去调命令，仍然要报（不是把整类放过）", () => {
    const src = [
      "const md = `- \\`Select-String\\` 会 mojibake`;",
      'execSync("Get-Content src\\\\a.ts | Select-String foo");',
    ].join("\n");
    expect(findShellRisks("handoff.ts", src).length).toBe(1);
  });
});

// ── 检查 5：外部进程退出状态 ──────────────────────────────────

describe("检查 5 · spawnSync 结果判定", () => {
  test("**应报**：进程没起来（error 非空）", () => {
    const v = judgeProcess("typecheck", { error: new Error("spawn bun ENOENT"), status: null, stdout: "", stderr: "" });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("没能启动");
  });

  test("**应报**：被信号杀掉", () => {
    expect(judgeProcess("test", { status: null, signal: "SIGKILL" }).ok).toBe(false);
  });

  test("**应报**：退出码非零，即使 stdout 里一个 `error TS` 都没有", () => {
    // 上一版只 grep stdout：tsc 换输出格式、或者本地化之后就全绿。
    const v = judgeProcess("typecheck", { status: 2, stdout: "编译已完成，存在错误。", stderr: "" });
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("退出码 2");
  });

  test("**应报**：没有退出码（状态未知）", () => {
    expect(judgeProcess("test", { status: null }).ok).toBe(false);
  });

  test("**不应报**：退出码 0", () => {
    expect(judgeProcess("typecheck", { status: 0, stdout: "", stderr: "" }).ok).toBe(true);
  });
});

// ── 检查 6：测试条数基线 ──────────────────────────────────────

describe("检查 6 · 测试条数基线", () => {
  const base = { tests: 1341, files: 66 };

  test("parseTestOutput 取得到条数与失败数", () => {
    const out = " 1341 pass\n 0 fail\nRan 1341 tests across 66 files. [40.30s]";
    expect(parseTestOutput(out)).toEqual({ tests: 1341, files: 66, failed: 0 });
  });

  test("**应报**：条数比基线少（有测试被删/被跳过）", () => {
    const v = judgeTestCount({ tests: 1300, files: 66, failed: 0 }, base);
    expect(v.problems.some((p) => p.includes("回退"))).toBe(true);
  });

  test("**应报**：有失败", () => {
    const v = judgeTestCount({ tests: 1341, files: 66, failed: 2 }, base);
    expect(v.problems.some((p) => p.includes("2 条失败"))).toBe(true);
  });

  test("**应报**：解析不到条数 —— 不许当成通过", () => {
    // 上一版 `if (ran) notes.push(...)`：解析不到就什么也不做，静默变绿。
    const v = judgeTestCount({ tests: null, files: null, failed: null }, base);
    expect(v.problems.length).toBeGreaterThan(0);
  });

  test("**不应报**：条数与基线一致且零失败", () => {
    const v = judgeTestCount({ tests: 1341, files: 66, failed: 0 }, base);
    expect(v.problems).toEqual([]);
  });

  test("**不应报但要提示**：条数变多 → 提醒更新基线", () => {
    const v = judgeTestCount({ tests: 1400, files: 70, failed: 0 }, base);
    expect(v.problems).toEqual([]);
    expect(v.notes.some((n) => n.includes("更新"))).toBe(true);
  });
});
