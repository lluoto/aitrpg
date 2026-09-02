// 摄取管线 · 线索构建（todo-28：产线索数量一直是 0）
//
// 线索是这个模组的主体——基准 32 条，是场景/物品/NPC 加起来都比不上的
// 最大一块内容。而管线走到这一步，`build-scenes.ts` 早就把 `clues: []`
// 硬写死（该文件头 :3「本轮只填 id/name/description」，从没回来接上过），
// `build-items.ts:82` 的 `if (kind !== "item" && kind !== "trap") continue;`
// 又把分类器已经认出来的 clue 条目全部丢在地上——`classify-items.ts` 实跑
// 明明分出过 clue（`docs/notes/ingest.md` 记的第一次分布是 11 条，todo-51
// 修复后重跑的最终分布是 19 条），只是没有任何模块把它们接进 `Scene.clues`。
//
// 【范围已定，不扩】只产三个字段：`name` / `description` / `revelation`。
// 【不产】`findMethods` / `unlocks` / `importance` / `hint` / `failback` /
// `setStateVar`——这些字段描述的是"怎么找到""找到之后解锁什么""对玩法
// 有多重要"，原文是散文，没有任何结构标记能确定性抽出这些判断，抽出来
// 就是猜。`unlocks` 尤其不要碰：它正是卧室线索那个 bug 的根源（2c38d2c，
// `clue_bedroom_diary.unlocks` 曾经被曲解成"自动连锁发现"，酿成过一次
// 真实的可玩性问题）——手都不伸过去，比伸过去猜错再修安全。
//
// 与 `assemble-module.ts:12`「这一步一个字都不编」同一个纪律：抽不到的
// 字段留空/给最保守的占位值，报进 warnings，不编一个"看起来像模有样"
// 的假值——`Clue` 类型的 `findMethods`/`unlocks` 恰好是数组，留空数组
// 本身就是诚实的"没有"，不需要占位值；`importance` 是必填的三态枚举，
// 没有"未知"这个选项，只能给一个最保守的默认值并在 warnings 里说清楚
// 这不是真实评估（见下）。

import type { Clue, Provenance, Scene } from "../module/types";
import type { ItemInput, ItemKind } from "./classify-items";

export interface BuildCluesResult {
  /**
   * 新的 scenes 数组——每个场景的 `.clues` 已经填上属于它的线索，其余
   * 字段原样保留。不修改传入的 `scenes` 数组（调用方可能还要拿旧版本
   * 做别的事，函数式风格与 `build-scenes.ts`/`build-items.ts` 一致）。
   */
  scenes: Scene[];
  /** 产出的线索总数（跨全部场景），报告用——比逐场景数 `.clues.length` 更直接 */
  clueCount: number;
  /** 每条线索来自哪个 ▶ 条目（`sourceRef` = `ItemInput.key`，`pN:LN`），可复算、可倒查原文 */
  provenance: Provenance[];
  warnings: string[];
}

/**
 * 建线索。四个入参与 `buildItems` 同一套（`inputs`/`kinds`/`ids` 直接
 * 复用 `classifyItems`/`assignItemIds` 的产物，不另起一套编号或分类）。
 *
 * 场景归属：`ItemInput.sceneId` 在 `toItemInputs` 那一步就已经限定
 * "只收被判成 scene 的块上的条目"，理论上每条 clue 输入天然带着一个
 * 有效场景 id。这里仍然显式核对 `sceneId` 落在传入的 `scenes` 里
 * （防御性检查，不是信任上游一定不出错）——核对不上的按
 * `assemble-module.ts:63-65` 处理 NPC 归属同一个态度：没有依据就不填，
 * 报 warning，不按文档顺序或名字相似度去猜该挂在哪个场景。
 */
