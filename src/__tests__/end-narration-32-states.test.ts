// 开发C·任务3：让 evaluateEndNarration 真读声明式条件。
//
// 现状：evaluateEndNarration（barn-of-premier.ts）无视 END_NARRATIONS[i]
// .condition，手写了一遍 if 链，靠注释 `return END_NARRATIONS[0]; // true`
// 手工对应下标——这不是机械翻译，声明式数据本身是错的。32 态穷举（5 个
// 布尔：clue_bedroom_diary / clue_bedroom_old_doc / clue_control_supplies /
// bad_lever_pulled / 是否访问过 maintenance_room）发现 10 态不一致：
//   缺陷一（6 态，全部可达）—— Normal End 的 excludeClues 把它写成"三条
//   线索一条都没找到"，if 链却把它当无条件兜底：玩家找到老文件但没凑齐
//   True End 时，声明式给不出任何结局，游戏无法结束。
//   缺陷二（4 态）—— 优先级矛盾：if 链 true→bad→good→normal，数组顺序
//   true→good→bad→normal。拉杆杀光所有人比拿到补给更有决定性，bad 应当
//   胜出。
//
// 两个缺陷都按 if 链的行为收敛（改数据 + 改求值器）：
//   缺陷一是数据缺陷——游戏必须总能给出结局，全覆盖是功能要求，改数据
//   （去掉 Normal 的 excludeClues，让它成为真正的兜底），不是改判据迁就它。
//   缺陷二用显式 priority 字段表达优先级，不依赖数组书写顺序——数组顺序
//   隐含优先级正是这次踩的坑本身，字段自解释，不会因为编辑时挪了行就
//   悄悄变了游戏行为。
//
// 本文件先写、对着旧 if 链跑绿（确认测试本身没写错），再改实现，改完仍绿。
//
// bun test src/__tests__/end-narration-32-states.test.ts

import { describe, it, expect } from "bun:test";
import { BARN_SUPPORT, END_NARRATIONS } from "../module/barn-of-premier";

/**
 * 旧 if 链的忠实复刻（barn-of-premier.ts 改动前的 evaluateEndNarration）。
 * 作为本轮改动"结果必须不变"的基准——不是当前实现的引用，是把旧行为
 * 冻结下来的独立副本，改实现之后这份 oracle 不跟着变。
 */
function oldIfChainOracle(
  diary: boolean, oldDoc: boolean, supplies: boolean, leverPulled: boolean, maintVisited: boolean,
): string {
  if (diary && oldDoc && maintVisited) return "true";
  if (leverPulled) return "bad";
  if (supplies && !oldDoc) return "good";
  return "normal";
}

const FLAG_NAMES = ["diary", "oldDoc", "supplies", "leverPulled", "maintVisited"] as const;

function stateFromMask(mask: number) {
  return {
    diary: !!(mask & 1),
    oldDoc: !!(mask & 2),
    supplies: !!(mask & 4),
    leverPulled: !!(mask & 8),
    maintVisited: !!(mask & 16),
  };
}

function evaluatorsFor(s: ReturnType<typeof stateFromMask>) {
  const cluesFound = new Set<string>();
  if (s.diary) cluesFound.add("clue_bedroom_diary");
  if (s.oldDoc) cluesFound.add("clue_bedroom_old_doc");
  if (s.supplies) cluesFound.add("clue_control_supplies");
  if (s.leverPulled) cluesFound.add("bad_lever_pulled");
  const scenesVisited = new Set<string>();
  if (s.maintVisited) scenesVisited.add("maintenance_room");
  return {
    isClueFound: (id: string) => cluesFound.has(id),
    isSceneVisited: (id: string) => scenesVisited.has(id),
  };
}

describe("32态穷举：新实现（声明式求值器）与旧 if 链在每一态上都相同", () => {
  for (let mask = 0; mask < 32; mask++) {
    const s = stateFromMask(mask);
    const label = FLAG_NAMES.filter((k) => s[k]).join("+") || "(全否)";
    it(`态 ${mask.toString(2).padStart(5, "0")} [${label}]`, () => {
      const expected = oldIfChainOracle(s.diary, s.oldDoc, s.supplies, s.leverPulled, s.maintVisited);
      const { isClueFound, isSceneVisited } = evaluatorsFor(s);
      const result = BARN_SUPPORT.evaluateEnding(isClueFound, isSceneVisited);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(expected);
    });
  }
});

describe("全覆盖断言：32 态中不得有任何一态匹配不到结局", () => {
  it("**错误行为红线**：独立于等价性的断言——即使将来数据变了，也不允许出现「无结局」", () => {
    const unmatched: number[] = [];
    for (let mask = 0; mask < 32; mask++) {
      const s = stateFromMask(mask);
      const { isClueFound, isSceneVisited } = evaluatorsFor(s);
      const result = BARN_SUPPORT.evaluateEnding(isClueFound, isSceneVisited);
      if (result === null) unmatched.push(mask);
    }
    expect(unmatched).toEqual([]);
  });
});

describe("优先级：拉杆杀光所有人（bad）比拿到补给（good）更有决定性", () => {
  it("**正确**：同时满足 bad 与 good 的条件时，结局是 bad 不是 good", () => {
    // supplies=true, oldDoc=false → good 的条件成立（supplies 且非 oldDoc）
    // leverPulled=true → bad 的条件也成立
    // 两者都成立时，bad 必须赢
    const { isClueFound, isSceneVisited } = evaluatorsFor({
      diary: false, oldDoc: false, supplies: true, leverPulled: true, maintVisited: false,
    });
    const result = BARN_SUPPORT.evaluateEnding(isClueFound, isSceneVisited);
    expect(result?.id).toBe("bad");
  });
});

describe("Normal End 是真正的兜底——不再要求三条线索都没找到", () => {
  it("**错误行为红线**：只找到 clue_bedroom_old_doc（凑不齐 True End 的另外两个条件）仍然要给出结局，不能无结局", () => {
    const { isClueFound, isSceneVisited } = evaluatorsFor({
      diary: false, oldDoc: true, supplies: false, leverPulled: false, maintVisited: false,
    });
    const result = BARN_SUPPORT.evaluateEnding(isClueFound, isSceneVisited);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("normal");
  });
});

describe("EndNarration 数据本身有显式优先级字段", () => {
  it("**正确**：每条 END_NARRATIONS 都带 priority，且按 true<bad<good<normal 排序", () => {
    for (const en of END_NARRATIONS) {
      expect(typeof (en as any).priority).toBe("number");
    }
    const byId = new Map(END_NARRATIONS.map((en) => [en.id, (en as any).priority as number]));
    expect(byId.get("true")!).toBeLessThan(byId.get("bad")!);
    expect(byId.get("bad")!).toBeLessThan(byId.get("good")!);
    expect(byId.get("good")!).toBeLessThan(byId.get("normal")!);
  });
});
