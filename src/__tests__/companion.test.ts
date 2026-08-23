// Companion 系统测试 — 招募/命令/离队/自主行动
// bun test src/__tests__/companion.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { CompanionManager } from "../combat/companion-manager";
import { WorldStateManager } from "../state/world-state-manager";
import type { CompanionConfig } from "../types";

describe("CompanionManager", () => {
  let manager: CompanionManager;
  let world: WorldStateManager;

  const HILDA_CONFIG: CompanionConfig = {
    id: "hilda", name: "希尔妲",
    type: "npc", hp: 14, maxHp: 14, ac: 14,
    skills: { fight: 60, dodge: 40 },
    damageDice: "1d6+1d4",
    weapon: "shortsword",
    behavior: "aggressive",
    faction: "player_ally",
    traits: { courage: 8, aggression: 9, caution: 3, loyalty: 5, cruelty: 7 },
    departure: [
      { trigger: "hp_zero", description: "战死", farewell: "希尔妲倒下了。", canRejoin: false },
      { trigger: "morale_cower", description: "士气崩溃", farewell: "希尔妲逃走了。", canRejoin: true },
    ],
    motivation: "找点刺激的活儿干",
  };

  beforeEach(() => {
    manager = new CompanionManager();
    world = new WorldStateManager();
    // 初始化场景
    world.seedEntities([
      { id: "player", name: "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: "melee_range" },
      { id: "enemy_deep_one", name: "深潜者", type: "monster", hp: 15, maxHp: 15, ac: 12, status: [], position: "melee_range", faction: "monster" },
    ]);
  });

  // ==========================================================
  // 招募 & 离队
  // ==========================================================

  it("招募后实体存在于世界中", () => {
    manager.recruit(HILDA_CONFIG, world);
    const entity = world.getEntity("companion_hilda");
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe("希尔妲");
    expect(entity!.hp).toBe(14);
    expect(entity!.faction).toBe("player_ally");
  });

  it("招募后 isActive 返回 true", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.isActive("hilda")).toBe(true);
  });

  it("离队后实体从世界移除", () => {
    manager.recruit(HILDA_CONFIG, world);
    const farewell = manager.handleDeparture("hilda", world, "hp_zero");
    expect(farewell).toBe("希尔妲倒下了。");
    const entity = world.getEntity("companion_hilda");
    expect(entity?.hp).toBe(0);
    expect(manager.isActive("hilda")).toBe(false);
  });

  it("重复招募同一队友幂等", () => {
    const r1 = manager.recruit(HILDA_CONFIG, world);
    expect(r1.firstTime).toBe(true);
    const r2 = manager.recruit(HILDA_CONFIG, world);
    expect(r2.firstTime).toBe(false);
    const allActive = manager.getActiveCompanions();
    expect(allActive.length).toBe(1);
  });

  // ==========================================================
  // 状态查询
  // ==========================================================

  it("getActiveCompanions 返回活跃队友列表", () => {
    expect(manager.getActiveCompanions().length).toBe(0);
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.getActiveCompanions().length).toBe(1);
  });

  it("findByEntityId 通过实体 ID 查找队友", () => {
    manager.recruit(HILDA_CONFIG, world);
    const found = manager.findByEntityId("companion_hilda");
    expect(found).not.toBeUndefined();
    expect(found!.config.id).toBe("hilda");
  });

  it("getEntity 返回队友的 WorldEntity", () => {
    manager.recruit(HILDA_CONFIG, world);
    const entity = manager.getEntity("hilda", world);
    expect(entity).not.toBeNull();
    expect(entity!.name).toBe("希尔妲");
  });

  // ==========================================================
  // 行为切换
  // ==========================================================

  it("setBehavior 切换行为模式", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.setBehavior("hilda", "defensive")).toBe(true);
    const state = manager.getAllStates().get("hilda");
    expect(state!.behavior).toBe("defensive");
  });

  it("setBehavior 对不存在的队友返回 false", () => {
    expect(manager.setBehavior("nonexistent", "defensive")).toBe(false);
  });

  // ==========================================================
  // 士气
  // ==========================================================

  it("初始士气为 10", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.getMorale("hilda")).toBe(10);
  });

  it("adjustMorale 减少士气", () => {
    manager.recruit(HILDA_CONFIG, world);
    const r = manager.adjustMorale("hilda", -3);
    expect(r.morale).toBe(7);
    expect(r.triggered).toBe(false);
  });

  it("士气归零触发标记", () => {
    manager.recruit(HILDA_CONFIG, world);
    const r = manager.adjustMorale("hilda", -10);
    expect(r.morale).toBe(0);
    expect(r.triggered).toBe(true);
  });

  it("士气归零后触发 morale_cower 离队", () => {
    manager.recruit(HILDA_CONFIG, world);
    manager.adjustMorale("hilda", -10);
    const msgs = manager.checkDepartureTriggers(world);
    expect(msgs.length).toBe(1);
    expect(msgs[0]).toContain("逃走了");
    expect(manager.isActive("hilda")).toBe(false);
  });

  it("adjustMoraleByEntity 通过实体 ID 调整士气", () => {
    manager.recruit(HILDA_CONFIG, world);
    const r = manager.adjustMoraleByEntity("companion_hilda", -4);
    expect(r.morale).toBe(6);
  });

  // ==========================================================
  // 目标选择
  // ==========================================================

  it("selectTarget 在 aggressive 模式下选择低 HP 敌人", () => {
    manager.recruit(HILDA_CONFIG, world);
    const entity = world.getEntity("companion_hilda")!;

    // 添加第二个敌人，一个 HP 低
    world.seedEntities([
      { id: "weak_enemy", name: "受伤的鱼人", type: "monster", hp: 3, maxHp: 12, ac: 10, status: [], position: "melee_range", faction: "monster" },
    ]);
    const target = manager.selectTarget(entity, world.getCurrentState(), "aggressive");
    expect(target).not.toBeNull();
    // aggressive 模式选低 HP
    expect(target!.id).toBe("weak_enemy");
  });

  it("selectTarget 在没有敌人时返回 null", () => {
    // 清空敌人
    const cleanWorld = new WorldStateManager();
    cleanWorld.seedEntities([
      { id: "player", name: "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: "melee_range" },
    ]);
    manager.recruit(HILDA_CONFIG, cleanWorld);
    const entity = cleanWorld.getEntity("companion_hilda")!;
    const target = manager.selectTarget(entity, cleanWorld.getCurrentState(), "aggressive");
    expect(target).toBeNull();
  });

  it("selectTarget 不选 player_ally 作为目标", () => {
    manager.recruit(HILDA_CONFIG, world);
    // 添加友军
    world.seedEntities([
      { id: "ally", name: "友好NPC", type: "npc", hp: 10, maxHp: 10, ac: 10, status: [], position: "melee_range", faction: "player_ally" },
    ]);
    const entity = world.getEntity("companion_hilda")!;
    const target = manager.selectTarget(entity, world.getCurrentState(), "aggressive");
    // 应该只选深潜者，不选友好NPC
    expect(target).not.toBeNull();
    expect(target!.id).toBe("enemy_deep_one");
  });

  // ==========================================================
  // 物品交互
  // ==========================================================

  it("giveItem 给队友物品", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.giveItem("hilda", "猎枪")).toBe(true);
    expect(manager.listItems("hilda")).toContain("猎枪");
  });

  it("takeItem 拿走队友物品", () => {
    manager.recruit({ ...HILDA_CONFIG, inventory: ["猎刀"] }, world);
    const item = manager.takeItem("hilda", "猎刀");
    expect(item).toBe("猎刀");
    expect(manager.listItems("hilda")).not.toContain("猎刀");
  });

  it("resolveWeapon 优先使用背包中的武器", () => {
    manager.recruit({ ...HILDA_CONFIG, inventory: ["手枪"], weapon: "shortsword" }, world);
    // 手枪在 priority 列表中排在短剑之前
    const weapon = manager.resolveWeapon("hilda");
    expect(weapon).toBe("手枪");
  });

  // ==========================================================
  // 控制权切换
  // ==========================================================

  it("初始控制模式为 auto", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.getControl("hilda")).toBe("auto");
  });

  it("setControl 切换到 player:userId", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.setControl("hilda", "player:p1")).toBe(true);
    expect(manager.getControl("hilda")).toBe("player:p1");
  });

  it("setControl 对不存在的队友返回 false", () => {
    expect(manager.setControl("nonexistent", "player:p1")).toBe(false);
  });

  // ==========================================================
  // 轮次操作跟踪
  // ==========================================================

  it("markActed / hasActed 记录本轮行动", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.hasActed("hilda")).toBe(false);
    manager.markActed("hilda");
    expect(manager.hasActed("hilda")).toBe(true);
  });

  it("newRound 重置操作状态", () => {
    manager.recruit(HILDA_CONFIG, world);
    manager.markActed("hilda");
    expect(manager.hasActed("hilda")).toBe(true);
    manager.newRound();
    expect(manager.hasActed("hilda")).toBe(false);
  });

  // ==========================================================
  // 控制权转移 & 多玩家
  // ==========================================================

  it("setControl 接受 player:userId 格式", () => {
    manager.recruit(HILDA_CONFIG, world);
    expect(manager.setControl("hilda", "player:alice")).toBe(true);
    expect(manager.getControl("hilda")).toBe("player:alice");
  });

  it("transferControl 转移控制权", () => {
    manager.recruit(HILDA_CONFIG, world);
    manager.setControl("hilda", "player:alice");
    manager.transferControl("hilda", "bob");
    expect(manager.getControl("hilda")).toBe("player:bob");
  });

  it("getPlayerControlled 返回指定玩家控制的队友", () => {
    manager.recruit(HILDA_CONFIG, world);
    manager.recruit({ ...HILDA_CONFIG, id: "erin", name: "艾琳" }, world);
    manager.setControl("hilda", "player:alice");
    manager.setControl("erin", "player:alice");
    const aliceControlled = manager.getPlayerControlled("alice");
    expect(aliceControlled.length).toBe(2);
    expect(manager.getPlayerControlled("bob").length).toBe(0);
  });

  // ==========================================================
  // 快照（副本记录）
  // ==========================================================

  it("saveSnapshot 生成队伍快照", () => {
    manager.recruit(HILDA_CONFIG, world);
    const snapshots = manager.saveSnapshot(world);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].configId).toBe("hilda");
    expect(snapshots[0].hp).toBe(14);
    expect(snapshots[0].inventory).toEqual([]);
  });

  it("restoreSnapshot 恢复队伍状态", () => {
    // 1. 招募 + 修改状态
    manager.recruit(HILDA_CONFIG, world);
    manager.giveItem("hilda", "猎枪");
    manager.adjustMorale("hilda", -3);
    // 修改 HP
    const entity = world.getEntity("companion_hilda")!;
    world.upsertEntity({ ...entity, hp: 8 });

    // 2. 存快照
    const snapshots = manager.saveSnapshot(world);
    expect(snapshots[0].hp).toBe(8);
    expect(snapshots[0].inventory).toContain("猎枪");
    expect(snapshots[0].morale).toBe(7);

    // 3. 清空恢复 & 验证
    const cleanWorld = new WorldStateManager();
    cleanWorld.seedEntities([
      { id: "player", name: "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: "melee_range" },
    ]);
    manager.restoreSnapshot(snapshots, cleanWorld);

    const restoredEntity = cleanWorld.getEntity("companion_hilda");
    expect(restoredEntity).not.toBeNull();
    expect(restoredEntity!.hp).toBe(8);
    expect(restoredEntity!.maxHp).toBe(14);
    expect(manager.getActiveCompanions().length).toBe(1);
    expect(manager.getMorale("hilda")).toBe(7);
    expect(manager.listItems("hilda")).toContain("猎枪");
  });

  // ==========================================================
  // 清理
  // ==========================================================

  it("clearAll 移除所有队友", () => {
    manager.recruit(HILDA_CONFIG, world);
    manager.recruit({ ...HILDA_CONFIG, id: "erin", name: "艾琳" }, world);
    expect(manager.getActiveCompanions().length).toBe(2);
    manager.clearAll(world);
    expect(manager.getActiveCompanions().length).toBe(0);
  });
});
