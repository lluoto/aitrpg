// 源码扫描的底座：先把**注释、字符串、正则字面量**从代码里摘掉，再谈判据。
//
// 为什么非要这一层：preflight 里几条检查全是直接对原文跑正则，于是
//   · 注释里写着「不要用 Select-String」→ 判据把这句警告本身报成风险
//   · 字符串里出现 `import ... from "../play-module"` → 报成循环依赖
//   · `*/` 后面是不是语句，不看**花括号深度** → 接口字段、对象属性、
//     switch case、联合类型续行全被算进去（174 个假阳性就是这么来的）
// 这些都不是「正则写细一点」能解决的，缺的是词法层。
//
// ⚠ 为什么不用 TypeScript AST：本仓库装的是 `typescript@7.0.2`（native preview），
//    `require("typescript")` 只导出 2 个键，**没有** `createSourceFile` /
//    `forEachChild`，JS 编译器 API 在这个版本里不存在（已实测）。
//    import 那一项改用 **Bun 自带的解析器** `Bun.Transpiler.scanImports()`
//    —— 那是真解析不是正则，注释/字符串/dynamic import/require 都认。
//    结构那一项没有现成解析器可用，就自己做词法遮罩 + 括号深度，
//    并且为「该报」「不该报」两侧各写测试钉住。

interface MaskedSource {
  /** 与原文等长：注释与字面量内容换成空格，换行保留。可直接按偏移换算行号 */
  masked: string;
  /**
   * 块注释（含 JSDoc）的位置。
   * `nest` = 该注释所处的**括号嵌套深度**（`{}` `()` `[]` 一起数，
   * 还包括模板字面量的 `${}`）。判「顶层」用它。
   */
  blockComments: { start: number; end: number; startLine: number; endLine: number; nest: number }[];
  /** 字符串/模板字面量的原始内容（模板里的 `${...}` 表达式不含在内） */
  strings: { value: string; line: number }[];
}

const isIdentChar = (c: string) => /[A-Za-z0-9_$]/.test(c);
const REGEX_PREV_KEYWORDS = [
  "return", "typeof", "instanceof", "in", "of", "case", "do", "else",
  "yield", "await", "new", "delete", "void",
];

/**
 * 词法遮罩。
 *
 * ⚠ 模板字面量必须**真的**按语法处理，不能「找下一个反引号」了事：
 *   const md = `# 标题
 *     用 \`bun x\` 跑一次        ← markdown 里的代码跨度也是反引号
 *     ${rules.map(r => "- " + r).join("\n")}   ← 里面还有普通字符串
 *   `;
 * 天真扫描会在 markdown 的反引号处提前收尾，剩下的正文被当成代码继续扫，
 * 于是 `scripts/handoff.ts` 里一段 markdown 被判成「PowerShell 读文件命令」。
 * 这里用一个显式的栈：模板 → `${` 进代码帧 → 匹配的 `}` 回模板帧，
 * 嵌套模板也照样处理。
 *
 * ⚠ 嵌套深度把 `()` `[]` 也算进去。只数 `{}` 的话，
 *   带 JSDoc 的**函数参数**（`f(\n /** doc *∕\n x: number = 0,\n)`）
 *   会被当成顶层语句 —— 实跑在 `npc-reaction.ts` 上报了 4 个假阳性。
 */
