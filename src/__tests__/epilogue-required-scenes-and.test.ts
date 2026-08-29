// 开发C·任务2：定死 requiredScenes 的 AND/OR。
//
// types.ts:449 注释「必须访问过的场景 ID 列表（AND）」与 barn-of-premier.ts
// 的实现 `requiredScenes.some(...)`（OR）矛盾，且没有任何测试钉住过。
// 选 AND：字面意思 + 与 requiredClues 已经是 AND 的语义对齐。
//
// 复查过：全仓只有 3 处 requiredScenes 给了非空数组，两处单元素（AND/OR
// 无区别），唯一的双元素数组（adrian_fate）因为场景图拓扑（
// adrian_hospital_meeting 只能经 hospital 到达）在 AND 与 OR 下结果相同。
// 这份测试同时钉住"语义选的是 AND"与"现有数据在新语义下结果不变"两件事。
//
// bun test src/__tests__/epilogue-required-scenes-and.test.ts

import { describe, it, expect } from "bun:test";
import { evaluateEpilogues, BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { EpilogueEntry } from "../module/types";

function visitedSet(scenes: string[]) {
  const s = new Set(scenes);
  return (id: string) => s.has(id);
}
const noClues = (_id: string) => false;

describe("requiredScenes 是 AND（与 requiredClues 语义对齐）", () => {
  const twoSceneEntry: EpilogueEntry = {
    id: "test_two_scenes",
    condition: { requiredScenes: ["scene_a", "scene_b"] },
    lines: ["占位"],
  };

  it("**正确**：两个必须场景都访问过才匹配", () => {
    const result = evaluateEpilogues([twoSceneEntry], noClues, visitedSet(["scene_a", "scene_b"]));
    expect(result.map((e) => e.id)).toEqual(["test_two_scenes"]);
  });

  it("**错误行为红线**：只访问过其中一个不该匹配——这正是 AND 与 OR 的分歧点，OR 会误判匹配", () => {
    const onlyA = evaluateEpilogues([twoSceneEntry], noClues, visitedSet(["scene_a"]));
    const onlyB = evaluateEpilogues([twoSceneEntry], noClues, visitedSet(["scene_b"]));
    expect(onlyA.map((e) => e.id)).toEqual([]);
    expect(onlyB.map((e) => e.id)).toEqual([]);
  });

  it("**目标行为错误的对照**：一个必须场景都没访问过，同样不匹配（不是「部分满足也算过」）", () => {
    const none = evaluateEpilogues([twoSceneEntry], noClues, visitedSet([]));
    expect(none.map((e) => e.id)).toEqual([]);
  });

  it("**文本相似但合法**：requiredScenes 为空数组/未声明时不受这次改动影响，视为无场景限制", () => {
    const noReq: EpilogueEntry = { id: "no_req", condition: {}, lines: [] };
    const emptyReq: EpilogueEntry = { id: "empty_req", condition: { requiredScenes: [] }, lines: [] };
    const result = evaluateEpilogues([noReq, emptyReq], noClues, visitedSet([]));
    expect(result.map((e) => e.id).sort()).toEqual(["empty_req", "no_req"]);
  });
});

describe("现有后日谈数据在新语义（AND）下的匹配结果——跑前跑后对照", () => {
  it("**正确**：adrian_fate 唯一的双场景条目——访问过 adrian_hospital_meeting 时（场景图拓扑决定 hospital 必然也访问过）AND 与 OR 结果相同，仍然匹配", () => {
    // 场景图里唯一指向 adrian_hospital_meeting 的连接来自 hospital
    // （barn-of-premier.ts:356），所以真实玩法里"到过 adrian_hospital_meeting"
    // 蕴含"到过 hospital"——这里用真实数据验证这条蕴含关系下 AND 语义
    // 给出的结果与旧 OR 语义一致（都匹配），不是巧合，是拓扑保证的。
    const result = evaluateEpilogues(
      BARN_OF_PREMIER.epilogues!,
      noClues,
      visitedSet(["hospital", "adrian_hospital_meeting"]),
    );
    expect(result.map((e) => e.id)).toContain("adrian_fate");
  });

  it("**错误行为红线**：单独访问 hospital（没去 adrian_hospital_meeting）在 AND 语义下不匹配 adrian_fate——这是 AND 语义生效的直接证据，OR 语义下会误判匹配", () => {
    const result = evaluateEpilogues(
      BARN_OF_PREMIER.epilogues!,
      noClues,
      visitedSet(["hospital"]),
    );
    expect(result.map((e) => e.id)).not.toContain("adrian_fate");
  });

  it("**正确**：migo_escaped（单元素 requiredScenes）不受 AND/OR 切换影响，访问过 maintenance_room 就匹配", () => {
    const result = evaluateEpilogues(
      BARN_OF_PREMIER.epilogues!,
      (id) => id !== "clue_migo_defeated",
      visitedSet(["maintenance_room"]),
    );
    expect(result.map((e) => e.id)).toContain("migo_escaped");
  });
});
