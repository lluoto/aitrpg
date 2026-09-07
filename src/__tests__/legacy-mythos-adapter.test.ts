// Step 5B behavior freeze: this fixture was captured from MythosModuleLoader
// before custom-modules/premiers_barn.ts became a thin adapter. Expectations
// are intentionally independent from deriveMythosModule.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { deriveMythosModule, findRuntimeProjectionDifferences } from "../module/unified-module";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";
import { MYTHOS_CREATURE_BY_ID, MYTHOS_CREATURE_MAP } from "../rules/mythos-module";

interface LoaderSnapshot {
  lines: string[];
  scenes: Array<Record<string, unknown>>;
  exits: Array<[string, Array<Record<string, unknown>>]>;
  entities: Array<Record<string, unknown>>;
  personalities: Array<Record<string, unknown>>;
  clues: Array<Record<string, unknown>>;
  hooks: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  spells: Array<[string, Record<string, unknown>]>;
  sceneItems: Array<[string, string[]]>;
  itemDescriptions: Array<[string, string]>;
  kpNotes: Array<[string, string]>;
  rewards: Array<[string, Record<string, unknown>]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`fixture ${label} 必须是数组`);
  return value;
}

function loadSnapshot(): LoaderSnapshot {
  const raw: unknown = JSON.parse(readFileSync("src/__tests__/fixtures/premiers-barn-loader-snapshot.json", "utf8"));
  if (!isRecord(raw)) throw new Error("loader snapshot 必须是对象");
  const records = (key: string) => asArray(raw[key], key).map((value) => {
    if (!isRecord(value)) throw new Error(`fixture ${key} 项必须是对象`);
    return value;
  });
  const pairs = <T>(key: string): Array<[string, T]> => asArray(raw[key], key).map((value) => {
    if (!Array.isArray(value) || typeof value[0] !== "string") throw new Error(`fixture ${key} 项必须是键值对`);
    return [value[0], value[1] as T];
  });
  return {
    lines: asArray(raw.lines, "lines").map((value) => {
      if (typeof value !== "string") throw new Error("fixture lines 项必须是字符串");
      return value;
    }),
    scenes: records("scenes"),
    exits: pairs<Array<Record<string, unknown>>>("exits"),
    entities: records("entities"),
    personalities: records("personalities"),
    clues: records("clues"),
    hooks: records("hooks"),
    messages: records("messages"),
    spells: pairs<Record<string, unknown>>("spells"),
    sceneItems: pairs<string[]>("sceneItems"),
    itemDescriptions: pairs<string>("itemDescriptions"),
    kpNotes: pairs<string>("kpNotes"),
    rewards: pairs<Record<string, unknown>>("rewards"),
  };
}

const frozen = loadSnapshot();
const derived = deriveMythosModule(BARN_OF_PREMIER);

