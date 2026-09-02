// 摄取管线 · id 分配
//
// 模块原名 scene-id.ts。改名是因为它给的从来就不只是场景的 id ——
// assignSceneIds 给**每个块**编号（含前言、附录、空标题前置块），
// 而本轮又要给 ▶ 条目编号，两者共用同一套编号实现。
//
// id 的功能需求只有四条：唯一、同一 PDF 重跑稳定、纯 ASCII、能被 targetSceneId 解析。
// 可读性不在其中 —— 中文原名在 Scene.name 里，校准报告按 name 配对之后
// 路径印的也是中文名，看报告的人不需要认得 id。
//
// 所以形态定为 scene_01…scene_NN：
//   零依赖 —— 拼音要加一个字典包，而 te_li_kan_jia 并不比 特里坎家 多告诉你任何东西；
//   天然不冲突 —— 重名标题各得各的号，不必再写消歧逻辑；
//   标题哈希相对它只多一个「跨 PDF 版本稳定」的优势，而我们不需要那个：
//   稳定性的用途是「同一份 PDF 重跑，diff 只反映生成器的改动」。
//
// 编号按**块**走而不是按场景走。只有一部分块会被判成场景，按场景编号的话，
// 分类器换一次结果，所有场景 id 会集体挪位；按块编号则各归各位。

import type { Section } from "./sectionize";
import { sourceKey } from "./sectionize";
import type { SectionKind } from "./classify-sections";

/** 两位起步，够 44 块用；超过 99 自然变三位，不截断 */
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 按顺序给每个块分配 id，返回与输入等长、按下标一一对应的数组。
 *
 * 不返回 Map<title, id>：标题可能重复（分类器正是栽在以标题为键上），
 * 以标题为键会静默丢块。调用方按下标取。
 */
export function assignSceneIds(sections: Section[]): string[] {
  return sections.map((_, i) => `scene_${pad(i + 1)}`);
}

/**
 * 给全文的 ▶ 条目分配 id，键是 sourceKey（`p9:L13`）。
 *
 * 必须覆盖**全部**条目，不能只覆盖「长在场景块上」的那批：那个筛选依赖块分类结果，
 * 一个块从 scene 翻成 npc，它名下的条目就消失，后面所有 id 集体挪位。
 * assignSceneIds 按全部块编号，正是为了避开这件事。
 *
 * 返回 Map 而不是像 assignSceneIds 那样返回等长数组，是因为键的性质不同：
 * 标题会重复，p{page}:L{line} 不会。以它为键既安全，下游也不必再维护一层下标对应。
 *
 * 「不会重复」这条不是本函数保证的，是 sectionize 给的：那边一行只 match 一次 ITEM_LINE
 * 就 continue（sectionize.ts 的条目分支），所以同一个 (page, line) 上至多一个条目。
 * 哪天那条规则放宽成一行允许两个 ▶，这里的 Map.set 会静默顶掉一个，而且 n 已经加过，
 * 编号会跳号——正是本函数存在的理由所要避免的那种漂移。改那边时记得回头看这里。
 */
export function assignItemIds(sections: Section[]): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const s of sections) {
    for (const it of s.items) {
      n++;
      out.set(sourceKey(it.source), `item_${pad(n)}`);
    }
  }
  return out;
}

/**
 * 给分类为 npc 的块单独编号——不复用 assignSceneIds 的编号空间。
 *
 * ⚠ 真 bug（开发·管线继承基准 id 发现）：`assemble-module.ts` 曾经给
 * NPC 直接用 `input.ids[i]`，也就是**该块在 assignSceneIds 里分到的场景
 * 编号**。块按 `sections` 下标统一编号（`scene_01`…`scene_NN`），场景与
 * NPC 只是同一份编号表里被 `kinds` 筛出来的两个子集，NPC 从没有过自己的
 * 编号——一个块被分类成 npc 时，它的"id"其实是它在全部块里的位置号，
 * 恰好落在场景 id 的取值范围里，与真正的场景 id 相撞（同一次跑里
 * `scene_05` 完全可能既是某个场景的 id，又是某个 NPC 的 id，取决于
 * 各自在 `sections` 里的下标）。
 *
 * 修法：独立计数，只数 `kinds.get(title) === "npc"` 的块，产出
 * `npc_01`…`npc_NN`，与 `assignItemIds` 同一种"按类别单独编号"思路——
 * `assignItemIds` 早就不跟 `assignSceneIds` 共用编号空间，NPC 这条本该
 * 一开始就照做，是遗漏。
 *
 * 返回 Map<title, id> 而不是等长数组：调用方（`assemble-module.ts`）是按
 * `sections[i].title` 查、不是按下标查——原 bug 正是"按下标查一张为
 * 别的用途编的号表"，返回等长数组只会让同类错误更容易被复制一遍。
 */
export function assignNpcIds(sections: Section[], kinds: Map<string, SectionKind>): Map<string, string> {
  const out = new Map<string, string>();
  let n = 0;
  for (const s of sections) {
    if (kinds.get(s.title) !== "npc") continue;
    n++;
    out.set(s.title, `npc_${pad(n)}`);
  }
  return out;
}
