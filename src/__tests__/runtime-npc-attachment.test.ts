import { describe, expect, it } from "bun:test";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { attachRuntimeNpcs } from "../module/runtime-npc-attachment";

describe("runtime NPC snapshots attach to the single ModuleData source", () => {
  it("11 snapshots attach to narrative NPCs without creating a second runtime list", () => {
    expect(BARN_OF_PREMIER.npcs).toHaveLength(14);
    expect(BARN_OF_PREMIER.npcs.filter((npc) => npc.runtime)).toHaveLength(11);
    expect(BARN_OF_PREMIER.runtime?.runtimeNpcs).toBeUndefined();
  });

  it("duplicate source IDs, duplicate normalized names, and unmatched snapshots fail explicitly", () => {
    const source = structuredClone(BARN_OF_PREMIER);
    const snapshots = source.npcs.flatMap((npc) => npc.runtime ? [npc.runtime] : []);
    const first = snapshots[0]!;
    expect(() => attachRuntimeNpcs(source.npcs, [...snapshots, first])).toThrow("sourceId 重复");
    expect(() => attachRuntimeNpcs(source.npcs, [...snapshots, { ...first, sourceId: "duplicate" }])).toThrow("归一化姓名重复");
    expect(() => attachRuntimeNpcs(source.npcs, [{ ...first, sourceName: "未匹配 NPC" }])).toThrow("无对应叙事 NPC");
  });

  it("attached snapshots are cloned rather than aliasing their bootstrap data", () => {
    const source = structuredClone(BARN_OF_PREMIER);
    const snapshot = source.npcs.find((npc) => npc.runtime)?.runtime;
    if (!snapshot) throw new Error("runtime snapshot missing");
    const attached = attachRuntimeNpcs(source.npcs.map((npc) => ({ ...npc, runtime: undefined })), [snapshot]);
    const target = attached.find((npc) => npc.runtime?.sourceId === snapshot.sourceId);
    target!.runtime!.attributes!.strength = 999;
    expect(snapshot.attributes?.strength).not.toBe(999);
  });
});
