// 场景环境音床的下发口径
// bun test src/__tests__/scene-bgm.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";

function newSession() {
  return new GameSession(
    `bgm_${Math.random().toString(36).slice(2)}`,
    "cosmic-horror",
    undefined,
    undefined,
    "调查员"
  );
}

describe("sceneBgm — 模组映射下发", () => {
  it("印斯茅斯入口场景给出 coast", async () => {
    const s = newSession();
    await s.act("加载模组 印斯茅斯的阴影");
    expect(s.getState().bgm).toBe("coast");
  });

  it("阿卡姆入口场景给出 library", async () => {
    const s = newSession();
    await s.act("加载模组 阿卡姆档案检查");
    expect(s.getState().bgm).toBe("library");
  });

  it("模组未声明的场景不给床，而不是给个错的", async () => {
    const s = newSession();
    await s.act("加载模组 印斯茅斯的阴影");
    s.world.registerScene("无名巷", "无名巷");
    s.setScene("无名巷");
    expect(s.getState().bgm).toBeUndefined();
  });
});

describe("sceneBgm — 床跟随界面显示的场景", () => {
  // KP 面板切场景只翻 scenes.is_active，不移动玩家实体。
  // 若 bgm 读玩家 position 而 scene 读 is_active，两者就会分叉：
  // 状态栏显示教堂，耳朵里还是码头的浪声。
  it("KP 切场景后，bgm 跟着新场景走", async () => {
    const s = newSession();
    await s.act("加载模组 印斯茅斯的阴影");
    const posBefore = s.getPlayerPosition();

    expect(s.setScene("innsmouth_church")).toBe(true);

    const st = s.getState();
    expect(st.scene).toBe("innsmouth_church");
    expect(st.bgm).toBe("sacred");
    // 玩家实体确实没被移动 —— 否则这条用例就没走到分叉路径，等于没测
    expect(s.getPlayerPosition()).toBe(posBefore);
  });

  it("同一次响应里 scene 与 bgm 必须指向同一个场景", async () => {
    const s = newSession();
    await s.act("加载模组 阿卡姆档案检查");
    s.setScene("arkham_library_basement");

    const st = s.getState();
    expect(st.scene).toBe("arkham_library_basement");
    expect(st.bgm).toBe("underground");
  });

  it("玩家正常移动（两个源一致）时行为不变", async () => {
    const s = newSession();
    await s.act("加载模组 印斯茅斯的阴影");
    s.setScene("innsmouth_church");
    s.world.upsertEntity({
      id: "player", name: "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10,
      status: [], position: "innsmouth_church",
    } as never);
    expect(s.getState().bgm).toBe("sacred");
  });
});
