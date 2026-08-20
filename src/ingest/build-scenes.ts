// 摄取管线 · 场景骨架
//
// 把分好类的块变成 Scene[]。本轮只填 id / name / description 三个字段，
// 其余一律不填 —— 没抽就是没抽。填 undefined 或编一个占位值，
// 都会让校准报告读不出「还差多少」，而那份差异清单正是下一轮的路线图。
//
// ▶ 条目 buildScenes 不消费：基准里 ▶捕兽夹 是 ModuleItem，▶ 搜查项是 Clue，
// 都不属于场景描述。混进 description 会让抽线索/抽物品的那一步
// 面对一份已经被污染的正文。不消费不是遗漏，是分工 —— 同一次跑里
// 下游的 toItemInputs + buildItems 就把它们接走了。

import type { Scene } from "../module/types";
import type { Section } from "./sectionize";
import type { SectionKind } from "./classify-sections";

export interface BuildScenesResult {
  scenes: Scene[];
  /** 跳过的块、不消费的 ▶ 条目、重名标题 —— 不静默丢东西 */
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

    // 在所有 continue 之前记数。这个数说的是**输入里一共有多少 ▶ 条目** ——
    // buildScenes 一条都不消费，所以它等于全部块上条目数的总和，与分类结果无关。
    //
    // 原来它在 kind === "scene" 之后加，于是挂在 structure/npc/rule 块上的条目
    // （实跑里 16 条）连同 title 为空的前置块上的（`sectionize.ts:102-103`
    // 明确给「任何标题之前的条目」留了位置）一起，无声无息地没了。
    // warnings 那个字段的注释写着「不静默丢东西」，那就得是这个口径。
    //
    // 口径保持「全部块」不变，但要知道它和下游对不上，且这不是 bug：
    // 下游的 toItemInputs 只收 scene 块上的条目（`classify-items.ts:57-58`），
    // 所以实跑里这条报 39、物品那一步只见到 37（2 条挂在 npc 块上）。
    // 留全部块口径是因为它是个不动的分母：场景口径的数会跟着分类器一起动，
    // 看到数变了会分不清是抽取有进展还是分类把块挪了个类。文案里点明「含非场景块」，
    // 读的人才不会拿它去跟下游的数硬对。
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
  // 文案改过一次。原来写「本轮未消费（属线索/物品，留给下一轮）」——
  // 写的时候是真的，那会儿场景这一轮之后没有下一步；现在同一次跑里紧接着就分类、
  // 建物品（实跑 17 条成了 ModuleItem），report 里这句话正压在「它们被消费掉」的
  // 那一节上面。数没错，是话错了：一份度量工具说反话比不报还糟。
  if (droppedItems > 0) {
    warnings.push(`${droppedItems} 个 ▶ 条目 buildScenes 不消费（计入全部块，含非场景块与前置块），由下游 item/clue 路径处理`);
  }
  for (const [title, n] of titleCount) {
    if (n > 1) {
      warnings.push(`标题「${title}」出现 ${n} 次；分类器以标题为键，这几块只能拿到同一类，但 id 各自独立`);
    }
  }

  return { scenes, warnings };
}
