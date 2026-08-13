// entities 表存了什么，读回来就该是什么
//
// 取证：schema 里 entities 有 attributes 和 scene_id 两列，mythos-module 的宿主契约
// 也早就声明了 `scene_id?: string` 与 `attributes?: Record<string, number>`，模组导入
// 确实把它们传了进来。断的是中间那一层：
//
//   - WorldEntity（types.ts）没声明这两个字段，所以 upsertEntity 只能用
//     `(entity as any).scene_id` 去摸，类型检查全程沉默；
//   - rowToEntity 不回读它们，于是 UPDATE 分支里的 `?? (existing as any).scene_id`
//     恒为 undefined，任何一次更新（哪怕只改血量）都把已存的值抹成 NULL / '{}'。
//
// 后果是实测出来的：getEntitiesInScene() 按 scene_id 过滤，模组 NPC 第一次导入时
// 查得到，被更新过一次之后就再也查不到——而 injectWorldModelForScene() 正是用它
// 给 KP 组装「当前在场 NPC」名单。
//
// bun test src/__tests__/entity-round-trip.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { WorldStateManager } from "../state/world-state-manager";

let world: WorldStateManager;

beforeEach(() => {
  world = new WorldStateManager(":memory:");
  world.registerScene("barn", "谷仓");
});

describe("entities 的字段往返", () => {
  it("scene_id 写进去能读回来", () => {
    world.upsertEntity({
      id: "npc_1", name: "老农", type: "npc",
      hp: 10, maxHp: 10, ac: 10, status: [], position: "barn",
      scene_id: "barn",
    });

    expect(world.getEntity("npc_1")?.scene_id).toBe("barn");
  });

  it("attributes 写进去能读回来", () => {
    world.upsertEntity({
      id: "npc_2", name: "祭司", type: "npc",
      hp: 9, maxHp: 9, ac: 10, status: [], position: "barn",
      attributes: { strength: 40, power: 75 },
    });

    expect(world.getEntity("npc_2")?.attributes).toEqual({ strength: 40, power: 75 });
  });

  it("只改血量的更新不得抹掉 scene_id", () => {
    world.upsertEntity({
      id: "npc_3", name: "渔夫", type: "npc",
      hp: 12, maxHp: 12, ac: 10, status: [], position: "barn",
      scene_id: "barn",
    });

    world.upsertEntity({ id: "npc_3", name: "渔夫", type: "npc", hp: 5 });

    expect(world.getEntity("npc_3")?.scene_id).toBe("barn");
  });

  it("只改血量的更新不得抹掉 attributes", () => {
    world.upsertEntity({
      id: "npc_4", name: "船长", type: "npc",
      hp: 14, maxHp: 14, ac: 10, status: [], position: "barn",
      attributes: { power: 80 },
    });

    world.upsertEntity({ id: "npc_4", name: "船长", type: "npc", hp: 3 });

    expect(world.getEntity("npc_4")?.attributes).toEqual({ power: 80 });
  });

  it("被更新过的实体仍然留在场景查询结果里", () => {
    world.upsertEntity({
      id: "npc_5", name: "守夜人", type: "npc",
      hp: 11, maxHp: 11, ac: 10, status: [], position: "barn",
      scene_id: "barn",
    });
    expect(world.getEntitiesInScene("barn").map((e) => e.id)).toEqual(["npc_5"]);

    world.upsertEntity({ id: "npc_5", name: "守夜人", type: "npc", hp: 6 });

    expect(world.getEntitiesInScene("barn").map((e) => e.id)).toEqual(["npc_5"]);
  });

  it("显式传入的新值仍然覆盖旧值", () => {
    world.registerScene("dock", "码头");
    world.upsertEntity({
      id: "npc_6", name: "线人", type: "npc",
      hp: 8, maxHp: 8, ac: 10, status: [], position: "barn",
      scene_id: "barn", attributes: { power: 50 },
    });

    world.upsertEntity({
      id: "npc_6", name: "线人", type: "npc",
      scene_id: "dock", attributes: { power: 60 },
    });

    const moved = world.getEntity("npc_6");
    expect(moved?.scene_id).toBe("dock");
    expect(moved?.attributes).toEqual({ power: 60 });
  });
});
