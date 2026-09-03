// 摄取管线 · 对基准比对——开发·无基准模式 任务①。
//
// 背景：这份计算原来整段写死在 `scripts/ingest/run.ts` 里，直接读手写
// 基准模组与它配套的评分口径表这两个模块级常量——本仓目前只有这一份
// 手写基准，跑别的 PDF 时这段代码要么硬套一个不相干的基准（诊断信息
// 全是噪音），要么直接崩。抽出来做成"基准数据由调用方传入"的纯函数，
// 是让"有没有基准"从"写死在代码里"变成"运行时的一个值"——这份计算
// 本身不认得任何具体模组常量，只认得符合 `BaselineData` 形状的任何
// 数据，为将来真的接入第二本模组的基准留了口子（即使本轮没有）。
//
// id 继承（`inherit-ids.ts` 的 `computeIdInheritance`）与覆盖率/精确率/
// 分类准确率/calibrate diff 是两类不同的计算，但这里放在同一个函数里
// 一次算完——因为 `scenes`/`items` 在 id 继承之后才是"最终版本"，后面
// 那些覆盖率计算全都要用继承过 id 的版本，拆成两个函数只会让调用方
// 多背一层"先调 A 拿到 scenes/items，再把这两个值传给 B"的顺序耦合，
// 不比一个函数内部顺序执行更清楚。
//
// ⚠ 这个文件依然是"要花钱之后"的计算（读 clueProvenance/itemKinds 这些
// 分类结果），但本身不碰 IO——所有输入都是已经算好的内存数据，纯函数、
// 可单测，同 `calibrate.ts`/`inherit-ids.ts` 一个规矩。

import type { ModuleData, ModuleItem, Provenance, Scene } from "../module/types";
import type { ItemInput, ItemKind } from "./classify-items";
import { computeIdInheritance, applySceneIdInheritance, applyItemIdInheritance, applyClueIdInheritance, type IdInheritanceResult } from "./inherit-ids";
import { diffValues, type FieldDiff } from "./calibrate";

/**
 * 评分口径表条目在基准里实际是什么——与摄取管线自己的评分口径表（一份
 * 手建、绝不能进 prompt 的评分数据，那个模块的路径与导出常量名字面
 * 本身被一份边界判据结构性地禁止在测试之外的 src/ 文件里出现，本文件
 * 因此不直接 import 那个类型）结构一致。本文件按值传参数
 * （`BaselineData.scoringKey`），调用方传什么就是什么，这里不需要、
 * 也不该知道那份数据从哪来。
 */
export type BaselineActualKind =
  | { kind: "clue"; id: string }
  | { kind: "item"; id: string }
  | { kind: "connection" }
  | { kind: "npc_knowledge" }
  | { kind: "npc_secret" }
  | { kind: "event" }
  | { kind: "none" };

/** 一份可比对的基准——本仓目前只有一套（普瑞米尔的谷仓），但函数本身不认得任何具体模组，只认这个形状 */
export interface BaselineData {
  module: ModuleData;
  /** 评分键：sourceKey → 基准里实际是什么 */
  scoringKey: Record<string, BaselineActualKind[]>;
}

export interface KeyLhsStats {
  extractedCount: number;
  keyCount: number;
  /** 抽出来了但键里没有（不参与计分） */
  keyMissing: string[];
  /** 键里有但抽不出来（行号漂了？） */
  keyStale: string[];
  /** sourceKey 重复时的提示；没有重复则为 null */
  duplicateNote: string | null;
}

export interface ClueCoverageStats {
  scoringClueCount: number;
  clueHit: number;
  cluePrecisionHits: number;
  missedClueIds: string[];
}

export interface ItemCoverageStats {
  baseItemCount: number;
  itemHit: number;
  itemMatchingGenerated: number;
  extraItemNames: string[];
  missingBaseItemNames: string[];
}

export interface ScoredItemEntry {
  key: string;
  name: string;
  predicted: string;
  expected: string[];
  ok: boolean;
}

export interface ItemClassificationStats {
  correct: number;
  total: number;
  /** 键说 none 的：基准没收，任何标签都谈不上对错 */
  unscoreable: string[];
  /** 送去分类但评分键里没有的：不该发生 */
  notInKey: string[];
  confusion: Map<string, Map<string, number>>;
  scored: ScoredItemEntry[];
}

export interface SceneCoverageStats {
  baseSceneCount: number;
  /** 按 name 严格覆盖到的基准场景名 */
  hit: string[];
  /** 名字变体（基准多了手写括号注解） */
  variantPairs: string[];
  /** 真漏报（连去掉注解都对不上） */
  trueMissing: string[];
  /** 真误报（扣掉变体那侧） */
  trueExtraScenes: string[];
  /** 生成侧对上基准名字的个数（含重复） */
  sceneMatchingGenerated: number;
}

