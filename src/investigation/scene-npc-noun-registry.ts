// 「角色名词」登记表——线索路径提到某个角色，但场景 npcIds 里没有
// 对应实体，是可复现的一类缺口（开发·在场实体与线索路径 N7，todo-41：
// 维森酒吧提到"前台"却没有前台、报亭提到"报亭老板"却没有 NPC）。
// 此前只能靠实跑撞到（analysis/sim/2026-08-30-barn-natural-play.md 那次
// 就是玩家换了四种问法才浮出水面），这份登记表把它变成一条确定性判据。
//
// 照本仓既有登记表惯例（KNOWN_UNREACHABLE / FABRICATION_REGISTRY /
// NARRATIVE_VOCABULARY_REGISTRY / CONFIRMED_FABRICATION_LOG）：只登记
// 已经核实过的词，不做通用扩展。

import type { ModuleData, ModuleNPC, Scene } from "../module/types";

/**
 * 登记的角色名词。只收"线索的 description/findMethods 里真的出现过、
 * 且这个人物确实是获取线索要问的对象"这一类词——不是随手把中文里所有
 * "角色类名词"都塞进来。
 *
 * "保安"/"客人"/"其他人"不收：weisen_bar 原文明确写这两类人「不回答
 * 或者不知道」，没有任何线索的获取路径依赖问他们（clue_bar_ask_around
 * 问的是"其他人"里爱八卦的那个，但那本身就是 bonus 线索、无法定位到
 * 具体某一个人，不是"场景该有个 NPC 却没有"这类缺口，是原文本来就写
 * 成"随缘问一圈"，登记这个词会制造假阳性）。
 */
export const CHARACTER_NOUN_REGISTRY: string[] = [
  "前台", // weisen_bar：clue_bar_mass_booking / clue_bar_guest_identity 的唯一获取路径
  "报亭老板", // newsstand：clue_newspaper_kidnapper 的交易对象（原文"询问报亭老板…""老板会咂咂嘴…"）
  // 开发·约束层补角色实体域 N9（todo-56）：单独收"老板"这个短称呼——
  // 真实撞坑案例（analysis/sim/2026-08-30-barn-natural-play.md:58）里
  // 酒吧保镖说的是「老板锁进抽屉了」，不是"报亭老板"这个完整复合词，
  // 按子串匹配抓不住。收成独立一条不会在 newsstand 产生新缺口——
  // newsstand_owner 的 name 是"报亭老板"，本身就包含"老板"两个字，
  // `representsCharacterNoun` 依旧判定它代表这个词；`findModuleChara
  // cterNounGaps` 实测过加了这条之后全模组仍是 0 命中。
  "老板",
];

/** 场景内确属跨场景引用、不需要本场景补 NPC 的豁免登记。 */
export interface SceneNounExemption {
  sceneId: string;
  noun: string;
  reason: string;
}

export const SCENE_NOUN_EXEMPTIONS: SceneNounExemption[] = [];

export interface SceneNounGap {
  sceneId: string;
  sceneName: string;
  noun: string;
  clueId: string;
}

/**
 * 一个实体是否"代表"这个角色名词——按 role/name 是否包含该词判断。
 *
 * 参数放宽成 `{ name; role? }` 而不是锁死 `ModuleNPC`——开发·约束层
 * 补角色实体域 N9：运行时能拿到的是 `WorldEntity`（只有 `name`，没有
 * `role`），静态扫描（`findSceneCharacterNounGaps`）拿到的是
 * `ModuleNPC`（两者都有）。两处判定"这个实体算不算数"的标准必须是
 * 同一份，不能运行时判定悄悄比静态扫描宽松或严格——所以这里放宽类型
 * 而不是另外单独给运行时写一份判定。
 */
export function representsCharacterNoun(entity: { name: string; role?: string }, noun: string): boolean {
  return (entity.role ?? "").includes(noun) || entity.name.includes(noun);
}

/**
 * 给定「实际在场的实体」列表，登记表里哪些角色名词【没有】被代表——
 * 供运行时约束层用（NPC 说话提到这些词就是在编造场景里不存在的角色）。
 * 与 `findSceneCharacterNounGaps` 反过来看同一份事实：那边问"线索要求
 * 的角色，场景是否真的有"（离线扫描模组数据）；这里问"登记表里的角色，
 * 这个场景实际有哪些、没有哪些"（供运行时按在场实体名单实时算）。
 */
export function unrepresentedCharacterNouns(
  presentEntities: { name: string; role?: string }[],
  registry: string[] = CHARACTER_NOUN_REGISTRY,
): string[] {
  return registry.filter((noun) => !presentEntities.some((e) => representsCharacterNoun(e, noun)));
}

function clueTexts(clue: Scene["clues"][number]): string[] {
  return [clue.description, ...clue.findMethods.map((f) => f.description)];
}

/**
 * 扫描给定的场景/NPC 数据，找出「线索提到登记表里的角色名词，但场景
 * npcIds 里没有对应实体」的缺口。
 *
 * ⚠ 能力边界（同 narrative-vocabulary-registry.ts:17-23 的处理方式，别
 * 让下一个人以为这份判据覆盖了"所有场景实体缺口"）：只认
 * CHARACTER_NOUN_REGISTRY 里已经登记的词，不做分词、不自动从线索文本
 * 里提炼新词、也不判断"这里可能还有一个没登记的角色"——表外的词
 * （比如一个新模组用了"店员"这个从没出现过的词）不会被这份判据发现，
 * 只能靠人工阅读线索文本找到，发现后手动加一条登记。
 */
export function findSceneCharacterNounGaps(
  scenes: Scene[],
  npcs: ModuleNPC[],
  registry: string[] = CHARACTER_NOUN_REGISTRY,
  exemptions: SceneNounExemption[] = SCENE_NOUN_EXEMPTIONS,
): SceneNounGap[] {
  const npcById = new Map(npcs.map((n) => [n.id, n]));
  const gaps: SceneNounGap[] = [];

  for (const scene of scenes) {
    const sceneNpcs = scene.npcIds.map((id) => npcById.get(id)).filter((n): n is ModuleNPC => !!n);
    for (const clue of scene.clues) {
      const texts = clueTexts(clue);
      for (const noun of registry) {
        if (!texts.some((t) => t.includes(noun))) continue;
        if (exemptions.some((e) => e.sceneId === scene.id && e.noun === noun)) continue;
        if (sceneNpcs.some((n) => representsCharacterNoun(n, noun))) continue;
        gaps.push({ sceneId: scene.id, sceneName: scene.name, noun, clueId: clue.id });
      }
    }
  }
  return gaps;
}

/** 便捷入口：直接对一份完整 ModuleData 跑扫描。 */
export function findModuleCharacterNounGaps(
  mod: ModuleData,
  registry: string[] = CHARACTER_NOUN_REGISTRY,
  exemptions: SceneNounExemption[] = SCENE_NOUN_EXEMPTIONS,
): SceneNounGap[] {
  return findSceneCharacterNounGaps(mod.scenes, mod.npcs, registry, exemptions);
}
