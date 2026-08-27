// P3 — 世界模型加载状态的机器可判定出口
// 背景见 src/api/world-model-status.ts 头注释：默认路径找不到时此前只是一条
// warn 日志滚过去，整局都没有世界模型注入，没有任何人发现。
//
// 这里不测 /api/config 这条 HTTP 路由本身——server.ts 导入即执行
// Bun.serve()，本仓测试全部刻意不起一个真实的 Bun.serve 实例（同一约定见
// entity-id-consolidation.test.ts）。worldModelStatus() 是 /api/config 实际
// 调用的同一份函数，直接测它就是测真实代码路径，不是另一份会漂移的实现。
//
// 也不用仓库外的真实 229MB 世界模型文件验证「loaded: true」——那份文件
// 位置因机器而异，CI/其它开发机上不一定存在，测试不该依赖它。改用测试自建
// 的小 JSONL 夹具，走的是同一个 WorldModelLoader.load() 解析逻辑。
//
// bun test src/__tests__/world-model-status.test.ts

import { describe, it, expect, afterAll } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { worldModelStatus } from "../api/world-model-status";
import { sharedWorldModel } from "../world/world-model-loader";

const dir = mkdtempSync(join(tmpdir(), "wm-status-test-"));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("worldModelStatus — 路径不存在时如实报 false", () => {
  it("v18/克苏鲁路径都不存在：exists 与 loaded 都应该是 false，不是抛异常或悄悄当 true", () => {
    const badV18 = join(dir, "nonexistent-v18.jsonl");
    const badCthulhu = join(dir, "nonexistent-cthulhu.jsonl");
    const status = worldModelStatus(badV18, badCthulhu);
    expect(status.worldModel.exists).toBe(false);
    expect(status.worldModel.loaded).toBe(false);
    expect(status.worldModel.entryCount).toBe(0);
    expect(status.worldModel.path).toBe(badV18);
    expect(status.cthulhuModel.exists).toBe(false);
    expect(status.cthulhuModel.loaded).toBe(false);
    expect(status.cthulhuModel.path).toBe(badCthulhu);
  });
});

describe("worldModelStatus — 不该自己触发加载", () => {
  it("文件真实存在，但从没调用过 load()：loaded 仍应为 false", () => {
    // 证明 worldModelStatus() 本身只读现有状态，不会「顺手」帮你 load 一次
    // ——229MB、约 1.2s 的加载不该被一次 /api/config 请求悄悄触发。
    const existsButUnloaded = join(dir, "exists-but-unloaded.jsonl");
    writeFileSync(existsButUnloaded, '{"type":"scene","chapter":"1","novel":"test"}\n', "utf8");
    const status = worldModelStatus(existsButUnloaded, existsButUnloaded);
    expect(status.worldModel.loaded).toBe(false);
    expect(status.cthulhuModel.loaded).toBe(false);
  });
});

describe("worldModelStatus — exists 与 loaded 是两回事，不要混着当同一个信号用", () => {
  // ⚠ 这条就是本次实际踩的坑：loaded 是懒加载的运行时状态（见
  //   game-session.ts:591「懒加载：首次注入时才加载世界模型」），开跑前
  //   查它必然是 false。拿 loaded 当「文件在不在」的事前门禁，会把「还没
  //   到加载的时候」误报成「文件缺失/部署错误」。exists 才是回答「需要时
  //   能不能加载成功」的那个字段。两者都要能各自正确反映真相，且互不
  //   干扰，才算这个字段真的补对了地方。
  it("exists:true 但 loaded:false 是完全正常的状态——文件在磁盘上，只是还没被读", () => {
    const realFileNeverLoaded = join(dir, "real-file-never-loaded.jsonl");
    writeFileSync(realFileNeverLoaded, '{"type":"scene","chapter":"1"}\n', "utf8");
    // 故意不调用 sharedWorldModel(...).load(...)
    const status = worldModelStatus(realFileNeverLoaded, realFileNeverLoaded);
    expect(status.worldModel.exists).toBe(true);
    expect(status.worldModel.loaded).toBe(false);
    expect(status.cthulhuModel.exists).toBe(true);
    expect(status.cthulhuModel.loaded).toBe(false);
  });

  it("exists:false 时 loaded 必然也是 false（文件都不在，不可能已经加载成功）", () => {
    const doesNotExist = join(dir, "definitely-missing.jsonl");
    const status = worldModelStatus(doesNotExist, doesNotExist);
    expect(status.worldModel.exists).toBe(false);
    expect(status.worldModel.loaded).toBe(false);
  });

  it("exists 会跟着磁盘上文件的真实存在与否变化，不是写死的常量", () => {
    const p1 = join(dir, "toggle-a.jsonl");
    const p2 = join(dir, "toggle-b.jsonl");
    writeFileSync(p2, '{"type":"scene","chapter":"1"}\n', "utf8");
    // p1 不存在，p2 存在——同一次调用里两个不同路径应该给出不同的 exists
    const status = worldModelStatus(p1, p2);
    expect(status.worldModel.exists).toBe(false);
    expect(status.cthulhuModel.exists).toBe(true);
  });
});

describe("worldModelStatus — 已加载时如实报 true，两种情形要能区分", () => {
  it("显式 load() 过的路径：loaded 为 true 且 entryCount 反映真实条目数", () => {
    const fixture = join(dir, "loaded-fixture.jsonl");
    const lines = [
      { type: "scene", chapter: "1", novel: "测试小说", name: "场景甲" },
      { type: "scene", chapter: "1", novel: "测试小说", name: "场景乙" },
      { type: "rule", chapter: "2", novel: "测试小说", name: "规则丙" },
      // 缺 chapter 的行会被 load() 跳过（v18 parse 的既有规则），不计入 entryCount
      { type: "orphan" },
    ];
    writeFileSync(fixture, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");

    // 先像真实启动流程一样显式 load()，模拟"世界模型已经加载好"这一态——
    // worldModelStatus() 自己绝不调用 load()（上一组用例已经锁住这一点）。
    sharedWorldModel(fixture).load(fixture);

    const status = worldModelStatus(fixture, fixture);
    expect(status.worldModel.exists).toBe(true);
    expect(status.worldModel.loaded).toBe(true);
    expect(status.worldModel.entryCount).toBe(3); // 第 4 行缺 chapter 被跳过
    expect(status.cthulhuModel.exists).toBe(true);
    expect(status.cthulhuModel.loaded).toBe(true);
  });

  it("同一次调用里两个字段互不影响：v18 已加载、克苏鲁未加载时能分别报出", () => {
    const loadedPath = join(dir, "loaded-2.jsonl");
    const unloadedPath = join(dir, "unloaded-2.jsonl");
    writeFileSync(loadedPath, '{"type":"scene","chapter":"1"}\n', "utf8");
    writeFileSync(unloadedPath, '{"type":"scene","chapter":"1"}\n', "utf8");
    sharedWorldModel(loadedPath).load(loadedPath);
    // unloadedPath 故意不调用 load()

    const status = worldModelStatus(loadedPath, unloadedPath);
    expect(status.worldModel.loaded).toBe(true);
    expect(status.cthulhuModel.loaded).toBe(false);
  });
});
