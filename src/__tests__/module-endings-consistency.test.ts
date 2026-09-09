import { describe, expect, it } from "bun:test";
import { BARN_OF_PREMIER, END_NARRATIONS } from "../module/barn-of-premier";

function idSet(entries: Array<{ id: string }>): Set<string> {
  return new Set(entries.map((entry) => entry.id));
}

describe("谷仓统一 ModuleData 的结局表示", () => {
  it("可求值 EndNarration、展示 endings 与 runtime legacyEndings 共享同一组 id", () => {
    const truthIds = idSet(END_NARRATIONS);
    expect(idSet(BARN_OF_PREMIER.endings)).toEqual(truthIds);
    expect(idSet(BARN_OF_PREMIER.runtime?.legacyEndings ?? [])).toEqual(truthIds);
  });

  it("id 集合缺一条时明确不等，避免把同一投影函数当作独立证据", () => {
    const truthIds = idSet(END_NARRATIONS);
    const drifted = new Set([...truthIds].filter((id) => id !== "bad"));
    expect(drifted).not.toEqual(truthIds);
  });
});
