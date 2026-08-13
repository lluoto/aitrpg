// 场景激活必须只有一条写入路径，且不得静默无效
//
// 取证：game-session.ts 有三处绕过 setScene() 直接调 world.setActiveScene()：
//   L1250 movePlayerToScene()      —— 不检查场景是否已注册
//   L1275 handleMove 的场景映射分支 —— 用 (this.world as any).getDatabase() 裸写 SQL 建场景
//   L1683 加载生成故事后激活首个场景 —— 场景已注册，属形式上的绕过
//
// 两类风险：
//   1. setActiveScene() 是 `UPDATE scenes SET is_active=1 WHERE id=?`，
//      场景未注册时匹配不到行 → 整条切换静默失效，与 §八 记录的两次事故同类。
//   2. `as any` 取 getDatabase() 是宿主契约外的隐式依赖。§八 明确记过一次：
//      MythosModuleLoader 就是这么依赖 getDatabase()，宿主换成窄适配器后
//      运行时变 undefined，被 catch 降级成一行警告，模组场景出口整段失效。
//
// bun test src/__tests__/scene-write-path.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";

const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

let session: GameSession;

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("scene-path", "cosmic-horror", LLM, "investigator", "调查员");
});

describe("场景切换的写入路径", () => {
  it("走别名映射前往场景后，该场景确实被激活", async () => {
    await session.act("前往 酒馆");
    expect(session.world.getCurrentState().scene).toBe("tavern");
  });

  it("经移动创建的场景是正经注册过的，可被 getScene 读到且带展示名", async () => {
    await session.act("前往 酒馆");
    const scene = session.world.getScene("tavern");
    expect(scene).not.toBeNull();
    expect(scene!.name.length).toBeGreaterThan(0);
  });

  it("前往一个此前完全没注册过的场景，切换不得静默失效", async () => {
    await session.act("前往 废弃灯塔");
    const active = session.world.getCurrentState().scene;
    expect(active).not.toBe("unknown");
    expect(session.world.getScene(active)).not.toBeNull();
  });

  it("连续移动后活动场景是最后一个目标，不残留在中间场景", async () => {
    await session.act("前往 酒馆");
    await session.act("前往 废弃灯塔");
    const active = session.world.getCurrentState().scene;
    expect(active).not.toBe("tavern");
    expect(session.world.getScene(active)).not.toBeNull();
  });

  it("KP 面板切到未注册场景仍然被拒绝（既有契约不变）", () => {
    expect(session.setScene("never_registered_at_all")).toBe(false);
  });

  it("KP 面板切到已注册场景成功且真的生效", () => {
    session.world.registerScene("study_room", "书房");
    expect(session.setScene("study_room")).toBe(true);
    expect(session.world.getCurrentState().scene).toBe("study_room");
  });
});
