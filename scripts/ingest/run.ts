// 摄取管线实跑：PDF → 清洗 → 切分 → 分类 → 场景骨架 → 对基准 diff。
//
// 所有 IO 集中在这里。src/ingest/ 那几个模块保持无 IO 才能被纯逻辑单测，
// 逻辑不要往这里搬。
//
// ⚠ 这个文件原先是 `tools/_run-ingest.ts`，而 `tools/` 在 .gitignore 里。
//   后果：`src/ingest/*` 六个模块 800 多行、16 个测试文件，**唯一的入口不在仓库中** ——
//   新克隆下来根本跑不起来，扫依赖图看到的是「整个子系统没人调用」。
//   （上一轮把 `tools/_diag-*.ts` 搬进 `scripts/diag/` 时漏了这一个。）
//
//   顺带：PDF 路径原先硬编码成某台机器上的绝对路径，也是「只有我这儿能跑」。
//   现在从命令行/环境变量取。
//
// 用法：
//   bun scripts/ingest/run.ts <模组 PDF 路径>
//   INGEST_PDF=... bun scripts/ingest/run.ts

import { readFileSync } from "fs";
import { loadConfig } from "../../src/config";
import { LLMClient } from "../../src/llm/client";
import type { ChatOptions, Message } from "../../src/llm/client";
import { extractPages } from "../../src/ingest/pdf-source";

import { sourceKey } from "../../src/ingest/sectionize";
import { prepareSections, classifyAndBuild } from "../../src/ingest/pipeline";
import { assembleModule } from "../../src/ingest/assemble-module";
import { diffValues, formatDiff } from "../../src/ingest/calibrate";
import { computeIdInheritance, applySceneIdInheritance, applyItemIdInheritance, applyClueIdInheritance } from "../../src/ingest/inherit-ids";
import { BARN_OF_PREMIER } from "../../src/module/barn-of-premier";
// 评分键在这里**只用来对左手边**（键名 vs 实际抽出的 sourceKey），下面那段检查是它唯一的用处。
// 它绝不能进任何 prompt：本文件同时也是拼 prompt 的地方（classify-sections / classify-items），
// 白名单管得住谁能 import，管不住 import 进来往哪儿传。约定是：
// **只在分类返回之后读，绝不进 toClassifyInputs / toItemInputs 的任何参数。**
// 见 src/__tests__/ingest-scoring-key-boundary.test.ts 的 RUNNER_KEY_ALLOWLIST。
import { ENTRY_SCORING_KEY, type ActualKind } from "../../src/ingest/scoring-key";

// 硬编码绝对路径 = 只有作者那台机器能跑。缺参数就说清楚要什么，别拿一条
// ENOENT 让人猜。
const PDF = process.argv[2] ?? process.env.INGEST_PDF ?? "";
if (!PDF) {
  console.error("用法：bun scripts/ingest/run.ts <模组 PDF 路径>（或设 INGEST_PDF）");
  process.exit(2);
}
// 产物落 analysis/（已 gitignore），与其余诊断产物同一个去处；tools/ 不再参与。
const OUT = "analysis/ingest";

/**
 * 录下每一次 prompt 与原始回复。
 *
 * classify* 只交出解析后的 Map，解析不出来时它是空的 —— 空表既可能是
 * 模型没答，也可能是键归一化又出问题（上一轮 `【农场外围】` 就把 43 条全卡掉了）。
 * 两者从空表上分不出来，而重发一次去看又要多烧一次调用还未必复现同一个回复。
 * 所以在同一次调用上把原文截下来，事后照着看，不猜。
 *
 * 用继承而不是塞一个同形状的对象：LLMClient 有私有字段，结构类型对不上。
 *
 * 存成列表而不是单组字段：本轮有两次调用（块分类、条目分类），
 * 单组字段会让后一次把前一次的原始回复覆盖掉 —— 而那正是唯一的证据。
 */
interface Recorded {
  label: string;
  prompt: string;
  raw: string;
  ms: number;
}

