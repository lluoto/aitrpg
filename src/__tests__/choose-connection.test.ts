import { describe, expect, test } from "bun:test";
import { chooseConnection, type MoveWorldView } from "../play-module";
import type { SceneConnection } from "../module/types";

function conn(condition: string, targetSceneId: string): SceneConnection {
  return { condition, targetSceneId } as SceneConnection;
}

/** 默认：场景都存在、都没访问过 */
function view(over: Partial<MoveWorldView> = {}): MoveWorldView {
  return {
    isSceneVisited: () => false,
    visitCount: () => 0,
    sceneExists: () => true,
    sceneName: () => "",
    ...over,
  };
}

describe("chooseConnection", () => {
  test("玩家说的地名对上了就用他选的，不算强制", () => {
    const a = conn("前往加比的拖车房", "trailer");
    const b = conn("前往普瑞米尔", "premier");
    const r = chooseConnection({ action: "我前往加比的拖车房看看" }, [a, b], view());
    expect(r.conn).toBe(a);
    expect(r.forced).toBe(false);
  });

  test("对不上就按分数替他挑，并且标成 forced", () => {
    // forced 是这次抽函数的重点：原先埋在闭包里，
    // 「玩家自己选的」和「引擎替他选的」出来一模一样，外面无从分辨。
    const a = conn("前往加比的拖车房", "trailer");
    const r = chooseConnection({ action: "我蹲下来检查地上的痕迹" }, [a], view());
    expect(r.conn).toBe(a);
    expect(r.forced).toBe(true);
  });

  test("没有可走的连接时返回 null，不崩", () => {
    // 抽出来之前这里是 scored[0].conn 读 undefined → TypeError。
    // processScene 声明了返回 SceneConnection | null，调用方还写了几十行
    // dead-end 兜底，但旧代码根本到不了 null —— 先抛异常了。
    const r = chooseConnection({ action: "我环顾四周" }, [], view());
    expect(r.conn).toBeNull();
    expect(r.forced).toBe(false);
  });

  test("指向不存在场景的连接排最后", () => {
    // 模组数据有洞的时候。少了这一支，坏连接反而会因为
    // 「没访问过」拿 +10 排到第一个去 —— 把玩家送进不存在的地方。
    const broken = conn("前往虚空", "nope");
    const ok = conn("前往谷仓", "barn");
    const r = chooseConnection(
      { action: "随便走走" },
      [broken, ok],
      view({ sceneExists: (id) => id !== "nope" }),
    );
    expect(r.conn).toBe(ok);
  });

  test("没去过的优先于去过的", () => {
    const seen = conn("返回普瑞米尔", "premier");
    const fresh = conn("前往谷仓", "barn");
    const r = chooseConnection(
      { action: "嗯" },
      [seen, fresh],
      view({ isSceneVisited: (id) => id === "premier" }),
    );
    expect(r.conn).toBe(fresh);
  });

  test("去过三次以上的进一步靠后", () => {
    const many = conn("前往甲", "a");
    const few = conn("前往乙", "b");
    const r = chooseConnection(
      { action: "嗯" },
      [many, few],
      view({
        isSceneVisited: () => true,
        visitCount: (id) => (id === "a" ? 3 : 0),
      }),
    );
    expect(r.conn).toBe(few);
  });

  test("匹配只看地名，不受动词前缀影响", () => {
    const a = conn("返回普瑞米尔", "premier");
    const r = chooseConnection({ action: "我们回普瑞米尔" }, [a], view());
    expect(r.forced).toBe(false);
  });

  test("地名带括号补充时也能对上", () => {
    // 曾经对不上：condition 去掉动词后取前 8 字，
    // "艾德里安的农场（沿着小路向北）" 截成 "艾德里安的农场（" —— 带着半个括号。
    // 括号里往往是走法说明，玩家不会照念。
    const a = conn("前往艾德里安的农场（沿着小路向北）", "farm");
    const r = chooseConnection({ action: "我去艾德里安的农场" }, [a], view());
    expect(r.conn).toBe(a);
    expect(r.forced).toBe(false);
  });

  test("按目标场景的真名也能对上", () => {
    // condition 和场景名可以完全不一样。玩家看着场景名说话，
    // 而选项文本用的是 condition —— 两边都得认。
    const a = conn("返回镇上", "premier");
    const r = chooseConnection(
      { action: "我们回普瑞米尔" },
      [a],
      view({ sceneName: (id) => (id === "premier" ? "普瑞米尔" : "") }),
    );
    expect(r.forced).toBe(false);
  });

  test("单字不算匹配", () => {
    // 键短于 2 字就丢掉：一个字满大街都是，会把不相干的话判成移动。
    const a = conn("前往东", "east");
    const r = chooseConnection({ action: "我把手电筒往东边照了照" }, [a], view());
    expect(r.forced).toBe(true);
  });
});
