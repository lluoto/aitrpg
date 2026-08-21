// 摄取管线 · 条目分类的二次追问（LLM 层）
//
// 一次性问「这条属于六类里的哪一类」实测只有 22/33（67%）。
// 混淆矩阵显示错法是**成族**的，不是散的：
//   · item 被判成 item 但其实是 clue —— 标题是「床头柜」「枪械柜」这种，
//     模型看见一件实物就判 item，而基准要的是「翻开它发现了什么」
//   · event 被判成 event 但其实是 clue —— 「如果调查员……就会……」里，
//     有的让人多知道一件事（线索），有的只是事情发生完了
// 成族的错就该分族问。对每一族只问一个二选一的问题，实测 22/33 → 31/33（94%）。
//
// 轴是试出来的，不是想出来的：
//   · item 族先试「得到东西 vs 知道事情」，**−2** ——
//     基准 6 个非陷阱物品里有 3 个是文件（照片/驾驶证/老旧文件），
//     实体物件而全部意义在传递信息，那条轴分不开它们。
//     换成「带走的东西 vs 去翻的地方」，+7、0 弄坏。
//   · event 族用「往下还有得查吗」，+2、0 弄坏。
//
// **prompt 的字面内容是测量条件的一部分。** 曾经两处各写了一份，
// 其中一处把例子删了，同一条管线的基线就从 31/33 变成 29/33，跨实验的数不能比了。
// 所以这两个 prompt 全仓**只此一份**，工具脚本一律 import 这里，不许自己重打。
import type { LLMClient } from "../llm/client";
import type { ItemInput, ItemKind } from "./classify-items";

/**
 * item 族的轴：容器 vs 内容。
 *
 * 例子不能删：删掉之后实测掉 2 分。
 */
export function itemFollowupPrompt(list: ItemInput[]): string {
  const body = list
    .map((it) => `${it.key} 【${it.sceneTitle}】${it.name || "(无标题)"}：${it.text.slice(0, 160).replace(/\s+/g, "")}`)
    .join("\n");

  return `下面是一个克苏鲁的呼唤（CoC）跑团模组里的若干条目。对每一条，只回答一个问题：

**这一条的标题，指的是「调查员带走的那件东西」，还是「调查员去翻的那个地方」？**

- thing：标题就是那件实物本身。调查员把它拿走，之后还能用或还能看。
  例如「防盗门的钥匙」「农场的照片」「驾驶证」——**文件、照片、证件都算 thing**，
  哪怕它的用处是让人知道点什么。
- place：标题指的是一处地方、一件家具、或一个搜查动作。
  例如「床头柜」「枪械柜」「在一旁的冰箱与储物柜」「侦查餐厅/仔细检查餐桌」——
  重点不是这件家具，而是翻开它之后发现了什么。

条目：
${body}

只输出 JSON，不要任何解释。格式为 {"条目键": "thing|place"}，键必须是每行开头那个 pN:LN。`;
}

/**
 * event 族的轴：往下还有得查吗。
 *
 * 这一族的形态都是「如果调查员……就会……」，区别在结果里：
 * 有的让调查员知道/看见了什么（那就是线索），有的只是事情发生完了。
 * 而后者的原文自己写着「无法再进一步获得线索」。
 */
export function eventFollowupPrompt(list: ItemInput[]): string {
  const body = list
    .map((it) => `${it.key} 【${it.sceneTitle}】${it.name || "(无标题)"}：${it.text.slice(0, 200).replace(/\s+/g, "")}`)
    .join("\n");

  return `下面是一个克苏鲁的呼唤（CoC）跑团模组里的若干条目，都是「如果调查员……就会……」这种写法。
对每一条，只回答一个问题：

**这一段发生完之后，调查员手里是不是多了一条能继续往下查的东西？**

- lead：是。调查员因此知道了某个情况、看见了某样东西、或拿到了某个说法，
  之后还能拿它接着查。
- dead：不是。这一段只是一个结果 —— 事情发生了、场面结束了，
  调查员并没有因此多知道什么可以往下追的东西。

条目：
${body}

只输出 JSON，不要任何解释。格式为 {"条目键": "lead|dead"}，键必须是每行开头那个 pN:LN。`;
}

/** 从可能夹着解释或围栏的回答里抠 JSON，并按 pN:LN 归一化键 */
export function parseKeyed(text: string, known: Set<string>, valid: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const b = fenced ? (fenced[1] as string) : text;
  const s = b.indexOf("{");
  const e = b.lastIndexOf("}");
  if (s < 0 || e <= s) return out;
  let obj: unknown;
  try {
    obj = JSON.parse(b.slice(s, e + 1));
  } catch {
    return out;
  }
  for (const [rk, v] of Object.entries(obj as Record<string, unknown>)) {
    const m = rk.match(/p\d+:L\d+/);
    const k = m ? m[0] : rk.trim();
    if (!known.has(k) || typeof v !== "string") continue;
    const nv = v.trim().toLowerCase();
    if (valid.includes(nv)) out.set(k, nv);
  }
  return out;
}

/**
 * 追问答案怎么覆盖原判。
 *
 * 只映射这两个方向，没有第三个 —— 多给选项会让模型漂到本来就判对的类别去，
 * 把「修正一族」变成「重判一遍」。
 */
const THING_PLACE_TO_KIND: Record<string, ItemKind> = { thing: "item", place: "clue" };

/**
 * 对 item 族与 event 族各追问一次，返回修正后的分类表。
 *
 * 不修改传进来的 kinds，返回新表：调用方常常要拿前后两份对比
 * （实跑 report 里的「修好几条 / 弄坏几条」就是这么算的）。
 *
 * 任何一次追问失败都只是那一族不修正，不影响另一族，也不影响原判 ——
 * 追问是**锦上添花**，不能让它把已有的分类结果拖下水。
 */
export async function refineItemKinds(
  inputs: ItemInput[],
  kinds: Map<string, ItemKind>,
  client: LLMClient,
): Promise<Map<string, ItemKind>> {
  const after = new Map(kinds);

  const ask = async (
    family: ItemInput[],
    prompt: string,
    valid: readonly string[],
  ): Promise<Map<string, string>> => {
    if (family.length === 0) return new Map();
    try {
      // 分类是判断题，低温度：DESIGN-LOG §4（检定低温度、叙事高温度）
      const reply = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
      return parseKeyed(reply, new Set(family.map((i) => i.key)), valid);
    } catch (e) {
      console.warn(`[ingest] 条目追问失败，该族维持原判: ${e instanceof Error ? e.message : String(e)}`);
      return new Map();
    }
  };

  const itemFamily = inputs.filter((i) => kinds.get(i.key) === "item");
  for (const [k, v] of await ask(itemFamily, itemFollowupPrompt(itemFamily), ["thing", "place"])) {
    const mapped = THING_PLACE_TO_KIND[v];
    if (mapped) after.set(k, mapped);
  }

  const eventFamily = inputs.filter((i) => kinds.get(i.key) === "event");
  for (const [k, v] of await ask(eventFamily, eventFollowupPrompt(eventFamily), ["lead", "dead"])) {
    // dead 维持原判 event，只有 lead 改判 clue
    if (v === "lead") after.set(k, "clue");
  }

  return after;
}
