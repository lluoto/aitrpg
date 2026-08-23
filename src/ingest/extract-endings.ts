// 从「结局」那类块里抽出结局。
//
// 为什么之前没有：结局块被分类器判成 `structure`，而 structure 块整批不消费，
// 于是 `ModuleData.endings` 一直是空数组 —— 摄取出来的模组跑起来**不会自行结束**。
// 又是那个反复出现的形状：**认出来了，没地方放**。
//
// 为什么用模型而不是规则：普瑞米尔那份的标记是 `Normal End` / `Good End` /
// `Bad End` / `True End`，正文里连成一片没有分隔（`Normal End调查员没有…`）。
// 拿正则切这四个词能work，但我手上只有**一个**模组，
// 没有任何依据说别的模组也用这套英文标记。规则一旦写死，
// 换个写「结局一/结局二」的模组就全漏。分不清就交给模型。
//
// ⚠️ 抽出来的 `conditions` 是**自由文本**，不是可执行条件。
// `Ending` 这个类型本身就是这么定义的（`conditions: string[]`）。
// 真正让模组结束的是 `ModuleSupport.evaluateEnding` 那个函数，那是另一件事，
// 不在这里假装解决。
import type { Ending } from "../module/types";
import type { ChatLike } from "./infer-connections";

interface EndingBlock {
  title: string;
  body: string;
}

/**
 * 失败语义：出错就返回空数组，跟没抽一样 —— 与接这一步之前的行为一致。
 * 结局是给主持人当事实用的，编一个出来会被当成原文里写着的照着念。
 */
export async function extractEndings(
  blocks: EndingBlock[],
  client: ChatLike,
): Promise<Ending[]> {
  const usable = blocks.filter((b) => b.body.trim().length > 0);
  if (usable.length === 0) return [];

  const doc = usable.map((b) => `【${b.title}】\n${b.body}`).join("\n\n");

  const prompt = `下面是一个克苏鲁的呼唤（CoC）跑团模组里若干段**非场景**的文字，
其中可能包含这个模组的**结局**。请把结局逐条抽出来。

什么算一个结局：它描述**一局游戏结束时的某种收场**，
通常会写调查员做到了什么、没做到什么，以及最后怎么样了。
常见的标记有「Normal End / Good End / Bad End / True End」这类，
也可能写成「结局一」「完美结局」，或者根本没有标记、只是分段叙述。

**不要**把这些当成结局：奖惩表（例如「击杀 Mi-Go San 值回复 d6」）、
版权声明、作者的话、附录、给主持人的操作建议。
奖惩条目请放进它所属结局的 conditions 里，如果分不清属于哪个就丢掉。

原文：
${doc}

只输出 JSON 数组，不要任何解释。格式为：
[{"name":"结局名","description":"这个结局的叙述","conditions":["达成条件，一条一句"]}]

要求：
- description 用原文的说法，不要改写、不要补充原文没有的情节。
- conditions 写原文里写明的达成条件；原文没写就给空数组，**不要推测**。
- 如果这些文字里根本没有结局，输出 []。`;

  let raw: string;
  try {
    raw = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
  } catch {
    return [];
  }

  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = fenced ? (fenced[1] as string) : raw;
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start < 0 || end <= start) return [];
    const arr = JSON.parse(body.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];

    const out: Ending[] = [];
    for (const raw of arr) {
      if (typeof raw !== "object" || raw === null) continue;
      const r = raw as Record<string, unknown>;
      const name = typeof r.name === "string" ? r.name.trim() : "";
      const description = typeof r.description === "string" ? r.description.trim() : "";
      // 名字与描述缺一不可：没有名字的结局在 endLabels 里无从显示，
      // 没有描述的结局到了终局什么都念不出来。宁可丢掉也不要半条。
      if (name === "" || description === "") continue;
      const conditions = Array.isArray(r.conditions)
        ? r.conditions.filter((c): c is string => typeof c === "string" && c.trim() !== "")
        : [];
      out.push({
        // id 由序号生成而不是用名字：结局名可能带空格与非 ASCII，
        // 而 id 会进 endLabels 的键与存档，要稳定、可预期。
        id: `ending_${out.length + 1}`,
        name,
        description,
        conditions: conditions.map((c) => c.trim()),
      });
    }
    return out;
  } catch {
    return [];
  }
}
