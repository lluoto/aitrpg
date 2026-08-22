// 开场卷入方式（hooks）：代词要对，履历不能瞎编。
//
// 起因是实跑的开场长这样：
//   「玛丽·布朗的办公桌上摊着一封委托信。作为飞行员，**他**见过太多案子——
//     但这个失踪案，他总觉得不太对劲。」
// 两个毛病叠在一句里：
//   1. 玛丽是女名，代词却是「他」
//   2. 「见过太多案子」是**侦探的履历**，被安给了随机职业。
//      调查员可能是护士、飞行员、艺术家、消防员 —— 他们不「见过太多案子」，
//      这个失踪案对他们恰恰是头一遭。职业换得越多，这句越假。
//
// 第 1 条的根因不在模板：`randomCoCName` 当时**不返回性别**，
// 名字池男女混排且无标记 —— 模板作者除了写死「他」没有别的选择。
// 所以判据要同时守住数据侧（性别拿得到）和文本侧（模板别编履历）。

import { describe, test, expect } from "bun:test";
import {
  randomCoCName, genderOfFirstName, pronounOf,
  MALE_FIRST_NAMES, FEMALE_FIRST_NAMES,
} from "../character/background-profile";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";

describe("性别必须拿得到 —— 这是代词能写对的前提", () => {
  test("**正确**：男名 / 女名都认得出", () => {
    expect(genderOfFirstName("亨利")).toBe("male");
    expect(genderOfFirstName("玛丽")).toBe("female");
  });

  test("**干扰**：认不出就返回 undefined，不猜", () => {
    expect(genderOfFirstName("张三")).toBeUndefined();
    expect(genderOfFirstName("")).toBeUndefined();
  });

  test("两个池子不重叠 —— 重叠就等于没分", () => {
    for (const n of MALE_FIRST_NAMES) expect(FEMALE_FIRST_NAMES).not.toContain(n);
  });

  test("**错误行为的红线**：randomCoCName 必须带出性别", () => {
    // 变异检验：把 gender 去掉，这条立刻红 —— 而它正是「他/她」写得对的唯一依据。
    for (let i = 0; i < 40; i++) {
      const n = randomCoCName();
      expect(n.gender).toBeDefined();
      expect(genderOfFirstName(n.short)).toBe(n.gender!);
    }
  });

  test("按职业取名时同样带性别", () => {
    for (const id of ["detective", "doctor_medicine", "soldier"]) {
      const n = randomCoCName(id);
      expect(n.gender).toBeDefined();
    }
  });
});

describe("pronounOf", () => {
  test("女 → 她，男 → 他", () => {
    expect(pronounOf("female")).toBe("她");
    expect(pronounOf("male")).toBe("他");
  });

  test("**干扰**：性别未知时不抛也不留空，回落「他」", () => {
    expect(pronounOf(undefined)).toBe("他");
  });
});

// ── 模板本身 ─────────────────────────────────────────────────

const hooks = BARN_OF_PREMIER.partySetup?.hooks ?? [];

describe("hooks 模板", () => {
  test("确实有卷入方式模板（别让这组测试测了个空）", () => {
    expect(hooks.length).toBeGreaterThan(0);
  });

  test("**错误行为的红线**：不许写死第三人称代词", () => {
    // 写死「他」正是「玛丽·布朗……他见过太多案子」的直接原因。
    // 要用代词就走 {pronoun} 槽位。
    for (const h of hooks) {
      const withoutSlots = h.replace(/\{pronoun\}/g, "");
      expect(withoutSlots).not.toMatch(/[他她]/);
    }
  });

  test("用到代词的模板必须声明 {pronoun} 槽位", () => {
    for (const h of hooks) {
      if (/\{pronoun\}/.test(h)) expect(h).toContain("{pronoun}");
    }
  });

  test("**错误行为的红线**：不许替随机职业编侦探履历", () => {
    // 「见过太多案子」「办过无数案件」这类话，对护士/飞行员/艺术家一律是假的。
    // 卷入方式该说**这个职业真的会有的处境**，不是给谁都套一层侦探皮。
    for (const h of hooks) {
      expect(h).not.toMatch(/见过太多案子|办过.*案|经手过.*案子|老练的侦探/);
    }
  });

  test("槽位齐全：{name} 与 {occupation} 都还在", () => {
    for (const h of hooks) {
      expect(h).toContain("{name}");
      expect(h).toContain("{occupation}");
    }
  });
});

describe("渲染出来的句子 —— 正例/反例/干扰", () => {
  const render = (h: string, name: string, occ: string, g: "male" | "female" | undefined) =>
    h.replace(/\{name\}/g, name).replace(/\{occupation\}/g, occ).replace(/\{pronoun\}/g, pronounOf(g));

  test("**正确**：女性角色渲染出「她」", () => {
    for (const h of hooks.filter((x) => x.includes("{pronoun}"))) {
      const s = render(h, "玛丽·布朗", "飞行员", "female");
      expect(s).toContain("她");
      expect(s).not.toContain("他");
    }
  });

  test("**正确**：男性角色渲染出「他」", () => {
    for (const h of hooks.filter((x) => x.includes("{pronoun}"))) {
      const s = render(h, "约翰·布朗", "护士", "male");
      expect(s).toContain("他");
    }
  });

  test("**干扰**：性别未知时仍是通顺的句子，不留下 `{pronoun}` 字面量", () => {
    for (const h of hooks) {
      const s = render(h, "某人", "记者", undefined);
      expect(s).not.toContain("{");
      expect(s).not.toContain("}");
    }
  });

  test("职业换成各种冷门职业都不会读出「他见过太多案子」这种断言", () => {
    for (const occ of ["护士", "飞行员", "艺术家", "消防员", "殡葬师", "音乐家"]) {
      for (const h of hooks) {
        const s = render(h, "某人", occ, "female");
        expect(s).not.toMatch(/见过太多案子/);
      }
    }
  });
});
