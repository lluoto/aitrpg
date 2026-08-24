// 意图解析在网页/服务器那条路上**只有 regex**（`setIntentLLM()` 原先只有 CLI 调）。
// 量过一次：24 条常见 CoC 动作，认对 10、认错 3、不认识 11。
//
// 最糟的不是「不认识」——那顶多没反应。是**认错**：
//   `ATTACK_VERBS` 里字面写着「潜行」，于是裸的「潜行」被判成攻击。
//   玩家想溜过去，系统让他动手。做相反的事比不做事伤害大得多。
//
// 这个表是**先匹配先赢的手排列表**，所以宽模式压在窄模式前面就会吃掉它：
//   `查看|探索|搜查` → look 排在 `背包` → inventory 前面，「查看背包」看不到背包。

import { describe, test, expect } from "bun:test";
import { parseIntent } from "../llm/intent";

async function act(input: string) {
  return (await parseIntent(input)).action;
}
async function skill(input: string) {
  return (await parseIntent(input)).skill;
}

describe("不能做相反的事", () => {
  test("**错误行为的红线**：裸「潜行」是技能检定，不是攻击", async () => {
    expect(await act("潜行")).toBe("skill_check");
    expect(await skill("潜行")).toBe("stealth");
  });

  test("**正确**：「潜行攻击」仍然是攻击，且方式是潜行", async () => {
    // 修「潜行→攻击」不能把「潜行攻击」一起修没了。
    const r = await parseIntent("潜行攻击 怪物");
    expect(r.action).toBe("attack");
    expect(r.method).toBe("stealth");
  });

  test("**正确**：「偷袭」本身就是攻击，不受影响", async () => {
    expect(await act("偷袭 怪物")).toBe("attack");
  });

  test("**错误行为的红线**：「查看背包」要看得到背包", async () => {
    // `查看` 命中 look 模式，排在 inventory 前面。
    expect(await act("查看背包")).toBe("inventory");
    expect(await act("背包")).toBe("inventory");
  });
});

describe("CoC 常用技能要认得", () => {
  const CASES: Array<[string, string]> = [
    ["聆听", "listen"],
    ["恐吓 流浪汉", "intimidate"],
    ["取悦 前台", "charm"],
    ["话术", "fast_talk"],
    ["图书馆使用", "library_use"],
    ["查资料", "library_use"],
    ["侦查", "perception"],
    ["潜行", "stealth"],
  ];
  for (const [input, want] of CASES) {
    test(`**正确**：「${input}」→ ${want}`, async () => {
      const r = await parseIntent(input);
      expect(r.action).toBe("skill_check");
      expect(r.skill).toBe(want);
    });
  }

  test("**正确**：恐吓是模组给流浪汉编的机制路径，必须认得", async () => {
    // barn-of-premier 的贫民窟：「只认钱不接受除恐吓外的社交技能」。
    // 认不出恐吓，那条路就只剩打架。
    expect(await act("恐吓他们")).toBe("skill_check");
  });
});

describe("急救", () => {
  test("**错误行为的红线**：裸「急救」要够得着 handleFirstAid", async () => {
    // 原模式要求「急救」后面跟 伤口|伤势|出血|血，裸词落到 unknown，
    // 而 handleFirstAid 就在派发表里。
    expect(await act("急救")).toBe("first_aid");
    expect(await act("给甲急救")).toBe("first_aid");
  });

  test("**正确**：带伤势的说法照旧", async () => {
    expect(await act("包扎伤口")).toBe("first_aid");
  });
});

describe("没被这次改动碰到的要保持原样", () => {
  const KEEP: Array<[string, string]> = [
    ["攻击 怪物", "attack"],
    ["逃跑", "flee"],
    ["休息", "rest"],
    ["装填", "reload"],
    ["san检定", "san_check"],
    ["理智检定", "san_check"],
    ["环顾四周", "look"],
    ["说服 保镖", "skill_check"],
    ["调查 谷仓", "skill_check"],
    ["创建角色 investigator 甲", "create_character"],
    ["加载模组 谷仓", "load_module"],
    ["状态", "status"],
  ];
  for (const [input, want] of KEEP) {
    test(`「${input}」仍然是 ${want}`, async () => {
      expect(await act(input)).toBe(want);
    });
  }
});
