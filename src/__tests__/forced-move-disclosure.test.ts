// 引擎替玩家挑地方时，要**明说**。
//
// 背景：`chooseConnection` 匹配不上玩家的话时会按分数替他挑一个，
// 并诚实返回 `forced: true`。但那个标记原先只喂给「访问≥6次强制改道」，
// 玩家那边一个字都看不到 —— 他说「去那边」，引擎把他送到别处，
// 日志上只有目的地的名字。
//
// 匹配本身修不了（子串比对，见 scripts/diag/diag-phrasing.ts：不含完整地名时
// 命中率 0~3%），但「不告诉玩家」是可以修的。

import { describe, test, expect } from "bun:test";
import { chooseConnection, type MoveWorldView } from "../play-module";
import type { SceneConnection } from "../module/types";

const conns: SceneConnection[] = [
  { targetSceneId: "bar", condition: "前往维森酒吧" },
  { targetSceneId: "police", condition: "前往警察局" },
] as SceneConnection[];

const NAMES: Record<string, string> = { bar: "维森酒吧", police: "警察局" };
const view: MoveWorldView = {
  isSceneVisited: () => false,
  visitCount: () => 0,
  sceneExists: (id) => id in NAMES,
  sceneName: (id) => NAMES[id] ?? "",
};

describe("chooseConnection — forced 要如实反映「是不是玩家自己选的」", () => {
  test("话里含地名 → 命中，forced=false", () => {
    const r = chooseConnection({ action: "我们去维森酒吧看看" }, conns, view);
    expect(r.conn?.targetSceneId).toBe("bar");
    expect(r.forced).toBe(false);
  });

  test("照抄选项原文 → 命中", () => {
    const r = chooseConnection({ action: "前往警察局" }, conns, view);
    expect(r.conn?.targetSceneId).toBe("police");
    expect(r.forced).toBe(false);
  });

  test("**同义改写不含地名 → 替他挑，且必须标 forced**", () => {
    // 这条是整件事的关键：替玩家做决定可以，但不能假装是他选的。
    // forced 一旦丢失，上游就不会播报「没听清」，也不会豁免强制改道。
    const r = chooseConnection({ action: "换个地方看看" }, conns, view);
    expect(r.conn).not.toBeNull();
    expect(r.forced).toBe(true);
  });

  test("代词指代 → 同样是 forced", () => {
    const r = chooseConnection({ action: "去那边" }, conns, view);
    expect(r.forced).toBe(true);
  });

  test("没有可走的出口 → conn 为 null，且不算 forced", () => {
    // null 不是「替他挑了」，是「没得挑」。两者混同会让上游多播一句莫名其妙的话。
    const r = chooseConnection({ action: "随便走走" }, [], view);
    expect(r.conn).toBeNull();
    expect(r.forced).toBe(false);
  });
});
