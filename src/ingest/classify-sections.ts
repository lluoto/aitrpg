// 摄取管线 · 块分类（LLM 层）
//
// 「这一块是不是场景」不是文本形态能定的。试过用「正文含整段朗读引文」当判据，
// 实测命中 15 / 误报 6 / 漏报 5（基准共 20 个场景）—— 报亭、证物室、农场外围
// 这些真场景根本没有朗读引文。所以这一步归 LLM。
//
// 分工没变：规则管死板形态（骰子、难度词、体型阈值），LLM 管需要理解的判断。

import type { LLMClient } from "../llm/client";
import type { Section } from "./sectionize";
import { extractJson } from "./llm-json";

export type SectionKind = "scene" | "npc" | "structure" | "rule";

const VALID: readonly string[] = ["scene", "npc", "structure", "rule"];

/** 单个块给模型看的正文长度上限 —— 44 个块乘以全文会把 prompt 撑爆 */
const EXCERPT_MAX = 120;

export interface ClassifyInput {
  title: string;
  excerpt: string;
}

/**
 * Section → ClassifyInput。
 *
 * 放在这一侧而不是切分那一侧：ClassifyInput 是本模块定义的，
 * 怎么从上游结构造出来该由本模块负责。
 *
 * 滤掉标题为空的块 —— sectionize 会把首个标题之前的内容（第 1 页的书名等）
 * 归入一个 title 为空串的前置块。它进不了以标题为键的分类结果，也不可能是场景。
 *
 * 正文原样带过去，不在这里截断：截断口径由 buildClassifyPrompt 的 EXCERPT_MAX 独占，
 * 两处各截一次会让「模型到底看到了多少字」说不清。
 */
export function toClassifyInputs(sections: Section[]): ClassifyInput[] {
  return sections
    .filter((s) => s.title !== "")
    .map((s) => ({ title: s.title, excerpt: s.body }));
}

export function buildClassifyPrompt(sections: ClassifyInput[]): string {
  const list = sections
    .map((s, i) => `${i + 1}. 【${s.title}】${s.excerpt.slice(0, EXCERPT_MAX).replace(/\s+/g, "")}`)
    .join("\n");

  return `下面是一个克苏鲁的呼唤（CoC）跑团模组里切分出的若干文本块。请判断每一块属于哪一类。

类别：
- scene：调查员会去到的地点/场景。有环境描写、可以在里面调查和行动。
- npc：某个具体人物的设定（性格、知道什么、态度）。
- structure：模组的文档结构，不是游戏内容。如前言、附录、写在最后、导入说明、结局说明。
- rule：规则、数据表、怪物属性、KP 操作指引。

注意：
- 场景不一定有供朗读的引文段落，没有引文的也可能是场景。
- 人物的名字作标题时通常是 npc，但"与某人的会面"这种描述一次遭遇的通常是 scene。

文本块：
${list}

只输出 JSON，不要任何解释文字。格式为 {"块标题": "类别"}，标题必须与上面完全一致。`;
}

/**
 * 归一化模型给回来的键。
 *
 * prompt 里标题是写成 `【农场外围】` 展示的，模型会照抄这个格式回来。
 * 实跑时 43 个块全被这一条卡掉：解析出 0 条，看上去像模型没干活，
 * 其实它全做对了。展示格式不该变成输出格式的契约，解析这边兜住。
 */
function normalizeKey(k: string): string {
  return k.trim().replace(/^[【\[［]\s*/, "").replace(/\s*[】\]］]$/, "").trim();
}

/**
 * 解析分类结果。
 *
 * 认不出的一律丢弃，不做兜底猜测：把不认识的东西默认成 scene，
 * 会让分类结果虚高而没人察觉——宁可少认，也不要悄悄多认。
 *
 * 值这一侧是**故意**精确比对（`VALID.includes(v)` 原样比，不 trim、不转小写、
 * 不把 `-` 当 `_`），与兄弟模块 classify-items 的 normalizeKind 不对称。
 * 这个不对称是留着的，不是漏改：本步已公布的实跑成绩（命中 20 / 误报 7 / 漏报 0）
 * 就是拿现在这个解析器认下来的东西量出来的。放宽写法等于放宽「哪些回答算数」，
 * 那三个数会跟着动，而不重跑就没有新数去替换旧数 —— 于是公布的成绩变成一个
 * 没人量过的数字。要改的前提是先重跑一次、把三个数重新量出来，连着数一起改；
 * 只为了跟 classify-items 对称而对称，不值这个代价。
 */
export function parseClassifyResponse(text: string, knownTitles: string[]): Map<string, SectionKind> {
  const out = new Map<string, SectionKind>();
  const obj = extractJson(text ?? "");
  if (!obj || typeof obj !== "object") return out;
  const known = new Set(knownTitles);
  for (const [rawKey, v] of Object.entries(obj as Record<string, unknown>)) {
    const k = normalizeKey(rawKey);
    if (!known.has(k)) continue;            // 模型编出来的标题
    if (typeof v !== "string") continue;
    if (!VALID.includes(v)) continue;       // 类别不在枚举内
    out.set(k, v as SectionKind);
  }
  return out;
}

/**
 * 调 LLM 做分类。失败返回空表，由调用方决定怎么降级 ——
 * 不在这里静默塞一个"全都是 scene"的结果。
 */
export async function classifySections(
  sections: ClassifyInput[],
  client: LLMClient,
): Promise<Map<string, SectionKind>> {
  if (sections.length === 0) return new Map();
  const prompt = buildClassifyPrompt(sections);
  try {
    // 分类是判断题，低温度：DESIGN-LOG §4（检定低温度、叙事高温度）
    const reply = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
    return parseClassifyResponse(reply, sections.map((s) => s.title));
  } catch (e) {
    console.warn(`[ingest] 块分类失败，未产出分类: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}
