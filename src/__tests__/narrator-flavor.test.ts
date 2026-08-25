// 战斗叙述分级 —— 覆盖两件事：
// 1. 文案池自身的卫生条件（内容开发之后会不断往 narrator-pools.ts 加句子，
//    这条测试就是那份任务书里承诺的"重复句/占位符"检查，不是摆设）。
// 2. 分档路由是否真的按伤害/最大HP的**比例**走（而不是像之前那样卡在
//    maxHp=10 的默认值上，或者按绝对值分档）。
//
// ⚠ 随机量必须钉住。`pick()` 内部用 Math.random 选文案，不钉住的话
// 「读到了正确的池子」这件事只是三选一/四选一蒙对，红不了也测不出东西。
import { describe, test, expect } from "bun:test";
import { generateNarrative } from "../llm/narrator";
import {
  SCRATCH_TEMPLATES, FLESH_TEMPLATES, DEEP_TEMPLATES, GRIEVOUS_TEMPLATES,
  LETHAL_TEMPLATES, MISS_TEMPLATES, FUMBLE_TEMPLATES, CRIT_PREFIX,
} from "../llm/narrator-pools";

function withPinnedRandom<T>(value: number, fn: () => T): T {
  const real = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = real; }
}

/** 与 narrator.ts 的 fillTemplate 同口径的替换 —— 占位符可能出现不止一次，必须全局替换。 */
function render(t: string, attacker: string, defender: string, weapon: string): string {
  return t.replace(/\{attacker\}/g, attacker).replace(/\{defender\}/g, defender).replace(/\{weapon\}/g, weapon);
}

describe("narrator-pools 文案池卫生条件", () => {
  const pools: [string, string[]][] = [
    ["SCRATCH", SCRATCH_TEMPLATES], ["FLESH", FLESH_TEMPLATES],
    ["DEEP", DEEP_TEMPLATES], ["GRIEVOUS", GRIEVOUS_TEMPLATES],
    ["LETHAL", LETHAL_TEMPLATES], ["MISS", MISS_TEMPLATES],
    ["FUMBLE", FUMBLE_TEMPLATES],
  ];

  for (const [name, pool] of pools) {
    test(`${name} 池至少 4 条，且互不重复`, () => {
      expect(pool.length).toBeGreaterThanOrEqual(4);
      expect(new Set(pool).size).toBe(pool.length);
    });

    test(`${name} 池只用 {attacker}/{defender}/{weapon} 三个占位符`, () => {
      for (const t of pool) {
        const placeholders = t.match(/\{[a-zA-Z]+\}/g) ?? [];
        for (const p of placeholders) {
          expect(["{attacker}", "{defender}", "{weapon}"]).toContain(p);
        }
      }
    });
  }

  test("CRIT_PREFIX 允许空串，但非空的不重复", () => {
    const nonEmpty = CRIT_PREFIX.filter((s) => s !== "");
    expect(new Set(nonEmpty).size).toBe(nonEmpty.length);
  });

  test("跨池不该有完全相同的句子（复读检测跨档也生效）", () => {
    const all = pools.flatMap(([, p]) => p);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("generateNarrative — 分档按比例走，不是绝对值也不是写死 maxHp=10", () => {
  test("1/100（1%）→ scratch 池", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, damage: 1, result: "wound" }, 100)
    );
    expect(text).toBe(render(SCRATCH_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("30/100（30%）→ flesh 池 —— 若还按旧的 maxHp=10 默认值算，这里会算成 deep", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, damage: 30, result: "wound" }, 100)
    );
    expect(text).toBe(render(FLESH_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("50/100（50%）→ deep 池", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, damage: 50, result: "wound" }, 100)
    );
    expect(text).toBe(render(DEEP_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("80/100（80%）→ grievous 池", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, damage: 80, result: "wound" }, 100)
    );
    expect(text).toBe(render(GRIEVOUS_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("result: kill → lethal 池，不看伤害比例", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, damage: 1, result: "kill" }, 100)
    );
    expect(text).toBe(render(LETHAL_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("未命中 → miss 池（非 fumble）", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: false, damage: 0, result: "miss" }, 100)
    );
    expect(text).toBe(render(MISS_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("fumble → 走单独的 fumble 池，不是普通 miss 池", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: false, damage: 0, result: "miss" }, 100, { fumble: true })
    );
    expect(text).toBe(render(FUMBLE_TEMPLATES[0]!, "甲", "乙", "匕首"));
  });

  test("暴击命中会加前缀", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, crit: true, damage: 1, result: "wound" }, 100)
    );
    expect(text.startsWith(CRIT_PREFIX[0]!)).toBe(true);
  });

  test("maxHp<=0 不炸——退化为最低档而不是抛错或除零", async () => {
    const text = await withPinnedRandom(0, () =>
      generateNarrative("甲", "乙", "匕首", { hit: true, damage: 5, result: "wound" }, 0)
    );
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });
});
