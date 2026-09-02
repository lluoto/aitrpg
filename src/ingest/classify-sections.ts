// 摄取管线 · 块分类（LLM 层）
//
// 「这一块是不是场景」不是文本形态能定的。试过用「正文含整段朗读引文」当判据，
// 实测命中 15 / 误报 6 / 漏报 5（基准共 20 个场景）—— 报亭、证物室、农场外围
// 这些真场景根本没有朗读引文。所以这一步归 LLM。
//
// 分工没变：规则管死板形态（骰子、难度词、体型阈值），LLM 管需要理解的判断。
//
// 类别为什么有 item：
// 原来只有 scene/npc/structure/rule 四类，而模组里「奇怪的卡片」「绑架犯的报道」
// 「艾米丽与爱莉的棺材」这些块**在四个格子里没有正确答案** —— 它们是物品/线索，
// 不是地点、不是人物、不是文档结构、不是规则。模型只能挑个最不离谱的，
// 而「有描述的实体」最像 scene，于是全挤进了场景表。
// 当时把这记成「场景精确率 20/27，要提精确率」，框架是错的：
// 同一次实跑**漏报是 0**，真场景一个不落，召回满 —— 失的分全部来自无处安放的条目。
// 那不是判错，是体系里缺格子。
//
// 只加 item 一类，没有一次加四类（还剩「背景事件」「行动流程」「通道」无处可去），
// 是为了能归因：一次加多个，分不清是哪个起的作用。
//
// item 块**不进** buildScenes，也**不进** toItemInputs。
// 后者是有意的：toItemInputs 给每个条目挂的 sceneId 取自 `ids[i]`，
// 而非 scene 块的那个 id 从来没被写进任何 Scene.id —— 让 item 块进去
// 只会造出一批指向不存在场景的悬空引用。物品块该怎么落地是下一轮的事。

import type { LLMClient } from "../llm/client";
import type { Section } from "./sectionize";
import { extractJson } from "../llm/json";

export type SectionKind = "scene" | "npc" | "structure" | "rule" | "item";

const VALID: readonly string[] = ["scene", "npc", "structure", "rule", "item"];

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
- item：一件具体的东西，而不是一个地方。如某张卡片、某份报纸剪报、某封信、
  某样在现场发现的物件。它可以被拿起、被阅读、被检查，但调查员不会"进入"它。

注意：
- 场景不一定有供朗读的引文段落，没有引文的也可能是场景。
- 人物的名字作标题时通常是 npc，但"与某人的会面"这种描述一次遭遇的通常是 scene。
- **判断 scene 还是 item，看调查员是"走进去"还是"拿起来"。**
  一个房间、一片区域、一栋建筑是 scene；一张卡片、一份文件、一口棺材是 item。

文本块：
${list}

只输出 JSON，不要任何解释文字。格式为 {"块标题": "类别"}，标题必须与上面完全一致。`;
}

/**
 * 从模型给回来的键里抽出方括号包着的标题。
 *
 * 第一次踩这个坑（2026-08-2X 前后）：prompt 里标题写成 `【农场外围】`
 * 展示，模型照抄格式回来，43 个块全被"只剥字符串首尾的方括号"这条
 * 规则卡掉——解析出 0 条，看上去像模型没干活，其实它全做对了。
 *
 * 第二次（todo-51，`scripts/diag/probe-classify-key-format.ts` 实测
 * 8/8 轮稳定复现，2026-09-02）：模型把方括号里的标题连同后面一段摘录
 * 正文一起抄了回来（"【前言】本模组是在吃安眠药的情况下想到的……"），
 * 方括号不再贴着字符串结尾，原来"只剥首尾"的规则再次卡死——43 个块
 * 只解析出 1 条。同一句话的更宽版本：**展示格式不该变成输出格式的
 * 契约，解析这边兜住**，这次兜的是"方括号后面还有内容"这一种。
 *
 * 修法：不再要求方括号贴着字符串首尾，改成从键的**任意位置**抽取全部
 * `【...】`/`[...]`/`［...］` 片段，逐个核对是否在 `knownTitles` 里——
 * 抽出的候选必须【唯一命中】才采纳，命中多个或零个一律返回 null，
 * 交给调用方按"认不出的一律丢弃，不做兜底猜测"处理（下面
 * `parseClassifyResponse` 那条规则没有变，变的只是"怎么算认出来"）。
 * 不做模糊匹配——模糊匹配是另一类风险（猜错一个标题，那条块的分类
 * 结果会挂到错误的标题上，比丢弃更糟）。
 */
function extractKnownTitle(rawKey: string, knownTitles: Set<string>): string | null {
  // 键本身（去空白后）就是已知标题——模型没有照抄方括号时的老路径，
  // 一直存在，不能因为这次改的是"方括号里带多余内容"就把它删掉。
  const trimmed = rawKey.trim();
  if (knownTitles.has(trimmed)) return trimmed;

  const candidates = new Set<string>();
  for (const m of rawKey.matchAll(/[【\[［]([^】\]］]*)[】\]］]/g)) {
    const t = m[1]!.trim();
    if (knownTitles.has(t)) candidates.add(t);
  }
  return candidates.size === 1 ? ([...candidates][0] as string) : null;
}

/**
 * 解析分类结果。
 *
 * 认不出的一律丢弃，不做兜底猜测：把不认识的东西默认成 scene，
 * 会让分类结果虚高而没人察觉——宁可少认，也不要悄悄多认。
 *
 * 值这一侧是**故意**精确比对（`VALID.includes(v)` 原样比，不 trim、不转小写、
 * 不把 `-` 当 `_`），与兄弟模块 classify-items 的 normalizeKind 不对称。
 * 这个不对称是留着的，不是漏改：本步已公布的实跑成绩（命中 20 / 误报 4 / 漏报 0）
 * 就是拿现在这个解析器认下来的东西量出来的。放宽写法等于放宽「哪些回答算数」，
 * 那三个数会跟着动，而不重跑就没有新数去替换旧数 —— 于是公布的成绩变成一个
 * 没人量过的数字。要改的前提是先重跑一次、把三个数重新量出来，连着数一起改；
 * 只为了跟 classify-items 对称而对称，不值这个代价。
 *
 * 误报从 7 降到 4 是加了 item 类之后重跑量出来的（旧数是 7）。
 * 移出场景表的正是「奇怪的卡片」「绑架犯的报道」「艾米丽与爱莉的棺材」这三个物品块。
 * 同一次跑里物品覆盖 9/10、精确率 9/19、评分键左手边 39/39 全部持平 —— 没有倒退。
 * （那之后接进了条目分族追问，物品精确率升到 9/11，与本步无关。）
 * 剩下的 4 个是「在小镇内询问路人」「关于艾米丽难产的事件」「旅店」「比较大的奇怪管道」，
 * 其中**旅店是个真地方**，只是基准没把它建成场景 —— 那不是体系缺格子，是基准的取舍。
 */
export function parseClassifyResponse(text: string, knownTitles: string[]): Map<string, SectionKind> {
  const out = new Map<string, SectionKind>();
  const obj = extractJson(text ?? "");
  if (!obj || typeof obj !== "object") return out;
  const known = new Set(knownTitles);
  for (const [rawKey, v] of Object.entries(obj as Record<string, unknown>)) {
    const k = extractKnownTitle(rawKey, known);
    if (k === null) continue;               // 模型编出来的标题，或抽出的候选命中了 0/多个已知标题
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
