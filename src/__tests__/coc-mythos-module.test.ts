// 神话模组系统单元测试
// bun test src/__tests__/coc-mythos-module.test.ts

import { describe, it, expect } from "bun:test";
import {
  MythosModuleLoader,
  createMythosEntity,
  MYTHOS_CREATURE_MAP,
  MYTHOS_CREATURE_BY_ID,
  ARKHAM_LIBRARY_MODULE,
  type MythosModule,
  type MythosModuleHost,
} from "../rules/mythos-module";
import { MYTHOS_CREATURES, MYTHOS_TOMES, MYTHOS_SPELLS } from "../rules/mythos-expansion";
import type { MessageType } from "../agent/types";

// ============================================================
// MYTHOS_CREATURE_MAP — 生物名索引
// ============================================================

describe("MYTHOS_CREATURE_MAP", () => {
  it("所有 8 个生物均可通过中文名查到", () => {
    const expectedNames = ["深潜者", "修格斯", "夜魇", "廷达罗斯猎犬", "拜亚基", "维度漫步者", "星之精", "米戈"];
    for (const name of expectedNames) {
      expect(MYTHOS_CREATURE_MAP.get(name)).toBeDefined();
    }
  });

  it("所有 8 个生物均可通过 id 查到", () => {
    const expectedIds = ["deep_one", "shoggoth", "nightgaunt", "hound_of_tindalos", "byakhee", "dimensional_shambler", "star_vampire", "mi_go"];
    for (const id of expectedIds) {
      expect(MYTHOS_CREATURE_BY_ID.get(id)).toBeDefined();
    }
  });

  it("MYTHOS_CREATURES 数据完整性 — 每只生物都有必填字段", () => {
    for (const c of MYTHOS_CREATURES) {
      expect(c.hp).toBeGreaterThan(0);
      expect(c.maxHp).toBeGreaterThan(0);
      expect(c.ac).toBeGreaterThan(0);
      expect(c.str).toBeGreaterThan(0);
      expect(c.damage).toBeTruthy();
      expect(c.sanLoss).toMatch(/\d+d\d+/);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });

  it("不存在的生物名查询返回 undefined", () => {
    expect(MYTHOS_CREATURE_MAP.get("不存在")).toBeUndefined();
    expect(MYTHOS_CREATURE_BY_ID.get("nope")).toBeUndefined();
  });
});

// ============================================================
// createMythosEntity — 生物→世界实体转换
// ============================================================

describe("createMythosEntity", () => {
  it("通过生物 id 深潜者创建实体应有正确 HP/AC/名字", () => {
    const entity = createMythosEntity("deep_one", "innsmouth_docks");
    expect(entity.name).toBe("深潜者");
    expect(entity.type).toBe("monster");
    expect(entity.hp).toBe(15);
    expect(entity.maxHp).toBe(15);
    expect(entity.ac).toBe(13);
    expect(entity.position).toBe("innsmouth_docks");
    expect(entity.faction).toBe("神话生物");
  });

  it("通过中文名创建修格斯实体", () => {
    const entity = createMythosEntity("修格斯", "basement", "远古者造物");
    expect(entity.name).toBe("修格斯");
    expect(entity.hp).toBe(70);
    expect(entity.maxHp).toBe(70);
    expect(entity.ac).toBe(8);
    expect(entity.faction).toBe("远古者造物");
  });

  it("创建的实体 id 应为唯一（时间戳后缀）", () => {
    const e1 = createMythosEntity("byakhee", "sky");
    const e2 = createMythosEntity("byakhee", "sky");
    expect(e1.id).not.toBe(e2.id);
  });

  it("不存在的生物 id 应抛异常", () => {
    expect(() => createMythosEntity("不存在", "scene")).toThrow();
  });

  it("实体包含完整 stats 备份供战斗使用", () => {
    const entity = createMythosEntity("star_vampire", "temple");
    expect(entity.stats.str).toBe(14);
    expect(entity.stats.damage).toBe("1d6");
    expect(entity.stats.abilities.length).toBeGreaterThan(0);
  });
});

// ============================================================
// MythosModuleLoader — 模组导入逻辑
// ============================================================

/** 测试用 mock host */
function createMockHost(): MythosModuleHost {
  const spellMap = new Map<string, { sanCost: string; mpCost: number; description: string; effect?: string }>();
  const sceneItems = new Map<string, string[]>();
  const itemDescriptions = new Map<string, string>();
  const messages: Array<{ s: string; c: string; t: string }> = [];

  return {
    mythosSpells: spellMap,
    knownMythosSpells: [],
    sceneItems,
    itemDescriptions,
    world: {
      upsertEntity(_e: any) { /* mock */ },
      logEvent(_p: any) { /* mock */ },
    },
    addMessage(speaker: string, content: string, type: MessageType) {
      messages.push({ s: speaker, c: content, t: type });
    },
    activeRuleset: "cosmic-horror",
    currentRound: 1,
  };
}

describe("MythosModuleLoader", () => {
  it("导入模组后 importedModules 包含该模组 id", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    loader.import(ARKHAM_LIBRARY_MODULE);
    expect(loader.importedModules).toContain("arkham_miskatonic");
  });

  it("重复导入同一模组应跳过", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    loader.import(ARKHAM_LIBRARY_MODULE);
    const r2 = loader.import(ARKHAM_LIBRARY_MODULE);

    // 第二次导入后 importedModules 应只有 1 个
    expect(loader.importedModules.length).toBe(1);
    expect(r2.some(l => l.includes("已导入"))).toBe(true);
  });

  it("导入模组后法术注册到 mythosSpells", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    loader.import(ARKHAM_LIBRARY_MODULE);

    expect(host.mythosSpells.has("阿卡姆档案检索")).toBe(true);
    const spell = host.mythosSpells.get("阿卡姆档案检索")!;
    expect(spell.mpCost).toBe(1);
    expect(spell.sanCost).toBe("0/1d2");
  });

  it("导入模组后典籍放置到场景物品", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    loader.import(ARKHAM_LIBRARY_MODULE);

    const vaultItems = host.sceneItems.get("arkham_library_vault");
    expect(vaultItems).toBeDefined();
    expect(vaultItems!.includes("塞拉伊诺断章")).toBe(true);
  });

  it("导入模组后物品放置到指定场景", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    loader.import(ARKHAM_LIBRARY_MODULE);

    const libItems = host.sceneItems.get("arkham_miskatonic");
    expect(libItems).toBeDefined();
    expect(libItems!.includes("特别书库借阅证")).toBe(true);
  });

  it("autoActivate 在匹配类型+条件时自动导入模组", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    const modules = [ARKHAM_LIBRARY_MODULE];
    const results = loader.autoActivate(modules, "location_enter", "arkham_miskatonic");

    expect(loader.isImported("arkham_miskatonic")).toBe(true);
    expect(results.length).toBeGreaterThan(0);
  });

  it("autoActivate 不匹配时不导入", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    const modules = [ARKHAM_LIBRARY_MODULE];
    loader.autoActivate(modules, "location_enter", "somewhere_else");

    expect(loader.isImported("arkham_miskatonic")).toBe(false);
  });

  it("isImported 返回正确状态", () => {
    const host = createMockHost();
    const loader = new MythosModuleLoader(host);

    expect(loader.isImported("arkham_miskatonic")).toBe(false);
    loader.import(ARKHAM_LIBRARY_MODULE);
    expect(loader.isImported("arkham_miskatonic")).toBe(true);
  });
});

