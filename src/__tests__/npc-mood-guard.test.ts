// NPCMood 的共享守卫
//
// 情绪有三个不经编译器的入口：npcs.yaml（运行时 parse）、编辑器存的模组 JSON、
// 以及历史数据库里的旧值。下游按八个取值分派，越界值不会报错，只会让每个分支
// 都落空 —— 实测曾从 /history 拿到 "paranoid"，模组数据里躺着六个这样的值。
//
// bun test src/__tests__/npc-mood-guard.test.ts

import { describe, it, expect } from "bun:test";
import { asNPCMood, NPC_MOODS } from "../agent/types";

describe("asNPCMood", () => {
  it("八个合法取值原样返回", () => {
    for (const mood of NPC_MOODS) {
      expect(asNPCMood(mood)).toBe(mood);
    }
  });

  it("模组里实际出现过的六个越界值全部拒绝", () => {
    for (const bad of [
      "paranoid", "hostile", "anxious_hopeful",
      "playful", "paralyzed_terrified", "alien_calm",
    ]) {
      expect(asNPCMood(bad)).toBeUndefined();
    }
  });

  it("非字符串一律拒绝", () => {
    for (const bad of [undefined, null, 0, 1, true, {}, [], ["calm"]]) {
      expect(asNPCMood(bad)).toBeUndefined();
    }
  });

  it("大小写与空白不做宽容匹配", () => {
    // 宽容匹配会把"差不多对"的数据放进来，掩盖上游真正写错的地方
    expect(asNPCMood("Calm")).toBeUndefined();
    expect(asNPCMood(" calm ")).toBeUndefined();
  });
});

describe("NPC_MOODS 与联合类型保持同步", () => {
  it("恰好八个取值且不重复", () => {
    expect(NPC_MOODS).toHaveLength(8);
    expect(new Set(NPC_MOODS).size).toBe(8);
  });
});
