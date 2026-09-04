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
// 上一个提交（N8①）在数据修复前先跑了这份判据，如实记录发现时刻的
// 真实状态：全模组 7 处撞车，全部集中在 weisen_bar（3）与
// newsstand（4）。本提交（N8②）修完这五组别名后，回归确认为 0——
// 历史记录见该提交信息，这里的断言只保留"现在应该是什么样"。
//
// bun test src/__tests__/scene-matchtext-collision.test.ts

import { describe, it, expect } from "bun:test";
import { findMatchTextCollisions } from "../investigation/scene-matchtext-collision";
import { resolvesUniquelyTo, evaluateObjectMentionClaims } from "../ingest/narrative-guard";
import { decideClueMatch } from "../investigation/clue-match";
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
  it("**正确**：修完五组别名后，全模组 20 个场景扫描结果为 0 冲突——数字可用 findMatchTextCollisions(BARN_OF_PREMIER.scenes) 直接复算", () => {
    const collisions = findMatchTextCollisions(BARN_OF_PREMIER.scenes);
    expect(collisions).toEqual([]);
  });
});

describe("原文指定的三个动作各自唯一命中它对应的线索（任务②）", () => {
  const scene = BARN_OF_PREMIER.scenes.find((s) => s.id === "维森酒吧")!;
  const candidates = scene.clues.map((c) => ({
    id: c.id,
    texts: [c.name, ...c.findMethods.map((f) => f.description), ...(c.matchTexts ?? [])],
  }));

  it.each([
    ["给前台小费", "clue_bar_mass_booking"],
    ["取悦前台", "clue_bar_mass_booking"],
    ["付钱套话问贵客身份", "clue_bar_guest_identity"],
    ["向其他人打听艾德里安", "clue_bar_ask_around"],
  ])("%s → resolve 到 %s（不是 ask）", (said, expectedClueId) => {
    expect(decideClueMatch(said, candidates)).toEqual({ kind: "resolve", clueId: expectedClueId });
  });

  it("**不再收「前台」这个词本身当别名**——它是两条线索共同要问的对象，不是任何一条专属的称呼（同一份克制见 7d9e6f1 排除「设备」/「容器」）", () => {
    const massBooking = scene.clues.find((c) => c.id === "clue_bar_mass_booking")!;
    const guestIdentity = scene.clues.find((c) => c.id === "clue_bar_guest_identity")!;
    expect(massBooking.matchTexts).not.toContain("前台");
    expect(guestIdentity.matchTexts).not.toContain("前台");
  });
});
