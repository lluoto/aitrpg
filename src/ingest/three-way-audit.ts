// 摄取管线 · 三方比对——原文 ⟷ 生成物 ⟷ 手写基准。
//
// 背景：calibrate.ts 只做两方比对（基准 vs 生成物），差异分四类
// （changed/missing/extra/id-mismatch），但"基准有、生成物没有"这个形状
// 含义可以完全相反：
//   Scene.atmosphere（14 处）  原文【有】——文本已混在生成的 description 里
//                              （管线抽到了，塞进了错的字段）→ 漏抽
//   【共鸣特质】                原文【无】——18 个切片命中 0 → 臆造
//   prologue.lines             原文【无】但引擎需要 → 创作层
// 只有引入原文当第三方才能裁决。
//
// ⚠ 臆造与创作层的区别是【判断】，不能自动化——本文件只负责"原文里有没有
// 这段内容"这个可判定的事实，真正的分类（这是臆造还是刻意的创作层）落在
// 下面的显式登记名单里，照 end-narration-clue-reachability.test.ts 的
// KNOWN_UNREACHABLE 模式：名单内是已裁决的，名单外任何新的"原文无据"发现
// 都会让判据变红——让"无据"成为显式事实，不是靠人记得
// （barn-of-premier.ts:1317-1321「让不可达成为显式事实」同一个设计意图）。
//
// ⚠ 原文切片（tools/modules/raw/*.txt）是派生物，不进版本库
// （module/types.ts:76「切片是派生物且不进版本库，PDF 才是权威源」）。本地有、
// CI 可能没有——所有依赖切片的判据都要能在切片缺失时优雅降级：明确报
// "跳过"并告警，不能静默通过（那等于什么都没测，却显示成绿的）。

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export type ThreeWayVerdict = "fabrication" | "missing-extraction" | "creative-layer";

// ============================================================
// 原文语料读取
// ============================================================

/**
 * 原文切片文件清单——00_header + section_01..17，**不含 section_18**
 * （0 字节空壳，旧切分器 off-by-one 留下的，见血缘核对
 * docs/archive-world-model-2026-08.md:9-21）。
 */
const RAW_SECTION_FILES = [
  "00_header.txt",
  ...Array.from({ length: 17 }, (_, i) => `section_${String(i + 1).padStart(2, "0")}.txt`),
];

export type OriginalCorpusResult =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * 读取全部原文切片并拼成一份语料。任何一个文件缺失都整体判定不可用——
 * 不拼一份"缺了几页"的语料悄悄用，那样"原文没有"和"原文那几页刚好不在"
 * 会分不清，静默产出错误结论比明确报"没跑"更糟。
 */
export function readOriginalCorpus(rawDir: string = "tools/modules/raw"): OriginalCorpusResult {
  const parts: string[] = [];
  for (const name of RAW_SECTION_FILES) {
    const p = join(rawDir, name);
    if (!existsSync(p)) {
      return { ok: false, reason: `缺少切片文件：${p}（tools/ 不进版本库，本地/CI 环境可能没有）` };
    }
    parts.push(readFileSync(p, "utf8"));
  }
  return { ok: true, text: parts.join("\n") };
}

// ============================================================
// 归一化匹配
// ============================================================

/**
 * 归一化：去空白（含全角空格、PDF 抽取遗留的跳页换行/制表符）、去半角/
 * 全角连字符与破折号。
 *
 * ⚠ 这一步不能省——"米戈联络术"（生成物/游戏文案的写法）与"米-戈联络术"
 * （原文实际写法，section_11.txt:38）只差一个连字符，不做这层归一化会把
 * 一个纯粹的写法差异误判成"原文查无此词"，制造假阳性臆造。
 */
export function normalizeForMatch(s: string): string {
  return s.replace(/[\s\u3000]+/g, "").replace(/[-－—]/g, "");
}

/** 归一化后做子串检查：`term` 是否在 `corpusText` 里出现过 */
export function termAppearsInCorpus(term: string, corpusText: string): boolean {
  return normalizeForMatch(corpusText).includes(normalizeForMatch(term));
}

// ============================================================
// 方括号术语审计
// ============================================================