export interface BaselineComparisonResult {
  /** 已尝试继承基准 id 的最终版本——下游（assembleModule、落盘）都用这份 */
  scenes: Scene[];
  items: ModuleItem[];
  sceneIdInherit: IdInheritanceResult;
  itemIdInherit: IdInheritanceResult;
  clueIdInherit: IdInheritanceResult;
  keyLhs: KeyLhsStats;
  clueCoverage: ClueCoverageStats;
  itemCoverage: ItemCoverageStats;
  itemClassification: ItemClassificationStats;
  sceneCoverage: SceneCoverageStats;
  diffs: FieldDiff[];
}

export interface BaselineComparisonInput {
  rawScenes: Scene[];
  rawItems: ModuleItem[];
  /** 从 sections 抽出的全部 sourceKey（含重复，用来查重） */
  extractedKeys: string[];
  clueProvenance: Provenance[];
  clueCount: number;
  itemInputs: ItemInput[];
  itemKinds: Map<string, ItemKind>;
}

/** 把评分键的「实际是什么」翻成分类器的六个标签之一 */
function expectedLabels(kinds: BaselineActualKind[], baseline: ModuleData): string[] {
  const out: string[] = [];
  for (const k of kinds) {
    if (k.kind === "clue") out.push("clue");
    else if (k.kind === "item") {
      const it = baseline.items.find((i) => i.id === k.id);
      out.push(it?.type === "trap" ? "trap" : "item");
    } else if (k.kind === "connection") out.push("connection");
    else if (k.kind === "npc_knowledge" || k.kind === "npc_secret") out.push("npc_knowledge");
    else if (k.kind === "event") out.push("event");
  }
  return [...new Set(out)];
}

/** 去掉尾部的括号注解再比一次，用来把「名字变体」从真漏报里分出来 */
function stripAnno(s: string): string {
  return s.replace(/[（(][^）)]*[）)]\s*$/, "");
}