class RecordingClient extends LLMClient {
  calls: Recorded[] = [];
  /** 下一次调用记在哪个名下，调用前设 */
  label = "(未命名)";

  override async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const rec: Recorded = {
      label: this.label,
      prompt: messages.map((m) => `[${m.role}]\n${m.content}`).join("\n\n"),
      raw: "",
      ms: 0,
    };
    this.calls.push(rec);
    const t0 = Date.now();
    try {
      const reply = await super.chat(messages, options);
      rec.raw = reply;
      return reply;
    } catch (e) {
      rec.raw = `<<调用抛错>> ${e instanceof Error ? e.message : String(e)}`;
      throw e;
    } finally {
      rec.ms = Date.now() - t0;
    }
  }
}

// 只在这里碰 IO：读 PDF、写产物。清洗、切分、分类、建场景建物品的顺序
// 全在 `src/ingest/pipeline.ts` 里 —— 那些是编排，属于版本库，
// 不属于这个 gitignore 掉的脚本。本文件只剩 IO 与度量。
//
// 分两步调而不是一把 runIngest：确定性的那半（切分）先跑完，
// 好让下面那段评分键检查赶在掏钱之前。
const raw = await extractPages(new Uint8Array(readFileSync(PDF)));
const sections = prepareSections(raw);

/**
 * 评分键的**左手边**对不对得上。
 *
 * 单测只验了键名的形态（`/^p\d+:L\d+$/`），没验存在性 —— `"p99:L99"` 照样过。
 * 而键自己的文件头就写着：那个行号是**清洗后**的，「清洗逻辑一变行号就漂」。
 * 漂一行，那条就永远配不上任何条目：它既不报错也不报红，只是从此不参与计分，
 * 指标悄悄变差一点，看的人会以为是模型退步了。
 * 这与「引用的 clue/item id 都能在基准里找到」防的是同一种失效，只是在映射的另一半上，
 * 而那一半先前完全没人看。
 *
 * 为什么不进单测：它需要 PDF，而 PDF 在仓库之外。同 `pdf-source` 的内容保真一样，
 * 「要外部文件才能验的」归实跑器报，不进单测 —— 单测里塞一个读绝对路径的用例，
 * 换台机器就红，最后被删掉。
 *
 * 放在 LLM 调用**之前**：这段检查是确定性的、不花钱，没有理由让它等在一次可能失败的网络调用后面。
 */
const extractedKeys = sections.flatMap((s) => s.items.map((it) => sourceKey(it.source)));
const extractedSet = new Set(extractedKeys);
const keySet = new Set(Object.keys(ENTRY_SCORING_KEY));
/** 抽出来了但键里没标 —— 这条目不参与计分 */
const keyMissing = [...extractedSet].filter((k) => !keySet.has(k));
/** 键里标了但抽不出来 —— 多半是行号漂了，这条标注成了死字 */
const keyStale = [...keySet].filter((k) => !extractedSet.has(k));
// 两个方向都印。只印一个方向的话，「漂了一行」会表现成一进一出，
// 而单看任何一侧都像是「少了一条」，看不出是同一条挪了位置。
const keyLhsLines = [
  `评分键左手边: 抽出条目 ${extractedSet.size} / 键 ${keySet.size} —— ${keyMissing.length === 0 && keyStale.length === 0 ? "**完全一致**" : "**对不上**"}`,
  `  抽出来了但键里没有（不参与计分）${keyMissing.length} 个: ${keyMissing.join("、") || "无"}`,
  `  键里有但抽不出来（行号漂了？）${keyStale.length} 个: ${keyStale.join("、") || "无"}`,
];
if (extractedKeys.length !== extractedSet.size) {
  keyLhsLines.push(`  **sourceKey 有重复**：${extractedKeys.length} 个条目只有 ${extractedSet.size} 个不同的键 —— assignItemIds 的 Map 会静默顶掉一个`);
}

