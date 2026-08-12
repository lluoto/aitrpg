// 场景状态 — getState() 暴露给前端/API 的场景与在场名单。
//
// 回归背景 1（在场过滤）：模组加载后所有 NPC 都被写入世界状态，getState() 未按场景过滤，
// 导致「前往警察局」时返回的 npcs 里同时含有菲碧、加比、酒吧保镖等根本不在场的角色。
// 这会让前端在场名单与 KP 叙事（injectWorldModelForScene 已按场景过滤）相互矛盾。
//
// 回归背景 2（KP 切换场景无效）：setScene() 曾写 `world.getCurrentState().scene = id`，
// 而 getCurrentState() 每次都新建并返回一个对象，赋值落在临时对象上、随即被丢弃，
// 数据库中的 scenes.is_active 从未变更。KP 面板点「切换」后端照样返回 success:true，
// 前端场景纹丝不动，且没有任何报错。正确写法是 world.setActiveScene()。

import { describe, expect, test } from "bun:test";
import { GameSession } from "../api/game-session";

function seedEntity(
  session: GameSession,
  id: string,
  name: string,
  type: "pc" | "npc" | "monster",
  scene: string,
) {
  session.world.upsertEntity({
    id,
    name,
    type,
    hp: 10,
    maxHp: 10,
    ac: 10,
    status: [],
    position: scene,
    scene_id: scene,
  } as never);
}

describe("场景在场过滤", () => {
  test("getState().npcs 只包含玩家当前场景的 NPC", () => {
    const session = new GameSession("t_presence_npc", "cosmic-horror");
    seedEntity(session, "player", "调查员", "pc", "特里坎家");
    seedEntity(session, "npc_present", "菲碧·特里坎", "npc", "特里坎家");
    seedEntity(session, "npc_elsewhere", "警员", "npc", "警察局");

    const names = session.getState().npcs.map((n) => n.name);

    expect(names).toContain("菲碧·特里坎");
    expect(names).not.toContain("警员");
  });

  test("getState().monsters 只包含玩家当前场景的怪物", () => {
    const session = new GameSession("t_presence_monster", "cosmic-horror");
    seedEntity(session, "player", "调查员", "pc", "下水道");
    seedEntity(session, "monster_present", "食尸鬼", "monster", "下水道");
    seedEntity(session, "monster_elsewhere", "Mi-Go", "monster", "农场外围");

    const names = session.getState().monsters.map((m) => m.name);

    expect(names).toContain("食尸鬼");
    expect(names).not.toContain("Mi-Go");
  });

  test("玩家移动后在场名单随之切换", () => {
    const session = new GameSession("t_presence_move", "cosmic-horror");
    seedEntity(session, "player", "调查员", "pc", "特里坎家");
    seedEntity(session, "npc_a", "菲碧·特里坎", "npc", "特里坎家");
    seedEntity(session, "npc_b", "酒吧保镖", "npc", "维森酒吧");

    expect(session.getState().npcs.map((n) => n.name)).toEqual(["菲碧·特里坎"]);

    seedEntity(session, "player", "调查员", "pc", "维森酒吧");

    expect(session.getState().npcs.map((n) => n.name)).toEqual(["酒吧保镖"]);
  });
});

describe("KP 切换场景", () => {
  test("切换到已注册场景后 getState().scene 随之变更", () => {
    const session = new GameSession("t_kp_scene_ok", "cosmic-horror");
    session.world.registerScene("barn_interior", "谷仓内部");

    expect(session.setScene("barn_interior")).toBe(true);
    expect(session.getState().scene).toBe("barn_interior");
  });

  test("切换到未注册场景应报告失败，而不是静默成功", () => {
    const session = new GameSession("t_kp_scene_missing", "cosmic-horror");
    session.world.registerScene("barn_interior", "谷仓内部");
    session.setScene("barn_interior");

    expect(session.setScene("never_registered")).toBe(false);
    // 失败不得污染当前场景
    expect(session.getState().scene).toBe("barn_interior");
  });

  test("连续切换以最后一次为准，不残留多个活动场景", () => {
    const session = new GameSession("t_kp_scene_switch", "cosmic-horror");
    session.world.registerScene("barn_interior", "谷仓内部");
    session.world.registerScene("farm_exterior", "农场外围");

    session.setScene("barn_interior");
    session.setScene("farm_exterior");

    expect(session.getState().scene).toBe("farm_exterior");
    const active = session.world
      .getDatabase()
      .query("SELECT COUNT(*) AS n FROM scenes WHERE is_active = 1")
      .get() as { n: number };
    expect(active.n).toBe(1);
  });
});