export function computeBaselineComparison(
  baseline: BaselineData,
  input: BaselineComparisonInput,
): BaselineComparisonResult {
  // ── 评分键左手边 ──
  const extractedSet = new Set(input.extractedKeys);
  const keySet = new Set(Object.keys(baseline.scoringKey));
  const keyMissing = [...extractedSet].filter((k) => !keySet.has(k));
  const keyStale = [...keySet].filter((k) => !extractedSet.has(k));
  const keyLhs: KeyLhsStats = {
    extractedCount: extractedSet.size,
    keyCount: keySet.size,
    keyMissing,
    keyStale,
    duplicateNote:
      input.extractedKeys.length !== extractedSet.size
        ? `sourceKey 有重复：${input.extractedKeys.length} 个条目只有 ${extractedSet.size} 个不同的键 —— assignItemIds 的 Map 会静默顶掉一个`
        : null,
  };

  // ── id 继承（场景 → 物品 → 线索，顺序不能换，见 inherit-ids.ts） ──
  const sceneIdInherit = computeIdInheritance(input.rawScenes, baseline.module.scenes, "场景");
  const itemIdInherit = computeIdInheritance(input.rawItems, baseline.module.items, "物品");
  const scenesWithSceneIds = applySceneIdInheritance(input.rawScenes, sceneIdInherit.idMap);
  const items = applyItemIdInheritance(input.rawItems, sceneIdInherit.idMap, itemIdInherit.idMap);

  const rawClues = scenesWithSceneIds.flatMap((s) => s.clues.map((c) => ({ id: c.id, name: c.name })));
  const baselineClues = baseline.module.scenes.flatMap((s) => s.clues.map((c) => ({ id: c.id, name: c.name })));
  const clueIdInherit = computeIdInheritance(rawClues, baselineClues, "线索");
  const scenes = applyClueIdInheritance(scenesWithSceneIds, clueIdInherit.idMap);

  // ── 线索覆盖率/精确率（拿评分键算） ──
  const scoringClueIds = new Set<string>();
  for (const entryKinds of Object.values(baseline.scoringKey)) {
    for (const k of entryKinds) if (k.kind === "clue") scoringClueIds.add(k.id);
  }
  const generatedClueKeys = new Set(
    input.clueProvenance.map((p) => p.sourceRef).filter((s): s is string => s !== undefined),
  );
  const coveredClueIds = new Set<string>();
  for (const [key, entryKinds] of Object.entries(baseline.scoringKey)) {
    if (!generatedClueKeys.has(key)) continue;
    for (const k of entryKinds) if (k.kind === "clue") coveredClueIds.add(k.id);
  }
  const missedClueIds = [...scoringClueIds].filter((id) => !coveredClueIds.has(id)).sort();
  const cluePrecisionHits = input.clueProvenance.filter((p) => {
    const entryKinds = p.sourceRef ? baseline.scoringKey[p.sourceRef] : undefined;
    return entryKinds?.some((k) => k.kind === "clue") ?? false;
  }).length;
  const clueCoverage: ClueCoverageStats = {
    scoringClueCount: scoringClueIds.size,
    clueHit: coveredClueIds.size,
    cluePrecisionHits,
    missedClueIds,
  };

  // ── 物品覆盖率/精确率 ──
  const baseItemNames = new Set(baseline.module.items.map((i) => i.name));
  const coveredBaseItems = new Set(items.map((i) => i.name).filter((n) => baseItemNames.has(n)));
  const itemMatchingGenerated = items.filter((i) => baseItemNames.has(i.name)).length;
  const itemCoverage: ItemCoverageStats = {
    baseItemCount: baseline.module.items.length,
    itemHit: coveredBaseItems.size,
    itemMatchingGenerated,
    extraItemNames: items.filter((i) => !baseItemNames.has(i.name)).map((i) => i.name),
    missingBaseItemNames: baseline.module.items.filter((i) => !items.some((g) => g.name === i.name)).map((i) => i.name),
  };

  // ── 条目分类准确率 ──
  const scored: ScoredItemEntry[] = [];
  const unscoreable: string[] = [];
  const notInKey: string[] = [];
  for (const inp of input.itemInputs) {
    const predicted = input.itemKinds.get(inp.key);
    if (predicted === undefined) continue;
    const actual = baseline.scoringKey[inp.key];
    if (actual === undefined) {
      notInKey.push(inp.key);
      continue;
    }
    const expected = expectedLabels(actual, baseline.module);
    if (expected.length === 0) {
      unscoreable.push(`${inp.key}${inp.name ? `(${inp.name})` : ""}`);
      continue;
    }
    scored.push({ key: inp.key, name: inp.name, predicted, expected, ok: expected.includes(predicted) });
  }
  const confusion = new Map<string, Map<string, number>>();
  for (const s of scored) {
    if (!confusion.has(s.predicted)) confusion.set(s.predicted, new Map());
    const inner = confusion.get(s.predicted) as Map<string, number>;
    const e = s.ok ? s.predicted : (s.expected[0] as string);
    inner.set(e, (inner.get(e) ?? 0) + 1);
  }
  const itemClassification: ItemClassificationStats = {
    correct: scored.filter((s) => s.ok).length,
    total: scored.length,
    unscoreable,
    notInKey,
    confusion,
    scored,
  };

  // ── 场景覆盖率 ──
  const baseNames = new Set(baseline.module.scenes.map((s) => s.name));
  const hit = [...new Set(scenes.map((s) => s.name).filter((n) => baseNames.has(n)))];
  const genNames = new Set(scenes.map((s) => s.name));
  const variantPairs = baseline.module.scenes
    .filter((b) => !genNames.has(b.name) && genNames.has(stripAnno(b.name)))
    .map((b) => `${b.name} ← ${stripAnno(b.name)}`);
  const trueMissing = baseline.module.scenes
    .filter((b) => !genNames.has(b.name) && !genNames.has(stripAnno(b.name)))
    .map((b) => b.name);
  const variantGenerated = new Set(
    baseline.module.scenes.filter((b) => !genNames.has(b.name) && genNames.has(stripAnno(b.name))).map((b) => stripAnno(b.name)),
  );
  const trueExtraScenes = scenes.filter((s) => !baseNames.has(s.name) && !variantGenerated.has(s.name)).map((s) => s.name);
  const sceneMatchingGenerated = scenes.filter((s) => baseNames.has(s.name) || variantGenerated.has(s.name)).length;
  const sceneCoverage: SceneCoverageStats = {
    baseSceneCount: baseline.module.scenes.length,
    hit,
    variantPairs,
    trueMissing,
    trueExtraScenes,
    sceneMatchingGenerated,
  };

  // ── calibrate diff（provenance 不进去，见 run.ts 原注释：那是生成过程留痕，基准手写永远没有） ──
  const candidate = { ...baseline.module, scenes, items };
  const diffs = diffValues(baseline.module, candidate, { pairBy: ["id", "name"], refFields: ["sceneId"] });

  return {
    scenes,
    items,
    sceneIdInherit,
    itemIdInherit,
    clueIdInherit,
    keyLhs,
    clueCoverage,
    itemCoverage,
    itemClassification,
    sceneCoverage,
    diffs,
  };
}