export function maskSource(src: string): MaskedSource {
  const out = src.split("");
  const blockComments: MaskedSource["blockComments"] = [];
  const strings: MaskedSource["strings"] = [];
  const lineStarts: number[] = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === "\n") lineStarts.push(k + 1);
  const lineAt = (idx: number) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== "\n") out[k] = " ";
  };

  /** 帧栈：code 帧记它自己的 `{` 计数，用来认出关掉 `${` 的那个 `}` */
  type Frame = { kind: "code"; braces: number; fromTemplateExpr: boolean } | { kind: "template"; start: number; value: string };
  const stack: Frame[] = [{ kind: "code", braces: 0, fromTemplateExpr: false }];
  /** 括号嵌套深度：`{` `(` `[` 与模板表达式一起数 */
  let nest = 0;
  /** 上一个有意义的代码字符，用来判 `/` 是正则还是除号 */
  let lastSig = "";
  let lastWord = "";

  let i = 0;
  while (i < src.length) {
    const top = stack[stack.length - 1]!;
    const c = src[i]!;

    if (top.kind === "template") {
      if (c === "\\") { top.value += src[i + 1] ?? ""; blank(i, i + 2); i += 2; continue; }
      if (c === "$" && src[i + 1] === "{") {
        stack.push({ kind: "code", braces: 0, fromTemplateExpr: true });
        nest++;
        i += 2;
        continue;
      }
      if (c === "`") {
        strings.push({ value: top.value, line: lineAt(top.start) });
        stack.pop();
        lastSig = "`"; lastWord = "";
        i++;
        continue;
      }
      top.value += c;
      if (c !== "\n") out[i] = " ";
      i++;
      continue;
    }

    // ── code 帧 ──
    const nxt = src[i + 1];
    if (c === "/" && nxt === "/") {
      const end = src.indexOf("\n", i);
      blank(i, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end;
      continue;
    }
    if (c === "/" && nxt === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end < 0 ? src.length : end + 2;
      blockComments.push({ start: i, end: stop, startLine: lineAt(i), endLine: lineAt(stop - 1), nest });
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let value = "";
      while (j < src.length) {
        const d = src[j]!;
        if (d === "\\") { value += src[j + 1] ?? ""; j += 2; continue; }
        if (d === c || d === "\n") break;
        value += d;
        j++;
      }
      strings.push({ value, line: lineAt(i) });
      blank(i + 1, j);
      lastSig = c; lastWord = "";
      i = Math.min(j + 1, src.length);
      continue;
    }
    if (c === "`") {
      stack.push({ kind: "template", start: i, value: "" });
      i++;
      continue;
    }
    if (c === "/") {
      const prevAllows =
        lastSig === "" || "=(,:[!&|?{};+-*%~^<>".includes(lastSig) ||
        (lastSig === "@" ) || REGEX_PREV_KEYWORDS.includes(lastWord);
      if (prevAllows) {
        let j = i + 1;
        let inClass = false;
        let closed = false;
        while (j < src.length) {
          const d = src[j]!;
          if (d === "\\") { j += 2; continue; }
          if (d === "\n") break;
          if (d === "[") inClass = true;
          else if (d === "]") inClass = false;
          else if (d === "/" && !inClass) { closed = true; break; }
          j++;
        }
        if (closed) {
          // 正则体整段遮掉：`/\d{1,3}/` 里的花括号不能算进嵌套深度
          blank(i + 1, j);
          lastSig = "/"; lastWord = "";
          i = j + 1;
          continue;
        }
      }
    }

    if (c === "{" || c === "(" || c === "[") {
      nest++;
      if (c === "{") top.braces++;
    } else if (c === "}" ) {
      if (top.braces === 0 && top.fromTemplateExpr) {
        // 关掉 `${` —— 回到模板帧
        stack.pop();
        nest = Math.max(0, nest - 1);
        lastSig = "}"; lastWord = "";
        i++;
        continue;
      }
      top.braces = Math.max(0, top.braces - 1);
      nest = Math.max(0, nest - 1);
    } else if (c === ")" || c === "]") {
      nest = Math.max(0, nest - 1);
    }

    if (!/\s/.test(c)) {
      lastSig = c;
      if (isIdentChar(c)) lastWord += c; else lastWord = "";
    }
    i++;
  }

  // 模板没闭合（源码本身有问题）时把它当字符串收掉，别丢
  for (const f of stack) if (f.kind === "template") strings.push({ value: f.value, line: lineAt(f.start) });

  return { masked: out.join(""), blockComments, strings };
}

/** 把偏移换成 1 基行号 */
function lineOf(src: string, index: number): number {
  let n = 1;
  for (let k = 0; k < index && k < src.length; k++) if (src[k] === "\n") n++;
  return n;
}

export interface Finding {
  file: string;
  line: number;
  rule: string;
  message: string;
}

// ============================================================
// 检查 1：切割残渣 —— 顶层块注释后面直接是**语句**
// ============================================================

/**
 * 机械切割最常见的后果：注释块留下、函数头被搬走，块注释结束符下面直接是函数体第一句。
 *
 * ⚠ 关键收窄是**花括号深度必须为 0**。
 *   - 上一版没有这一条 → 接口字段、对象属性、switch case、联合类型续行
 *     全部命中，174 个假阳性淹掉 2 个真问题。
 *   - 而上一版的补救是把「下一行」的形态白名单缩到
 *     `return|await|const x = f()|x =` 四种 → `register();` `if (…)` `for (…)`
 *     这些同样是「函数头没了」的残骸，一个都不报（假阴性）。
 * 深度为 0 时，任何**不是声明**的东西都不该出现，所以判据可以反过来写：
 * 白名单声明起手式，其余一律报。
 */