describe("步骤 5B：薄适配保持迁移前 Mythos loader 关键输出", () => {
  it("旧导出接口仍是统一入口的确定性派生，不再持有独立事实对象", () => {
    expect(MODULE_PREMIERS_BARN).toEqual(derived);
    expect(MODULE_PREMIERS_BARN).not.toBe(derived);
  });

  it("场景描述、出口、NPC 与人格输出保持冻结结果", () => {
    const sceneDescriptions = Object.fromEntries(
      frozen.scenes
        .filter((scene) => typeof scene.description === "string" && typeof scene.sceneId === "string")
        .map((scene) => [scene.sceneId as string, scene.description]),
    );
    expect(derived.sceneDescriptions as unknown).toEqual(sceneDescriptions);
    expect(derived.exits as unknown).toEqual(Object.fromEntries(frozen.exits));
    const loadedEntities = (derived.npcs ?? []).map((npc) => {
      const creature = npc.mythosCreatureId
        ? MYTHOS_CREATURE_BY_ID.get(npc.mythosCreatureId) ?? MYTHOS_CREATURE_MAP.get(npc.mythosCreatureId)
        : undefined;
      return {
        id: npc.id,
        name: npc.name,
        type: npc.type,
        hp: creature?.hp ?? npc.hp,
        maxHp: creature?.maxHp ?? npc.maxHp,
        ac: creature?.ac ?? npc.ac,
        status: [],
        position: npc.sceneId,
        faction: creature && npc.faction === "神话生物" ? creature.name : npc.faction,
        scene_id: npc.sceneId,
        attributes: npc.attributes ?? {},
        skills: npc.skills ?? {},
      };
    });
    expect(loadedEntities as unknown).toEqual(frozen.entities);
    expect(derived.npcs?.filter((npc) => npc.personality || npc.npcPersonalityId).map((npc) => ({
      npcName: npc.name,
      personality: {
        ...(npc.personality ?? {}),
        background: npc.personality?.background ?? "",
        goals: npc.personality?.goals ?? [],
        secrets: npc.personality?.secrets ?? [],
      },
      npcPersonalityId: npc.npcPersonalityId,
    })) as unknown).toEqual(frozen.personalities);
  });

  it("线索、典籍物品、法术、奖励、KP notes、hooks 与导入消息保持冻结结果", () => {
    const itemMap = new Map<string, string[]>();
    const itemDescriptionMap = new Map<string, string>();
    const addItem = (sceneId: string, name: string) => {
      const names = itemMap.get(sceneId) ?? [];
      if (!names.includes(name)) names.push(name);
      itemMap.set(sceneId, names);
    };
    for (const tome of derived.tomes ?? []) addItem(tome.sceneId, tome.name);
    for (const item of derived.items ?? []) {
      const names = itemMap.get(item.sceneId) ?? [];
      const isNew = !names.includes(item.name);
      if (isNew) names.push(item.name);
      itemMap.set(item.sceneId, names);
      if (isNew && item.description) itemDescriptionMap.set(item.name, item.description);
    }
    expect(derived.clues?.map((clue) => ({ sceneName: clue.scene, clueType: clue.clueType, description: clue.description, sanCost: clue.sanCost })) as unknown).toEqual(frozen.clues);
    expect(derived.hooks as unknown).toEqual(frozen.hooks);
    expect([...itemMap.entries()] as unknown).toEqual(frozen.sceneItems);
    expect([...itemDescriptionMap.entries()] as unknown).toEqual(frozen.itemDescriptions);
    expect((derived.spells ?? []).map((spell) => [spell.name, {
      sanCost: spell.sanCost, mpCost: spell.mpCost, description: spell.description, effect: spell.effectType,
    }]) as unknown).toEqual(frozen.spells);
    expect(Object.entries(derived.kpNotes ?? {}) as unknown).toEqual(frozen.kpNotes);
    expect((derived.rewards ?? []).map((reward) => [reward.id, reward]) as unknown).toEqual(frozen.rewards);
    const firstMessage = frozen.messages[0];
    if (typeof firstMessage?.content !== "string") throw new Error("fixture first message lacks content");
    expect(derived.introNarration).toBe(firstMessage.content);
    expect(derived.hooks).toHaveLength(34);
    expect(frozen.lines).toContain("构建 41 条模组场景显式出口");
  });

  it("**变异检验**：漏掉一个出口会被原始运行配置与派生配置的结构对账报出", () => {
    const expected = BARN_OF_PREMIER.runtime!;
    const exits = structuredClone(expected.loaderExits!);
    delete exits["维修间"];
    const broken = { ...expected, loaderExits: exits };
    expect(findRuntimeProjectionDifferences(expected, broken)).toEqual([
      expect.objectContaining({ field: "loaderExits" }),
    ]);
  });

  it("**变异检验**：漏掉一个 runtime NPC 会让旧接口派生显式失败，不静默丢弃", () => {
    const broken = structuredClone(BARN_OF_PREMIER);
    broken.npcs = broken.npcs.filter((npc) => npc.runtime?.sourceId !== "mi-go");
    expect(() => deriveMythosModule(broken)).toThrow("缺少运行 NPC：mi-go");
  });

  it("统一来源的值改变会改变旧接口派生输出，证明没有第二份手填值", () => {
    const altered = structuredClone(BARN_OF_PREMIER);
    altered.runtime!.introNarration = "统一来源变异：旧接口必须读取此值";
    expect(deriveMythosModule(altered).introNarration).toBe("统一来源变异：旧接口必须读取此值");
  });
});
