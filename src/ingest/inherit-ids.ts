// 摄取管线 · id 继承（开发·管线继承基准 id，对应 todo-48）。
//
// 背景：生成侧的 id 是内部句柄（`scene_07`/`item_03`，见 ids.ts），基准
// （`barn-of-premier.ts`）是人工意译（`adrian_bedroom`/`clue_bedroom_diary`）
// ——两套体系本来就不该一样，calibrate.ts 因此按 name 配对，报出的
// id-mismatch/ref-mismatch 一直是「命名体系不同」这一种噪音，不是内容
// 差异。噪音掩盖的是 build-clues 这类下一步该看的真实差异。
//
// 已定方向（不是本文件自己决定的，是任务背景写明的）：不迁移 id，让
// 管线继承基准 id。
//   id    人工维护的稳定层 —— 全仓 ~681 处引用一处不动，摄取管线自己的
//         评分度量（按 id 配对基准条目那一套）继续有效
//   内容  可重新生成的层   —— 管线产出这个
// `scene_NN`/`item_NN` 因此降级为管线内部中转，只在配不上基准 name 时
// 才会真的出现在最终产物里（这种情况本身也要显式报出来，不能假装没有）。
//
// ⚠ 配不上 name 的必须显式报进 warnings 并保留内部 id，不得静默生成一个
// 新 id——那等于偷偷引入第四套命名体系（现有三套见 todo-19/34）。这里
// 说的"保留内部 id"不是"假装配上了"：内部 id 的形状本身
// （`scene_NN`/`item_NN`）就是"这一条没能继承基准 id"的可见信号，比
// 编一个自己都不知道算不算数的新 id 更诚实。
//
// 只处理 scene / item 两类——clue 目前还没有独立生成（build-scenes.ts:99
// `clues: []`，todo-28），没有 id 可继承；npc 的 id 命名空间问题是另一个
// bug（复用了 scene_NN 编号空间），修法是给它自己的编号（见 ids.ts
// `assignNpcIds`），不是靠这里的按 name 继承——npc.sceneId 目前恒为
// ""（assemble-module.ts 的已知缺口），没有基准 NPC 数据可比对 name。

import type { ModuleItem, Scene } from "../module/types";
import { stripDisplayAnnotation } from "./three-way-audit";

export interface IdInheritanceEntity {
  id: string;
  name: string;
}

export interface IdInheritanceResult {
  /** 旧的内部 id → 继承到的基准 id，只收配上的那些 */
  idMap: Map<string, string>;
  /** 配不上（或撞了重名）的候选，每条都在这——不是数字，是可读清单 */
  warnings: string[];
}

/**
 * 按 name 把候选的内部 id 映射到基准 id。纯函数，只算映射，不改数据——
 * 应用映射是下面两个 apply* 函数的事，分开是为了让"算映射"本身可以
 * 独立单测，不用每次都造一份完整的 Scene/ModuleItem。
 *
 * 基准 name 唯一是前提（当前 BARN_OF_PREMIER 的 scenes/items 均已核实
 * 唯一，见 mutation 测试）——如果基准出现重名，这条 name 整体判定为
 * "无法唯一配对"，两侧候选都保留内部 id 并报 warning，不去猜哪个对哪个
 * （calibrate.ts 的 bucketBy 允许猜"按出现顺序两两配"，这里不允许：
 * calibrate.ts 只是在报告里配对**展示**差异，猜错了顶多报告读起来别扭；
 * 这里是要把 id 真的写回数据、写回场景连接引用，猜错的后果是把玩家
 * 送错场景）。
 *
 * 候选内部重名同理：两个候选共享同一个 name，只有第一个能认领这个
 * 基准 id，其余保留内部 id 并报 warning——不能让两个候选拿到同一个
 * 基准 id，那比继承不到 id 更糟（下游会分不清是哪一个）。
 *
 * 按 `stripDisplayAnnotation` 归一化后比较（去掉基准侧手写的尾部括号
 * 注解，如"维修间（终局场景）"→"维修间"）——那类注解是数据作者给自己
 * 看的提示，PDF 原文与管线生成的候选自然不会带它，逐字比较会把纯粹的
 * 写法差异误判成"配不上"（与 three-way-audit.ts 用同一个函数处理实体
 * 名核对是同一个理由，见该函数注释：阶段7 实测过不做这层归一化的
 * 假阳性数）。
 */
export function computeIdInheritance(
  candidates: IdInheritanceEntity[],
  baseline: IdInheritanceEntity[],
  label: string,
): IdInheritanceResult {
  const baselineByName = new Map<string, string>();
  const baselineDupNames = new Set<string>();
  for (const b of baseline) {
    const key = stripDisplayAnnotation(b.name);
    if (baselineByName.has(key)) {
      baselineDupNames.add(key);
      continue;
    }
    baselineByName.set(key, b.id);
  }

  const idMap = new Map<string, string>();
  const warnings: string[] = [];
  const claimedBaselineIds = new Set<string>();

  for (const c of candidates) {
    const key = stripDisplayAnnotation(c.name);
    if (baselineDupNames.has(key)) {
      warnings.push(`${label}「${c.name}」（内部 id ${c.id}）在基准里重名，无法唯一配对，保留内部 id`);
      continue;
    }
    const baseId = baselineByName.get(key);
    if (baseId === undefined) {
      warnings.push(`${label}「${c.name}」（内部 id ${c.id}）在基准里找不到同名条目，保留内部 id`);
      continue;
    }
    if (claimedBaselineIds.has(baseId)) {
      warnings.push(`${label}「${c.name}」（内部 id ${c.id}）与另一个候选重名，基准 id ${baseId} 已被占用，保留内部 id`);
      continue;
    }
    claimedBaselineIds.add(baseId);
    idMap.set(c.id, baseId);
  }

  return { idMap, warnings };
}

/**
 * 把场景 id 映射应用到生成的 scenes 上——同时改写 id 本身与
 * `connections[].targetSceneId`（那是指向别的场景 id 的引用，场景 id 变了
 * 它必须跟着变，否则出口会指向一个已经不存在的旧内部 id）。
 * 配不上的（idMap 里没有）原样保留，不是错误，是上面已经报过的已知缺口。
 */
export function applySceneIdInheritance(scenes: Scene[], sceneIdMap: Map<string, string>): Scene[] {
  return scenes.map((s) => ({
    ...s,
    id: sceneIdMap.get(s.id) ?? s.id,
    connections: s.connections.map((c) => ({
      ...c,
      targetSceneId: sceneIdMap.get(c.targetSceneId) ?? c.targetSceneId,
    })),
  }));
}

/**
 * 把物品 id 映射应用到生成的 items 上——`sceneId` 字段引用的是场景 id，
 * 要用场景那份映射改写，不是物品自己的映射；物品自身的 id 用物品的
 * 映射改写。两份映射来源不同，调用方要传对，签名上分开两个参数就是
 * 为了不让人手滑传错。
 */
export function applyItemIdInheritance(
  items: ModuleItem[],
  sceneIdMap: Map<string, string>,
  itemIdMap: Map<string, string>,
): ModuleItem[] {
  return items.map((it) => ({
    ...it,
    id: itemIdMap.get(it.id) ?? it.id,
    sceneId: sceneIdMap.get(it.sceneId) ?? it.sceneId,
  }));
}
