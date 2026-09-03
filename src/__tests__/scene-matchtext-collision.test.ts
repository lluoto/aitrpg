// 「同场景多条线索的 matchTexts 互相撞车」判据——开发·把已有判据
// 补齐到手写侧 N8。
//
// 背景：learn-gate（narrative-guard.ts 的 evaluateObjectMentionClaims）
// 对生成端提议的新别名跑条件 b（加入候选池后 decideClueMatch 必须
// 唯一命中目标线索），但只在"生成一条新别名"这个时刻检查一次——
// N7 手写进 barn-of-premier.ts 的 matchTexts 从没有经过它。核查发现
// 「前台」同时进了 clue_bar_mass_booking 与 clue_bar_guest_identity
// 两条线索的 matchTexts，「问前台贵客的身份」落进 ask 而不是 resolve。
//
// 本文件写下时，barn-of-premier.ts 的数据【还没修】——这是任务④要求
// 的"先查清楚全模组有多少处命中"那一步，如实记录发现时刻的真实状态；
// 下一个提交（N8②）才修数据，并把下面"真实数据"那组测试的期望值从
// 这份已知清单改成空数组。
//
// bun test src/__tests__/scene-matchtext-collision.test.ts

import { describe, it, expect } from "bun:test";
import { findMatchTextCollisions } from "../investigation/scene-matchtext-collision";
import { resolvesUniquelyTo, evaluateObjectMentionClaims } from "../ingest/narrative-guard";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { Scene } from "../module/types";

function scene(id: string, clues: Scene["clues"], npcIds: string[] = []): Scene {
  return { id, name: id, description: "", clues, npcIds, connections: [] };
}
function clue(id: string, matchTexts: string[], name = id): Scene["clues"][number] {
  return {
    id, name, description: "", findMethods: [], revelation: "",
    unlocks: [], found: false, importance: "core", matchTexts,
  };
}

describe("findMatchTextCollisions：正确/错误/能力边界（合成数据）", () => {
  it("**正确**：同场景两条线索的 matchTexts 互不重叠 → 不报冲突", () => {
    const collisions = findMatchTextCollisions([
      scene("s1", [clue("c1", ["前台专属词甲"]), clue("c2", ["前台专属词乙"])]),
    ]);
    expect(collisions).toEqual([]);
  });

  it("**错误行为红线**：一条别名同时写进同场景两条线索的 matchTexts → 两边都报冲突，且各自指出对方是谁", () => {
    const collisions = findMatchTextCollisions([
      scene("s1", [clue("c1", ["共享词"]), clue("c2", ["共享词"])]),
    ]);
    expect(collisions.length).toBe(2);
    const byClue = new Map(collisions.map((c) => [c.clueId, c]));
    expect(byClue.get("c1")?.phrase).toBe("共享词");
    expect(byClue.get("c1")?.collidesWith).toEqual(["c2"]);
    expect(byClue.get("c2")?.collidesWith).toEqual(["c1"]);
  });

  it("**变异检验**：构造一条会撞车的别名，判据必须报出来；把它改成不冲突的词，判据必须变绿", () => {
    const colliding = findMatchTextCollisions([
      scene("s1", [clue("c1", ["撞车词"]), clue("c2", ["撞车词"])]),
    ]);
    expect(colliding.length).toBeGreaterThan(0);

    const fixed = findMatchTextCollisions([
      scene("s1", [clue("c1", ["c1专属词"]), clue("c2", ["c2专属词"])]),
    ]);
    expect(fixed).toEqual([]);
  });

  it("**能力边界**：一条别名太短/太泛导致 decideClueMatch 判 fallback（不是 resolve）也算过不了条件 b，判据同样报出来", () => {
    // 单字/极短别名常见地会被 decideClueMatch 的 no-signal 早退判成
    // fallback，不是 ask——但 resolvesUniquelyTo 的定义是"必须 resolve
    // 到目标线索"，fallback 同样不满足，判据不会漏报这种情况。
    const collisions = findMatchTextCollisions([
      scene("s1", [clue("c1", ["之"])]), // 极短、会被判 no-signal
    ]);
    expect(collisions.length).toBe(1);
    expect(collisions[0]!.phrase).toBe("之");
  });
});

describe("resolvesUniquelyTo 只有一处实现——evaluateObjectMentionClaims 与 findMatchTextCollisions 共用它", () => {
  it("生成端 learn-gate 的条件 b 判定与 findMatchTextCollisions 判定的是同一件事：把「共享词」同时写进两条线索会让两边都失败", () => {
    const sceneClues = [
      { id: "c1", name: "c1", description: "", findMethods: [], matchTexts: ["c1专属"] },
      { id: "c2", name: "c2", description: "", findMethods: [], matchTexts: ["共享词"] },
    ];
    // 生成端声明「共享词」指代 c1——此时 c2 已经拿着「共享词」，条件 b 应该拒绝。
    const [result] = evaluateObjectMentionClaims([{ phrase: "共享词", clueId: "c1" }], sceneClues);
    expect(result!.accepted).toBe(false);

    // 同一份场景数据（把「共享词」也写进 c1 的 matchTexts，模拟"已经手写接纳了"）
    // 交给 findMatchTextCollisions，两条判据对同一个事实给出一致的结论。
    const collisions = findMatchTextCollisions([
      scene("s1", [
        clue("c1", ["c1专属", "共享词"]),
        clue("c2", ["共享词"]),
      ]),
    ]);
    expect(collisions.some((c) => c.phrase === "共享词" && c.clueId === "c1")).toBe(true);
    expect(collisions.some((c) => c.phrase === "共享词" && c.clueId === "c2")).toBe(true);
  });

  it("resolvesUniquelyTo 本身：命中目标线索时返回 true，命中别的线索/没命中时返回 false", () => {
    const candidates = [
      { id: "c1", texts: ["甲词"] },
      { id: "c2", texts: ["乙词"] },
    ];
    expect(resolvesUniquelyTo("甲词", "c1", candidates)).toBe(true);
    expect(resolvesUniquelyTo("甲词", "c2", candidates)).toBe(false); // 命中了，但不是这条
    expect(resolvesUniquelyTo("没有的词", "c1", candidates)).toBe(false);
  });
});

describe("对 BARN_OF_PREMIER 实跑：全模组扫描结果如实记录（任务④）", () => {
  it("**已知现状（本次提交前）**：全模组 20 个场景里，撞车全部集中在 weisen_bar（3 条）与 newsstand（4 条），其它场景 0 命中——数字可用 findMatchTextCollisions(BARN_OF_PREMIER.scenes) 直接复算", () => {
    const collisions = findMatchTextCollisions(BARN_OF_PREMIER.scenes);
    const bySceneCount = new Map<string, number>();
    for (const c of collisions) bySceneCount.set(c.sceneId, (bySceneCount.get(c.sceneId) ?? 0) + 1);

    expect(collisions.length).toBe(7);
    expect(bySceneCount.get("weisen_bar")).toBe(3);
    expect(bySceneCount.get("newsstand")).toBe(4);
    expect([...bySceneCount.keys()].sort()).toEqual(["newsstand", "weisen_bar"]);
  });
});
