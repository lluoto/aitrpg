// 摄取管线 · ModuleItem 构建
//
// 只取分类为 item 与 trap 的条目。基准 10 个物品里有 9 个的 name 能在 ▶ 名字里
// 原样找到，所以这一批是整条管线上少有的、能靠名字直接对分的字段。
//
// type 归规则、「是不是物品」归 LLM —— 名字里有没有「钥匙」是死板文本形态，
// 规则抽取可复现、可解释、不要 API key。

import type { ModuleItem, Provenance } from "../module/types";
import type { ItemInput, ItemKind } from "./classify-items";
import { extractTrapMechanics } from "./extract-trap";

export interface BuildItemsResult {
  items: ModuleItem[];
  /** 陷阱抽取的改写留痕，path 已 rebase 到根 */
  provenance: Provenance[];
  /** 跳过的条目、抽不到机制的陷阱 —— 不静默丢东西 */
  warnings: string[];
}

/**
 * 只拿 name 匹配，不看 text。
 *
 * 正文里出现「钥匙」的条目多得是 —— 基准的「床头柜」正文就写着钥匙 ——
 * 拿正文匹配会把一堆东西判成 key。
 *
 * weapon 不设规则：基准里没有非陷阱物品用它，凭空加一条只会多一个没人验证过的分支。
 */
const TYPE_RULES: Array<[RegExp, ModuleItem["type"]]> = [
  [/钥匙/, "key"],
  [/照片|驾驶证|证件|文件|协议|日记|信件/, "document"],
];

function itemType(name: string): ModuleItem["type"] {
  for (const [re, t] of TYPE_RULES) if (re.test(name)) return t;
  return "loot";
}

/**
 * 建物品。三个入参都以 ItemInput.key 对齐，没有下标耦合。
 */
export function buildItems(
  inputs: ItemInput[],
  kinds: Map<string, ItemKind>,
  ids: Map<string, string>,
): BuildItemsResult {
  const items: ModuleItem[] = [];
  const provenance: Provenance[] = [];
  const warnings: string[] = [];
  let unclassified = 0;
  let nameless = 0;
  let noMech = 0;

  for (const input of inputs) {
    const id = ids.get(input.key);
    if (id === undefined) throw new Error(`[ingest] 条目 ${input.key} 没有分到 id`);

    const kind = kinds.get(input.key);
    if (kind === undefined) {
      unclassified++;
      continue;
    }
    if (kind !== "item" && kind !== "trap") continue;

    // 物品没有名字就没法被指认 —— 校准器按 name 配对，叙事里也没法提起它。
    // 39 个条目里那 8 个无名的，基准里没有一个是物品，所以这条不会误伤；
    // 真触发了说明分类错了，该看见。
    if (input.name === "") {
      nameless++;
      continue;
    }

    const item: ModuleItem = {
      id,
      name: input.name,
      sceneId: input.sceneId,
      description: input.text,
      type: kind === "trap" ? "trap" : itemType(input.name),
    };

    if (kind === "trap") {
      const ex = extractTrapMechanics(input.name, input.text, input.key);
      if (ex) {
        item.trap = ex.mech;
        // rebase：抽取器产出的是相对路径（trap.damage），而 Provenance.path 的语义是根路径。
        // 用 id 不用下标 —— 下标路径在按身份配对之后没有意义，上一轮已经确认过。
        for (const p of ex.provenance) provenance.push({ ...p, path: `items[${id}].${p.path}` });
      } else {
        // 基准里 trap 缺省的语义就是「该陷阱纯叙事，不结算」，与此一致
        noMech++;
      }
    }

    items.push(item);
  }

  if (unclassified > 0) warnings.push(`${unclassified} 个条目没有分类结果，已跳过`);
  if (nameless > 0) warnings.push(`${nameless} 个条目被判成物品/陷阱但没有名字，已跳过`);
  if (noMech > 0) warnings.push(`${noMech} 个陷阱条目一条机制都抽不到，按纯叙事处理（不带 trap 字段）`);

  return { items, provenance, warnings };
}