// ============================================================
// 模组 NPC 生成 — mythosCreatureId 集成
// ============================================================

describe("MythosModuleLoader NPC 生成", () => {
  it("NPC 指定 mythosCreatureId 时使用生物属性覆盖基础值", () => {
    const host = createMockHost();
    const upserted: any[] = [];
    host.world.upsertEntity = (e: any) => { upserted.push(e); };
    const loader = new MythosModuleLoader(host);

    const module: MythosModule = {
      id: "test_npc",
      name: "测试NPC",
      version: "1",
      description: "",
      difficulty: "easy",
      activation: { type: "manual", condition: "" },
      npcs: [{
        id: "test_deep_one",
        name: "深潜者斥候",
        type: "monster",
        hp: 1, // 应被 mythos stats 覆盖
        maxHp: 1,
        ac: 1,
        faction: "神话生物",
        sceneId: "dock",
        mythosCreatureId: "deep_one",
      }],
    };

    loader.import(module);

    expect(upserted.length).toBe(1);
    const entity = upserted[0];
    expect(entity.hp).toBe(15);       // 来自 deep_one 的 hp
    expect(entity.maxHp).toBe(15);    // 来自 deep_one 的 maxHp
    expect(entity.ac).toBe(13);       // 来自 deep_one 的 ac
    expect(entity.name).toBe("深潜者斥候"); // name 保持模组自定义
  });

  it("NPC 不指定 mythosCreatureId 时使用模组原始属性", () => {
    const host = createMockHost();
    const upserted: any[] = [];
    host.world.upsertEntity = (e: any) => { upserted.push(e); };
    const loader = new MythosModuleLoader(host);

    const module: MythosModule = {
      id: "test_npc2",
      name: "测试普通NPC",
      version: "1",
      description: "",
      difficulty: "easy",
      activation: { type: "manual", condition: "" },
      npcs: [{
        id: "test_human",
        name: "普通村民",
        type: "npc",
        hp: 8,
        maxHp: 8,
        ac: 10,
        faction: "友善",
        sceneId: "village",
      }],
    };

    loader.import(module);

    expect(upserted[0].hp).toBe(8);
    expect(upserted[0].ac).toBe(10);
    expect(upserted[0].faction).toBe("友善");
  });

  it("NPC 属性与技能应被转发到 upsertEntity 有效载荷", () => {
    const host = createMockHost();
    const upserted: Parameters<MythosModuleHost["world"]["upsertEntity"]>[0][] = [];
    host.world.upsertEntity = (entity) => upserted.push(entity);
    const loader = new MythosModuleLoader(host);

    const module: MythosModule = {
      id: "test_npc_attrs",
      name: "属性技能测试",
      version: "1",
      description: "",
      difficulty: "easy",
      activation: { type: "manual", condition: "" },
      npcs: [{
        id: "scholar",
        name: "学者",
        type: "npc",
        hp: 6,
        maxHp: 6,
        ac: 10,
        faction: "学者",
        sceneId: "library",
        attributes: { str: 8 },
        skills: { "侦查": 60 },
      }],
    };

    loader.import(module);

    expect(upserted[0]?.attributes).toEqual({ str: 8 });
    expect(upserted[0]?.skills).toEqual({ "侦查": 60 });
  });
});

