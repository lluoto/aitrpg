// Step 5A: prove the extended ModuleData target can carry both active
// representations without switching any loader or mutating either source.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { importPointsTo, scanImports } from "../diagnostics/source-scan";
import { BARN_OF_PREMIER, END_NARRATIONS, NPC_STATS } from "../module/barn-of-premier";
import {
  buildUnifiedModuleData,
  deriveMythosModule,
  findRuntimeProjectionDifferences,
  projectMythosRuntime,
  projectRuntimeNpc,
  readMythosRuntimeFields,
  restoreMythosRuntimeFields,
} from "../module/unified-module";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";
import type { MythosModule } from "../rules/mythos-module";

const unified = buildUnifiedModuleData(BARN_OF_PREMIER, MODULE_PREMIERS_BARN, NPC_STATS);
const projectedRuntime = projectMythosRuntime(MODULE_PREMIERS_BARN);
const sourceRuntime = readMythosRuntimeFields(MODULE_PREMIERS_BARN);

function narrativeNpc(npc: typeof unified.npcs[number]) {
  const { runtime: _runtime, ...narrative } = npc;
  return narrative;
}

describe("步骤 5A：统一 ModuleData 类型无损承载两份活跃表示", () => {
  it("14 个 ModuleData NPC 的叙事字段逐对象不丢，runtime 嵌套不覆盖叙事字段", () => {
    expect(BARN_OF_PREMIER.npcs).toHaveLength(14);
    expect(unified.npcs.map(narrativeNpc)).toEqual(BARN_OF_PREMIER.npcs);
  });

  it("11 个 Mythos NPC 的运行/战斗字段逐对象无损落进对应 ModuleNPC.runtime", () => {
    const runtimeNpcs = MODULE_PREMIERS_BARN.npcs ?? [];
    expect(runtimeNpcs).toHaveLength(11);
    const embedded = unified.npcs.filter((npc) => npc.runtime);
    expect(embedded).toHaveLength(11);

    for (const sourceNpc of runtimeNpcs) {
      const target = unified.npcs.find((npc) => npc.runtime?.sourceId === sourceNpc.id);
      expect(target?.runtime).toEqual(projectRuntimeNpc(sourceNpc));
    }
  });

  it("Mythos 运行配置对账独立来自原始输入：顶层 identity、场景图、加载字段与 legacy 同名字段全部保留", () => {
    const restored = restoreMythosRuntimeFields(projectedRuntime);
    expect(findRuntimeProjectionDifferences(sourceRuntime, projectedRuntime)).toEqual([]);
    expect(findRuntimeProjectionDifferences(sourceRuntime, restored)).toEqual([]);
    expect(restored.sourceIdentity).toEqual({
      id: MODULE_PREMIERS_BARN.id,
      name: MODULE_PREMIERS_BARN.name,
      version: MODULE_PREMIERS_BARN.version,
      description: MODULE_PREMIERS_BARN.description,
    });
  });

  it("运行字段实测数量完整：4 spells、1 tome、9 rewards、8 kpNotes、34 hooks、19 BGM、1 aliases", () => {
    expect(projectedRuntime.spells).toHaveLength(4);
    expect(projectedRuntime.tomes).toHaveLength(1);
    expect(projectedRuntime.rewards).toHaveLength(9);
    expect(Object.keys(projectedRuntime.kpNotes ?? {})).toHaveLength(8);
    expect(projectedRuntime.hooks).toHaveLength(34);
    expect(Object.keys(projectedRuntime.sceneBgm ?? {})).toHaveLength(19);
    expect(Object.keys(projectedRuntime.sceneAliases ?? {})).toHaveLength(1);
    expect(Object.keys(projectedRuntime.loaderSceneDescriptions ?? {})).toEqual(
      Object.keys(MODULE_PREMIERS_BARN.sceneDescriptions ?? {}),
    );
    expect(projectedRuntime.loaderExits).toEqual(MODULE_PREMIERS_BARN.exits);
    expect(projectedRuntime.rewards?.some((reward) => reward.reputationChange !== undefined)).toBe(true);
    expect(projectedRuntime.rewards?.some((reward) => reward.skillGrowth !== undefined)).toBe(true);
  });

  it("统一输出中的 32 条丰富 Clue、4 条 trap item/3 个 TrapMechanics、5 结局和 4 epilogue 保持", () => {
    const clues = unified.scenes.flatMap((scene) => scene.clues);
    const traps = unified.items.filter((item) => item.type === "trap");
    expect(clues).toHaveLength(32);
    expect(traps).toHaveLength(4);
    expect(traps.filter((item) => item.trap)).toHaveLength(3);
    expect(END_NARRATIONS).toHaveLength(5);
    expect(unified.epilogues).toHaveLength(4);
    expect(unified.runtime?.npcStats).toEqual(NPC_STATS);
    expect(unified.runtime?.npcStats?.emily_estrum?.str).toBe("?");
    expect(unified.runtime?.npcStats?.bar_bouncer?.db).toBe("+1d4");
  });

  it("**变异检验**：删除统一运行类型中的 rewards 字段会被结构化对账精确报出", () => {
    const broken = { ...projectedRuntime, rewards: undefined };
    expect(findRuntimeProjectionDifferences(sourceRuntime, broken)).toEqual([
      expect.objectContaining({ field: "rewards" }),
    ]);
  });

  it("数据隔离：统一输出的深层数组、人格对象和 aliases 修改不会污染两个原始输入", () => {
    const isolated = buildUnifiedModuleData(BARN_OF_PREMIER, MODULE_PREMIERS_BARN, NPC_STATS);
    const npc = isolated.npcs.find((entry) => entry.runtime?.sourceId === "艾德里安·埃斯特鲁姆");
    const originalGoal = MODULE_PREMIERS_BARN.npcs?.find((entry) => entry.id === "艾德里安·埃斯特鲁姆")?.personality?.goals?.[0];
    const originalAliasCount = MODULE_PREMIERS_BARN.sceneAliases?.["维修间"]?.length;
    npc?.runtime?.personality?.goals?.push("隔离变异");
    isolated.runtime?.sceneAliases?.["维修间"]?.push("隔离别名");
    isolated.runtime?.spells?.[0] && (isolated.runtime.spells[0].description = "隔离法术文本");
    expect(MODULE_PREMIERS_BARN.npcs?.find((entry) => entry.id === "艾德里安·埃斯特鲁姆")?.personality?.goals?.[0]).toBe(originalGoal);
    expect(MODULE_PREMIERS_BARN.sceneAliases?.["维修间"]?.length).toBe(originalAliasCount);
    expect(MODULE_PREMIERS_BARN.spells?.[0]?.description).not.toBe("隔离法术文本");
  });

  it("薄适配器从统一结果派生的 MythosModule 与原始输入逐字段一致", () => {
    expect(deriveMythosModule(unified)).toEqual(MODULE_PREMIERS_BARN);
  });

  it("NPC 归一化匹配遇到重复 sourceId、重名或未匹配时显式失败，不静默覆盖", () => {
    const npcs = MODULE_PREMIERS_BARN.npcs ?? [];
    const first = npcs[0]!;
    const duplicateId: MythosModule = { ...MODULE_PREMIERS_BARN, npcs: [...npcs, first] };
    const duplicateName: MythosModule = { ...MODULE_PREMIERS_BARN, npcs: [...npcs, { ...first, id: "duplicate-id" }] };
    const unmatched: MythosModule = { ...MODULE_PREMIERS_BARN, npcs: [{ ...first, name: "无法匹配的运行 NPC" }, ...npcs.slice(1)] };
    expect(() => buildUnifiedModuleData(BARN_OF_PREMIER, duplicateId, NPC_STATS)).toThrow("sourceId 重复");
    expect(() => buildUnifiedModuleData(BARN_OF_PREMIER, duplicateName, NPC_STATS)).toThrow("归一化姓名重复");
    expect(() => buildUnifiedModuleData(BARN_OF_PREMIER, unmatched, NPC_STATS)).toThrow("无对应叙事 NPC");
  });

  it("5A 不切换加载路径：活跃入口没有运行时 import unified-module", () => {
    const activeLoaders = [
      "src/api/game-session.ts",
      "src/play-module.ts",
      "src/index.ts",
      "src/api/scripted-session.ts",
    ];
    for (const file of activeLoaders) {
      const imports = scanImports(readFileSync(file, "utf8"));
      expect(imports.some((entry) => importPointsTo(entry.path, "unified-module"))).toBe(false);
    }
  });
});