export function buildClues(
  scenes: Scene[],
  inputs: ItemInput[],
  kinds: Map<string, ItemKind>,
  ids: Map<string, string>,
): BuildCluesResult {
  const warnings: string[] = [];
  const provenance: Provenance[] = [];
  const sceneIdSet = new Set(scenes.map((s) => s.id));
  const cluesBySceneId = new Map<string, Clue[]>();
  // 场景内重名检测——与 build-items.ts 的全局重名检测同一个理由，只是
  // 范围收窄到"同一个场景内"：calibrate.ts 按 (id/name) 在**每个场景自己
  // 的 clues 数组内**配对，跨场景重名不影响配对，场景内重名才会让
  // bucketBy 的"按次序两两配"生效。
  const nameCountBySceneId = new Map<string, Map<string, number>>();

  let unclassified = 0;
  let nameless = 0;
  let noScene = 0;

  for (const input of inputs) {
    const kind = kinds.get(input.key);
    if (kind === undefined) {
      unclassified++;
      continue;
    }
    if (kind !== "clue") continue;

    const id = ids.get(input.key);
    if (id === undefined) throw new Error(`[ingest] 条目 ${input.key} 没有分到 id`);

    // 线索没有名字就没法被指认——校准器按 name 配对，玩家也没法说出
    // 一个没有名字的东西。与 build-items.ts 对物品的同一条判据同构。
    if (input.name === "") {
      nameless++;
      continue;
    }

    if (!sceneIdSet.has(input.sceneId)) {
      noScene++;
      continue;
    }

    const clue: Clue = {
      id,
      name: input.name,
      // description/revelation 同取一份原文——▶ 条目正文本身就是"找到
      // 这条线索会发生什么"，原文里没有另一份独立的"发现前提示文案"，
      // 硬拆成两份不同的话就是在编——两个字段指向同一段原文是诚实的
      // 表示，不是偷懒漏填。
      description: input.text,
      findMethods: [],
      revelation: input.text,
      unlocks: [],
      found: false,
      // 必填字段，没有"未知"选项——给最保守的默认值（不主动提示、
      // 不影响流程），并在 warnings 里说清楚这不是真实评估。
      importance: "color",
    };

    if (!cluesBySceneId.has(input.sceneId)) cluesBySceneId.set(input.sceneId, []);
    cluesBySceneId.get(input.sceneId)!.push(clue);

    if (!nameCountBySceneId.has(input.sceneId)) nameCountBySceneId.set(input.sceneId, new Map());
    const nameCount = nameCountBySceneId.get(input.sceneId)!;
    nameCount.set(input.name, (nameCount.get(input.name) ?? 0) + 1);

    provenance.push({
      path: `scenes[${input.sceneId}].clues[${id}]`,
      source: input.text,
      sourceRef: input.key,
      result: "产出 name/description/revelation；findMethods/unlocks 留空，importance 占位为 color",
      reason: "摄取管线只抽可判定字段——findMethods/unlocks/importance/hint/failback/setStateVar 原文是散文，没有结构标记可供确定性抽取，抽了就是猜",
      by: "rule",
    });
  }

  if (unclassified > 0) warnings.push(`${unclassified} 个条目没有分类结果，已跳过`);
  if (nameless > 0) warnings.push(`${nameless} 个条目被判成线索但没有名字，已跳过`);
  if (noScene > 0) {
    warnings.push(`${noScene} 个条目被判成线索，但所在场景 id 在已建的 scenes 里找不到，已跳过（不猜挂到哪个场景）`);
  }

  let dupTotal = 0;
  for (const [sceneId, nameCount] of nameCountBySceneId) {
    for (const [name, n] of nameCount) {
      if (n > 1) {
        dupTotal++;
        const sceneName = scenes.find((s) => s.id === sceneId)?.name ?? sceneId;
        warnings.push(`场景「${sceneName}」内线索名「${name}」出现 ${n} 次；校准器按 name 配对，其中一个会报成 extra，那不是幻觉。本轮不去重，都产出`);
      }
    }
  }

  const clueCount = [...cluesBySceneId.values()].reduce((a, c) => a + c.length, 0);
  if (clueCount > 0) {
    warnings.push(
      `产出的 ${clueCount} 条线索均未生成 findMethods/unlocks/hint/failback/setStateVar（原文无结构标记，管线不猜）；` +
        `importance 字段类型要求非空，暂填 "color" 占位，不代表真实评估过的重要度——下一轮要用这批线索前，这几个字段都需要人工补全`,
    );
  }

  const newScenes = scenes.map((s) => ({ ...s, clues: cluesBySceneId.get(s.id) ?? [] }));

  return { scenes: newScenes, clueCount, provenance, warnings };
}
