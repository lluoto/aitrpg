// 修A·任务2 —— 收紧 chase/flee 正则，别再把追问/追查/跑团/逃避这类
// 对话/调查/闲聊词判成追逐/逃跑。
//
// 背景：analysis/sim/2026-08-28-barn-a-acceptance.md 第 11 回合中止，根因是
// llm/intent.ts 原来的 chase 正则 /(?:追逐|逃跑|跑|追|逃)/ 太贪——LLM 判对了
// action（talk），但因为围栏解析失败（任务1已修）静默回落到这条 regex，
// 贪婪的 /追/ 把"追问 NPC"命中成 chase。这份测试钉住 regex 兜底路径本身
// 也不应该有这个误判，即使不经过围栏失败这条路径。
//
// bun test src/__tests__/intent-chase-tightening.test.ts

import { describe, test, expect } from "bun:test";
import { parseIntent } from "../llm/intent";

async function act(input: string) {
  return (await parseIntent(input)).action;
}

describe("实跑原文三句：必须判 talk，不得判 chase", () => {
  const REAL_SENTENCES = [
    "林娜追问菲碧，加比是否提过维森酒吧或者一场免费酒水的聚会。",
    "陈岳追问菲碧，加比最近有没有受伤、服药或向谁求助的迹象。",
    "陆川追问菲碧，加比离家那晚穿了什么，又有没有携带现金或行李。",
  ];
  for (const s of REAL_SENTENCES) {
    test(`「${s.slice(0, 12)}…」→ talk`, async () => {
      const action = await act(s);
      expect(action).not.toBe("chase");
      expect(action).toBe("talk");
    });
  }
});

describe("追问/追查/追踪/跑团/逃避 都不得命中 chase", () => {
  const CASES = ["追问", "追查", "追踪", "跑团", "逃避这个话题", "我们聊聊跑团规则"];
  for (const s of CASES) {
    test(`「${s}」不得判 chase`, async () => {
      expect(await act(s)).not.toBe("chase");
    });
  }
});

describe("真正的追逐说法仍然命中（正例，别改瘸了）", () => {
  const CASES: Array<[string, string]> = [
    ["追逐那个身影", "chase"],
    ["我们追上去", "chase"],
    ["猛追那辆车", "chase"],
    ["追", "chase"], // 裸「追」：既有测试（game-session.test.ts）用它当战斗快捷指令
    ["跑", "chase"], // 裸「跑」：同上
  ];
  for (const [input, want] of CASES) {
    test(`「${input}」→ ${want}`, async () => {
      expect(await act(input)).toBe(want);
    });
  }
});

describe("flee 同样收紧：裸「撤」「逃」不再单独触发，复合词不受影响", () => {
  test("**不应报**：裸「撤」不再触发 flee", async () => {
    expect(await act("撤")).not.toBe("flee");
  });

  test("**不应报**：裸「逃」不再触发 flee", async () => {
    expect(await act("逃")).not.toBe("flee");
  });

  test("**正例，别改瘸了**：复合词仍然命中 flee", async () => {
    expect(await act("逃跑")).toBe("flee");
    expect(await act("逃走")).toBe("flee");
    expect(await act("逃离")).toBe("flee");
    expect(await act("撤退")).toBe("flee");
  });
});
