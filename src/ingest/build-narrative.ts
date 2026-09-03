// 摄取管线 · 创作层（todo-52）第一版。
//
// 【范围收窄，只产三样】openingAtmosphere / prologue / partySetup。
// 【不产】epilogues / narrative.entities——两者都要求生成端引用具体的
// 线索/场景 id（epilogues.condition.requiredClues、narrative.entities[]
// 的 sceneId 要能在 NPC 知识文本里对上），而这些 id 在同一次摄取里由
// build-clues.ts/build-scenes.ts 产出，是内部句柄（item_03 这类），
// 写 prompt 的时候 LLM 压根不知道这些 id 长什么样——硬让它编，编出来的
// 要么是不存在的 id（跑起来是死数据），要么是"看起来对但从没验证过"的
// 条件，比留空更危险。等有了更可靠的 id 传递+存在性校验机制再做，
// 不在本轮（与 build-clues.ts 当初不产 unlocks 同一种"手都不伸过去，
// 比伸过去猜错再修安全"的判断）。
//
// openingAtmosphere/prologue/partySetup 没有这个问题——纯粹的氛围/
// 情境文本，不需要引用任何内部 id，风险小得多。
//
// 三档约束（细节见 narrative-guard.ts 头部）本轮接两档：
//   第一档 findFabricatedTerms —— 挡新造专名/术语
//   第二档 findUnresolvedObjectMentions —— 挡"引擎教了玩家一个自己
//     不认识的词"（培养缸类 bug 的机器化版本）
//   另接 checkNarrationText（world-constraint.ts）—— 时代错置检查，
//     与 KP 叙事同一条约束层
// 第三档（语义蕴含扫描）不在这里——按 todo-52 的分工，那是开发期工具，
// 不进管线、不当门禁。
//
// 任何一档不合格，整批生成结果一律不采纳，留空并报 warning——创作层
// 的"允许编"不等于"编错了也认"。
//
// sourceRef 方案 C：本轮生成的都是纯创作（openingAtmosphere/prologue/
// partySetup 在这个模组里逐字核对过原文没有对应内容，见 todo-52），
// provenance 里 sourceRef 一律留空、by:"llm"，`findMissingCreativeSourceRef`
// /`findRegisteredCreativeLayer`（本文件）与 narration-provenance.ts 的
// `findMissingSourceRef`/`UNREVIEWED_NARRATION_REGISTRY` 同一个模式，
// 不发明新范式——区别只是这里没有一份能手写的静态"已知缺出处名单"
// （创作层每次生成的内容都不同），判据改成"每一条 by:llm 的 provenance
// 是否显式承认了无出处"，不是对照一张固定表。

import type { Provenance } from "../module/types";
import type { ChatLike } from "./infer-connections";
import { extractJson } from "../llm/json";
import { checkNarrationText } from "../world/world-constraint";
import {
  findFabricatedTerms,
  findUnresolvedObjectMentions,
  clueCandidatesForScene,
  type ObjectMentionClaim,
} from "./narrative-guard";

export interface NarrativeSceneInput {
  id: string;
  name: string;
  description: string;
  clues: { id: string; name: string; findMethods: { description: string }[] }[];
}

export interface BuildNarrativeInput {
  title: string;
  era: string;
  scenes: NarrativeSceneInput[];
}

export interface BuildNarrativeResult {
  openingAtmosphereByScene: Map<string, string>;
  prologueLines: string[];
  partySetup?: { context: string[]; hooks: string[]; closing: string[] };
  provenance: Provenance[];
  warnings: string[];
  /** 本轮是否真的产出了内容——全部被约束拦下/调用失败/解析失败时为 false */
  accepted: boolean;
}

interface RawOpening {
  sceneId?: unknown;
  text?: unknown;
  objectMentions?: unknown;
}

interface RawResponse {
  openingAtmosphere?: unknown;
  prologueLines?: unknown;
  partySetup?: unknown;
}

const CREATIVE_LAYER_MARKER = "创作层生成——原文没有对应内容，纯创作，无 sourceRef";

/**
 * 生成创作层内容。失败语义：任何一档约束不过、调用失败、JSON 解不出，
 * 整批不采纳（`accepted:false`，各字段留空）——与 `extract-endings.ts`
 * 同一种"出错就当没做"的语义，不半采纳、不挑着留一部分。
 */
