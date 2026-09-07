// Step 5A: prove the extended ModuleData target can carry both active
// representations without switching any loader or mutating either source.

import { describe, expect, it } from "bun:test";
import { BARN_OF_PREMIER, END_NARRATIONS } from "../module/barn-of-premier";
import {
  buildUnifiedModuleData,
  findRuntimeProjectionDifferences,
  projectMythosRuntime,
  projectRuntimeNpc,
  restoreMythosRuntimeFields,
} from "../module/unified-module";
import { MODULE_PREMIERS_BARN } from "../rules/custom-modules/premiers_barn";

const unified = buildUnifiedModuleData(BARN_OF_PREMIER, MODULE_PREMIERS_BARN);
const projectedRuntime = projectMythosRuntime(MODULE_PREMIERS_BARN);

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

  it("Mythos 运行配置结构化 round-trip：顶层 identity、加载字段与 legacy 同名字段全部对账", () => {
    const restored = restoreMythosRuntimeFields(projectedRuntime);
    expect(findRuntimeProjectionDifferences(projectedRuntime, restored)).toEqual([]);
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
    expect(projectedRuntime.rewards?.some((reward) => reward.reputationChange !== undefined)).toBe(true);
    expect(projectedRuntime.rewards?.some((reward) => reward.skillGrowth !== undefined)).toBe(true);
  });

  it("32 条丰富 Clue、4 条 trap item 与其中 3 个 TrapMechanics、5 结局和 4 epilogue 保持", () => {
    const clues = BARN_OF_PREMIER.scenes.flatMap((scene) => scene.clues);
    const traps = BARN_OF_PREMIER.items.filter((item) => item.type === "trap");
    expect(clues).toHaveLength(32);
    expect(traps).toHaveLength(4);
    expect(traps.filter((item) => item.trap)).toHaveLength(3);
    expect(END_NARRATIONS).toHaveLength(5);
    expect(BARN_OF_PREMIER.epilogues).toHaveLength(4);
  });

  it("**变异检验**：删除统一运行类型中的 rewards 字段会被结构化对账精确报出", () => {
    const broken = { ...projectedRuntime, rewards: undefined };
    expect(findRuntimeProjectionDifferences(projectedRuntime, broken)).toEqual([
      expect.objectContaining({ field: "rewards" }),
    ]);
  });
});
