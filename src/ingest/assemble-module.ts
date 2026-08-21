// 把摄取出来的零件装配成一个完整的 ModuleData。
//
// 为什么需要这一步：摄取产出的是**零件**（场景、物品、溯源），
// 而运行时 `runModule` 与 `populateWorldFromModule` 吃的是 `ModuleData` ——
// 一个有 id/title/era/summary/npcs/meta/endings 的完整结构。
// 在这之前，摄取产物与运行时之间没有任何通路：
// 运行时只跑过硬编码的 `BARN_OF_PREMIER`。
//
// ⚠️ 别跟 `MythosModule` 搞混。`data/modules` + `loadModuleFile` 存的是那个，
// 是另一套东西（`src/rules/mythos-module.ts:163`），不是可玩模组。
//
// **这一步一个字都不编。** 抽到什么写什么，没抽到的留空并报进 warnings。
// 理由：模组数据是给主持人当事实用的，编出来的「性格：沉默寡言」
// 会被当成原文里写着的东西照着演。宁可空着让人一眼看出缺，
// 也不要填一个看起来像模像样的假值。
import type { Ending, ModuleData, ModuleItem, ModuleNPC, Provenance, Scene } from "../module/types";
import type { Section } from "./sectionize";
import type { SectionKind } from "./classify-sections";

export interface AssembleInput {
  sections: Section[];
  /** 与 sections 平行的 id 表 */
  ids: string[];
  kinds: Map<string, SectionKind>;
  scenes: Scene[];
  items: ModuleItem[];
  provenance: Provenance[];
  endings?: Ending[];
}

export interface AssembleOptions {
  id: string;
  title: string;
  version?: string;
}

export interface AssembleResult {
  module: ModuleData;
  /** 每一处「没抽到、留空了」都记在这儿 */
  warnings: string[];
}

export function assembleModule(input: AssembleInput, opts: AssembleOptions): AssembleResult {
  const warnings: string[] = [];
  const npcs: ModuleNPC[] = [];

  for (let i = 0; i < input.sections.length; i++) {
    const s = input.sections[i] as Section;
    if (s.title === "") continue;
    if (input.kinds.get(s.title) !== "npc") continue;

    // 抽到的只有三样：名字、描述、块上的 ▶ 条目。
    // 基准把 npc 块上的条目收作 knowledge / secrets，但原文里
    // 没有任何标记能区分这两者，所以一律进 knowledge —— 分不出来就不分。
    npcs.push({
      id: input.ids[i] as string,
      name: s.title,
      description: s.body,
      role: "",
      personality: { traits: [], speech: "", attitude: "" },
      knowledge: s.items.map((it) => it.text),
      secrets: [],
      // 空着。NPC 在哪个场景要靠「块归属」来定，而那个信号量过 ——
      // 可计分样本只有 1 个，文档顺序在它上面还判错了。没有依据就不填。
      sceneId: "",
    });
  }

  if (npcs.length > 0) {
    warnings.push(
      `${npcs.length} 个 NPC 只有名字与描述 —— role / personality / sceneId 原文里没抽到，留空`,
    );
  }

  const module: ModuleData = {
    id: opts.id,
    title: opts.title,
    version: opts.version ?? "0.0.0-ingest",
    ruleset: "cosmic-horror",
    // era 与 summary 摄取都没做，不猜。
    era: "",
    summary: "",
    scenes: input.scenes,
    npcs,
    meta: {
      playerCount: "",
      expectedDuration: "",
      triggerWarnings: [],
    },
    endings: input.endings ?? [],
    items: input.items,
    provenance: input.provenance,
  };

  warnings.push("era / summary / meta 未抽取，留空");
  if (module.endings.length === 0) {
    // 这条要单独说：没有结局意味着这个模组跑起来不会自己结束。
    // 它不是「少一个字段」，是少一半玩法。
    warnings.push("endings 为空 —— 摄取没有做结局抽取，模组跑起来不会自行结束");
  }

  const noExit = input.scenes.filter((s) => s.connections.length === 0);
  if (noExit.length > 0) {
    warnings.push(`${noExit.length} 个场景没有出口：${noExit.map((s) => s.name).join("、")}`);
  }

  return { module, warnings };
}

/**
 * 中性的 ModuleSupport。
 *
 * `runModule` 除了 ModuleData 还要一份 ModuleSupport，里面全是模组专属逻辑：
 * 恐怖线索的 SAN 代价、结局评估、遭遇战、枢纽/终局场景 id……摄取一样都没抽。
 *
 * 这里给的是一份**什么都不做**的：没有结局评估、没有遭遇战、没有终局。
 * 它让摄取出来的模组能跑起来、能走动、能看描述，但不会自己结束，也不会打起来。
 * 同样不编 —— 编一个 finaleSceneId 出来，跑到那个场景就会莫名其妙地终局。
 */
export function neutralSupport(): import("../module/types").ModuleSupport {
  return {
    traumaticClues: {},
    evaluateEnding: () => null,
    endLabels: {},
    encounters: [],
    // 枢纽留空：模型认枢纽验过 5/5，但那还没接进管线。
    // 空串的效果是不做「回镇上重分派」的移动排序，不影响能不能走。
    hubSceneId: "",
    finaleSceneId: "",
    finaleClueId: "",
    // 匹配不到任何东西 —— 摄取没有做 BOSS 识别。
    bossNpcIdPattern: /(?!)/,
  };
}
