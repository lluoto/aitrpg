// NPC 持久化层的往返一致性与非法枚举值防线
// bun test src/__tests__/npc-store-rows.test.ts

import { describe, it, expect, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { NPCStore } from "../db/index";
import type { NPCPersonality, MemoryEntry } from "../agent/types";

const dirs: string[] = [];

/**
 * 落到临时文件而不是 :memory:，因为有几条用例要用第二个连接改库里的值，
 * 模拟老库/手改过的库送进越界枚举。
 */
function fileStore() {
  const dir = mkdtempSync(join(tmpdir(), "npcstore-"));
  dirs.push(dir);
  const path = join(dir, "npc.db");
  return { store: new NPCStore(path), path };
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function personality(over: Partial<NPCPersonality> = {}): NPCPersonality {
  return {
    name: "扎多克·艾伦",
    role: "醉汉",
    personality: "惊恐、语无伦次",
    background: "在码头待了一辈子",
    speech_style: "断续、含混",
    goals: ["活下去"],
    knowledge: ["印斯茅斯的秘密"],
    secrets: ["见过深潜者"],
    attitudes: { 调查员: "戒备" },
    ruleset: "cosmic-horror",
    initialMood: "fearful",
    ...over,
  };
}

const mem = (over: Partial<MemoryEntry> = {}): MemoryEntry => ({
  timestamp: 1000,
  type: "dialogue",
  content: "他提到了大衮教堂",
  importance: 8,
  ...over,
});

describe("人格卡往返", () => {
  it("写入后读回，字段不丢", () => {
    const { store } = fileStore();
    store.savePersonality(personality());

    const got = store.getPersonality("扎多克·艾伦");
    expect(got).not.toBeNull();
    expect(got!.role).toBe("醉汉");
    expect(got!.goals).toEqual(["活下去"]);
    expect(got!.secrets).toEqual(["见过深潜者"]);
    expect(got!.attitudes).toEqual({ 调查员: "戒备" });
    expect(got!.ruleset).toBe("cosmic-horror");
    expect(got!.initialMood).toBe("fearful");
    store.close();
  });

  it("不存在的 id 返回 null", () => {
    const { store } = fileStore();
    expect(store.getPersonality("查无此人")).toBeNull();
    store.close();
  });
});

describe("记忆往返", () => {
  it("写入后读回，类型与重要性不变", () => {
    const { store } = fileStore();
    store.savePersonality(personality());
    store.addMemory("扎多克·艾伦", mem());

    const rows = store.getRecentMemories("扎多克·艾伦");
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("dialogue");
    expect(rows[0].importance).toBe(8);
    expect(rows[0].content).toBe("他提到了大衮教堂");
    store.close();
  });

  // scene_id 此前没声明在 MemoryEntry 上，写入端读不到它，
  // 于是这张表的 scene_id 恒为空、按场景查永远落空
  it("带 scene_id 的记忆能按场景查回来", () => {
    const { store } = fileStore();
    store.savePersonality(personality());
    store.addMemory("扎多克·艾伦", mem({ scene_id: "innsmouth_church" }));
    store.addMemory("扎多克·艾伦", mem({ content: "别处的事", scene_id: "innsmouth_docks" }));

    const inChurch = store.getSceneMemories("扎多克·艾伦", "innsmouth_church");
    expect(inChurch).toHaveLength(1);
    expect(inChurch[0].content).toBe("他提到了大衮教堂");
    store.close();
  });

  it("按重要性筛选", () => {
    const { store } = fileStore();
    store.savePersonality(personality());
    store.addMemory("扎多克·艾伦", mem({ importance: 9 }));
    store.addMemory("扎多克·艾伦", mem({ content: "琐事", importance: 2 }));

    const important = store.getImportantMemories("扎多克·艾伦", 7);
    expect(important).toHaveLength(1);
    expect(important[0].importance).toBe(9);
    store.close();
  });
});

describe("非法枚举值不得流出持久层", () => {
  // 越界字符串直接 as NPCMood，会把一个系统里不存在的情绪放进消息流 ——
  // 情绪转移表里那个 curious 就是同一类问题，只是来源在代码而不是库里。
  it("状态表里的越界情绪退回 neutral", () => {
    const { store, path } = fileStore();
    store.savePersonality(personality());
    store.updateState("扎多克·艾伦", "angry", 0, 1);
    store.close();

    const raw = new Database(path);
    raw.run("UPDATE npc_states SET mood = ? WHERE npc_id = ?", ["curious", "扎多克·艾伦"]);
    raw.close();

    const reopened = new NPCStore(path);
    expect(reopened.getState("扎多克·艾伦")!.mood).toBe("neutral");
    reopened.close();
  });

  it("人格卡里的越界规则集与情绪读成 undefined", () => {
    const { store, path } = fileStore();
    store.savePersonality(personality());
    store.close();

    const raw = new Database(path);
    raw.run(
      "UPDATE npc_personalities SET ruleset = ?, initial_mood = ? WHERE id = ?",
      ["pathfinder", "curious", "扎多克·艾伦"]
    );
    raw.close();

    const reopened = new NPCStore(path);
    const got = reopened.getPersonality("扎多克·艾伦")!;
    expect(got.ruleset).toBeUndefined();
    expect(got.initialMood).toBeUndefined();
    reopened.close();
  });

  it("合法值照常通过", () => {
    const { store } = fileStore();
    store.savePersonality(personality({ ruleset: "dnd5e", initialMood: "calm" }));
    const got = store.getPersonality("扎多克·艾伦")!;
    expect(got.ruleset).toBe("dnd5e");
    expect(got.initialMood).toBe("calm");
    store.close();
  });
});
