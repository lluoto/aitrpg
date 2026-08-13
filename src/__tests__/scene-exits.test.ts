// scenes.exits 的读回形状必须与写入形状一致
//
// 取证：mythos-module.ts 的三处写入点（L465 / L480 / L492）一律
// `JSON.stringify` 一个 `{target, desc}[]`；而 WorldStateManager.getScene()
// 此前把返回类型声明为 `exits: string[]`，中间是 `JSON.parse(row.exits)`——
// JSON.parse 返回 any，类型检查因此全程沉默。
//
// 当前无人消费 getScene().exits（只用了 .description），所以这是潜伏缺陷：
// 第一个真正读 exits 的调用方会拿到对象却以为是字符串。而 exits 恰恰是
// 迁移计划阶段 3 做场景邻接校验时要读的第一份数据
// （docs/kp-tool-surface-assessment.md §六 阶段 3）。
//
// 这与 §八 记录的两次事故同类：类型说一套、数据是另一套、类型检查全绿。
//
// bun test src/__tests__/scene-exits.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { WorldStateManager } from "../state/world-state-manager";

let world: WorldStateManager;

beforeEach(() => {
  world = new WorldStateManager(":memory:");
});

describe("scenes.exits 读回形状", () => {
  it("按模组的写入形状（对象数组）写入后，读回的是带 target/desc 的对象", () => {
    world.registerScene("farm_exterior", "农场外");
    world.registerScene("barn_interior", "谷仓内部");

    // 复刻 mythos-module.ts 的写法，不走任何便利封装
    world.getDatabase().run("UPDATE scenes SET exits = ? WHERE id = ?", [
      JSON.stringify([{ target: "barn_interior", desc: "推开谷仓大门" }]),
      "farm_exterior",
    ]);

    const scene = world.getScene("farm_exterior");
    expect(scene).not.toBeNull();
    expect(scene!.exits.length).toBe(1);
    expect(scene!.exits[0]!.target).toBe("barn_interior");
    expect(scene!.exits[0]!.desc).toBe("推开谷仓大门");
  });

  it("出口目标可直接用于查场景，不需要调用方再猜形状", () => {
    world.registerScene("farm_exterior", "农场外");
    world.registerScene("barn_interior", "谷仓内部");
    world.getDatabase().run("UPDATE scenes SET exits = ? WHERE id = ?", [
      JSON.stringify([{ target: "barn_interior", desc: "推开谷仓大门" }]),
      "farm_exterior",
    ]);

    const targets = world.getScene("farm_exterior")!.exits.map((e) => e.target);
    expect(targets).toEqual(["barn_interior"]);
    expect(world.getScene(targets[0]!)).not.toBeNull();
  });

  it("容忍历史上的纯字符串写法，归一成同一形状", () => {
    world.registerScene("a", "A");
    world.getDatabase().run("UPDATE scenes SET exits = ? WHERE id = ?", [
      JSON.stringify(["b", "c"]),
      "a",
    ]);

    const exits = world.getScene("a")!.exits;
    expect(exits.map((e) => e.target)).toEqual(["b", "c"]);
    expect(exits.every((e) => typeof e.desc === "string")).toBe(true);
  });

  it("未设置出口时返回空数组而不是抛错", () => {
    world.registerScene("lonely", "孤立场景");
    expect(world.getScene("lonely")!.exits).toEqual([]);
  });

  it("exits 列损坏时降级为空数组，不影响场景本身可读", () => {
    world.registerScene("broken", "损坏出口");
    world.getDatabase().run("UPDATE scenes SET exits = ? WHERE id = ?", ["{not json", "broken"]);

    const scene = world.getScene("broken");
    expect(scene).not.toBeNull();
    expect(scene!.exits).toEqual([]);
    expect(scene!.name).toBe("损坏出口");
  });

  it("registerScene 保留已有出口，不把它清空", () => {
    world.registerScene("keep", "保留出口");
    world.getDatabase().run("UPDATE scenes SET exits = ? WHERE id = ?", [
      JSON.stringify([{ target: "elsewhere", desc: "走出去" }]),
      "keep",
    ]);

    world.registerScene("keep", "保留出口", "新的描写");

    const scene = world.getScene("keep")!;
    expect(scene.description).toBe("新的描写");
    expect(scene.exits.map((e) => e.target)).toEqual(["elsewhere"]);
  });
});

// listScenes() 是为了让 game-session 不再 getDatabase() 手写
// `SELECT id, name FROM scenes`。手写的问题不是取不到 db（那是公开方法），
// 而是行类型是 any：列名拼错、少读一列、name 为 null 都要等运行时才发现。
// 收到真相源之后，表结构只有 world-state-manager 知道。
describe("listScenes 契约", () => {
  it("列出全部已注册场景，不漏不重", () => {
    world.registerScene("a", "客厅");
    world.registerScene("b", "书房");
    world.registerScene("c", "阁楼");

    const ids = world.listScenes().map((s) => s.id).sort();
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每行与 getScene 同形：name/description 非 null，exits 已解析成对象", () => {
    world.registerScene("hall", "大厅", "空旷的大厅");
    world.getDatabase().run("UPDATE scenes SET exits = ? WHERE id = ?", [
      JSON.stringify([{ target: "attic", desc: "爬上阁楼" }]),
      "hall",
    ]);

    const hall = world.listScenes().find((s) => s.id === "hall")!;
    const viaGetScene = world.getScene("hall")!;
    expect(hall).toEqual(viaGetScene);
    expect(hall.exits[0]!.target).toBe("attic");
    expect(hall.exits[0]!.desc).toBe("爬上阁楼");
  });

  it("description 缺失时给空串而不是 null，调用方可以直接 .length", () => {
    world.registerScene("bare", "空描写场景");
    const bare = world.listScenes().find((s) => s.id === "bare")!;
    expect(bare.description).toBe("");
    expect(bare.description.length).toBe(0);
  });

  // schema 对 scenes.name 是 NOT NULL，所以不存在 name 为 null 的行；
  // 但空串是允许的，模糊匹配靠 `!name` 把它挡掉，这里锁住这个前提。
  it("name 是 NOT NULL：写 null 会被数据库直接拒绝", () => {
    world.registerScene("legacy", "临时名");
    expect(() =>
      world.getDatabase().run("UPDATE scenes SET name = NULL WHERE id = ?", ["legacy"]),
    ).toThrow();
  });

  it("空串 name 原样返回，由调用方的 falsy 判断挡掉", () => {
    world.registerScene("blank", "占位");
    world.getDatabase().run("UPDATE scenes SET name = '' WHERE id = ?", ["blank"]);

    const blank = world.listScenes().find((s) => s.id === "blank")!;
    expect(blank.name).toBe("");
  });

  it("空库返回空数组而不是抛错", () => {
    const empty = new WorldStateManager(":memory:");
    expect(Array.isArray(empty.listScenes())).toBe(true);
  });
});