// ============================================================
// 预打包模组数据完整性
// ============================================================

describe("预打包模组数据完整性", () => {
  it("ARKHAM_LIBRARY_MODULE 包含必填字段", () => {
    expect(ARKHAM_LIBRARY_MODULE.id).toBeTruthy();
    expect(ARKHAM_LIBRARY_MODULE.name).toBeTruthy();
    expect(ARKHAM_LIBRARY_MODULE.activation.type).toBe("location_enter");
    expect(ARKHAM_LIBRARY_MODULE.introNarration).toBeTruthy();
    expect(ARKHAM_LIBRARY_MODULE.tomes!.length).toBeGreaterThan(0);
    expect(ARKHAM_LIBRARY_MODULE.spells!.length).toBeGreaterThan(0);
    expect(ARKHAM_LIBRARY_MODULE.npcs!.length).toBeGreaterThan(0);
  });
});

// ============================================================
// MYTHOS_TOMES 数据完整性
// ============================================================

describe("MYTHOS_TOMES 数据完整性", () => {
  it("全部 5 本典籍都有必填字段", () => {
    for (const t of MYTHOS_TOMES) {
      expect(t.name).toBeTruthy();
      expect(t.sanCost).toMatch(/\d/);
      expect(t.studyTime).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
    }
  });

  it("死灵之书应有 7 个可教授法术", () => {
    const necro = MYTHOS_TOMES.find(t => t.id === "necronomicon");
    expect(necro).toBeDefined();
    expect(necro!.spellsTaught.length).toBe(7);
  });
});

// ============================================================
// MYTHOS_SPELLS 数据完整性
// ============================================================

describe("MYTHOS_SPELLS 数据完整性", () => {
  it("全部法术都有必填字段", () => {
    for (const s of MYTHOS_SPELLS) {
      expect(s.name).toBeTruthy();
      expect(s.mpCost).toBeGreaterThan(0);
      expect(s.sanCost).toMatch(/\d/);
      expect(s.description.length).toBeGreaterThan(10);
    }
  });
});
