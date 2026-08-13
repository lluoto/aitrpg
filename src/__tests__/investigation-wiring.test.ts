// CoC 调查循环必须真的接进游戏流程
//
// 取证：InvestigationEngine 的规则是完整且被 investigation-coc.test.ts 覆盖过的
// ——技能选取、带惩罚骰的检定、按成功层级取揭示文本、SAN 按成败取值并乘难度倍率、
// 已发现则不重复扣 SAN、成功即 markDiscovered。缺的只是从游戏流程调用它这一步。
//
// 而 handleSkillCheck 自己掷一个裸 d100 就结束了：不看场景线索、不出揭示文本、
// 不扣 SAN。于是模组导入时注册的线索永远不会被"调查"这个动作解析，
// CoC 的核心循环（调查 → 线索 → 掉 SAN）实际不成立。
//
// 这里用 SAN 的变化做断言而不是揭示文案：文案随成功层级变化，
// 而首次调查 ritual_site（san_cost "1/1d6"）无论成败都必定扣 SAN。
//
// bun test src/__tests__/investigation-wiring.test.ts

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

function currentSan(): number {
  return session.sanity.state.currentSAN;
}

function currentScene(): string {
  return session.world.getCurrentState().scene;
}

beforeEach(() => {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  session = new GameSession("investigation-wiring", "cosmic-horror", LLM, "investigator", "调查员");
});

describe("调查动作接入 InvestigationEngine", () => {
  it("场景有未发现线索时，调查会扣 SAN", async () => {
    session.investigation.registerSceneClue(currentScene(), "ritual_site");
    const before = currentSan();

    await session.act("调查");

    expect(currentSan()).toBeLessThan(before);
  });

  it("扣掉的 SAN 落到真相源，不只是进程内引擎", async () => {
    session.investigation.registerSceneClue(currentScene(), "ritual_site");
    const before = currentSan();

    await session.act("调查");

    const persisted = session.world.getPlayerSanity(session.activePlayerId)?.currentSAN;
    expect(persisted).toBe(currentSan());
    expect(persisted).toBeLessThan(before);
  });

  it("线索已被该调查员发现后，再调查不重复扣 SAN", async () => {
    session.investigation.registerSceneClue(currentScene(), "ritual_site");
    session.investigation.markDiscovered("ritual_site", session.activePlayerId);
    const before = currentSan();

    await session.act("调查");

    expect(currentSan()).toBe(before);
  });

  it("场景没有线索时，调查保持原有的裸检定行为，不扣 SAN", async () => {
    const before = currentSan();

    await session.act("调查");

    expect(currentSan()).toBe(before);
  });

  // 这一组推翻了本文件上一版的一条断言。当时写的是「只有描述的模组线索不得劫持
  // 技能检定」——那是在没有定义可合成的前提下唯一安全的做法：送进 investigateCoC
  // 只会拿到兜底失败「你没有找到有用的线索」，比裸检定更糟。
  //
  // 前提现在变了：模组每条线索本来就带 description 和 sanCost，registerSceneClue
  // 只是没有 sanCost 这个参数、把它丢在了边界上。补上之后就能合成一份最小定义
  // （检定技能取 addClueType 既有的默认值 spot_hidden，揭示文本用模组自己的描述），
  // 于是模组线索应当可被调查解析——这才是这套数据本来的用途。
  describe("模组注册的线索", () => {
    it("带 sanCost 的模组线索，调查会按它扣 SAN", async () => {
      session.investigation.registerSceneClue(currentScene(), "barn_hideout", "谷仓里的临时住所", "1/1d6");
      const before = currentSan();

      await session.act("调查");

      expect(currentSan()).toBeLessThan(before);
    });

    it("不带 sanCost 的模组线索仍可被解析，只是不扣 SAN", async () => {
      session.investigation.registerSceneClue(currentScene(), "barn_hideout", "谷仓里的临时住所");
      const before = currentSan();

      await session.act("调查");

      expect(currentSan()).toBe(before);
      expect(session.investigation.hasClueType("barn_hideout")).toBe(true);
    });

    it("不得覆盖 investigation.yaml 里已有的同名定义", () => {
      expect(session.investigation.hasClueType("ritual_site")).toBe(true);

      session.investigation.registerSceneClue(currentScene(), "ritual_site", "模组自己的描述", "0/1");

      // 合成定义只有一句描述和一条 spot_hidden 路径；yaml 版有多技能路径与分层文本。
      // 覆盖即数据丢失，所以已有定义必须原样保留 —— 用 san_cost 作可判定的观测点。
      const resolved = session.investigation.investigateCoC("ritual_site", { occult: 50 }, "probe");
      expect(resolved.sanCost).toBe("1/1d6");
    });
  });

  it("SAN 不会被扣成负数", async () => {
    session.setPlayerSan(session.activePlayerId, 1);
    session.investigation.registerSceneClue(currentScene(), "ritual_site");

    await session.act("调查");

    expect(currentSan()).toBeGreaterThanOrEqual(0);
  });
});
