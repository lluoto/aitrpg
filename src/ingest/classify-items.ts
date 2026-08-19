// 摄取管线 · ▶ 条目分类（LLM 层）
//
// ▶ 不是线索标记，是通用的子条目标记。把 39 个条目逐条对回基准，底下混着六种东西：
// 陷阱、可拿走的物品、场景之间的进入方式、NPC 知道的事、分支结局叙事，才是线索。
// 「这一条是哪一种」是语义判断，与块分类同一类问题，归 LLM。
//
// 键用 sourceKey 而不是名字。块分类以标题为键，重名时静默互相覆盖 ——
// 那个缺陷本轮不修，但不能在这里重演一遍：`驾驶证` 在证物室和交火现场各出现一次。

import type { LLMClient } from "../llm/client";
import type { Section } from "./sectionize";
import { sourceKey } from "./sectionize";
import type { SectionKind } from "./classify-sections";

export type ItemKind = "clue" | "item" | "trap" | "connection" | "npc_knowledge" | "event";

const VALID: readonly string[] = ["clue", "item", "trap", "connection", "npc_knowledge", "event"];

/** 单条给模型看的正文上限。39 条乘全文会把 prompt 撑大，且条目正文本就不长 */
const EXCERPT_MAX = 160;

export interface ItemInput {
  /** 唯一键，形如 `p9:L13`；同时就是这条的 Provenance.sourceRef */
  key: string;
  /** 所属块标题，给模型上下文 */
  sceneTitle: string;
  /** 所属场景 id */
  sceneId: string;
  /** ▶ 与第一个冒号之间那截；39 条里有 8 条没有，为空串 */
  name: string;
  /** 冒号之后的正文；没有冒号时是整行 */
  text: string;
}

/**
 * Section → ItemInput。只取被判成 scene 的块上的条目。
 *
 * npc 块上的条目（菲碧·特里坎名下那两条）在基准里是 ModuleNPC.knowledge / .secrets，
 * 是另一轮的事；rule/structure 块上的条目不属于任何场景。查不到分类的块一律不取，不猜。
 */
export function toItemInputs(
  sections: Section[],
  kinds: Map<string, SectionKind>,
  ids: string[],
): ItemInput[] {
  if (ids.length !== sections.length) {
    throw new Error(`[ingest] ids 与 sections 长度不符：${ids.length} vs ${sections.length}`);
  }

  const out: ItemInput[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as Section;
    if (s.title === "") continue;
    if (kinds.get(s.title) !== "scene") continue;
    for (const it of s.items) {
      out.push({
        key: sourceKey(it.source),
        sceneTitle: s.title,
        sceneId: ids[i] as string,
        name: it.name,
        text: it.text,
      });
    }
  }
  return out;
}

export function buildItemPrompt(inputs: ItemInput[]): string {
  const list = inputs
    .map((it) => {
      const head = it.name === "" ? "(无标题)" : it.name;
      return `${it.key} 【${it.sceneTitle}】${head}：${it.text.slice(0, EXCERPT_MAX).replace(/\s+/g, "")}`;
    })
    .join("\n");

  return `下面是一个克苏鲁的呼唤（CoC）跑团模组里，各个场景名下用 ▶ 标出的条目。请判断每一条属于哪一类。

类别：
- item：调查员可以拿走、之后还能用的实体物品。钥匙、照片、证件、文件之类。
- trap：会对调查员造成伤害或理智损失的机关。
- clue：调查员通过搜查、检定或观察得知的信息。它本身不是能拿走的东西，是"知道了某件事"。
- connection：进入或离开这个场景的方式。门、梯子、可以爬上去的杂物堆之类。
- npc_knowledge：某个人物知道的事或隐瞒的事，说的是人不是地方。
- event：条件触发的一段剧情或结局分支，通常写成"如果调查员……就会……"。

注意：
- 拿得走的是 item，知道了的是 clue。"床头柜里有日记本"重点是发现了这件事，算 clue；"防盗门的钥匙"本身就是那件东西，算 item。
- 有的条目没有标题，只有正文，照样要判。

条目：
${list}

只输出 JSON，不要任何解释文字。格式为 {"条目键": "类别"}，键必须是每行开头那个 pN:LN。`;
}

/** 从可能夹着解释文字或代码围栏的回答里抠出 JSON 对象 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? (fenced[1] as string) : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 归一化模型给回来的键。
 *
 * 上一轮的教训：prompt 里把标题展示成 `【农场外围】`，模型就照这个格式返回键，
 * 43 条全被解析器丢掉，表现成「模型没干活」，实际它全做对了。
 * 展示格式不该变成输出格式的契约，解析这边兜住。
 *
 * 这里键是行首的 pN:LN，模型可能只回它，也可能把整行抄回来。认行首那段即可。
 */
function normalizeKey(k: string): string {
  const m = k.match(/p\d+:L\d+/);
  return m ? m[0] : k.trim();
}

/**
 * 解析分类结果。认不出的一律丢弃，不做兜底猜测：
 * 把不认识的东西默认成某一类，会让分类结果虚高而没人察觉。
 */
export function parseItemResponse(text: string, knownKeys: string[]): Map<string, ItemKind> {
  const out = new Map<string, ItemKind>();
  const obj = extractJson(text ?? "");
  if (!obj || typeof obj !== "object") return out;
  const known = new Set(knownKeys);
  for (const [rawKey, v] of Object.entries(obj as Record<string, unknown>)) {
    const k = normalizeKey(rawKey);
    if (!known.has(k)) continue;
    if (typeof v !== "string") continue;
    if (!VALID.includes(v)) continue;
    out.set(k, v as ItemKind);
  }
  return out;
}

/**
 * 调 LLM 做分类。失败返回空表，由调用方决定怎么降级 ——
 * 不在这里静默塞一个「全都是 clue」的结果。
 */
export async function classifyItems(
  inputs: ItemInput[],
  client: LLMClient,
): Promise<Map<string, ItemKind>> {
  if (inputs.length === 0) return new Map();
  const prompt = buildItemPrompt(inputs);
  try {
    // 分类是判断题，低温度：DESIGN-LOG §4（检定低温度、叙事高温度）
    const reply = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
    return parseItemResponse(reply, inputs.map((i) => i.key));
  } catch (e) {
    console.warn(`[ingest] 条目分类失败，未产出分类: ${e instanceof Error ? e.message : String(e)}`);
    return new Map();
  }
}
