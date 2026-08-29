// 开发 A · 任务 3：移动代价的图与 BFS 本体。
// 正反例覆盖：无向化、跳数计算、孤立节点、未注册目标、原地不动。

import { describe, test, expect } from "bun:test";
import { buildSceneGraph, shortestHops } from "../play/move-graph";

describe("buildSceneGraph —— 无向化", () => {
  test("单向 exits 也能反向走通（当作无向图）", () => {
    const graph = buildSceneGraph([
      { id: "a", exits: [{ target: "b" }] }, // a -> b，但 b 没有声明回 a 的出口
      { id: "b", exits: [] },
    ]);
    expect(graph.get("a")!.has("b")).toBe(true);
    expect(graph.get("b")!.has("a")).toBe(true); // 反向边也在
  });

  test("孤立场景（零出口、也没被任何人当目标）仍然是图里的节点", () => {
    const graph = buildSceneGraph([
      { id: "a", exits: [{ target: "b" }] },
      { id: "b", exits: [] },
      { id: "isolated", exits: [] },
    ]);
    expect(graph.has("isolated")).toBe(true);
    expect(graph.get("isolated")!.size).toBe(0);
  });
});

describe("shortestHops", () => {
  const linear = buildSceneGraph([
    { id: "a", exits: [{ target: "b" }] },
    { id: "b", exits: [{ target: "c" }] },
    { id: "c", exits: [{ target: "d" }] },
    { id: "d", exits: [] },
    { id: "isolated", exits: [] },
  ]);

  test("原地不动是 0 跳", () => {
    expect(shortestHops(linear, "a", "a")).toBe(0);
  });

  test("相邻是 1 跳", () => {
    expect(shortestHops(linear, "a", "b")).toBe(1);
  });

  test("跨图按最短路径算跳数", () => {
    expect(shortestHops(linear, "a", "d")).toBe(3);
  });

  test("反向路径同样能算（无向）", () => {
    expect(shortestHops(linear, "d", "a")).toBe(3);
  });

  test("**应报 null**：孤立节点，图上量不出到达方式", () => {
    expect(shortestHops(linear, "a", "isolated")).toBeNull();
  });

  test("**应报 null**：目标压根没注册", () => {
    expect(shortestHops(linear, "a", "no-such-scene")).toBeNull();
  });

  test("起点没注册同样报 null（防御性——调用方按理不会传这种输入）", () => {
    expect(shortestHops(linear, "no-such-scene", "a")).toBeNull();
  });

  test("有多条路时取最短的那条，不是随便一条", () => {
    // a -b-c-d，另加一条 a-d 直连的捷径
    const withShortcut = buildSceneGraph([
      { id: "a", exits: [{ target: "b" }, { target: "d" }] },
      { id: "b", exits: [{ target: "c" }] },
      { id: "c", exits: [{ target: "d" }] },
      { id: "d", exits: [] },
    ]);
    expect(shortestHops(withShortcut, "a", "d")).toBe(1); // 走捷径，不是绕 3 跳
  });
});
