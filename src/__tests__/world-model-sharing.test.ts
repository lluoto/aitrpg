// 世界模型 loader 必须进程内共享，不能按会话各建一份
//
// 取证（真实服务日志，3 个会话各跑 1 回合）：
//   🌐 世界模型 v18 已加载: 383688 条 | 73 部小说 | 424 种类型 | 1.3s   ← 会话 1
//   🌐 世界模型 v18 已加载: 383688 条 | 73 部小说 | 424 种类型 | 1.2s   ← 会话 2
//   🌐 世界模型 v18 已加载: 383688 条 | 73 部小说 | 424 种类型 | 1.2s   ← 会话 3
// 服务进程驻留 1938 MB。磁盘上已有 41 个存档会话，按原样逐个恢复必然打爆内存。
//
// 根因：GameSession 构造函数为每个会话各 `new WorldModelLoader()`。构造函数里的
// 懒加载注释只解决了「不在构造时加载」，没解决「每会话各加载一份」。
//
// 这两份是只读参考数据，不是会话状态：loader 的全部可变状态都在 load() 里
// 一次性建好，之后所有公开方法只读。
//
// bun test src/__tests__/world-model-sharing.test.ts

import { describe, it, expect } from "bun:test";
import { GameSession } from "../api/game-session";
import { sharedWorldModel, DEFAULT_V18_PATH, WorldModelLoader } from "../world/world-model-loader";

const LLM = {
  apiKey: "sk-placeholder",
  baseUrl: "http://localhost:9999",
  model: "mock",
  maxTokens: 1024,
  temperature: 0.7,
};

function makeSession(id: string): GameSession {
  process.env.LLM_API_KEY = "";
  process.env.OPENAI_API_KEY = "";
  return new GameSession(id, "cosmic-horror", LLM, "investigator", "调查员");
}

describe("世界模型 loader 共享", () => {
  it("同一路径重复取用返回同一个实例", () => {
    expect(sharedWorldModel()).toBe(sharedWorldModel());
    expect(sharedWorldModel(DEFAULT_V18_PATH)).toBe(sharedWorldModel());
  });

  it("不同路径分桶，互不串用", () => {
    const a = sharedWorldModel("path/a.jsonl");
    const b = sharedWorldModel("path/b.jsonl");
    expect(a).not.toBe(b);
    expect(sharedWorldModel("path/a.jsonl")).toBe(a);
  });

  it("多个会话复用同一个 v18 loader，而不是各建一份", () => {
    const s1 = makeSession("share-1");
    const s2 = makeSession("share-2");
    const s3 = makeSession("share-3");

    expect(s1.worldModel).toBe(s2.worldModel);
    expect(s2.worldModel).toBe(s3.worldModel);
    expect(s1.worldModel).toBe(sharedWorldModel());
  });

  it("多个会话复用同一个克苏鲁 loader，且与 v18 loader 不是同一个", () => {
    const s1 = makeSession("share-4");
    const s2 = makeSession("share-5");

    expect(s1.cthulhuLoader).toBe(s2.cthulhuLoader);
    expect(s1.cthulhuLoader).not.toBe(s1.worldModel);
  });

  it("会话之间共享，因此第二个会话看到的是第一个的加载结果", () => {
    // 不实际读 240MB 的主库：用一个独立路径桶模拟「已加载」状态的可见性。
    const probePath = "probe/shared-visibility.jsonl";
    const first = sharedWorldModel(probePath);
    const second = sharedWorldModel(probePath);
    expect(second.isLoaded()).toBe(first.isLoaded());
    expect(second).toBe(first);
  });

  it("共享的仍是 WorldModelLoader，公开接口不变", () => {
    const loader = sharedWorldModel("probe/interface.jsonl");
    expect(loader).toBeInstanceOf(WorldModelLoader);
    expect(typeof loader.isLoaded).toBe("function");
    expect(typeof loader.getByType).toBe("function");
  });
});
