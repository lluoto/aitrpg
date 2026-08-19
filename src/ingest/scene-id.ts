// 摄取管线 · 场景 id 分配
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