export async function buildNarrative(
  input: BuildNarrativeInput,
  client: ChatLike,
  corpusText: string | undefined,
): Promise<BuildNarrativeResult> {
  const warnings: string[] = [];
  const empty = (): BuildNarrativeResult => ({
    openingAtmosphereByScene: new Map(),
    prologueLines: [],
    partySetup: undefined,
    provenance: [],
    warnings,
    accepted: false,
  });

  if (input.scenes.length === 0) {
    warnings.push("没有场景，创作层无从生成");
    return empty();
  }

  const scenesById = new Map(input.scenes.map((s) => [s.id, s]));
  const sceneList = input.scenes
    .map((s) => `${s.id} 【${s.name}】：${s.description.slice(0, 200).replace(/\s+/g, "")}`)
    .join("\n");

  const prompt = `你是一个 1920 年代克苏鲁的呼唤（CoC）跑团模组的编剧助手。
模组名：《${input.title}》，时代背景：${input.era}年。

下面是已经摄取出来的全部场景：
${sceneList}

请你创作三样东西：

1. openingAtmosphere（可选，逐场景）：为你认为合适的场景写一段
   "首次到访时、NPC 出场前"的简短氛围描写（1-3 句），继续场景描述里
   还没写完的动态（比如有人正在做什么、发生了什么小事）。不是每个
   场景都需要，觉得不合适就不写。

2. prologueLines：整个模组的开场白，3-6 句，用 {pl1_name}/{pl2_name}
   代表两名调查员的名字、{pl1_motive}/{pl2_motive} 代表他们各自的
   动机，这些占位符会在实际游玩时被替换，请原样保留。

3. partySetup：
   - context：2-3 句案件背景概述
   - hooks：2 句"调查员为什么会卷入这件事"，每句用 {name} 代表调查员
     名字、{occupation} 代表职业、{pronoun} 代表代词（不要写死"他"/
     "她"，因为调查员性别不定）
   - closing：1 句收束语，衔接到实际调查开始

严格规则：
- 如果你想引入一个原文没有明确给出、但你认为合理的专有名词或术语
  （比如某种超自然现象的名字），必须用【】标出来，例如【某某效应】——
  这不是禁止你写，是要求你老实标注"这是我补充的"。普通的环境描述词
  （阴冷、潮湿、破败）不用标。
- 如果 openingAtmosphere 的文本里明确指代了场景里的某个具体可交互物件
  （不是随口一提，是玩家读完会想去查看的那种），在该场景条目的
  objectMentions 里声明 {"phrase": "你用的称呼", "clueId": "线索id"}——
  没有就留空数组，不要为了填而硬凑。

只输出 JSON，不要任何解释。格式：
{"openingAtmosphere": [{"sceneId": "...", "text": "...", "objectMentions": [{"phrase":"...","clueId":"..."}]}],
 "prologueLines": ["...", ...],
 "partySetup": {"context": ["..."], "hooks": ["...", "..."], "closing": ["..."]}}`;

  let raw: string;
  try {
    raw = await client.chat([{ role: "user", content: prompt }], { temperature: 0.8 });
  } catch {
    warnings.push("LLM 调用失败，创作层本轮不产出");
    return empty();
  }

  let parsed: RawResponse | null;
  try {
    parsed = extractJson(raw) as RawResponse | null;
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== "object") {
    warnings.push("LLM 回复解不出 JSON，创作层本轮不产出");
    return empty();
  }

  // ── 收集全部生成文本 + 对象称呼声明 ──
  const openings: { sceneId: string; text: string; claims: ObjectMentionClaim[] }[] = [];
  if (Array.isArray(parsed.openingAtmosphere)) {
    for (const item of parsed.openingAtmosphere as RawOpening[]) {
      if (typeof item !== "object" || item === null) continue;
      const sceneId = typeof item.sceneId === "string" ? item.sceneId : "";
      const text = typeof item.text === "string" ? item.text.trim() : "";
      if (sceneId === "" || text === "") continue;
      if (!scenesById.has(sceneId)) {
        warnings.push(`openingAtmosphere 引用了不存在的场景 id「${sceneId}」，跳过（不猜挂到哪个场景）`);
        continue;
      }
      const claims: ObjectMentionClaim[] = Array.isArray(item.objectMentions)
        ? (item.objectMentions as unknown[])
            .filter(
              (m): m is { phrase: string; clueId: string } =>
                typeof m === "object" &&
                m !== null &&
                typeof (m as Record<string, unknown>).phrase === "string" &&
                typeof (m as Record<string, unknown>).clueId === "string",
            )
            .map((m) => ({ phrase: m.phrase, clueId: m.clueId }))
        : [];
      openings.push({ sceneId, text, claims });
    }
  }

  const prologueLines = Array.isArray(parsed.prologueLines)
    ? (parsed.prologueLines as unknown[]).filter((l): l is string => typeof l === "string" && l.trim() !== "")
    : [];

  let partySetup: { context: string[]; hooks: string[]; closing: string[] } | undefined;
  if (typeof parsed.partySetup === "object" && parsed.partySetup !== null) {
    const ps = parsed.partySetup as Record<string, unknown>;
    const strArr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
    partySetup = { context: strArr(ps.context), hooks: strArr(ps.hooks), closing: strArr(ps.closing) };
  }

  // ── 第一档：全部生成文本合并检查 ──
  const allText = [
    ...openings.map((o) => o.text),
    ...prologueLines,
    ...(partySetup ? [...partySetup.context, ...partySetup.hooks, ...partySetup.closing] : []),
  ].join("\n");

  if (corpusText !== undefined) {
    const fabricated = findFabricatedTerms(allText, corpusText);
    if (fabricated.length > 0) {
      warnings.push(
        `第一档拦下：生成文本里出现原文查无出处的术语 ${fabricated.map((t) => `【${t}】`).join("、")}，本轮整批不采纳`,
      );
      return empty();
    }
  } else {
    warnings.push("未提供原文语料，第一档（禁止新造专名/术语）本轮跳过——不是通过，是没查");
  }

  // ── 第二档：逐场景核对声明的对象称呼 ──
  for (const o of openings) {
    if (o.claims.length === 0) continue;
    const scene = scenesById.get(o.sceneId)!;
    const candidates = clueCandidatesForScene(scene.clues);
    const failed = findUnresolvedObjectMentions(o.claims, candidates);
    if (failed.length > 0) {
      warnings.push(
        `第二档拦下：场景「${scene.name}」的生成文本声明称呼 ${failed.map((f) => `「${f.phrase}」→${f.clueId}`).join("、")}，` +
          `但 decideClueMatch 认不出——这正是"培养缸"类 bug 的场景，本轮整批不采纳`,
      );
      return empty();
    }
  }

  // ── checkNarrationText（world-constraint.ts），与 KP 叙事同一条约束层 ──
  const narrationTexts: { text: string; sceneId?: string }[] = [
    ...openings.map((o) => ({ text: o.text, sceneId: o.sceneId })),
    ...prologueLines.map((l) => ({ text: l })),
    ...(partySetup ? [...partySetup.context, ...partySetup.hooks, ...partySetup.closing].map((l) => ({ text: l })) : []),
  ];
  for (const { text, sceneId } of narrationTexts) {
    const hit = checkNarrationText(text, { sceneId });
    if (hit) {
      warnings.push(`checkNarrationText 拦下一段生成文本（「${text.slice(0, 30)}…」），命中约束，本轮整批不采纳`);
      return empty();
    }
  }

  // ── 全部通过，组装结果 + provenance（scheme C：本轮全部无原文依据）──
  const provenance: Provenance[] = [];
  const openingAtmosphereByScene = new Map<string, string>();
  for (const o of openings) {
    openingAtmosphereByScene.set(o.sceneId, o.text);
    provenance.push({
      path: `scenes[${o.sceneId}].openingAtmosphere`,
      source: "",
      result: o.text,
      reason: CREATIVE_LAYER_MARKER,
      by: "llm",
    });
  }
  if (prologueLines.length > 0) {
    provenance.push({
      path: "prologue.lines",
      source: "",
      result: prologueLines.join(" / "),
      reason: CREATIVE_LAYER_MARKER,
      by: "llm",
    });
  }
  if (partySetup) {
    provenance.push({
      path: "partySetup",
      source: "",
      result: [...partySetup.context, ...partySetup.hooks, ...partySetup.closing].join(" / "),
      reason: CREATIVE_LAYER_MARKER,
      by: "llm",
    });
  }

  return { openingAtmosphereByScene, prologueLines, partySetup, provenance, warnings, accepted: true };
}

/**
 * 创作层字段缺 sourceRef 的集合——与 `narration-provenance.ts` 的
 * `findMissingSourceRef` 同一个模式，操作对象改成通用 `Provenance[]`。
 */
export function findMissingCreativeSourceRef(provenance: Provenance[]): string[] {
  return provenance.filter((p) => !p.sourceRef || p.sourceRef.trim() === "").map((p) => p.path);
}

/** 显式承认"这条是创作层、没有出处"的集合——判据要求与上面那个集合精确相等 */
export function findRegisteredCreativeLayer(provenance: Provenance[]): string[] {
  return provenance.filter((p) => p.by === "llm" && p.reason === CREATIVE_LAYER_MARKER).map((p) => p.path);
}
