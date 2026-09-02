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
// ────────────────────────────────────────────────────────────────
// 开发·摄取管线校准 阶段3 追加：oldIfChainOracle 退役，新增 64 态穷举
// ────────────────────────────────────────────────────────────────
//
// 上面这份 32 态穷举把 oldIfChainOracle 冻结成"改实现不许改变行为"的
// 基准——那份契约只对**开发C·任务3那一次重构**成立（把 if 链改写成声明式
// 求值器，结果必须逐态相同，验证的是"翻译没翻错"，不是"这套规则该不该
// 这样定"）。这一轮（开发·摄取管线校准 阶段3）是**故意改变行为**的重构：
// True End 的条件从 [diary, old_doc] 改成 [old_doc, final_brain_jars]（原文
// 三重欺骗结构要求"读懂机制"+"亲眼见到处境"，不再是"读懂机制"两条线索
// 各说各话），新增 near_truth 结局。继续拿 oldIfChainOracle 当基准，等于
// 用上一次重构的契约去阻止这一次明确要做的事——"改动前后结果必须相同"
// 这句话本身就不该再对 True End 的条件成立。
//
// 按本文件自己在 :22 定下的方法论重新走一遍（不是另起一套）：
//   1. 先写 newIntentOracle，编码新的意图（含 near_truth，见下）。
//   2. 对着**改动前**的 END_NARRATIONS 跑：必须红——这一步已经做过
//      （手动核对：改动前 true 的条件是 diary+oldDoc+maintVisited，
//      newIntentOracle 要的是 oldDoc+finalBrainJars+maintVisited，凡是
//      finalBrainJars 与 diary 取值不同的状态都会在 true 分支上产生分歧；
//      near_truth 在改动前的数据里根本不存在，所有该判 near_truth 的态
//      改动前只会落到 normal，同样会红）。证明这份新判据真的在测新行为，
//      不是照着已经改好的实现抄出来的。
//   3. 再改数据（barn-of-premier.ts 的 END_NARRATIONS），跑绿——见本文件
//      下方新增的 64 态穷举。
//
// oldIfChainOracle 与它原来的 32 态循环**保留在文件里但退役**——用
// `describe.skip` 而不是删掉：它记录的是"if 链 → 声明式求值器"那次
// 重构的行为基准，删掉会让后人以为这段历史被随手抹掉、以为这次重构是
// 第一次动这份逻辑；skip 让它既不参与这一轮的 pass/fail 计数，又能被
// 翻出来读、需要时还能取消 skip 手动核对。
//
// 状态空间从 5 个布尔（32 态）变成 6 个（64 态）：新增
// clue_final_brain_jars。diary 保留在状态空间里，但**不再直接影响求值
// 结果**——阶段1 的前置门只保证"不discover diary 就摸不到 old_doc"，
// 求值器本身从没读过 diary 这个 id；穷举里单独变化 diary、其它 5 个不变
// 时结果不应该有任何差异，这是验证"diary 已经不是判定条件的一部分，
// 只是通过前置门间接影响 old_doc 能不能被发现"的一个隐含断言。
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