const client = new RecordingClient(loadConfig());
// 阶段标签由编排层报过来，录制这边照着分组。
// 编排层不该知道有人在录 prompt，所以是回调不是依赖。
const {
  classifyInputs: inputs,
  kinds,
  scenes: rawScenes,
  sceneWarnings: warnings,
  itemInputs,
  itemKinds,
  itemIds,
  items: rawItems,
  provenance,
  itemWarnings,
  clueCount,
  clueProvenance,
  clueWarnings,
  endings,
} = await classifyAndBuild(sections, client, {
  onStage: (label) => {
    client.label = label;
  },
});

/**
 * 管线继承基准 id（开发·管线继承基准 id，对应 todo-48）：把 rawScenes/
 * rawItems 里的内部句柄（scene_NN/item_NN）按 name 换成基准的手写 id，
 * 换完之后 `scenes`/`items` 这两个名字在本文件剩余部分指的都是"已继承
 * 过 id"的版本——下游所有读 scenes/items 的地方（校准 diff、落盘产物、
 * assembleModule）不需要各自记得再做一遍替换。
 *
 * 配不上基准 name 的，`compute*` 已经把内部 id 保留在结果里、把理由写进
 * warnings——这里只管把 warnings 并入 report.txt，不在这一步做任何
 * "看起来更完整"的兜底。
 */
const sceneIdInherit = computeIdInheritance(rawScenes, BARN_OF_PREMIER.scenes, "场景");
const itemIdInherit = computeIdInheritance(rawItems, BARN_OF_PREMIER.items, "物品");
const scenesWithSceneIds = applySceneIdInheritance(rawScenes, sceneIdInherit.idMap);
const items = applyItemIdInheritance(rawItems, sceneIdInherit.idMap, itemIdInherit.idMap);

// 线索挂在 Scene.clues[] 里，不是顶层数组——继承基准 id 要多一步：先把
// 候选线索（此时 sceneId 已经不重要，只按线索自己的 name 配）与基准的
// 嵌套线索表（BARN_OF_PREMIER.scenes 里各场景的 clues）都拍平成
// {id,name}[]，再和场景/物品同一个函数配对。
const rawClues = scenesWithSceneIds.flatMap((s) => s.clues.map((c) => ({ id: c.id, name: c.name })));
const baselineClues = BARN_OF_PREMIER.scenes.flatMap((s) => s.clues.map((c) => ({ id: c.id, name: c.name })));
const clueIdInherit = computeIdInheritance(rawClues, baselineClues, "线索");
const scenes = applyClueIdInheritance(scenesWithSceneIds, clueIdInherit.idMap);

// ── 线索覆盖率/精确率（拿评分键算，todo-28：build-clues 的产出第一次
// 能被量出来） ──
//
// scoring-key 给的是 sourceKey → 基准对象的位置级 ground truth，比按
// name 配对更可靠（不依赖生成的线索名恰好和基准写法一致）。一个
// sourceKey 可能对应基准里不止一条线索（p5:L17 一条条目正文同时命中
// 两条基准线索），"这个位置产出了线索"就该把它对应的全部基准 clue id
// 都算覆盖到，不是只算一个——否则会把一对多的情形错记成只覆盖了一条。
//
// ⚠️ 评分键只在这里、分类结果已经产出之后读，不进任何 prompt——
// 与下面条目分类那段同一条约定，ingest-scoring-key-boundary.test.ts
// 结构性地拦着这件事。
const scoringClueIds = new Set<string>();
for (const entryKinds of Object.values(ENTRY_SCORING_KEY)) {
  for (const k of entryKinds) if (k.kind === "clue") scoringClueIds.add(k.id);
}
const generatedClueKeys = new Set(
  clueProvenance.map((p) => p.sourceRef).filter((s): s is string => s !== undefined),
);
const coveredClueIds = new Set<string>();
for (const [key, entryKinds] of Object.entries(ENTRY_SCORING_KEY)) {
  if (!generatedClueKeys.has(key)) continue;
  for (const k of entryKinds) if (k.kind === "clue") coveredClueIds.add(k.id);
}
const clueHit = coveredClueIds.size;
const missedClueIds = [...scoringClueIds].filter((id) => !coveredClueIds.has(id)).sort();
// 精确率：生成的线索里，有几条的 sourceKey 在评分键里确实标记为 clue（分子用这个，
// 不用「生成了多少条」——道理与物品精确率同一条：分子该是「真的对上基准的」。
const cluePrecisionHits = clueProvenance.filter((p) => {
  const entryKinds = p.sourceRef ? ENTRY_SCORING_KEY[p.sourceRef] : undefined;
  return entryKinds?.some((k) => k.kind === "clue") ?? false;
}).length;

