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
  /**
   * 跳过的条目、抽不到机制的陷阱、产出了但可疑的物品 —— 不静默丢东西，
   * 也不静默放东西过去。后者原先没人报：空描述和重名都是照产不误、report 里一片空白，
   * 而它们恰好是最需要有人看一眼的两种形状。
   */
  warnings: string[];
}

/**
 * 只拿 name 匹配，不看 text。
 *
 * 正文里出现「钥匙」的条目多得是 —— 基准的「床头柜」正文就写着钥匙 ——
 * 拿正文匹配会把一堆东西判成 key。
 *
 * weapon 不设规则：基准里没有非陷阱物品用它，凭空加一条只会多一个没人验证过的分支。
 *
 * 但上面那句话不能反过来读成「现有的每个备选都验证过」—— 它们成色不一样。
 * 对得上基准物品名的是 `照片`（农场的照片）、`驾驶证`、`文件`（老旧文件）；
 * `协议` 在基准里没有对应物品，可它并非空转 —— 实跑命中 item_20
 * 「抽屉里的关于***号农场的转购协议」，把它判成了 document；
 * `证件`、`日记`、`信件` 到目前一条都没打中，是预留。
 * （`日记` 尤其容易被误认为在用：实跑的「床头柜」正文里写着日记本，
 * 但规则只看 name，所以它是 loot。）
 *
 * 所以这条正则要不要收窄是个**待定**的取舍，不是顺手清理能定的：删掉 `协议`
 * 会把 item_20 的 type 从 document 改回 loot —— 那是改输出，得有人拿着实跑结果拍板。
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
  let emptyDesc = 0;
  // 只统计**真产出了**的物品的名字。放在循环外面按 name 计数，是因为重名的两条
  // 各自独立、可能隔着十几个条目，边走边比对没法覆盖。
  const nameCount = new Map<string, number>();

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

    // 以下两个数说的是「产出了什么」，不是「跳过了什么」，所以记在这儿 ——
    // item 已经建齐、紧接着就 push，走到这一行的条目必定进 items。
    // 无名条目在上面那关已经 continue 了，不会在这里再被算一次：
    // 一条输入只该出现在一个数里，否则读的人会以为有两条问题条目。

    // 名字有、冒号后什么都没有的 ▶ 行（实跑 p8:L6「抽屉里的关于***号农场的转购协议」）。
    // 没有描述的物品没法叙事，多半是分块产物，值得看一眼。
    // text 在 sectionize 那层已经 trim 过（`sectionize.ts:78-79`），所以精确比空串就够，
    // 与上面 name === "" 同一口径。
    if (item.description === "") emptyDesc++;
    nameCount.set(item.name, (nameCount.get(item.name) ?? 0) + 1);

    items.push(item);
  }

  if (unclassified > 0) warnings.push(`${unclassified} 个条目没有分类结果，已跳过`);
  if (nameless > 0) warnings.push(`${nameless} 个条目被判成物品/陷阱但没有名字，已跳过`);
  if (noMech > 0) warnings.push(`${noMech} 个陷阱条目一条机制都抽不到，按纯叙事处理（不带 trap 字段）`);
  // 注意这两条 warning 的语气：说的是「放过去了，你看一眼」，不是「已丢弃」。
  // 空描述的物品照样在 items 里，重名的两个也都在 —— 去重是个判断，本轮没做。
  if (emptyDesc > 0) {
    warnings.push(`${emptyDesc} 个条目产出了物品但 description 为空（▶ 行只有名字没有正文），已照原样产出`);
  }
  // 点出名字而不是只报个数：报数说明「有重名」，名字才让人找得到它。
  // 兄弟模块的重名标题（`build-scenes.ts` 那条）也是这个写法。
  for (const [name, n] of nameCount) {
    if (n > 1) {
      warnings.push(`物品名「${name}」出现 ${n} 次；校准器按 name 配对，其中一个会报成 extra，那不是幻觉。本轮不去重，两个都产出`);
    }
  }

  return { items, provenance, warnings };
}