// 退役（开发·摄取管线校准 阶段3）：见文件头新增的说明。用 describe.skip
// 保留代码本身可读、可手动核对，但不计入这一轮的 pass/fail——继续要求
// 它绿，等于要求 True End 的条件不许变，而这一轮明确要改它。
describe.skip("32态穷举：新实现（声明式求值器）与旧 if 链在每一态上都相同（已退役，见文件头说明）", () => {
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

// ────────────────────────────────────────────────────────────────
// 新增（开发·摄取管线校准 阶段3）：64 态穷举，编码新的意图
// ────────────────────────────────────────────────────────────────

/**
 * 新意图的独立 oracle——不是照抄 evaluateEndNarration 的实现，是把"这一轮
 * 想要的规则"用最直白的 if 链写一遍，按 END_NARRATIONS 里的真实 priority
 * 顺序（true=1 < bad=2 < good=3 < near_truth=4 < normal=5）排列分支。
 *
 *   true       —— 读懂了老旧文件（机制）+ 亲眼见到缸中脑（处境）+ 到过终局
 *   bad        —— 拉杆杀光所有人，最有决定性，排在 good/near_truth 前面
 *   good       —— 报警时手上有补给，但没读懂老旧文件
 *   near_truth —— 到过终局、见到缸中脑，但没读懂老旧文件（比 good 更接近
 *                 真相，但排在它后面——与 END_NARRATIONS 里的注释同一个
 *                 理由：good 判定不要求真的到过终局，near_truth 要求，
 *                 但 priority 数值上 good 仍然定得比 near_truth 靠前，
 *                 是这一轮明确做出的取舍，不是笔误）
 *   normal     —— 兜底，前面都不中才轮到它
 */
function newIntentOracle(
  // diary 有意不参与任何分支——见上方注释，它已经不是直接判定条件，
  // 只留在签名里是为了跟 stateFromMask6 的字段顺序对齐、方便调用处一次性
  // 展开六个布尔。
  _diary: boolean, oldDoc: boolean, supplies: boolean, leverPulled: boolean,
  maintVisited: boolean, finalBrainJars: boolean,
): string {
  if (oldDoc && finalBrainJars && maintVisited) return "true";
  if (leverPulled) return "bad";
  if (supplies && !oldDoc) return "good";
  if (finalBrainJars && maintVisited && !oldDoc) return "near_truth";
  return "normal";
}

const FLAG_NAMES_6 = ["diary", "oldDoc", "supplies", "leverPulled", "maintVisited", "finalBrainJars"] as const;

function stateFromMask6(mask: number) {
  return {
    diary: !!(mask & 1),
    oldDoc: !!(mask & 2),
    supplies: !!(mask & 4),
    leverPulled: !!(mask & 8),
    maintVisited: !!(mask & 16),
    finalBrainJars: !!(mask & 32),
  };
}

function evaluatorsFor6(s: ReturnType<typeof stateFromMask6>) {
  const cluesFound = new Set<string>();
  if (s.diary) cluesFound.add("clue_bedroom_diary");
  if (s.oldDoc) cluesFound.add("clue_bedroom_old_doc");
  if (s.supplies) cluesFound.add("clue_control_supplies");
  if (s.leverPulled) cluesFound.add("bad_lever_pulled");
  if (s.finalBrainJars) cluesFound.add("clue_final_brain_jars");
  const scenesVisited = new Set<string>();
  if (s.maintVisited) scenesVisited.add("maintenance_room");
  return {
    isClueFound: (id: string) => cluesFound.has(id),
    isSceneVisited: (id: string) => scenesVisited.has(id),
  };
}

describe("64态穷举：新实现与新意图 oracle 在每一态上都相同（含 near_truth）", () => {
  for (let mask = 0; mask < 64; mask++) {
    const s = stateFromMask6(mask);
    const label = FLAG_NAMES_6.filter((k) => s[k]).join("+") || "(全否)";
    it(`态 ${mask.toString(2).padStart(6, "0")} [${label}]`, () => {
      const expected = newIntentOracle(s.diary, s.oldDoc, s.supplies, s.leverPulled, s.maintVisited, s.finalBrainJars);
      const { isClueFound, isSceneVisited } = evaluatorsFor6(s);
      const result = BARN_SUPPORT.evaluateEnding(isClueFound, isSceneVisited);
      expect(result).not.toBeNull();
      expect(result!.id).toBe(expected);
    });
  }
});

describe("全覆盖断言（64 态）：不得有任何一态匹配不到结局", () => {
  it("**错误行为红线**：即使将来数据变了，也不允许出现「无结局」", () => {
    const unmatched: number[] = [];
    for (let mask = 0; mask < 64; mask++) {
      const s = stateFromMask6(mask);
      const { isClueFound, isSceneVisited } = evaluatorsFor6(s);
      const result = BARN_SUPPORT.evaluateEnding(isClueFound, isSceneVisited);
      if (result === null) unmatched.push(mask);
    }
    expect(unmatched).toEqual([]);
  });
});

describe("diary 已不直接参与判定——只通过阶段1 的前置门间接影响 old_doc 能不能被发现", () => {
  it("**正确**：其余 5 个布尔不变时，单独翻转 diary 不改变结局", () => {
    for (let mask = 0; mask < 32; mask++) {
      // mask 的第 0 位固定跑两次：diary=false 与 diary=true，其余位不变。
      const base = mask << 1; // 腾出最低位给 diary，其余 5 位保持原样
      const withoutDiary = evaluatorsFor6(stateFromMask6(base));
      const withDiary = evaluatorsFor6(stateFromMask6(base | 1));
      const a = BARN_SUPPORT.evaluateEnding(withoutDiary.isClueFound, withoutDiary.isSceneVisited);
      const b = BARN_SUPPORT.evaluateEnding(withDiary.isClueFound, withDiary.isSceneVisited);
      expect(a?.id).toBe(b?.id);
    }
  });
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
  it("**正确**：每条 END_NARRATIONS 都带 priority，且按 true<bad<good<near_truth<normal 排序", () => {
    for (const en of END_NARRATIONS) {
      expect(typeof (en as any).priority).toBe("number");
    }
    const byId = new Map(END_NARRATIONS.map((en) => [en.id, (en as any).priority as number]));
    expect(byId.get("true")!).toBeLessThan(byId.get("bad")!);
    expect(byId.get("bad")!).toBeLessThan(byId.get("good")!);
    expect(byId.get("good")!).toBeLessThan(byId.get("near_truth")!);
    expect(byId.get("near_truth")!).toBeLessThan(byId.get("normal")!);
  });
});