const baseItemNames = new Set(BARN_OF_PREMIER.items.map((i) => i.name));

// 命中数要数「被覆盖的基准物品个数」，不是「匹配上的生成物品个数」。
// 两者不等：`驾驶证` 在 PDF 的证物室和交火现场各写了一次，基准只收了一个，
// 按生成侧数会把同一个基准名字数两遍 —— 第一次跑就这么报出了 10/10，
// 而同一份报告里还写着「基准里没被生成出来的: 黑色钱包」，自相矛盾。
// 度量工具报出比理论上限更好的数字，是这套东西最不能有的失败方向。
const coveredBaseItems = new Set(items.map((i) => i.name).filter((n) => baseItemNames.has(n)));
const itemHit = coveredBaseItems.size;
/** 生成侧有几个能对上基准名字（含重复），拿来和 itemHit 一起看才知道有没有重名 */
const itemMatchingGenerated = items.filter((i) => baseItemNames.has(i.name)).length;

const itemDist = new Map<string, number>();
for (const v of itemKinds.values()) itemDist.set(v, (itemDist.get(v) ?? 0) + 1);
const itemUnanswered = itemInputs.filter((i) => !itemKinds.has(i.key)).map((i) => `${i.key}${i.name ? `(${i.name})` : ""}`);

// ══════════════════════════════════════════════════════════════════════
// 条目分类的真实准确率（拿评分键算）
//
// ⚠️ 评分键**只在分类返回之后**读，绝不进 toClassifyInputs / toItemInputs 的任何参数。
//    把基准答案喂给模型，测出来的数不说明任何事。
//    这条是约定不是保证 —— boundary test 的白名单注释里写明了这一点。
//
// 在有键之前，只能拿「生成物品的名字对不对得上基准」间接推准确率，
// 而那条路只覆盖 43% 的条目（57% 的条目名在基准里根本不存在或本身无名）。
// ══════════════════════════════════════════════════════════════════════

/** 把评分键的「实际是什么」翻成分类器的六个标签之一 */
function expectedLabels(kinds: ActualKind[]): string[] {
  const out: string[] = [];
  for (const k of kinds) {
    if (k.kind === "clue") out.push("clue");
    else if (k.kind === "item") {
      // 陷阱在基准里是 ModuleItem.type="trap"，而分类器的标签是 trap。
      // 不解析这一层的话，4 个陷阱条目（10% 的样本）会把正确答案算成错。
      const it = BARN_OF_PREMIER.items.find((i) => i.id === k.id);
      out.push(it?.type === "trap" ? "trap" : "item");
    } else if (k.kind === "connection") out.push("connection");
    else if (k.kind === "npc_knowledge" || k.kind === "npc_secret") out.push("npc_knowledge");
    else if (k.kind === "event") out.push("event");
    // none 不产出期望标签 —— 基准没收这一条，没有「正确答案」可言
  }
  return [...new Set(out)];
}

interface Scored {
  key: string;
  name: string;
  predicted: string;
  expected: string[];
  ok: boolean;
}

const scored: Scored[] = [];
/** 键说 none 的：基准没收，任何标签都谈不上对错，单独放不进准确率 */
const unscoreable: string[] = [];
/** 送去分类但键里没有的：不该发生，`评分键左手边` 那一项已经在管 */
const notInKey: string[] = [];

