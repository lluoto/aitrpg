// 判据：**类的公开方法没有任何调用方**。
//
// 为什么现有判据抓不到这一类 ——
// `probe-dead-code.ts` 量的是**模块级导出**（`export function` / `export const`）。
// 而这一轮反复撞见的断线全是**类的公开方法**：类本身在用、被 new、被注入，
// 只有那一个方法没人调。tsc 也不报：`noUnusedLocals` 不管公开方法。
//
// 实际撞见过的（都是先读文档才发现，不是判据发现的）：
//   · `NPCCombatEngine.getSanCost()`        遭遇修格斯 = 遭遇野狗
//   · `InvestigationEngine.setDifficultyProfile()`  难度按钮按下去什么都没变
//
// 这两个的共同点：**两端都写好了，中间那根线没接**。
// 数据在（coc-npc.yaml 的 san_cost、DifficultyProfile 四档），
// 实现在，只差一句调用。这种缺陷不会报错、不会让测试变红，
// 只会让「本该发生的事」安静地不发生。
//
// ⚠ 已知盲区，写在这里免得下一个人以为它什么都能抓：
//   1. **纯粹的「缺代码」抓不到。** 比如「NPC 从不还手」——
//      那不是某个方法没被调用，而是根本没有那段逻辑。
//   2. **被字符串间接调用的抓不到**（HTTP 路由按名字派发、事件名注册）。
//      这一类会被误报，所以下面按目录做了豁免。
//   3. **只在同文件内用 `this.x()` 的**不算断线，但那种方法本该是 private ——
//      单独归一类列出，不混进主结果。

import fs from "fs";
import path from "path";

const ROOT = path.resolve(import.meta.dir, "../../src").replace(/\\/g, "/");
const OUT = path.resolve(import.meta.dir, "../../analysis/diag/probe-unwired.md");

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p.replace(/\\/g, "/"));
  }
  return acc;
}

const ALL = walk(ROOT);
const isTest = (f: string) => /__tests__|\.test\.ts$/.test(f);
const PROD = ALL.filter((f) => !isTest(f));
const TESTS = ALL.filter(isTest);

/** 生命周期钩子与框架回调：由框架按名字调，不是断线。 */
const LIFECYCLE = new Set([
  "constructor", "toString", "toJSON", "valueOf", "then", "catch", "finally",
  "next", "return", "throw", "dispose", "close",
]);

type Method = { file: string; cls: string; name: string; line: number };

const methods: Method[] = [];
for (const f of PROD) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  let cls = "";
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const cm = /^\s*(?:export\s+)?(?:abstract\s+)?class\s+(\w+)/.exec(l);
    if (cm) { cls = cm[1]!; depth = 0; }
    if (cls) {
      depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
      if (depth <= 0 && !cm && /^\}/.test(l)) cls = "";
    }
    if (!cls) continue;
    // 类体内缩进两格的方法定义；显式 private/protected 的跳过
    const mm = /^\s{2}(?!private|protected|#)(?:public\s+)?(?:readonly\s+)?(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*(?:<[^>]*>)?\s*\(/.exec(l);
    if (!mm) continue;
    const name = mm[1]!;
    if (LIFECYCLE.has(name)) continue;
    if (/^\s*(if|for|while|switch|catch|return|throw)\b/.test(l)) continue;
    methods.push({ file: f, cls, name, line: i + 1 });
  }
}

/**
 * 在给定文件集合里找对 `.name` 的引用，排除定义所在文件自身。
 *
 * ⚠ 匹配的是**成员访问**（`\.name\b`）而不是「调用」（`\.name(`）。
 *   第一版只认调用，于是 **getter 被系统性误报** ——
 *   `get name()` 的用法是 `agent.name`，永远不带括号。
 *   把方法当回调传出去（`onX: obj.handle`）也是同样的形状。
 *
 *   代价是精度降低：同名属性会让真断线漏报。
 *   这是有意的取舍 —— 判据宁可漏报，也不能用噪声淹人。
 *   （上次栽在这上面：174 条假阳性淹掉了 2 个真问题。）
 */
