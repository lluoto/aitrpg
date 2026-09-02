// 摄取管线 · id 继承（开发·管线继承基准 id，对应 todo-48）。
//
// 背景：生成侧的 id 是内部句柄（scene_NN/item_NN），基准是人工意译
// （adrian_bedroom/clue_bedroom_diary）——calibrate.ts 报的 id-mismatch/
// ref-mismatch 一直是命名体系不同这一种噪音。已定方向：不迁移 id，让
// 管线继承基准 id；id 是人工维护的稳定层，内容是可重新生成的层。
//
// bun test src/__tests__/ingest-inherit-ids.test.ts

import { describe, it, expect } from "bun:test";
import {
  computeIdInheritance,
  applySceneIdInheritance,
  applyItemIdInheritance,
  type IdInheritanceEntity,
} from "../ingest/inherit-ids";
import type { Scene, ModuleItem, SceneConnection } from "../module/types";

function scene(id: string, name: string, connections: SceneConnection[] = []): Scene {
  return { id, name, description: "", clues: [], npcIds: [], connections };
}

function item(id: string, name: string, sceneId: string): ModuleItem {
  return { id, name, sceneId, description: "", type: "key" };
}

describe("computeIdInheritance：按 name 把内部 id 映射到基准 id", () => {
  it("**正确**：name 对上基准的候选，拿到基准 id", () => {
    const candidates: IdInheritanceEntity[] = [{ id: "scene_01", name: "特里坎家" }];
    const baseline: IdInheritanceEntity[] = [{ id: "tricam_house", name: "特里坎家" }];
    const result = computeIdInheritance(candidates, baseline, "场景");
    expect(result.idMap.get("scene_01")).toBe("tricam_house");
    expect(result.warnings).toEqual([]);
  });

  it("**错误行为红线**：name 在基准里找不到，不静默生成新 id——保留内部 id 且报 warning", () => {
    const candidates: IdInheritanceEntity[] = [{ id: "scene_07", name: "凭空捏造的场景" }];
    const baseline: IdInheritanceEntity[] = [{ id: "tricam_house", name: "特里坎家" }];
    const result = computeIdInheritance(candidates, baseline, "场景");
    expect(result.idMap.has("scene_07")).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("凭空捏造的场景");
    expect(result.warnings[0]).toContain("scene_07");
  });

  it("多条混合：对上的进 idMap，对不上的进 warnings，互不影响", () => {
    const candidates: IdInheritanceEntity[] = [
      { id: "scene_01", name: "特里坎家" },
      { id: "scene_02", name: "新场景" },
    ];
    const baseline: IdInheritanceEntity[] = [{ id: "tricam_house", name: "特里坎家" }];
    const result = computeIdInheritance(candidates, baseline, "场景");
    expect(result.idMap.size).toBe(1);
    expect(result.idMap.get("scene_01")).toBe("tricam_house");
    expect(result.warnings.length).toBe(1);
  });

  it("基准侧重名：无法唯一配对，两侧都保留内部 id 并报 warning，不去猜哪个对哪个", () => {
    const candidates: IdInheritanceEntity[] = [{ id: "scene_01", name: "卧室" }];
    const baseline: IdInheritanceEntity[] = [
      { id: "bedroom_a", name: "卧室" },
      { id: "bedroom_b", name: "卧室" },
    ];
    const result = computeIdInheritance(candidates, baseline, "场景");
    expect(result.idMap.has("scene_01")).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("重名");
  });

  it("候选侧重名：只有第一个能认领基准 id，其余保留内部 id 并报 warning——不能让两个候选拿到同一个基准 id", () => {
    const candidates: IdInheritanceEntity[] = [
      { id: "scene_01", name: "特里坎家" },
      { id: "scene_02", name: "特里坎家" },
    ];
    const baseline: IdInheritanceEntity[] = [{ id: "tricam_house", name: "特里坎家" }];
    const result = computeIdInheritance(candidates, baseline, "场景");
    expect(result.idMap.get("scene_01")).toBe("tricam_house");
    expect(result.idMap.has("scene_02")).toBe(false);
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain("scene_02");
  });

  it("基准名字带尾部括号注解时，候选的无注解原文名字仍能配上——注解是数据作者自己看的提示，PDF/生成侧不会带它", () => {
    const candidates: IdInheritanceEntity[] = [{ id: "scene_22", name: "维修间" }];
    const baseline: IdInheritanceEntity[] = [{ id: "maintenance_room", name: "维修间（终局场景）" }];
    const result = computeIdInheritance(candidates, baseline, "场景");
    expect(result.idMap.get("scene_22")).toBe("maintenance_room");
    expect(result.warnings).toEqual([]);
  });

  it("空候选/空基准都不报错，给空结果", () => {
    expect(computeIdInheritance([], [], "场景")).toEqual({ idMap: new Map(), warnings: [] });
    expect(computeIdInheritance([{ id: "scene_01", name: "x" }], [], "场景").warnings.length).toBe(1);
  });
});

