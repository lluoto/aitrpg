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
//
// ── 第一版实测（2026-09-03，真实 PDF + 真实 LLM ecnu-plus，
// `scripts/ingest/run.ts`，产物见 `analysis/ingest/report.txt`）──
//
// 连跑三轮，**三轮都被门禁拦下**，且是三种不同的真实失败模式——不是
// 构造出来验证判据的场景，是真实生成里自己撞出来的：
//
//   轮1：第一档拦下。模型在 `partySetup.context` 里写了"艾德里安……
//     正在进行某种危险的【生化仪式】"——原文完全没有这个词（0 命中）。
//     同一次回复里还有一条 `objectMentions` 声明称呼"枕头底下的硬物"
//     指代线索 id `gabi_pistol`——这个 id 当次摄取里根本不存在（真实
//     线索 id 是 `item_NN` 这类内部句柄），说明当时 prompt 没有把真实
//     线索列表喂给模型，它只能瞎编 id。
//
//   轮2（喂真实线索列表之前的最后一轮）：第二档拦下，同一个瞎编 id
//     的模式——声明"烧烤架"指代线索 id `grill_residue`，同样不存在。
//
//   轮3（改了 prompt，把每个场景真实的线索 id→名字列表喂给模型之后）：
//     第二档仍然拦下，但换了一种更细的失败模式——这次模型确实用对了
//     真实存在的 id（`item_28`，对应基准线索"其他受害者的床位"），
//     但生成文本里指代它的措辞是"那些被仪器罩住的人"，这是一句复述
//     而不是线索本名，`decideClueMatch` 认不出这句话指向 `item_28`
//     （线索的 `matchTexts` 目前只有名字本身，`findMethods` 恒为空，
//     见 `build-clues.ts` 的范围决策）。这正是"培养缸"事故的原始形状
//     ——不是编个不存在的东西，是用一个新措辞称呼一个真实存在的对象，
//     而匹配器认不出这个措辞。三档约束设计时设想的正是这类问题，
//     真实撞见比构造用例更有说服力。
//
// 三轮的共同点：门禁按设计生效，`module.json` 里 openingAtmosphere/
// prologue/partySetup 三个字段全程保持未产出状态，不是"看起来产出了
// 但没检查"——**第一版目前实测 0/3 采纳**，如实记录，没有为了让这个
// 数字好看去放宽门禁或调整 prompt 到"更容易过"，这与 build-clues.ts
// "数字难看是预期内的"是同一条纪律。
//
// 隔离校准验证：三轮实跑的场景/物品 diff（`changed` 79、`missing` 78
// 三轮完全一致，`extra` 在 29~30 之间浮动——那是 `classify-items` 的
// 线索分类跨轮非确定性，与创作层无关，见 docs/notes/ingest.md 的
// 可复现性记录）与本轮改动前的历史数字同口径——创作层无论产出还是
// 被拒，都没有影响到抽取层的既有指标，`buildNarrative` 在校准 diff
// **之后**才被调用这条编排顺序按预期生效。

import type { ModuleData, Provenance } from "../module/types";
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
  clues: { id: string; name: string; findMethods: { description: string }[]; matchTexts?: string[] }[];
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
  // 线索 id 是内部句柄（item_03 这类），LLM 不给出实际列表就无从知道
  // 该场景有哪些线索、各自的 id 是什么——不给这份列表，objectMentions
  // 只能是瞎编（实测：第一版真的编出过不存在的 clueId，见文件头「第一版
  // 实测」），给了列表之后，声明至少有对象可查，第二档判据才有意义。
  const sceneList = input.scenes
    .map((s) => {
      const clueLine = s.clues.length > 0
        ? `\n  该场景已有的线索（id → 名字，若要在 objectMentions 里指代它们必须原样用这些 id）：${s.clues.map((c) => `${c.id}→${c.name}`).join("、")}`
        : "";
      return `${s.id} 【${s.name}】：${s.description.slice(0, 200).replace(/\s+/g, "")}${clueLine}`;
    })
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
- 如果 openingAtmosphere 的文本里明确指代了场景里某条**已有线索**
  （只能是上面场景列表里给出的那些 id，不能自己编一个），在该场景条目的
  objectMentions 里声明 {"phrase": "你用的称呼", "clueId": "线索id"}——
  clueId 必须是场景列表里给出的真实 id，不给出线索列表的场景不要声明
  任何 objectMentions。没有就留空数组，不要为了填而硬凑。

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

/**
 * 把创作层结果并入已装配好的模组——单独一个函数，不塞进 assembleModule()。
 *
 * `assembleModule()` 头顶那条"这一步一个字都不编"的纪律管的是事实层，
 * 不能因为这一轮要接一条"允许编"的通道就去改它——创作层是另一条通道，
 * 混进同一个函数只会让"这段是不是编的"这条边界从代码结构上就看不出来。
 *
 * `narrative.accepted === false` 时原样返回 `module`——三档约束没通过
 * 或调用失败，不是"部分产出"，是"这轮没有可用的创作层内容"。
 *
 * ⚠ 这个函数产出的 module 不该拿去跟基准做校准 diff——调用方（脚本层）
 * 必须在算完 diff 之后再调用它，让 diff 用的那份 scenes 从头到尾没见过
 * openingAtmosphere，而不是算完 diff 再把这些字段摘掉。见 todo-52
 * 的隔离校准决策与 `scripts/ingest/run.ts` 的调用点注释。
 */
export function applyNarrative(module: ModuleData, narrative: BuildNarrativeResult): ModuleData {
  if (!narrative.accepted) return module;

  const scenes = module.scenes.map((s) => {
    const opening = narrative.openingAtmosphereByScene.get(s.id);
    return opening ? { ...s, openingAtmosphere: opening } : s;
  });

  return {
    ...module,
    scenes,
    prologue: narrative.prologueLines.length > 0 ? { lines: narrative.prologueLines } : module.prologue,
    partySetup: narrative.partySetup ?? module.partySetup,
    provenance: [...(module.provenance ?? []), ...narrative.provenance],
  };
}
