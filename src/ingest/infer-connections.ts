// 推断场景之间的连接。
//
// 为什么要靠模型：原文几乎从不明写「从镇上可以去警察局」——它默认读者理解地理关系。
// 确定性信号试过四个（被提到 / 提到别人 / 位置 / 长度），**全无区分度**，
// 值都挤在 0/1/2 上。所以这一步只能问。
//
// 为什么是「直接推图」而不是「先定层级再机械导出」：两条路各跑 3 次量过 ——
//   层级 + 机械导出   F1 0.74 / 0.70 / 0.70，正确边可达 13 / 13 / 13
//   直接推图（全文）  F1 0.81 / 0.81 / 0.81，正确边可达 20 / 20 / 20
// 判据是**配对**的（F1 与可达必须同时看，单看任何一个都能被刷），
// 而直推在两项上同时更高，没有取舍余地。层级路线的错边几乎全来自
// 「顶层一律连枢纽」这条机械规则把上游误报也连了上去 —— 规则会放大上游的错。
//
// ⚠️ 描述**不要截断**。最初随手取前 90 字，F1 只有 0.71；
// 关键的衔接信息常在 90 字之后，比如农场那段「再稍微往里有两个比较显眼的建筑。
// 一间刷着红油漆的类似谷仓的建筑，和一个农场主别墅」正是包含关系。
// 90 字 / 400 字 / 全文 = F1 0.71 / 0.76 / 0.81，单调。
import type { Message } from "../llm/client";
import { extractJson } from "../llm/json";

/** 只要 chat 这一个能力，方便测试时替身。 */
export interface ChatLike {
  chat(messages: Message[], opts?: { temperature?: number }): Promise<string>;
}

interface ConnScene {
  id: string;
  name: string;
  description: string;
}

/**
 * 返回 场景 id → 可走到的场景 id 列表。
 *
 * 失败语义：任何一步出错（调用失败、JSON 解析不出、名字对不上）都返回**空 Map**，
 * 调用方那边连接就维持空数组 —— 跟接这一步之前的行为一致。
 * 宁可没有边，也不要半张乱图：下游 `play-module` 的移动只认 connections，
 * 一条错边就是一个走得过去但不该走过去的地方。
 */
export async function inferConnections(
  scenes: ConnScene[],
  client: ChatLike,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (scenes.length < 2) return out;

  const list = scenes
    .map((s, i) => `${i + 1}. ${s.name}：${s.description.replace(/\s+/g, "")}`)
    .join("\n");

  // ⚠️ 「整张图必须是连通的」这句是**验证过无效**的：加上去之后输出一字未变。
  // 模型不会因为被要求就去做全局检查。留着是因为当前那组成绩
  // （F1 0.81 / 可达 20）就是带着它测出来的，拿掉等于换了个没测过的 prompt。
  // 想删可以，但要重跑三次确认成绩不掉。
  const prompt = `下面是一个克苏鲁的呼唤（CoC）跑团模组里的全部场景，按它们在原文里出现的顺序排列。
请推断调查员可以**从哪个场景走到哪个场景**。

原文通常不会明写「从镇上可以去警察局」这种话——它默认读者理解地理关系。
所以你要靠场景之间的从属与位置关系来判断，例如：

- 镇子这类**枢纽**通常能通往镇上的每一处地点，而每一处也都能回到镇子。
- 一处大地方（比如某个农场）下面往往嵌着若干小地方（外围、别墅、谷仓），
  进得去也出得来。
- 出现顺序常常跟着行进顺序，但**不总是**——枢纽会往回连很远。
- 只要能走过去就连，不用管需要什么条件。

**最要紧的一条：整张图必须是连通的。** 调查员从任何一个场景出发，都应该能一路走到
其余每一个场景。特别当心不同区域之间的衔接——比如镇子与镇外的地点，
很容易各自连得很好却彼此断开。写完后请自己检查一遍有没有走不到的地方。

场景：
${list}

只输出 JSON，不要任何解释。格式为 {"起点场景名": ["终点场景名", ...]}，
名字必须与上面完全一致。**双向可走的要在两边都写一次。**`;

  let raw: string;
  try {
    raw = await client.chat([{ role: "user", content: prompt }], { temperature: 0.1 });
  } catch {
    return out;
  }

  // 名字 → id。同名场景取第一个：重名在这里没有可靠的消歧依据，
  // 与其猜一个不如都归给先出现的那个。
  const byName = new Map<string, string>();
  for (const s of scenes) if (!byName.has(s.name)) byName.set(s.name, s.id);

  try {
    const parsed = extractJson(raw);
    if (!parsed || typeof parsed !== "object") return out;
    const obj = parsed as Record<string, unknown>;

    for (const [from, tos] of Object.entries(obj)) {
      const fromId = byName.get(from.trim());
      if (fromId === undefined || !Array.isArray(tos)) continue;
      const targets: string[] = [];
      for (const t of tos) {
        if (typeof t !== "string") continue;
        const toId = byName.get(t.trim());
        // 丢掉自环与认不出的名字：模型偶尔会把不在表里的地名写进来，
        // 那种边指向一个不存在的场景，接到运行时就是一条走不通的出口。
        if (toId === undefined || toId === fromId) continue;
        if (!targets.includes(toId)) targets.push(toId);
      }
      if (targets.length > 0) out.set(fromId, targets);
    }
  } catch {
    return new Map();
  }

  return out;
}