describe("applySceneIdInheritance：改写 scene.id 与 connections[].targetSceneId", () => {
  it("**正确**：id 与出口引用一起换成基准 id，不是只换其中一个", () => {
    const scenes = [
      scene("scene_01", "特里坎家", [{ targetSceneId: "scene_02", condition: "" }]),
      scene("scene_02", "加比的拖车房"),
    ];
    const idMap = new Map([["scene_01", "tricam_house"], ["scene_02", "gabis_trailer"]]);
    const result = applySceneIdInheritance(scenes, idMap);
    expect(result[0]!.id).toBe("tricam_house");
    expect(result[0]!.connections[0]!.targetSceneId).toBe("gabis_trailer");
    expect(result[1]!.id).toBe("gabis_trailer");
  });

  it("配不上的场景原样保留内部 id，不因为映射表里没有它就报错或清空", () => {
    const scenes = [scene("scene_07", "凭空捏造的场景")];
    const result = applySceneIdInheritance(scenes, new Map());
    expect(result[0]!.id).toBe("scene_07");
  });

  it("出口指向一个配不上基准的场景时，targetSceneId 同样原样保留——不会指向一个不存在的基准 id", () => {
    const scenes = [
      scene("scene_01", "特里坎家", [{ targetSceneId: "scene_99", condition: "" }]),
    ];
    const idMap = new Map([["scene_01", "tricam_house"]]); // scene_99 没有映射
    const result = applySceneIdInheritance(scenes, idMap);
    expect(result[0]!.connections[0]!.targetSceneId).toBe("scene_99");
  });

  it("不改动原数组——纯函数，返回新对象", () => {
    const scenes = [scene("scene_01", "特里坎家")];
    const idMap = new Map([["scene_01", "tricam_house"]]);
    applySceneIdInheritance(scenes, idMap);
    expect(scenes[0]!.id).toBe("scene_01"); // 原数组未被修改
  });
});

describe("applyItemIdInheritance：物品自身 id 用物品映射，sceneId 引用用场景映射", () => {
  it("**正确**：两份映射分别应用到对的字段，不会传反", () => {
    const items = [item("item_01", "老旧文件", "scene_01")];
    const sceneIdMap = new Map([["scene_01", "adrian_bedroom"]]);
    const itemIdMap = new Map([["item_01", "old_document"]]);
    const result = applyItemIdInheritance(items, sceneIdMap, itemIdMap);
    expect(result[0]!.id).toBe("old_document");
    expect(result[0]!.sceneId).toBe("adrian_bedroom");
  });

  it("物品对上基准但所在场景对不上：物品 id 换了，sceneId 仍是内部句柄——不会假装场景也对上了", () => {
    const items = [item("item_01", "老旧文件", "scene_07")];
    const sceneIdMap = new Map<string, string>(); // scene_07 没有映射
    const itemIdMap = new Map([["item_01", "old_document"]]);
    const result = applyItemIdInheritance(items, sceneIdMap, itemIdMap);
    expect(result[0]!.id).toBe("old_document");
    expect(result[0]!.sceneId).toBe("scene_07");
  });
});

describe("端到端：computeIdInheritance 的结果直接喂给 apply* 能正确改写一整套场景+物品", () => {
  it("场景与物品各自继承各自的基准 id，物品的 sceneId 引用也跟着场景的映射走", () => {
    const rawScenes = [scene("scene_01", "特里坎家")];
    const rawItems = [item("item_01", "老旧文件", "scene_01")];
    const baselineScenes: IdInheritanceEntity[] = [{ id: "tricam_house", name: "特里坎家" }];
    const baselineItems: IdInheritanceEntity[] = [{ id: "old_document", name: "老旧文件" }];

    const sceneInherit = computeIdInheritance(rawScenes, baselineScenes, "场景");
    const itemInherit = computeIdInheritance(rawItems, baselineItems, "物品");
    const scenes = applySceneIdInheritance(rawScenes, sceneInherit.idMap);
    const items = applyItemIdInheritance(rawItems, sceneInherit.idMap, itemInherit.idMap);

    expect(scenes[0]!.id).toBe("tricam_house");
    expect(items[0]!.id).toBe("old_document");
    expect(items[0]!.sceneId).toBe("tricam_house"); // 引用跟着场景映射走，不是物品自己的映射
  });
});
