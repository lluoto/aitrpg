// 限时状态接上了没有。
//
// 接之前的状况（两处都是 tsc 的 noUnusedLocals 报出来的）：
//   · `GameSession.processBleeding()` **从来没有被调用过**
//   · `src/rules/status-effects.ts`（78 行，中毒/流血/燃烧的定义库，带 duration）
//     在依赖图上是死模块 —— 唯一 import 它的地方五个符号一个都没用
//
// 后果：`checkMajorWound` 的描述写着「正在流血，每回合失去 1 HP 直到止血」，
// 战斗里也确实往 `status` 推了「流血」——但那个标签**永远不掉血、也永远不消失**。
// 一句纯装饰。规则在、缺陷在，两者从没接上。
//
// 接的时候有一条硬约束：**不另开一套存储**。实体身上还是 `status: string[]`
// （wound-effects、story-generator、game-session 全都这么存），
// 不加第二个结构化字段 —— 一份数据两套解析是这个仓库反复在修的病。
// 代价是字符串要能读回来，所以 format 与 parse 必须是**一对**，由下面的
// round-trip 钉着。

import { describe, test, expect } from "bun:test";
import {
  createStatus, formatStatus, parseStatus, tickStatuses,
  newStatus, getStatusDef, listStatusDefs, statusTick, isStatusExpired,
} from "../rules/status-effects";

describe("format 与 parse 必须互为逆运算", () => {
  test("**错误行为的红线**：库里每一条状态都要能原样转一圈回来", () => {
    // 两个方向各写一份、慢慢漂开，是这里最可能出的事故。
    const defs = listStatusDefs();
    expect(defs.length).toBeGreaterThan(0); // 空库会让下面的循环假绿
    for (const d of defs) {
      const s = createStatus(d.id, d.name, d.desc, d.category as never,
        getStatusDef(d.id)!.defaultDuration);
      const back = parseStatus(formatStatus(s));
      expect(back).not.toBeNull();
      expect(back!.id).toBe(s.id);
      expect(back!.duration).toBe(s.duration);
      expect(back!.stacks).toBe(s.stacks);
    }
  });

  test("**干扰输入**：既有的裸标签认不出来，必须返回 null 而不是瞎猜", () => {
    // 「重伤:左臂」是 wound-effects 写的，「疯狂」是 story-generator 写的。
    // 这里看不懂它们是对的 —— 看懂了才危险（会把别人的标签当成有时限的状态清掉）。
    expect(parseStatus("重伤:左臂")).toBeNull();
    expect(parseStatus("疯狂")).toBeNull();
    expect(parseStatus("old_wound")).toBeNull();
    expect(parseStatus("")).toBeNull();
  });

  test("**正确**：带层数与永续的也转得回来", () => {
    const stacked = { ...createStatus("poisoned", "中毒", "", "physical", 4), stacks: 3 };
    expect(parseStatus(formatStatus(stacked))!.stacks).toBe(3);
    const forever = createStatus("cursed", "诅咒", "", "condition", -1);
    expect(parseStatus(formatStatus(forever))!.duration).toBe(-1);
  });
});

describe("推进一回合", () => {
  test("**错误行为的红线**：限时状态必须真的走时限，不能永远挂着", () => {
    // 这正是接之前的毛病：标签写上去就再没人碰过。
    let cur = [newStatus("bleeding")]; // 默认 3 回合
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = tickStatuses(cur);
      seen.push(r.next.length);
      cur = r.next;
    }
    expect(seen[seen.length - 1]).toBe(0); // 最终清空
  });

  test("**正确**：到期那一轮要报出来，不是静默消失", () => {
    let cur = [newStatus("stunned")]; // 1 回合
    const r = tickStatuses(cur);
    expect(r.next).toEqual([]);
    expect(r.expired.map((s) => s.id)).toEqual(["stunned"]);
  });

  test("**错误行为的红线**：认不出的裸标签不得被清掉", () => {
    // 「这里看不懂」不是「可以删掉」的理由。
    const r = tickStatuses(["重伤:左臂", newStatus("bleeding"), "疯狂"]);
    expect(r.next).toContain("重伤:左臂");
    expect(r.next).toContain("疯狂");
    expect(r.active.map((s) => s.id)).toEqual(["bleeding"]);
  });

  test("**正确**：永续状态不会被 tick 掉", () => {
    const cursed = newStatus("cursed"); // duration -1
    let cur = [cursed];
    for (let i = 0; i < 10; i++) cur = tickStatuses(cur).next;
    expect(cur).toEqual([cursed]);
  });

  test("**干扰输入**：空数组不炸", () => {
    expect(tickStatuses([])).toEqual({ next: [], expired: [], active: [] });
  });
});

describe("newStatus 不许静默吞掉拼错的 id", () => {
  test("**错误行为的红线**：未知 id 必须抛，不能返回一个 tick 不到的裸标签", () => {
    // 静默返回 id 本身，会造出一个永远不生效也不消失的标签 ——
    // 正好是这次要修掉的那种东西。
    expect(() => newStatus("bleeeding")).toThrow();
    expect(() => newStatus("")).toThrow();
  });

  test("**正确**：名字与默认时限都来自定义库，不在调用点重写一遍", () => {
    expect(newStatus("bleeding")).toBe(formatStatus(
      createStatus("bleeding", "流血", "", "physical", getStatusDef("bleeding")!.defaultDuration)));
    expect(newStatus("bleeding", 9)).toContain("9回合");
  });
});

describe("底层 tick 语义", () => {
  test("**正确**：statusTick / isStatusExpired 的边界", () => {
    const s = createStatus("bleeding", "流血", "", "physical", 1);
    expect(isStatusExpired(s)).toBe(false);
    const t = statusTick(s);
    expect(t.duration).toBe(0);
    expect(isStatusExpired(t)).toBe(true);
    const forever = createStatus("cursed", "诅咒", "", "condition", -1);
    expect(statusTick(forever).duration).toBe(-1);
    expect(isStatusExpired(forever)).toBe(false);
  });
});