// 允许的起手式 = 声明关键字，或**上一行表达式/类型的续行符**。
// 续行符那一串（`|` `&` `=>` `?` `:` `.` 等）是顶层联合类型、链式类型、
// 三元续行的写法：
//     export type U =
//       /** 一支 */
//       | { t: "a" }
// 这不是「函数头被切走」，是同一条声明分了几行。
const DECL_START =
  /^(export\b|import\b|declare\b|function\b|async\s+function\b|class\b|interface\b|type\s|enum\b|const\b|let\b|var\b|abstract\b|namespace\b|module\s|extends\b|implements\b|satisfies\b|@|\}|\)|\]|,|;|<|\||&|=>|\?|:|\.|\/\/|\/\*|\*)/;

export function findTruncatedBlocks(file: string, src: string): Finding[] {
  const m = maskSource(src);
  const out: Finding[] = [];
  const lines = m.masked.split("\n");
  const rawLines = src.split("\n");
  for (const b of m.blockComments) {
    if (b.nest !== 0) continue; // 只看顶层（`{}` `()` `[]` 与模板表达式都算嵌套）
    // 找注释之后的第一条非空代码行
    let li = b.endLine; // endLine 是 1 基；数组下标即「下一行」
    while (li < lines.length && lines[li]!.trim() === "") li++;
    if (li >= lines.length) continue;
    const codeText = lines[li]!.trim();
    const rawText = (rawLines[li] ?? "").trim();
    if (codeText === "") continue;
    if (DECL_START.test(codeText)) continue;
    out.push({
      file,
      line: li + 1,
      rule: "truncated-block",
      message: `顶层块注释后面直接是语句「${rawText.slice(0, 48)}」—— 函数头可能被切走了`,
    });
  }
  return out;
}

// ============================================================
// 检查 2：搬运占位注释残留
// ============================================================

export function findPlaceholderResidue(
  file: string,
  src: string,
  pattern = /已抽到 src\/play\/[\w-]+\.ts（纯搬运/,
): Finding[] {
  const lines = src.split("\n");
  const hits = lines.map((l, i) => (pattern.test(l) ? i + 1 : 0)).filter(Boolean);
  if (hits.length <= 1) return [];
  return [{
    file, line: hits[0]!, rule: "placeholder-residue",
    message: `搬运占位注释残留 ${hits.length} 处（L${hits.join(", L")}）`,
  }];
}

// ============================================================
// 检查 3：反向 import（成环）
// ============================================================

interface ImportRef { path: string; kind: string }

/**
 * 取出一个文件里**真正会在运行时生效**的 import。
 *
 * 用 `Bun.Transpiler.scanImports()` —— 真解析器，因此：
 *   · 注释里的 `// import ... from "../play-module"` 不算（上一版会算）
 *   · 字符串里的 import 文本不算
 *   · `await import("../play-module.js")` 算（上一版漏）
 *   · `require("./x.cjs")` 算（上一版漏）
 *   · `export { x } from "@alias/y"` 算（上一版漏）
 *   · `import type {...}` **不算** —— 它会被擦除，不构成运行时环，
 *     这是语义正确而不是漏报。
 */
export function scanImports(src: string, loader: "ts" | "tsx" | "js" | "jsx" = "ts"): ImportRef[] {
  try {
    const t = new Bun.Transpiler({ loader });
    return t.scanImports(src).map((r) => ({ path: r.path, kind: r.kind }));
  } catch {
    return [];
  }
}

/**
 * 判断一个 import 说明符是不是指向某个模块。
 *
 * 要同时认：无扩展名（`../play-module`）、带扩展名（`../play-module.ts|.js`）、
 * 以及别名（`@/play-module`）。上一版写死 `from ["']\.\.\/play-module["']`，
 * 后两种全漏。
 */
export function importPointsTo(spec: string, moduleBase: string): boolean {
  const normalized = spec.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/i, "");
  const tail = normalized.split("/").filter(Boolean).pop() ?? "";
  return tail === moduleBase;
}

export function findReverseImports(
  file: string,
  src: string,
  moduleBase: string,
): Finding[] {
  const out: Finding[] = [];
  for (const ref of scanImports(src)) {
    if (!importPointsTo(ref.path, moduleBase)) continue;
    const idx = src.indexOf(ref.path);
    out.push({
      file,
      line: idx >= 0 ? lineOf(src, idx) : 1,
      rule: "reverse-import",
      message: `${ref.kind} 反向 import ${moduleBase}（"${ref.path}"）—— 成环，把需要的东西也抽出来`,
    });
  }
  return out;
}

// ============================================================
// 检查 4：中文过 PowerShell
// ============================================================

