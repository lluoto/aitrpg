// 开发 A · 任务 1 验收 —— 线索发现与场景访问历史真迁进真相源
// （WorldStateManager），不是再加一份投影。
//
// 背景：schema.ts:47-49 早就把理由写死给玩家状态（SAN/背包/武器/护甲）：
// 停在进程内 Map 重启即失，KP 与规则引擎都看不到。线索发现此前停在
// InvestigationEngine 自己的 Map（discovered），场景访问史 GameSession 侧
// 完全没有追踪。这份测试照抄 world-state-truth-source.test.ts 的形式：
// 不测"重启后还在"（架构里没有跨进程持久化这回事，:memory: db 本来就
// 随进程消失），测的是"读写是否真的只经过 WorldStateManager 这一处"。
//
// bun test src/__tests__/progress-state-truth-source.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { GameSession } from "../api/game-session";
import { InvestigationEngine } from "../investigation/investigation-engine";
import { WorldStateManager } from "../state/world-state-manager";

const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

function makeSession(): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession("progress-truth-source", "cosmic-horror", LLM, "investigator", "调查员");
}

let session: GameSession;

beforeEach(() => {
  session = makeSession();
});

describe("线索发现 · 真相只在真相源一处", () => {
  it("markDiscovered 写入可从 session.world 读回（不是引擎自己的 Map）", () => {
    session.investigation.markDiscovered("clue_test", "p1");
    expect(session.world.isClueDiscoveredBy("p1", "clue_test")).toBe(true);
    expect(session.investigation.isDiscoveredBy("clue_test", "p1")).toBe(true);
  });

  it("按玩家粒度隔离：p1 的发现不会让 p2 也算发现了", () => {
    session.investigation.markDiscovered("clue_test", "p1");
    expect(session.world.isClueDiscoveredBy("p2", "clue_test")).toBe(false);
    expect(session.investigation.isDiscoveredBy("clue_test", "p2")).toBe(false);
  });

  it("getDiscoveredBy 汇总某玩家全部发现，来自真相源", () => {
    session.investigation.markDiscovered("clue_a", "p1");
    session.investigation.markDiscovered("clue_b", "p1");
    expect(session.world.getCluesDiscoveredBy("p1").sort()).toEqual(["clue_a", "clue_b"]);
    expect(session.investigation.getDiscoveredBy("p1").sort()).toEqual(["clue_a", "clue_b"]);
  });

  it(
    "**关键判据**：两个独立的 InvestigationEngine 实例只要挂同一个 world，" +
      "就能看见彼此的发现记录——证明真相只存在 world 里，不在引擎实例自己的" +
      "进程内状态。若 markDiscovered 悄悄写回了引擎自己的 Map（回归成两处" +
      "各写一份），第二个实例会读不到，这条测试会变红。",
    () => {
      const world = new WorldStateManager(":memory:");
      const engineA = new InvestigationEngine(undefined, world);
      const engineB = new InvestigationEngine(undefined, world);
      engineA.markDiscovered("clue_cross", "p1");
      expect(engineB.isDiscoveredBy("clue_cross", "p1")).toBe(true);
      expect(engineB.getDiscoveredBy("p1")).toEqual(["clue_cross"]);
    },
  );

  it("没挂 world 的独立引擎不受影响，仍走进程内 Map（标准单测用法不受牵连）", () => {
    const standalone = new InvestigationEngine();
    standalone.markDiscovered("clue_local", "p1");
    expect(standalone.isDiscoveredBy("clue_local", "p1")).toBe(true);
    // 且不会污染任何 WorldStateManager——没有 world 可污染。
  });
});

describe("场景访问历史 · 真相只在真相源一处（GameSession 侧此前完全没有）", () => {
  it("movePlayerToScene 记一次访问，可从真相源读回", async () => {
    session.world.registerScene("scene_a", "场景A", "");
    (session as any).movePlayerToScene("scene_a");
    expect(session.world.isSceneVisitedBy("p1", "scene_a")).toBe(true);
  });

  it("按玩家粒度可查：p1 去过的地方不会让 p2 也算去过", () => {
    session.world.registerScene("scene_a", "场景A", "");
    (session as any).movePlayerToScene("scene_a");
    expect(session.world.isSceneVisitedBy("p2", "scene_a")).toBe(false);
  });

  it("getScenesVisitedBy 汇总累计历史；来回走同一场景，历史不丢也不重复", () => {
    session.world.registerScene("scene_a", "场景A", "");
    session.world.registerScene("scene_b", "场景B", "");
    (session as any).movePlayerToScene("scene_a");
    (session as any).movePlayerToScene("scene_b");
    (session as any).movePlayerToScene("scene_a"); // 回头
    expect(session.world.getScenesVisitedBy("p1").sort()).toEqual(["scene_a", "scene_b"]);
  });

  it("handleMove（自由模式，无模组）落地时同样记访问历史", async () => {
    const s = makeSession();
    await s.act("去码头");
    expect(s.world.getScenesVisitedBy("p1").length).toBeGreaterThan(0);
  });
});