for (const inp of itemInputs) {
  const predicted = itemKinds.get(inp.key);
  if (predicted === undefined) continue; // 模型没答，itemUnanswered 已经在报
  const actual = ENTRY_SCORING_KEY[inp.key];
  if (actual === undefined) {
    notInKey.push(inp.key);
    continue;
  }
  const expected = expectedLabels(actual);
  if (expected.length === 0) {
    unscoreable.push(`${inp.key}${inp.name ? `(${inp.name})` : ""}`);
    continue;
  }
  scored.push({ key: inp.key, name: inp.name, predicted, expected, ok: expected.includes(predicted) });
}

const correct = scored.filter((s) => s.ok).length;
/**
 * 混淆矩阵：预测 → 期望。
 *
 * 答对的一律记在对角线上，即便它的期望是多标签。
 * 第一版无脑取 `expected[0]`，于是 p12:L6（老旧文件，基准里同时是 Clue 与 ModuleItem）
 * 分类器答 item 明明算对，却落进了 `item→clue` 那一格 —— 矩阵与准确率对不上，
 * 读的人会数出比实际多一个的错误。矩阵必须和判定用同一套口径。
 */
const confusion = new Map<string, Map<string, number>>();
for (const s of scored) {
  if (!confusion.has(s.predicted)) confusion.set(s.predicted, new Map());
  const inner = confusion.get(s.predicted) as Map<string, number>;
  const e = s.ok ? s.predicted : (s.expected[0] as string);
  inner.set(e, (inner.get(e) ?? 0) + 1);
}

// 候选产物：只有 scenes 换成生成的，其余顶层字段沿用基准。
// 这样 diff 里只剩本轮该负责的部分 —— npcs/items/endings 尚未开工，
// 让它们整片报 missing 只会把 scenes 内部的真实差异淹掉。
// 下一轮的路线图仍然看得见：生成场景的 clues/npcIds/connections 是空的，
// 会逐条报成 scenes[卧室].clues[clue_bedroom_diary] 这样的 missing。
//
// provenance 不进被 diff 的那份：它是生成过程的留痕，不是模组内容，
// 而基准是手写的、永远不会有。塞进去只会凭空多出十几条 extra，
// 把真正的差异淹掉。它单独落一份文件，criterion 4 靠那份文件验。
const candidate = { ...BARN_OF_PREMIER, scenes, items };
const diffs = diffValues(BARN_OF_PREMIER, candidate, {
  pairBy: ["id", "name"],
  refFields: ["sceneId"],
});

// 基准 20 个场景里，按 name 配上的有几个。
//
// 同物品那边一样，要数「被覆盖的基准场景个数」而不是「匹配上的生成场景个数」。
//
// 另外要单列一类：基准有三个名字带手写括号注解（`农场外围（陷阱区）`），PDF 标题里没有。
// 严格按 name 比，它们既进「漏报」又让对应的生成场景进「误报」，同一件事被算两遍，
// 报告于是自相矛盾 —— 一边说 farm_periphery 没生成出来，一边把三个陷阱挂在它上面。
const baseNames = new Set(BARN_OF_PREMIER.scenes.map((s) => s.name));
const hit = [...new Set(scenes.map((s) => s.name).filter((n) => baseNames.has(n)))];

/** 去掉尾部的括号注解再比一次，用来把「名字变体」从真漏报里分出来 */
const stripAnno = (s: string) => s.replace(/[（(][^）)]*[）)]\s*$/, "");
const genNames = new Set(scenes.map((s) => s.name));
const variantPairs = BARN_OF_PREMIER.scenes
  .filter((b) => !genNames.has(b.name) && genNames.has(stripAnno(b.name)))
  .map((b) => `${b.name} ← ${stripAnno(b.name)}`);
