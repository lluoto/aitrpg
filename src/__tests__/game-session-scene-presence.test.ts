// 场景在场过滤 — getState() 暴露给前端/API 的在场名单必须限定在玩家当前场景。
//
// 回归背景：模组加载后所有 NPC 都被写入世界状态，getState() 未按场景过滤，
// 导致「前往警察局」时返回的 npcs 里同时含有菲碧、加比、酒吧保镖等根本不在场的角色。
// 这会让前端在场名单与 KP 叙事（injectWorldModelForScene 已按场景过滤）相互矛盾。

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
