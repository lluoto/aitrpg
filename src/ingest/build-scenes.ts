// 摄取管线 · 场景骨架
//
// 把分好类的块变成 Scene[]。本轮只填 id / name / description 三个字段，
// 其余一律不填 —— 没抽就是没抽。填 undefined 或编一个占位值，
// 都会让校准报告读不出「还差多少」，而那份差异清单正是下一轮的路线图。
//
// ▶ 条目本轮丢弃：基准里 ▶捕兽夹 是 ModuleItem，▶ 搜查项是 Clue，
// 都不属于场景描述。混进 description 会让下一轮抽线索时
// 面对一份已经被污染的正文。丢弃不是遗漏，是分工。

import type { Scene } from "../module/types";
import type { Section } from "./sectionize";
import type { SectionKind } from "./classify-sections";

export interface BuildScenesResult {
  scenes: Scene[];
  /** 跳过的块、未消费的条目、重名标题 —— 不静默丢东西 */
  warnings: string[];
}

/**
 * 建场景骨架。
 *
 * ids 必须与 sections 等长且按下标对应（见 assignSceneIds）。
 * kinds 以标题为键，是 classifySections 的原样产出。
 */
export function buildScenes(
  sections: Section[],
  kinds: Map<string, SectionKind>,
  ids: string[],
): BuildScenesResult {
  if (ids.length !== sections.length) {
    throw new Error(`[ingest] ids 与 sections 长度不符：${ids.length} vs ${sections.length}`);
  }

  const scenes: Scene[] = [];
  const warnings: string[] = [];
  const titleCount = new Map<string, number>();
  let unclassified = 0;
  let droppedItems = 0;

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i] as Section;

    // 在所有 continue 之前记数。这个数说的是**本轮**丢了多少 ▶ 条目，
    // 不是「本轮的场景上丢了多少」—— buildScenes 一条 ▶ 都不消费，
    // 所以它就等于输入里 ▶ 条目的总数，与分类结果无关。
    //
    // 原来它在 kind === "scene" 之后加，于是挂在 structure/npc/rule 块上的条目
    // （实跑里 16 条）连同 title 为空的前置块上的（`sectionize.ts:102-103`
    // 明确给「任何标题之前的条目」留了位置）一起，无声无息地没了。
    // warnings 那个字段的注释写着「不静默丢东西」，那就得是这个口径。
    //
    // 选记全轮而不是把文案改成「场景上的 N 条」，是为了下一轮：
    // 下一轮要把 ▶ 抽成 Clue/ModuleItem，NPC 块上的 ▶ 同样是它的活。
    // 而且场景口径的数会跟着分类器一起动 —— 下轮看到数变了，分不清是抽取有进展
    // 还是分类把块挪了个类；全轮口径是个不动的分母，减少多少就是干掉了多少。
    droppedItems += s.items.length;

    if (s.title === "") continue; // 前置块，没有标题就不是内容

    const kind = kinds.get(s.title);
    if (kind === undefined) {
      unclassified++;
      continue;
    }
    if (kind !== "scene") continue;

    titleCount.set(s.title, (titleCount.get(s.title) ?? 0) + 1);

    scenes.push({
      id: ids[i] as string,
      name: s.title,
      description: s.body,
      clues: [],
      npcIds: [],
      connections: [],
    });
  }

  if (unclassified > 0) warnings.push(`${unclassified} 个块没有分类结果，已跳过`);
  if (droppedItems > 0) warnings.push(`${droppedItems} 个 ▶ 条目本轮未消费（属线索/物品，留给下一轮）`);
  for (const [title, n] of titleCount) {
    if (n > 1) {
      warnings.push(`标题「${title}」出现 ${n} 次；分类器以标题为键，这几块只能拿到同一类，但 id 各自独立`);
    }
  }

  return { scenes, warnings };
}