const trueMissing = BARN_OF_PREMIER.scenes
  .filter((b) => !genNames.has(b.name) && !genNames.has(stripAnno(b.name)))
  .map((b) => b.name);
const variantGenerated = new Set(
  BARN_OF_PREMIER.scenes.filter((b) => !genNames.has(b.name) && genNames.has(stripAnno(b.name))).map((b) => stripAnno(b.name)),
);
const trueExtraScenes = scenes
  .filter((s) => !baseNames.has(s.name) && !variantGenerated.has(s.name))
  .map((s) => s.name);

/**
 * 生成侧有几个能对上基准名字（含重复）。
 *
 * 物品那边一开始就是漏了这一项才报出 10/10 的：只数 distinct，两个生成场景共用一个标题时
 * 会在「严格覆盖」里算一次、在「真误报」里算零次，两边同时消失，而「判成场景」照旧变大。
 * 这里把它印出来，好让 覆盖 + 误报 = 生成 这条恒等式当场可验。
 * 隐患不是假想的：build-scenes 专门为重名标题报 warning，calibrate 的 bucketBy 也是为它写的。
 */
const sceneMatchingGenerated = scenes.filter((s) => baseNames.has(s.name) || variantGenerated.has(s.name)).length;

/**
 * 悬空引用检查。
 *
 * `item.sceneId` 指向场景 id，而 refFields 把这类差异归成 ref-mismatch、文档里又说那是
 * 「预期内的噪音，读的人会略过」。两条加在一起，一个挂错场景的物品与挂对的物品
 * 输出一模一样 —— 没有任何数字能反映它。
 *
 * 不在比对前解析引用（那会动被比的数据，spec 已否掉过），只在事后断言：
 * 每个 item.sceneId 都得在 scenes 里找得到。
 */
const sceneIdSet = new Set(scenes.map((s) => s.id));
const danglingRefs = items.filter((i) => !sceneIdSet.has(i.sceneId)).map((i) => `${i.id}(${i.name}) → ${i.sceneId}`);

// 分类分布 + 送了却没回结果的标题：命中数偏低时先看这两项，再谈模型好坏
const dist = new Map<string, number>();
for (const v of kinds.values()) dist.set(v, (dist.get(v) ?? 0) + 1);
const unanswered = inputs.filter((s) => !kinds.has(s.title)).map((s) => s.title);

await Bun.write(`${OUT}/scenes.json`, JSON.stringify(scenes, null, 2));

await Bun.write(
  `${OUT}/id-name.txt`,
  ["id ↔ name 对照表", "", ...scenes.map((s) => `${s.id}\t${s.name}`)].join("\n"),
);

await Bun.write(`${OUT}/items.json`, JSON.stringify(items, null, 2));
await Bun.write(`${OUT}/provenance.json`, JSON.stringify(provenance, null, 2));

// 装配成一个完整 ModuleData 并落盘。
// 这是摄取产物第一次变成运行时能直接吃的东西 —— 在这之前
// scenes.json / items.json 都只是零件，runModule 吃不了。
const assembled = assembleModule(
  { sections, kinds, scenes, items, provenance, endings },
  { id: "barn-of-premier-ingested", title: "普瑞米尔的谷仓（摄取）" },
);
await Bun.write(`${OUT}/module.json`, JSON.stringify(assembled.module, null, 2));
await Bun.write(
  `${OUT}/module-gaps.txt`,
  [
    "装配成 ModuleData 时的缺口 —— 每一条都是「原文里没抽到，留空了」，",
    "不是 bug，是摄取还没做到那儿。填假值比留空更糟，所以一律留空。",
    "",
    ...assembled.warnings.map((w) => `· ${w}`),
  ].join("\n"),
);

await Bun.write(
  `${OUT}/item-kinds.txt`,
  [
    "条目分类逐条结果（键 → 类别 / 场景 / 名字）",
    "",
    ...itemInputs.map(
      (i) => `${i.key}\t${itemKinds.get(i.key) ?? "(未返回)"}\t${i.sceneTitle}\t${i.name || "(无名)"}`,
    ),
  ].join("\n"),
);