/**
 * 从源码文本里抽出所有方括号术语（去重）。只看**数据行**，跳过注释——
 * 注释是给开发者看的说明，不是玩家会读到的叙事正文，混进来会把"这里曾经
 * 有个标记常量【原文】"这种开发笔记也当成需要对原文负责的游戏文案。
 */
export function extractBracketTerms(sourceText: string): string[] {
  const seen = new Set<string>();
  for (const line of sourceText.split("\n")) {
    if (line.trim().startsWith("//")) continue;
    for (const m of line.matchAll(/【([^】]+)】/g)) seen.add(m[1]);
  }
  return [...seen];
}

// ============================================================
// 显式登记名单
// ============================================================

export interface FabricationEntry {
  term: string;
  location: string;
  note: string;
}

/**
 * 已确证"原文查无此词"的方括号术语——只收录确认无据的。能在原文查到的
 * （"原文"是注释产物、"救出"在 section_10.txt:62、"伎俩"在
 * section_14.txt:6、"米戈联络术"经归一化后对应原文"米-戈联络术"
 * section_11.txt:38）不是问题，不需要登记。
 *
 * 判据用法：对 barn-of-premier.ts 的每个方括号术语查原文，"查无此词"的
 * 集合必须与这份名单的 term 集合**精确相等**——名单外新冒出的"无据"发现
 * 会让判据变红，逼着人显式裁决它是臆造还是创作层，不能被悄悄漏过。
 */
export const FABRICATION_REGISTRY: FabricationEntry[] = [
  {
    term: "共鸣特质",
    location: "barn-of-premier.ts:1279",
    note: "米-戈对人类大脑「共鸣特质」感兴趣——18 个原文切片命中 0，无据。",
  },
  {
    term: "谢谢你们……",
    location: "barn-of-premier.ts:1280",
    note: "原文「谢谢」0 命中。",
  },
  {
    term: "谢谢你们……它不会回来了。",
    location: "barn-of-premier.ts:1453,1467",
    note: "同上一条的另一处措辞变体，原文「谢谢」同样 0 命中，不是同一处的写法差异，是两处独立的臆造台词。",
  },
  {
    term: "照顾好爱莉……",
    location: "barn-of-premier.ts:1460",
    note: "原文 section_14.txt:9 有「艾米丽或许会一辈子在下水道照顾爱莉」，但没有「照顾好」这个措辞——是不同的句子（叙述 vs 台词），不是写法差异，判定仍为无据。",
  },
];

// ============================================================
// 字段级"漏抽 vs 臆造"分类
// ============================================================

export interface FieldOmissionRule {
  /** 匹配 FieldDiff.path 的后缀——按字段名而不是逐场景硬编码，一条规则管住同类字段的全部出现 */
  fieldSuffix: string;
  verdict: ThreeWayVerdict;
  note: string;
}

/**
 * calibrate.ts 报出的 "missing"（基准有、生成物没有）差异里，哪些字段
 * 已经裁决过属于哪一类。目前只有 atmosphere 这一类已核实：某次真实摄取
 * 产出的生成 description（271 字，"特里坎家"）实测包含基准 atmosphere
 * 全文（70 字，见 barn-of-premier.ts:169）——管线确实抽到了这段内容，
 * 只是没有拆分成独立字段，不是无中生有。这与臆造的差异**形状相同**
 * （基准有、生成物没有）但**含义相反**，是这份判据要区分的关键测例。
 * 这次摄取产出本身是派生物（tools/ 不进版本库），可复核性靠
 * ingest-three-way-audit.test.ts 那份"缺失时跳过+告警"的判据，不靠
 * 这条注释指名道姓某个具体文件。
 */
export const FIELD_OMISSION_REGISTRY: FieldOmissionRule[] = [
  {
    fieldSuffix: ".atmosphere",
    verdict: "missing-extraction",
    note: "生成物的 description 字段包含基准 atmosphere 的全文（如「特里坎家」：生成 description 271 字，末尾即基准 atmosphere 70 字原样）——管线抽到了内容，只是没拆分成独立字段。",
  },
];

/** 按字段路径查表；没有登记规则时返回 null——不能自动裁决的字段不该被硬猜一个结论 */
export function classifyFieldOmission(fieldPath: string): ThreeWayVerdict | null {
  for (const rule of FIELD_OMISSION_REGISTRY) {
    if (fieldPath.endsWith(rule.fieldSuffix)) return rule.verdict;
  }
  return null;
}