function refs(name: string, files: string[], selfFile: string): string[] {
  const re = new RegExp(`\\.${name}\\b`);
  const out: string[] = [];
  for (const f of files) {
    if (f === selfFile) continue;
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((l, i) => {
      if (re.test(l) && !/^\s*(\/\/|\*)/.test(l)) out.push(`${f.replace(ROOT + "/", "")}:${i + 1}`);
    });
  }
  return out;
}

const noCaller: Array<Method & { testOnly: boolean; selfOnly: boolean }> = [];
for (const m of methods) {
  const prodRefs = refs(m.name, PROD, m.file);
  if (prodRefs.length > 0) continue;
  const testRefs = refs(m.name, TESTS, m.file);
  // 同文件内部是否用 this.x() 调过
  const selfSrc = fs.readFileSync(m.file, "utf8");
  const selfUsed = new RegExp(`this\\.${m.name}\\b`).test(selfSrc);
  noCaller.push({ ...m, testOnly: testRefs.length > 0, selfOnly: selfUsed });
}

const dead = noCaller.filter((m) => !m.testOnly && !m.selfOnly);
const testOnly = noCaller.filter((m) => m.testOnly && !m.selfOnly);
const shouldBePrivate = noCaller.filter((m) => m.selfOnly);

const rel = (f: string) => f.replace(ROOT + "/", "");
const lines: string[] = [
  "# 断线判据：类的公开方法没有调用方",
  "",
  "现有的 `probe-dead-code` 只看模块级导出。这一条看**类的公开方法** ——",
  "类本身在用、被 new、被注入，只有那一个方法没人调。tsc 也不报。",
  "",
  `扫了 ${PROD.length} 个生产文件，${methods.length} 个公开方法。`,
  "",
  `## 一、没有任何调用方（${dead.length}）`,
  "",
  "**两端都写好了，中间那根线没接**属于这一类。",
  "",
  dead.length === 0 ? "（无）" : "| 位置 | 类.方法 |\n|---|---|",
  ...dead.map((m) => `| \`${rel(m.file)}:${m.line}\` | \`${m.cls}.${m.name}\` |`),
  "",
  `## 二、只有测试在调（${testOnly.length}）`,
  "",
  "生产代码没有任何调用方，只有测试引用 —— 测试替一个没人用的能力背书。",
  "",
  testOnly.length === 0 ? "（无）" : "| 位置 | 类.方法 |\n|---|---|",
  ...testOnly.map((m) => `| \`${rel(m.file)}:${m.line}\` | \`${m.cls}.${m.name}\` |`),
  "",
  `## 三、只在本类内部用（${shouldBePrivate.length}）`,
  "",
  "不是断线，但公开得没必要：本该是 private。列在这里只作参考，不计入闸门。",
  "",
  shouldBePrivate.length === 0 ? "（无）" : "| 位置 | 类.方法 |\n|---|---|",
  ...shouldBePrivate.map((m) => `| \`${rel(m.file)}:${m.line}\` | \`${m.cls}.${m.name}\` |`),
  "",
  "## 已知盲区",
  "",
  "写在这里，免得下一个人以为它什么都能抓：",
  "",
  "1. **纯粹的「缺代码」抓不到。** 比如「NPC 从不还手」—— 那不是某个方法",
  "   没被调用，而是根本没有那段逻辑。判据只能发现「写了没接」，",
  "   发现不了「压根没写」。",
  "2. **被字符串间接调用的会误报**：HTTP 路由按名字派发、事件名注册。",
  "3. 匹配是文本级的 `.name(`，同名方法会互相遮蔽 —— 宁可漏报也不误报。",
  "",
];

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`没调用方 ${dead.length}｜只测试调 ${testOnly.length}｜本该 private ${shouldBePrivate.length}  -> ${path.relative(process.cwd(), OUT).replace(/\\/g, "/")}`);
