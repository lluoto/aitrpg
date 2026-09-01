// 端到端：摄取出来的模组能不能真的跑起来、能不能在场景之间走动。
//
// 为什么要这个脚本：在这之前「场景走不通」这件事一直是拿摄取产物跟手写基准
// 对着算指标，从来没有真的跑过。运行时只跑过硬编码的 BARN_OF_PREMIER，
// 摄取产物与 runModule 之间没有任何通路。
// 指标再好看也不等于跑得起来 —— 这个脚本就是把那一步补上。
//
// 判据只有两条，都很朴素：
//   1. 引擎不崩，能开始
//   2. 调查员真的从一个场景走到了另一个场景（看 onLine 里的场景切换）
//
// 开发·摄取管线校准 阶段4：原先躺在 `tools/_e2e-ingested-module.ts`，
// `tools/` 在 .gitignore 里——它依赖的 `neutralSupport` 因此在编译器眼里
// "全仓无 import"，一次死代码清理（60c7ed4）就把它删了，脚本从此崩溃，
// 没有任何判据看着这条断裂。与 8ca53fa 修的「摄取入口躺在 tools/ 外」是
// 同一类问题：仓库状态与本机状态分叉。搬进 scripts/（tsconfig.json 的
// include 已经覆盖 scripts/**/*.ts），编译器从此真的看得见这条依赖——
// 再删一次 neutralSupport，tsc 与 src/__tests__/ingest-e2e-module.test.ts
// 都会红。
//
// 用法：bun scripts/ingest/e2e-run.ts [module.json 路径]
//   不传参数时缺省指向 scripts/ingest/run.ts 的默认落盘位置
//   （该脚本自己的输出目录，是派生物，不进版本库）。

import { runModule } from "../../src/play-module";
import { neutralSupport } from "../../src/ingest/assemble-module";
import type { ModuleData } from "../../src/module/types";
import type { PlayerDecision } from "../../src/agent/player-agent";
import { writeReport } from "../../src/diagnostics/report";
import { existsSync } from "fs";

const modulePath = process.argv[2] ?? "tools/ingest-out/module.json";
if (!existsSync(modulePath)) {
  console.error(
    `找不到摄取产物：${modulePath}\n` +
      `先跑 bun scripts/ingest/run.ts 生成它（需要 PDF 路径参数，见该脚本用法），` +
      `或者把已有的 module.json 路径当第一个参数传给本脚本。`,
  );
  process.exit(1);
}

const mod = (await Bun.file(modulePath).json()) as ModuleData;
const sceneNames = new Set(mod.scenes.map((s) => s.name));

const lines: string[] = [];
let decisions = 0;
const visited = new Set<string>();
let failure = "";
/** 每次决策看到的选项，用来判断引擎到底有没有给出「可以走」这个选择 */
const optionLog: string[] = [];

// ⚠️ 判「到过哪些场景」必须按**描述**认，不能按名字认。
// 第一版按名字扫播报，扫出 24/24，看着像走遍全图 —— 其实是选项列表里
// 一次提到了很多场景名。engine 进入一个场景时会渲染它的描述，
// 描述才是「人真的在那儿」的证据。
const descKey = (d: string) => d.replace(/\s+/g, "").slice(0, 24);
const sceneByDesc = new Map(mod.scenes.map((s) => [descKey(s.description), s.name]));

// 决策器：只要有得走就走，优先去没去过的地方。
// 不问 LLM —— 这里验的是引擎与数据，不是模型的判断力。
function decide(_context: string, options: string[]): PlayerDecision {
  decisions++;
  const move = options.find((o) => {
    for (const n of sceneNames) if (o.includes(n) && !visited.has(n)) return true;
    return false;
  });
  const pick = move ?? options[0] ?? "观察四周";
  for (const n of sceneNames) if (pick.includes(n)) visited.add(n);
  return { action: pick, intent: move ? "move" : "observe" };
}

const MAX = 40;
try {
  await Promise.race([
    runModule(mod, neutralSupport(), {
      onLine: (line: string) => {
        lines.push(line);
        const flat = line.replace(/\s+/g, "");
        for (const [k, name] of sceneByDesc) if (k.length > 8 && flat.includes(k)) visited.add(name);
      },
      decide: (context: string, options: string[]) => {
        if (decisions >= MAX) throw new Error(`__STOP__`); // 没有 endings，得自己叫停
        optionLog.push(`#${decisions + 1} ${options.join(" | ").slice(0, 160)}`);
        return Promise.resolve(decide(context, options));
      },
    }),
    // 兜底：中性 support 没有结局评估，模组不会自行结束。
    new Promise((_, rej) => setTimeout(() => rej(new Error("__TIMEOUT__")), 120_000)),
  ]);
} catch (err) {
  const m = err instanceof Error ? err.message : String(err);
  if (m !== "__STOP__" && m !== "__TIMEOUT__") failure = m;
}

const L = [
  "端到端：跑摄取出来的模组",
  "",
  `场景 ${mod.scenes.length} / NPC ${mod.npcs.length} / 物品 ${mod.items.length}`,
  `连接总数 ${mod.scenes.reduce((a, s) => a + s.connections.length, 0)}`,
  "",
  failure === "" ? "**引擎没崩**" : `**引擎抛错**：${failure}`,
  `播报 ${lines.length} 行，决策 ${decisions} 次`,
  "",
  `**渲染过描述的场景 ${visited.size} / ${mod.scenes.length}** —— 这才是「人真的到过」`,
  visited.size > 0 ? `  ${[...visited].join("、")}` : "  （一个都没有）",
  visited.size > 1 ? "**走动成立**" : "**没有走动** —— 只停在开场那一个场景",
  "",
  "── 每次决策看到的选项 ──",
  ...optionLog,
  "",
  // 全量落盘。第一版只存前 30 行，结果事后想复查「哪些场景描述被渲染过」时
  // 文件里根本没有那些行，只能看到 5 个 —— 而 visited 是在跑的时候对全部
  // 89 行算的。**截断的产物没法用来复核跑时算出来的数。**
  "── 播报全文 ──",
  ...lines,
];
const path = await writeReport("ingest-e2e-run.md", L.join("\n"));
console.log(
  `崩=${failure !== ""} 行=${lines.length} 决策=${decisions} 到过场景=${visited.size}/${mod.scenes.length}  -> ${path}`,
);
if (failure !== "") process.exit(1);