// 原始回复单独落一份：报告里要贴的就是它，也是「模型到底答没答」的唯一证据
await Bun.write(
  `${OUT}/classify-raw.txt`,
  client.calls
    .flatMap((c) => [
      `=== ${c.label} ===`,
      `耗时 ${c.ms}ms / 回复长度 ${c.raw.length} 字符`,
      "",
      "--- 原始回复 ---",
      c.raw,
      "",
      "--- prompt ---",
      c.prompt,
      "",
    ])
    .join("\n"),
);

await Bun.write(
  `${OUT}/report.txt`,
  [
    ...keyLhsLines,
    "",
    // 页数用解码出来的原始页数。清洗与接跨页断句都不改变页数（实测 2→2、3→3），
    // 而且「PDF 有几页」本来就比「清洗后有几页」更是人想知道的那个数。
    `页数 ${raw.length} / 块 ${sections.length} / 送分类 ${inputs.length} / 分类返回 ${kinds.size}`,
    `分类分布: ${[...dist].map(([k, n]) => `${k} ${n}`).join(" / ") || "无"}`,
    `送了但没拿到分类的块: ${unanswered.join("、") || "无"}`,
    `判成场景 ${scenes.length} 个`,
    `基准 ${BARN_OF_PREMIER.scenes.length} 个场景，**按 name 严格覆盖 ${hit.length}**`,
    `名字变体（基准多了手写括号注解，实际是同一个场景）${variantPairs.length} 个: ${variantPairs.join("、") || "无"}`,
    `**按场景身份覆盖 ${hit.length + variantPairs.length}** —— 严格覆盖加上变体`,
    `真漏报（连去掉注解都对不上）: ${trueMissing.join("、") || "无"}`,
    `真误报（扣掉变体那侧）${trueExtraScenes.length} 个: ${trueExtraScenes.join("、") || "无"}`,
    `对账: 覆盖 ${hit.length + variantPairs.length} + 真误报 ${trueExtraScenes.length} = ${hit.length + variantPairs.length + trueExtraScenes.length}，判成场景 ${scenes.length}${hit.length + variantPairs.length + trueExtraScenes.length === scenes.length ? "，对上了" : "，**对不上——有重名标题被两边同时吃掉**"}（生成侧对上基准名字的 ${sceneMatchingGenerated} 个）`,
    "",
    "scene warnings:",
    ...warnings.map((w) => `  ${w}`),
    "",
    `场景 id 继承基准：${sceneIdInherit.idMap.size}/${rawScenes.length} 继承成功，${sceneIdInherit.warnings.length} 个保留内部 id（不是错误，是如实报出的已知缺口）`,
    ...sceneIdInherit.warnings.map((w) => `  ${w}`),
    "",
    "── 条目与物品 ──",
    `条目 ${itemInputs.length} 送分类 / 分类返回 ${itemKinds.size}（全文共 ${itemIds.size} 个 ▶，其余不在场景块上）`,
    `条目分类分布: ${[...itemDist].map(([k, n]) => `${k} ${n}`).join(" / ") || "无"}`,
    "",
    `── 条目分类准确率（拿评分键算，第一次能算全）──`,
    `**${correct}/${scored.length}**（${((correct / Math.max(scored.length, 1)) * 100).toFixed(0)}%）`,
    `  不计分 ${unscoreable.length} 条（键说 none —— 基准没收，无所谓对错）: ${unscoreable.join("、") || "无"}`,
    ...(notInKey.length ? [`  **送了分类但键里没有 ${notInKey.length} 条**: ${notInKey.join("、")}`] : []),
    "",
    "  混淆矩阵（预测 → 期望）:",
    ...[...confusion]
      .sort()
      .flatMap(([pred, inner]) => {
        const tot = [...inner.values()].reduce((a, b) => a + b, 0);
        return [
          `    判为 ${pred}（${tot}）:`,
          ...[...inner]
            .sort((a, b) => b[1] - a[1])
            .map(([exp, n]) => `        → 实际 ${exp} ${n}${exp === pred ? "  ✓" : ""}`),
        ];
      }),
    "",
    "  判错的逐条:",
    ...scored
      .filter((s) => !s.ok)
      .map((s) => `    ${s.key} 判 ${s.predicted} / 实际 ${s.expected.join("+")} — ${s.name || "（无名）"}`),
    `送了但没拿到分类的条目: ${itemUnanswered.join("、") || "无"}`,
    `建成物品 ${items.length} 个，provenance ${provenance.length} 条`,
    `基准 ${BARN_OF_PREMIER.items.length} 个物品，**按 name 覆盖 ${itemHit}**（上限 9，黑色钱包无 ▶ 锚点）`,
    `其中生成侧有 ${itemMatchingGenerated} 个能对上基准名字 —— 比覆盖数多出的就是 PDF 里重复写了的（如 驾驶证）`,
    `**精确率 ${itemHit}/${items.length}** —— 分子用覆盖数不用匹配数，重复写的那份不该算进真阳`,
    `误报（生成了但基准里不是 ModuleItem）${items.filter((i) => !baseItemNames.has(i.name)).length} 个: ${items.filter((i) => !baseItemNames.has(i.name)).map((i) => i.name).join("、") || "无"}`,
    `基准里没被生成出来的: ${BARN_OF_PREMIER.items.filter((i) => !items.some((g) => g.name === i.name)).map((i) => i.name).join("、") || "无"}`,
    "",
    "item warnings:",
    ...itemWarnings.map((w) => `  ${w}`),
    "",
    `物品 id 继承基准：${itemIdInherit.idMap.size}/${rawItems.length} 继承成功，${itemIdInherit.warnings.length} 个保留内部 id（不是错误，是如实报出的已知缺口）`,
    ...itemIdInherit.warnings.map((w) => `  ${w}`),
    "",
    "── 线索（todo-28：build-clues 第一次产出，第一版数字，不要为了好看去调 prompt）──",
    `产出 ${clueCount} 条线索，provenance ${clueProvenance.length} 条`,
    `基准 ${scoringClueIds.size} 条线索有评分键坐标（评分键覆盖 41 处 sourceKey，含一对多），**按评分键坐标覆盖 ${clueHit}**`,
    `**精确率 ${cluePrecisionHits}/${clueCount}**——分子是"这条线索的 sourceKey 在评分键里确实标记为 clue"的条数`,
    `漏掉的基准线索 ${missedClueIds.length} 个: ${missedClueIds.join("、") || "无"}`,
    "",
    "clue warnings:",
    ...clueWarnings.map((w) => `  ${w}`),
    "",
    `线索 id 继承基准：${clueIdInherit.idMap.size}/${rawClues.length} 继承成功，${clueIdInherit.warnings.length} 个保留内部 id（不是错误，是如实报出的已知缺口）`,
    ...clueIdInherit.warnings.map((w) => `  ${w}`),
    "",
    `悬空引用（item.sceneId 在生成的 scenes 里找不到）${danglingRefs.length} 个: ${danglingRefs.join("、") || "无"}`,
    `  —— 这一项没有任何 diff 能反映：refFields 把 sceneId 的差异归成 ref-mismatch，`,
    `     而那被当成预期噪音，挂错场景与挂对场景的输出长得一样。所以单独查。`,
    "",
    formatDiff(diffs),
  ].join("\n"),
);

console.log(keyLhsLines.join("\n"));
console.log(
  `场景 严格 ${hit.length} + 变体 ${variantPairs.length} = 身份覆盖 ${hit.length + variantPairs.length}/${BARN_OF_PREMIER.scenes.length}；` +
    `物品覆盖 ${itemHit}/${BARN_OF_PREMIER.items.length}，精确率 ${itemHit}/${items.length}，产物在 ${OUT}/`,
);