/**
 * 读文件内容的 PowerShell cmdlet（含常见别名），且必须落在**命令位**：
 * 行首、管道后、`;`/`&` 后。
 *
 * 不能只判「字符串里出现过这两个词」：`docs` 生成脚本里有整段 markdown 讲
 * 「`Select-String`/`Get-Content` 读中文会 mojibake」，那是**警告文案**，
 * 判据把它报出来就是自己咬自己。也不能退而求其次判「有没有竖线」——
 * markdown 表格全是竖线（实跑在 `handoff.ts` / `now.ts` 上各报了一个假阳性）。
 */
const RISKY_CMDLET = /(?:^|[|;&(]\s*|\bstart-process\s+)\s*(Select-String|Get-Content|sls|gc|cat|type)\b/i;
/** 真的在起一个外部进程的 API */
const SHELL_API = /\b(execSync|execFileSync|spawnSync|exec|execFile|spawn|Bun\.spawnSync|Bun\.spawn|Bun\.\$)\s*\(|Bun\.\$\s*`|\$`/;

type ScanLang = "ts" | "js" | "powershell";

function langOf(file: string): ScanLang {
  if (/\.ps(m)?1$/i.test(file)) return "powershell";
  if (/\.(mjs|cjs|jsx?)$/i.test(file)) return "js";
  return "ts";
}

/**
 * 找「真的在用 PowerShell 读中文源码」的地方。
 *
 * 两侧都要成立：
 *   应报 —— `execSync("Get-Content x.ts | Select-String foo")`、
 *           `Bun.$\`Get-Content a | Select-String b\``、
 *           `.ps1` 里的 `Get-Content src\x.ts`
 *   不应报 —— 注释里写「别用 Select-String」（判据不该咬自己）、
 *             提示文案 `"用 Select-String 会 mojibake"`（不是命令位）
 *
 * 判据落在**命令位**上：cmdlet 必须出现在行首、管道后、`;`/`&` 后，
 * 而不是随便出现在句子中间。
 */
export function findShellRisks(file: string, src: string): Finding[] {
  const out: Finding[] = [];
  const lang = langOf(file);

  if (lang === "powershell") {
    const m = maskSource(src.replace(/^#.*$/gm, "")); // ps 注释是 #
    const lines = src.split("\n");
    m.masked.split("\n").forEach((code, i) => {
      const bare = code.replace(/#.*$/, "");
      if (RISKY_CMDLET.test(bare)) {
        out.push({
          file, line: i + 1, rule: "powershell-read",
          message: `PowerShell 直接读文件（${lines[i]!.trim().slice(0, 60)}）—— 中文源码会 mojibake，用 fs.readFileSync`,
        });
      }
    });
    return out;
  }

  const m = maskSource(src);
  const hasShellApi = SHELL_API.test(m.masked) || /\$`/.test(src);
  for (const s of m.strings) {
    if (!/(Select-String|Get-Content)/i.test(s.value)) continue;
    // 逐行判命令位：多行模板里只要有一行是真命令就算，
    // 但整段 markdown 里出现这两个词不算。
    const hit = s.value.split("\n").find((ln) => RISKY_CMDLET.test(ln));
    if (!hit) continue;
    if (!hasShellApi && !/\|/.test(hit)) continue; // 没有起进程的 API，也不像管道 → 只是文案
    out.push({
      file, line: s.line, rule: "powershell-read",
      message: `字符串里是 PowerShell 读文件命令（${hit.trim().slice(0, 60)}）—— 中文源码会 mojibake，用 fs.readFileSync`,
    });
  }
  return out;
}

// ============================================================
// 检查 7：文档里叫人跑的脚本，仓库里得真有
// ============================================================

/**
 * 从文档正文里挑出「叫人跑的命令」所引用的脚本路径。
 *
 * 起因：`docs/handoff.md` 是入库的，里面整整一张表叫接手的人去跑
 * `tools/_diag-*.ts`，而 `tools/` 在 `.gitignore` 里 —— **新克隆里
 * 一个都没有**。判据本身入了库、测试也齐了，可跑它们的入口不在仓库里。
 * 这跟「判据看着很像在检查、其实什么也没量」是同一类错，只是换了层皮。
 *
 * 两种形态都要认：
 *   命令行     ```bun scripts/diag/diag-fuzz.ts 3```
 *   反引号路径 | `scripts/diag/diag-fuzz.ts` | 通关率 |
 *
 * ⚠ 起初只认命令行，理由是「表格里的裸文件名常常是在说这个文件装什么，
 *   不是叫人执行」。结果第一次做变异检验就露馅：把 `diag-fuzz.ts` 从索引里
 *   撤掉，检查**一声不吭** —— 因为 handoff 那张表里六个脚本只有一个
 *   以命令行形态出现过。文档指着一个不存在的路径，不管它是不是命令，
 *   都是在给接手的人指错路。
 *
 * 裸文本（不带反引号、不在命令里）仍旧不算 —— 那才是真的「顺口提一句」。
 *
 * ⚠ 第二次做变异检验又露馅：`RUN_CMD` / `CODE_PATH` 都要求路径以
 *   `src|scripts|tools/` 开头，于是三类真实引用完全不被检查 ——
 *   裸文件名（`_diag-fuzz.ts`）、src 内部相对路径（`play/clue-check.ts`、
 *   `api/game-session.ts`）、带行号的路径（`coc-engine.test.ts:131`）。
 *   反引号本身就是「这是一段代码/路径」的标记，不该再额外要求目录前缀——
 *   `BARE_CODE_PATH` 只锚定反引号，允许可选的 `:行号` 后缀。
 */
const RUN_CMD = /\bbun\s+(?:run\s+)?((?:src|scripts|tools)\/[\w./-]+\.(?:ts|mjs|cjs|js))/g;
const CODE_PATH = /`((?:src|scripts|tools)\/[\w./-]+\.(?:ts|mjs|cjs|js))`/g;
const BARE_CODE_PATH = /`([\w.-][\w./-]*\.(?:ts|mjs|cjs|js))(?::\d+)?`/g;

export function referencedScripts(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(RUN_CMD)) out.add(m[1]!);
  for (const m of markdown.matchAll(CODE_PATH)) out.add(m[1]!);
  for (const m of markdown.matchAll(BARE_CODE_PATH)) out.add(m[1]!);
  return [...out];
}

/**
 * 文档里引用的相对/裸路径要落到磁盘上的哪个真实文件，得靠候选列表比对——
 * 文档里写的是 `play/clue-check.ts`，磁盘上是 `src/play/clue-check.ts`，
 * 字符串不相等，但确实是同一个文件。
 *
 * 判法：完全相等，或者候选路径以 `"/" + ref` 结尾（`ref` 是候选路径的
 * 末尾一段）。调用方要保证候选列表统一用正斜杠——`path.join()` 在
 * Windows 上产出反斜杠，不归一化的话 `endsWith("/" + ref)` 永远是假，
 * 会把「文档引用的脚本是否入库」这条检查变成全量假阳性。
 */
export function resolveRef(ref: string, candidates: readonly string[]): boolean {
  return candidates.some((c) => c === ref || c.endsWith("/" + ref));
}

/**
 * 手写但**载荷**的文档 —— 不是脚本生成的（`generatedDocs()` 抓不到），
 * 但里面的路径引用是设计依据/验收标准，读者会真的照着它去找文件。
 * 跟 `docs/notes/*.md` 的区别：notes 是 append-only 的工作记录，
 * 「当时」为真就够了；这几份是活文档，读者拿它当**现在**的事实。
 *
 * ⚠ `docs/rules-licensing-audit.md` **不进这份清单**：它带 `Date:` 头，
 * 是法务性质的时点审计，跟 notes 一样只需要「当时为真」。
 */
export const LIVE_DOCS = [
  "docs/index-world-model.md",
  "docs/kp-tool-surface-assessment.md",
  "docs/kp-tool-numeric-domain-design.md",
  "docs/voice-readiness.md",
  "docs/deploy.md",
  "docs/scene-visuals.md",
  "docs/content-brief.md",
  "docs/index-program.md",
] as const;

/**
 * tier-2 的收窄规则：只认**带仓库前缀、带脚本扩展名**的反引号路径 ——
 * `poc/`（读作仓库根，匹配时直接剥掉这一段）、`src/`、`scripts/`、`docs/`、
 * `frontend/`、`tools/`，且必须是 `.ts`/`.mjs`/`.cjs`/`.js`。
 *
 * 前缀收窄的依据可推导：`docs/index-world-model.md:7` 自己声明
 * 「路径跨出 git 仓库，非 `poc/` 开头的相对 `C:\aitrpg\`」——
 * 没有仓库前缀的路径根本不保证落在仓库里，检查不该假装能验它。
 *
 * ⚠ 扩展名收窄同样是必须的，不是照抄 tier-1 偷懒：这几份手写文档里
 * 大量反引号路径是**目录**（`tools/modules/raw/`）或**历史对比用的
 * 数据文件**（`calibration-report.md`、`section_18.txt`）——那些是在
 * 记录「哪份副本已删除、哪份是保留侧」，本身就在断言"这份不存在"，
 * 不是接线错误。第一版没做这层收窄，混进了一堆目录/数据文件噪声，
 * 报了 15 条而不是 1 条。只查脚本扩展名，是因为
 * 这条检查的初衷本来就是"叫人去读的代码路径对不对"，不是通用的
 * "文档里提到的每个文件名都要存在"。
 */
const LIVE_DOC_PATH = /`(?:poc\/)?((?:src|scripts|docs|frontend|tools)\/[\w./-]+\.(?:ts|mjs|cjs|js))(?::\d+)?`/g;

export function referencedRepoPaths(markdown: string): string[] {
  const out = new Set<string>();
  for (const m of markdown.matchAll(LIVE_DOC_PATH)) out.add(m[1]!);
  return [...out];
}

/**
 * 结构化的手写载荷文档——目前只有 `docs/architecture.json` 一份。
 *
 * 跟 `LIVE_DOCS`（tier-2，反引号 markdown）不是同一类：这份是 JSON，
 * `docs/index-program.md:30-31` 自己写着它是"项目知识不是会话状态，
 * clone 下来必须还在"——完全符合"活文档"的定义，但 `generatedDocs()`
 * 只匹配 `docs/*.md` 写入、`LIVE_DOC_PATH` 只认反引号包裹的路径，
 * 两条现有判据都够不到它：107 个路径引用曾经无人守。
 */
export const ARCHITECTURE_DOCS = ["docs/architecture.json"] as const;

const ARCHITECTURE_PATH_SHAPE = /^(?:poc\/)?((?:src|scripts|docs|frontend|tools)\/[\w./-]+\.(?:ts|mjs|cjs|js))$/;

/**
 * `architecture.json` 的路径提取器：按结构取 `sections[].tables[].rows[][0]`，
 * 不对全文跑正则。
 *
 * 两条收窄，都可推导，不是拍脑袋：
 *
 * 1. **只取每行第 0 列**。第 1 列是职责描述、第 2 列是导出符号，
 *    路径散文式地出现在描述文字里的情况不算——那是在说这个东西，
 *    不是在断言"这份文件在这个路径"。`prose` 字段同理不扫：
 *    里面是大段历史叙述，混着已经不存在的旧路径当参照物提。
 * 2. **跳过标题以"工具脚本"开头的节**。该节标题自己写着
 *    "大部分仍在 `tools/`，被 .gitignore 排除"——记录的是一次性取证
 *    脚本的历史存在，跟 `docs/notes/*.md` 的豁免是同一个理由
 *    （见上面 `generatedDocs()` 的注释）：那批脚本"当时"存在过，
 *    现在没了不代表这条记录错了。不跳过的话第一版报了 3 条，
 *    其中 2 条（`tools/_cmp-raw.ts`、`tools/_followup-prompts.ts`）
 *    是这类历史记录，不是真的路径失效。
 *
 * 只判存在性，不判入库——跟 tier-2 一致：`tools/` 是 gitignored 的，
 * 判 tracked 会把"工具脚本"节里本来就该跳过的条目又从另一条路报回来。
 *
 * ⚠ JSON 解析失败直接抛错，不吞掉：这是判据脚本自己的输入，
 * 输入损坏就该在这里炸出来，不该悄悄跳过整份检查变成"没报=没问题"。
 */
export function architecturePathRefs(jsonText: string): string[] {
  const parsed = JSON.parse(jsonText) as {
    sections?: Array<{ title?: string; tables?: Array<{ rows?: unknown[][] }> }>;
  };
  const out = new Set<string>();
  for (const section of parsed.sections ?? []) {
    if (/^工具脚本/.test(section.title ?? "")) continue;
    for (const table of section.tables ?? []) {
      for (const row of table.rows ?? []) {
        const cell = row?.[0];
        if (typeof cell !== "string") continue;
        const stripped = cell.replace(/^`|`$/g, "");
        const m = ARCHITECTURE_PATH_SHAPE.exec(stripped);
        if (m) out.add(m[1]!);
      }
    }
  }
  return [...out];
}

/**
 * 哪些文档是**脚本生成的**。
 *
 * 这条检查只对生成的文档生效，理由是可推导的而不是拍脑袋定的：
 * 生成的文档每次都会被重写，所以里面的每一句都必须**当下为真**；
 * 而 `docs/notes/*.md` 是**append-only 的工作记录**，
 * 「当时用 `tools/_diag-absorb.ts` 数出 4 处」是历史事实，
 * 那个一次性脚本后来删了也不影响记录的正确性。
 *
 * ⚠ 不加这层收窄的话，第一次跑就是 43 个报告，其中 42 个来自 notes ——
 * 又一次「174 个假阳性淹掉 2 个真问题」。
 * 收窄的判据必须是**可推导的**：谁写这份文档，就由谁负责它当下为真。
 */
const DOC_WRITE = /(?:writeFileSync|Bun\.write)\(\s*["'`](docs\/[\w./-]+\.md)["'`]/g;

export function generatedDocs(scriptSources: readonly string[]): string[] {
  const out = new Set<string>();
  for (const src of scriptSources) {
    for (const m of src.matchAll(DOC_WRITE)) out.add(m[1]!);
  }
  return [...out];
}

interface ScriptRefVerdict {
  path: string;
  exists: boolean;
  tracked: boolean;
}

/**
 * 文档引用的脚本必须**既存在、又入库**。
 *
 * 只查存在是不够的：本机跑得动不代表别人克隆下来跑得动，
 * 而这份文档的唯一读者就是「别人」。
 */
export function judgeScriptRefs(refs: readonly ScriptRefVerdict[], doc: string): Finding[] {
  const out: Finding[] = [];
  for (const r of refs) {
    if (!r.exists) {
      out.push({ file: doc, line: 1, rule: "doc-script-missing", message: `文档叫人跑 \`${r.path}\`，但这个文件不存在` });
    } else if (!r.tracked) {
      out.push({ file: doc, line: 1, rule: "doc-script-untracked", message: `文档叫人跑 \`${r.path}\`，但它没入库（新克隆拿不到）` });
    }
  }
  return out;
}

// ============================================================
// 检查 8：「成功与否」的返回值被丢掉
// ============================================================

/**
 * 找出返回 `boolean` 的方法/函数名。
 *
 * ⚠ 要排掉**接口成员声明** —— `isSceneVisited(id: string): boolean;` 长得跟
 * 调用很像（标识符 + 括号 + 分号结尾），第一版扫出来两个假阳性就是它。
 * 判据：声明后面跟 `{`（有函数体）才算实现；跟 `;` 的是签名。
 */
const BOOL_IMPL = /\b([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*:\s*boolean\s*\{/g;

export function boolReturningNames(source: string): string[] {
  const out = new Set<string>();
  for (const m of maskSource(source).masked.matchAll(BOOL_IMPL)) {
    const n = m[1]!;
    if (["if", "while", "for", "switch", "catch", "function"].includes(n)) continue;
    out.add(n);
  }
  return [...out];
}

/**
 * 找出「整行就是一次调用、返回值没人接」的语句。
 *
 * 这类**不一定都是 bug** —— 有些调用方确实不关心结果。但每一条都该有人看，
 * 因为「静默失败」在这个仓库有前科：`setActiveScene` 静默失效、
 * `getCurrentState().scene` 赋值落在临时对象上，两次都是
 * 「类型检查与 710 个测试全绿，只有真实跑团暴露了它」。
 *
 * 实跑第一次就逮到 `this.setScene(sceneId);` 两处 —— 而 `setActiveScene`
 * 失败时会把世界弄成**一个活动场景都不剩**，比什么都没做更糟。
 */
export function findDroppedReturns(file: string, src: string, boolNames: ReadonlySet<string>): Finding[] {
  const out: Finding[] = [];
  const masked = maskSource(src).masked.split("\n");
  const raw = src.split("\n");
  masked.forEach((line, i) => {
    const t = line.trim();
    if (!t.endsWith(";")) return;
    // 接口/类型里的**成员签名**长得跟调用一样（标识符+括号+分号），
    // 区别是签名带返回类型标注：`isSceneVisited(id: string): boolean;`。
    // 真正的调用不会有 `): X;`。少这一条就会把接口声明报成「丢了返回值」。
    if (/\)\s*:\s*[\w<>[\]|&. ]+;$/.test(t)) return;
    const m = t.match(/^(?:await\s+)?(?:this\.)?([A-Za-z_$][\w$]*)\s*\(/);
    if (!m) return;
    if (/^(return|if|while|for|switch|throw|new)\b/.test(t)) return;
    const name = m[1]!;
    if (!boolNames.has(name)) return;
    out.push({
      file, line: i + 1, rule: "dropped-boolean-return",
      message: `\`${(raw[i] ?? "").trim().slice(0, 60)}\` —— ${name}() 返回成功与否，这里把它丢了`,
    });
  });
  return out;
}

// ============================================================
// 检查 9：无声吞掉错误的 catch
// ============================================================

/**
 * 找**空 catch 且一个字都没写**的地方。
 *
 * ⚠ 判据必须有区分力：空 catch 本身不是罪。
 *   `try { mkdirSync(d) } catch { /* 目录已存在 *∕ }` 完全合理。
 * 有区分力的问法是「吞掉了却不说为什么」，所以三档：
 *   catch 体里有语句（日志/上报/兜底赋值）→ 放过，至少留了痕
 *   空体但**有注释**                        → 放过，作者想过
 *   空体且一个字都没有                      → 报
 *
 * 这个仓库有先例（docs/kp-tool-surface-assessment.md §八）：
 * 「被 catch 降级成一行警告，模组场景出口整段失效」
 * 「类型检查与 710 个测试全绿，只有真实跑团暴露了它」。
 * 实跑第一次就逮到两处 —— `mythos-module` 里 `JSON.parse(exits)` 失败后
 * **照样把空数组写回数据库**，原有场景出口被静默抹掉。
 */
export function findSilentCatches(file: string, src: string): Finding[] {
  const m = maskSource(src);
  const masked = m.masked;
  const out: Finding[] = [];
  for (const hit of masked.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{/g)) {
    const open = hit.index! + hit[0].length - 1;
    let depth = 0;
    let end = open;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === "{") depth++;
      else if (masked[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
    }
    if (masked.slice(open + 1, end).trim().length > 0) continue; // 有语句
    const rawBody = src.slice(open + 1, end);
    if (/\/\/|\/\*/.test(rawBody)) continue;                     // 有注释说明
    out.push({
      file, line: lineOf(src, hit.index!), rule: "silent-catch",
      message: "catch 里一个字都没有 —— 吞掉了什么、为什么可以吞，都得写出来",
    });
  }
  return out;
}

// ============================================================
// 检查 5/6：外部进程的退出状态
// ============================================================

interface SpawnLike {
  error?: Error | null;
  status?: number | null;
  signal?: string | null;
  stdout?: string | null;
  stderr?: string | null;
}

interface ProcVerdict {
  ok: boolean;
  /** 失败原因；ok 时为空 */
  reason: string;
}

/**
 * `spawnSync` 的结果到底算不算成功。
 *
 * 上一版只看 stdout 里有没有 `error TS` / `(\d+) fail`：
 *   · 进程根本没起来（`error` 非空，比如 bun 不在 PATH）→ 输出是空串 → **判通过**
 *   · 被信号杀掉（OOM）→ 输出被截断 → **判通过**
 *   · tsc 换个输出格式（`--pretty`、本地化）→ 匹配不上 → **判通过**
 * 三条路都是「炸了但报绿」。退出码是唯一不依赖输出格式的信号，必须先看它。
 */
export function judgeProcess(label: string, r: SpawnLike): ProcVerdict {
  if (r.error) return { ok: false, reason: `${label} 没能启动：${r.error.message}` };
  if (r.signal) return { ok: false, reason: `${label} 被信号 ${r.signal} 终止` };
  if (r.status === null || r.status === undefined) {
    return { ok: false, reason: `${label} 没有退出码（进程状态未知）` };
  }
  if (r.status !== 0) return { ok: false, reason: `${label} 退出码 ${r.status}` };
  return { ok: true, reason: "" };
}

export interface TestBaseline { tests: number; files: number }
interface TestCount { tests: number | null; files: number | null; failed: number | null }

/** 从 `bun test` 的输出里取条数。取不到就是 null —— **不许当成 0 或当成通过** */
export function parseTestOutput(text: string): TestCount {
  const ran = text.match(/Ran (\d+) tests across (\d+) files/);
  const fail = text.match(/(\d+) fail/);
  return {
    tests: ran ? Number(ran[1]) : null,
    files: ran ? Number(ran[2]) : null,
    failed: fail ? Number(fail[1]) : null,
  };
}

interface BaselineVerdict {
  problems: string[];
  notes: string[];
}

/**
 * 测试条数的回归判据。
 *
 * 「只打印当前条数」不是检查 —— 谁去比？跟什么比？
 * 有基线才有回归：少了就是有测试被删/被跳过，多了就提示更新基线。
 */
export function judgeTestCount(cur: TestCount, base: TestBaseline): BaselineVerdict {
  const problems: string[] = [];
  const notes: string[] = [];
  if (cur.tests === null) {
    problems.push("没解析到测试条数 —— 不能当成通过（输出格式变了或测试根本没跑起来）");
    return { problems, notes };
  }
  if (cur.failed !== null && cur.failed > 0) problems.push(`测试有 ${cur.failed} 条失败`);
  if (cur.tests < base.tests) {
    problems.push(`测试条数回退：${cur.tests} < 基线 ${base.tests}（少了 ${base.tests - cur.tests} 条）`);
  } else if (cur.tests > base.tests) {
    notes.push(`测试条数 ${cur.tests} > 基线 ${base.tests} —— 新增了 ${cur.tests - base.tests} 条，记得更新 docs/test-baseline.json`);
  } else {
    notes.push(`测试 ${cur.tests} 条 / ${cur.files ?? "?"} 文件，与基线一致`);
  }
  return { problems, notes };
}
