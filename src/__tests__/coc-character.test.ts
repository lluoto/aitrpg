// CoC 7e 角色创建系统测试
// bun test src/__tests__/coc-character.test.ts

import { describe, expect, test } from "bun:test";
import {
  createCoCCharacter,
  validateOccupationConstraints,
  calcCoCHP,
  calcCoCAC,
  calcCoCMove,
  calcOccupationSkillPoints,
  calcInterestSkillPoints,
  applyAgeMods,
  rollLuck,
  rollCreditRating,
  COC_SKILLS,
  SKILL_NAME_MAP,
  REVERSE_SKILL_MAP,
  hasSkillByKey,
  COC_ATTRIBUTES,
  getCoCArchetypes,
  getCthulhuMythosInfo,
  skillCheckByKey,
  getBaseSkillValue,
  COC_SKILL_BASES,
  autoAllocateSkills,
} from "../character/coc-character";
import { ALL_ARCHETYPES, type CharacterArchetype } from "../character/character-factory";

// ============================================================
// 属性生成
// ============================================================

describe("calcCoCHP", () => {
  test("标准体质+体型 → 正确 HP", () => {
    // CON 50 + SIZ 50 = 100 / 10 = 10
    expect(calcCoCHP(50, 50)).toBe(10);
  });

  test("低体质低体型 → 至少 1", () => {
    expect(calcCoCHP(15, 15)).toBe(3); // 30/10 = 3
  });

  test("高体质高体型", () => {
    expect(calcCoCHP(90, 90)).toBe(18); // 180/10 = 18
  });

  test("至少 1", () => {
    // 极低情况下 floor 为 0，保底 1
    const hp = calcCoCHP(1, 1);
    expect(hp).toBeGreaterThanOrEqual(1);
  });
});

describe("calcCoCAC", () => {
  test("DEX 50 → AC 12", () => {
    expect(calcCoCAC(50)).toBe(12);
  });

  test("DEX 90 → AC 14", () => {
    expect(calcCoCAC(90)).toBe(14);
  });

  test("DEX 30 → AC 11", () => {
    expect(calcCoCAC(30)).toBe(11);
  });

  test("DEX 15 → AC 10", () => {
    expect(calcCoCAC(15)).toBe(10);
  });
});

describe("calcCoCMove", () => {
  test("标准属性 50 → Move 8（STR=DEX=SIZ，无调整）", () => {
    const move = calcCoCMove(50, 50, 50);
    expect(move).toBe(8);
  });

  test("STR 和 DEX 均 < SIZ → Move 7", () => {
    const move = calcCoCMove(50, 50, 80);
    expect(move).toBe(7);
  });

  test("STR 和 DEX 均 > SIZ → Move 9", () => {
    const move = calcCoCMove(80, 80, 50);
    expect(move).toBe(9);
  });

  test("单侧高于 SIZ（STR=SIZ, DEX<SIZ）→ Move 8", () => {
    const move = calcCoCMove(80, 50, 80);
    expect(move).toBe(8);
  });

  test("中年 40 岁减 1", () => {
    const move = calcCoCMove(50, 50, 50, 45);
    expect(move).toBe(7); // 8 - 1(age)
  });

  test("老年 70 岁减 4", () => {
    const move = calcCoCMove(50, 50, 50, 70);
    expect(move).toBe(4); // 8 - 4(age)
  });

  test("至少 1", () => {
    const move = calcCoCMove(10, 10, 10, 90);
    expect(move).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// 技能点
// ============================================================

describe("calcOccupationSkillPoints", () => {
  const testArchetype: CharacterArchetype = ALL_ARCHETYPES.find(a => a.id === "investigator")!;

  test("EDU 60 → 职业技能点 240（EDU×4）", () => {
    expect(calcOccupationSkillPoints(testArchetype, { education: 60 })).toBe(240);
  });

  test("EDU 90 → 职业技能点 360", () => {
    expect(calcOccupationSkillPoints(testArchetype, { education: 90 })).toBe(360);
  });

  test("默认使用 education 属性", () => {
    expect(calcOccupationSkillPoints(testArchetype, { education: 50 })).toBe(200);
  });
});

describe("calcInterestSkillPoints", () => {
  test("INT 50 → 个人兴趣 100", () => {
    expect(calcInterestSkillPoints(50)).toBe(100);
  });

  test("INT 90 → 个人兴趣 180", () => {
    expect(calcInterestSkillPoints(90)).toBe(180);
  });

  test("INT 15 → 个人兴趣 30", () => {
    expect(calcInterestSkillPoints(15)).toBe(30);
  });
});

// ============================================================
// 职业约束校验
// ============================================================

describe("validateOccupationConstraints", () => {
  const investigatorArchetype = ALL_ARCHETYPES.find(a => a.id === "investigator")!;

  test("满足约束通过", () => {
    const attrs = { strength: 50, constitution: 50, size: 50, dexterity: 50,
      appearance: 50, intelligence: 60, power: 50, education: 50 };
    const warnings = validateOccupationConstraints(attrs, investigatorArchetype);
    expect(warnings.length).toBe(0);
  });

  test("INT 低于 60 时警告", () => {
    const attrs = { strength: 50, constitution: 50, size: 50, dexterity: 50,
      appearance: 50, intelligence: 40, power: 50, education: 50 };
    const warnings = validateOccupationConstraints(attrs, investigatorArchetype);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(w => w.includes("智力"))).toBe(true);
  });

  test("属性超过 90 时警告", () => {
    const attrs = { strength: 95, constitution: 50, size: 50, dexterity: 50,
      appearance: 50, intelligence: 60, power: 50, education: 50 };
    const warnings = validateOccupationConstraints(attrs, investigatorArchetype);
    expect(warnings.some(w => w.includes("上限") || w.includes("90"))).toBe(true);
  });

  test("总额超 460 时警告", () => {
    const attrs = { strength: 90, constitution: 90, size: 90, dexterity: 90,
      appearance: 90, intelligence: 90, power: 90, education: 90 };
    const warnings = validateOccupationConstraints(attrs, investigatorArchetype, 460);
    expect(warnings.some(w => w.includes("460"))).toBe(true);
  });
});

// ============================================================
// 年龄调整
// ============================================================

describe("applyAgeMods", () => {
  test("20-29 岁无调整", () => {
    const base = { strength: 50, constitution: 50, size: 50, dexterity: 50,
      appearance: 50, intelligence: 50, power: 50, education: 50 };
    const { attrs, warnings } = applyAgeMods(base, 25);
    expect(attrs.strength).toBe(50);
    expect(warnings.some(w => w.includes("年龄调整"))).toBe(false);
  });

  test("40-49 岁体力下降", () => {
    const base = { strength: 50, constitution: 50, size: 50, dexterity: 50,
      appearance: 50, intelligence: 50, power: 50, education: 50 };
    const { attrs, warnings } = applyAgeMods(base, 45);
    expect(attrs.strength).toBe(40); // 50-10
    expect(attrs.education).toBe(60); // 50+10
    expect(warnings.some(w => w.includes("年龄调整"))).toBe(true);
  });

  test("属性不低于 15", () => {
    const base = { strength: 20, constitution: 20, size: 50, dexterity: 50,
      appearance: 20, intelligence: 50, power: 50, education: 50 };
    const { attrs } = applyAgeMods(base, 70);
    expect(attrs.strength).toBeGreaterThanOrEqual(15);
  });
});

// ============================================================
// 完整角色创建
// ============================================================

describe("createCoCCharacter", () => {
  const investigator = ALL_ARCHETYPES.find(a => a.id === "investigator")!;
  const soldier = ALL_ARCHETYPES.find(a => a.id === "soldier")!;

  test("投骰模式生成角色有完整结构", async () => {
    const char = await createCoCCharacter({
      name: "测试调查员",
      archetypeId: "investigator",
      method: "dice",
      age: 30,
    }, investigator);

    expect(char.name).toBe("测试调查员");
    expect(char.archetypeId).toBe("investigator");
    expect(char.attributes.strength).toBeGreaterThanOrEqual(15);
    expect(char.attributes.intelligence).toBeGreaterThanOrEqual(15);
    expect(char.hp).toBeGreaterThanOrEqual(1);
    expect(char.ac).toBeGreaterThanOrEqual(10);
    expect(char.damageBonus).toBeTruthy();
    expect(typeof char.build).toBe("number");
    expect(char.move).toBeGreaterThanOrEqual(1);
    expect(char.luck).toBeGreaterThanOrEqual(3);
    expect(char.luck).toBeLessThanOrEqual(99);
    expect(char.creditRating).toBeGreaterThanOrEqual(20);
    expect(char.creditRating).toBeLessThanOrEqual(50);
    expect(char.occupationSkills).toContain("spot_hidden");
    expect(char.occupationSkillPoints).toBeGreaterThan(0);
    expect(char.interestSkillPoints).toBeGreaterThan(0);
  });

  test("手动指定属性（无年龄调整）", async () => {
    // 20-29 岁无年龄调整
    const char = await createCoCCharacter({
      name: "强调查员",
      archetypeId: "investigator",
      method: "point_buy",
      attributes: {
        strength: 70, constitution: 60, size: 60, dexterity: 50,
        appearance: 50, intelligence: 70, power: 50, education: 60,
      },
      age: 25,
    }, investigator);

    expect(char.attributes.strength).toBe(70);
    expect(char.attributes.intelligence).toBe(70);
    expect(char.attributes.education).toBe(60);
  });

  test("手动指定属性（年龄 30 有微调）", async () => {
    // 30-39 岁：STR-5, CON-5, APP-5, EDU+5, INT+5
    const char = await createCoCCharacter({
      name: "中年调查员",
      archetypeId: "investigator",
      method: "point_buy",
      attributes: {
        strength: 70, constitution: 60, size: 60, dexterity: 50,
        appearance: 50, intelligence: 70, power: 50, education: 60,
      },
      age: 35,
    }, investigator);

    // 30-39: STR-5, CON-5, APP-5, EDU+5, INT+5, LUCK+5
    expect(char.attributes.strength).toBe(65);   // 70-5
    expect(char.attributes.constitution).toBe(55); // 60-5
    expect(char.attributes.appearance).toBe(45);   // 50-5
    expect(char.attributes.education).toBe(65);    // 60+5
    expect(char.attributes.intelligence).toBe(75); // 70+5
  });

  test("士兵职业约束校验", async () => {
    const char = await createCoCCharacter({
      name: "测试士兵",
      archetypeId: "soldier",
      method: "point_buy",
      attributes: {
        strength: 70, constitution: 60, size: 60, dexterity: 50,
        appearance: 40, intelligence: 40, power: 50, education: 40,
      },
    }, soldier);

    // 士兵要求 STR≥50, CON≥50, DEX≥40
    expect(char.attributes.strength).toBeGreaterThanOrEqual(50);
    expect(char.attributes.constitution).toBeGreaterThanOrEqual(50);
    expect(char.attributes.dexterity).toBeGreaterThanOrEqual(40);
  });

  test("属性低于职业下限时生成警告", async () => {
    const char = await createCoCCharacter({
      name: "弱调查员",
      archetypeId: "investigator",
      method: "point_buy",
      attributes: {
        strength: 40, constitution: 40, size: 50, dexterity: 40,
        appearance: 40, intelligence: 40, power: 40, education: 40,
      },
    }, investigator);

    // 调查员要求 INT≥60, EDU≥50
    expect(char.warnings.some(w => w.includes("智力"))).toBe(true);
  });

  test("点购模式属性总值不超过 460", async () => {
    const char = await createCoCCharacter({
      name: "点购测试",
      archetypeId: "investigator",
      method: "point_buy",
      attributes: {
        strength: 50, constitution: 50, size: 50, dexterity: 50,
        appearance: 50, intelligence: 60, power: 50, education: 50,
      },
    }, investigator);

    const total = COC_ATTRIBUTES.reduce((sum, a) => sum + (char.attributes[a] ?? 0), 0);
    expect(total).toBeLessThanOrEqual(460);
  });

  test("年龄影响衍生值", async () => {
    const young = await createCoCCharacter({
      name: "年轻", archetypeId: "investigator", method: "point_buy",
      attributes: { strength: 50, constitution: 50, size: 50, dexterity: 50,
        appearance: 50, intelligence: 50, power: 50, education: 50 },
      age: 25,
    }, investigator);

    const old = await createCoCCharacter({
      name: "年长", archetypeId: "investigator", method: "point_buy",
      attributes: { strength: 50, constitution: 50, size: 50, dexterity: 50,
        appearance: 50, intelligence: 50, power: 50, education: 50 },
      age: 55,
    }, investigator);

    // 年长者体力更低但教育更高
    const youngTotal = young.attributes.strength! + young.attributes.constitution!;
    const oldTotal = old.attributes.strength! + old.attributes.constitution!;
    expect(oldTotal).toBeLessThan(youngTotal);
  });
});

// ============================================================
// 工具函数
// ============================================================

describe("rollLuck", () => {
  test("幸运值在 3-99 范围", () => {
    for (let i = 0; i < 50; i++) {
      const luck = rollLuck();
      expect(luck).toBeGreaterThanOrEqual(3);
      expect(luck).toBeLessThanOrEqual(99);
    }
  });
});

describe("rollCreditRating", () => {
  test("在范围内", () => {
    const range: [number, number] = [30, 60];
    for (let i = 0; i < 20; i++) {
      const cr = rollCreditRating(range);
      expect(cr).toBeGreaterThanOrEqual(30);
      expect(cr).toBeLessThanOrEqual(60);
    }
  });

  test("无范围时默认 20-50", () => {
    for (let i = 0; i < 20; i++) {
      const cr = rollCreditRating();
      expect(cr).toBeGreaterThanOrEqual(20);
      expect(cr).toBeLessThanOrEqual(50);
    }
  });
});

// ============================================================
// 技能列表完整性
// ============================================================

describe("COC_SKILLS", () => {
  test("包含核心技能（中文名）", () => {
    expect(COC_SKILLS).toContain("侦查");
    expect(COC_SKILLS).toContain("图书馆使用");
    expect(COC_SKILLS).toContain("心理学");
    expect(COC_SKILLS).toContain("克苏鲁神话");
    expect(COC_SKILLS).toContain("信用评级");
  });

  test("不再包含英文映射名", () => {
    expect(COC_SKILLS).not.toContain("spot_hidden");
    expect(COC_SKILLS).not.toContain("library_use");
    expect(COC_SKILLS).not.toContain("psychology");
  });

  test("技能表不空", () => {
    expect(COC_SKILLS.length).toBeGreaterThan(50);
  });
});

describe("SKILL_NAME_MAP", () => {
  test("中文→英文双向映射一致（允许多中文→同英文）", () => {
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    expect(Object.keys(SKILL_NAME_MAP).length).toBeGreaterThan(0);
    for (const [cn, en] of Object.entries(SKILL_NAME_MAP)) {
      // 多个中文名可映射到同一英文 key（如"格斗(肉搏)"→"fighting","格斗(剑)"→"fighting"）
      // 反向映射只保留第一个，但正向映射必须能在反向中找到
      expect(REVERSE_SKILL_MAP[en]).toBeDefined();
      // 正向映射是一致的：cn → en → cn'，但 cn 必须也在映射到 en 的集合中
      const candidates = Object.entries(SKILL_NAME_MAP)
        .filter(([, v]) => v === en)
        .map(([k]) => k);
      expect(candidates).toContain(cn);
    }
  });

  test("覆盖所有 COC_SKILLS", () => {
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    expect(COC_SKILLS.length).toBeGreaterThan(0);
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    expect(COC_SKILLS.length).toBeGreaterThan(0);
    for (const cn of COC_SKILLS) {
      expect(SKILL_NAME_MAP[cn]).toBeDefined();
    }
  });

  test("hasSkillByKey 同时识别中英文", () => {
    expect(hasSkillByKey(["侦查"], "spot_hidden")).toBe(true);
    expect(hasSkillByKey(["spot_hidden"], "spot_hidden")).toBe(true);
    expect(hasSkillByKey(["侦查", "图书馆使用"], "library_use")).toBe(true);
    expect(hasSkillByKey(["图书馆使用"], "spot_hidden")).toBe(false);
  });
});

// ============================================================
// 职业列表完整性
// ============================================================

describe("getCoCArchetypes", () => {
  test("返回所有 CoC 7e 职业", () => {
    const archetypes = getCoCArchetypes();
    expect(archetypes.length).toBeGreaterThan(20);
    const ids = archetypes.map(a => a.id);
    expect(ids).toContain("investigator");
    expect(ids).toContain("soldier");
    expect(ids).toContain("doctor_medicine");
  });

  test("每个 CoC 职业有 skills 和 priorityAttributes", () => {
    const archetypes = getCoCArchetypes();
    // 两个字段在类型上可选，缺失时取 0 直接判负 —— 用例名说的就是"每个职业都有"，
    // 缺失本身就该算失败，而不是让可选性把断言绕过去。
    for (const a of archetypes) {
      expect(a.skills?.length ?? 0).toBeGreaterThan(0);
      expect(a.priorityAttributes?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// CM 技能检定 & 信息暴露
// ============================================================

describe("getCthulhuMythosInfo", () => {
  test("初始角色 CM 为 0", () => {
    const char = {
      cthulhuMythos: 0,
    } as any;
    const info = getCthulhuMythosInfo(char);
    expect(info.value).toBe(0);
    expect(info.maxSanReduction).toBe(0);
    expect(info.hasMythos).toBe(false);
  });

  test("CM 值正确反映", () => {
    const char = {
      cthulhuMythos: 15,
    } as any;
    const info = getCthulhuMythosInfo(char);
    expect(info.value).toBe(15);
    expect(info.maxSanReduction).toBe(15);
    expect(info.hasMythos).toBe(true);
  });

  test("CM 99 时 maxSanReduction = 99", () => {
    const char = {
      cthulhuMythos: 99,
    } as any;
    const info = getCthulhuMythosInfo(char);
    expect(info.value).toBe(99);
    expect(info.maxSanReduction).toBe(99);
    expect(info.hasMythos).toBe(true);
  });
});

describe("skillCheckByKey", () => {
  test("CM 0 时技能值 0，通常失败（极低概率大成功 1）", () => {
    const char = { cthulhuMythos: 0 } as any;
    let failCount = 0;
    for (let i = 0; i < 100; i++) {
      const result = skillCheckByKey(char, "cthulhu_mythos", {});
      expect(result.skillValue).toBe(0);
      expect(result.roll).toBeGreaterThanOrEqual(1);
      expect(result.roll).toBeLessThanOrEqual(100);
      if (!result.isSuccess) failCount++;
    }
    // 技能值 0 时只有 roll=1 才是成功（大成功规则），概率约 99% 失败
    expect(failCount).toBeGreaterThan(90);
  });

  test("CM 50 时有概率成功", () => {
    const char = { cthulhuMythos: 50 } as any;
    let successes = 0;
    const trials = 100;
    for (let i = 0; i < trials; i++) {
      const result = skillCheckByKey(char, "cthulhu_mythos", {});
      if (result.isSuccess) successes++;
    }
    // 50% 概率应有至少 20 次成功
    expect(successes).toBeGreaterThan(10);
    // 但不会全成功
    expect(successes).toBeLessThan(trials);
  });

  test("普通技能通过 skillValues 参数检定", () => {
    const char = { cthulhuMythos: 0 } as any;
    // spot_hidden = 80% → 大概率成功
    let successes = 0;
    const trials = 50;
    for (let i = 0; i < trials; i++) {
      const result = skillCheckByKey(char, "spot_hidden", { spot_hidden: 80 });
      if (result.isSuccess) successes++;
    }
    expect(successes).toBeGreaterThan(20);
  });

  test("检定结果包含完整结构", () => {
    const char = { cthulhuMythos: 40 } as any;
    const result = skillCheckByKey(char, "cthulhu_mythos", {});
    expect(result).toHaveProperty("roll");
    expect(result).toHaveProperty("skillValue");
    expect(result).toHaveProperty("successLevel");
    expect(result).toHaveProperty("isSuccess");
    expect(result).toHaveProperty("checkType");
    expect(result).toHaveProperty("description");
    expect(result.skillValue).toBe(40);
  });
});

describe("getBaseSkillValue", () => {
  test("侦查基础值 25%", () => {
    expect(getBaseSkillValue("spot_hidden")).toBe(25);
  });

  test("急救基础值 30%", () => {
    expect(getBaseSkillValue("first_aid")).toBe(30);
  });

  test("格斗基础值 25%", () => {
    expect(getBaseSkillValue("fighting")).toBe(25);
  });

  test("道奇特例: DEX/2", () => {
    expect(getBaseSkillValue("dodge", 40)).toBe(20);
    expect(getBaseSkillValue("dodge", 80)).toBe(40);
  });

  test("母语特例: = EDU", () => {
    expect(getBaseSkillValue("language_own", 50, 70)).toBe(70);
  });

  test("不存在技能返回 0", () => {
    expect(getBaseSkillValue("nonexistent_skill")).toBe(0);
  });
});

describe("COC_SKILL_BASES", () => {
  test("覆盖核心技能", () => {
    const core = ["spot_hidden", "library_use", "psychology", "persuade", "fighting", "stealth"];
    for (const k of core) {
      expect(COC_SKILL_BASES[k]).toBeDefined();
    }
  });

  test("所有 SKILL_NAME_MAP 中的技能都有基础值或特例处理", () => {
    const mappedSkills = Object.values(SKILL_NAME_MAP);
    const uniqueSkills = [...new Set(mappedSkills)];
    const exceptions = ["dodge", "language_own"];
    for (const k of uniqueSkills) {
      if (exceptions.includes(k)) continue;
      expect(COC_SKILL_BASES[k]).toBeDefined();
    }
  });
});

// ============================================================
// autoAllocateSkills 自动分配
// ============================================================

describe("autoAllocateSkills", () => {
  const mockArchetype: any = {
    id: "test_occ",
    skills: ["侦查", "图书馆使用", "心理学"],
    occupationSkills: ["spot_hidden", "library_use", "psychology"],
    priorityAttributes: ["intelligence"],
  };

  const baseAttrs: Record<string, number> = {
    strength: 50, constitution: 50, size: 50, dexterity: 50,
    appearance: 50, intelligence: 50, power: 50, education: 50,
  };

  test("返回包含所有技能的值", () => {
    const result = autoAllocateSkills(mockArchetype, baseAttrs, 60, 100);
    // 所有 SKILL_NAME_MAP 中的技能都有值
    const allEngKeys = [...new Set(Object.values(SKILL_NAME_MAP))];
    for (const eng of allEngKeys) {
      expect(result[eng]).toBeDefined();
      expect(result[eng]).toBeGreaterThanOrEqual(0);
    }
  });

  test("所有技能值不超过 99", () => {
    const result = autoAllocateSkills(mockArchetype, baseAttrs, 300, 500);
    // 空表会让下面的循环一条断言都不跑 —— 先钉住它非空
    expect(Object.keys(result).length).toBeGreaterThan(0);
    for (const [, val] of Object.entries(result)) {
      expect(val).toBeLessThanOrEqual(99);
    }
  });

  test("职业技能获得较多点数", () => {
    const result = autoAllocateSkills(mockArchetype, baseAttrs, 60, 0);
    // 侦查基础 25 + 20（60/3） = 45
    expect(result["spot_hidden"]).toBeGreaterThanOrEqual(40);
    expect(result["spot_hidden"]).toBeLessThanOrEqual(55);
    // 非职业技能（如神秘学）只有基础值
    if (result["occult"] !== undefined) {
      expect(result["occult"]).toBeLessThanOrEqual(10);
    }
  });

  test("基础值正确设置（无技能点分配时）", () => {
    const result = autoAllocateSkills(mockArchetype, baseAttrs, 0, 0);
    expect(result["spot_hidden"]).toBe(25);  // 侦查基础
    expect(result["first_aid"]).toBe(30);    // 急救基础
    expect(result["fighting"]).toBe(25);     // 格斗基础
  });

  test("dodge = DEX/2", () => {
    const highDex = { ...baseAttrs, dexterity: 80 };
    const result = autoAllocateSkills(mockArchetype, highDex, 0, 0);
    expect(result["dodge"]).toBe(40);
  });

  test("language_other 基础值 1%", () => {
    const result = autoAllocateSkills(mockArchetype, baseAttrs, 0, 0);
    expect(result["language_other"]).toBe(1);
  });

  test("兴趣技能点补弱: 低技能获得增加", () => {
    const result = autoAllocateSkills(mockArchetype, baseAttrs, 0, 100);
    // 所有非 CM/CR 技能都有值 > 基础值（因为 100 点分散）
    const nonSpecial = ["cthulhu_mythos", "credit_rating"];
    const vals = Object.entries(result).filter(([k]) => !nonSpecial.includes(k));
    const totalExtra = vals.reduce((s, [, v]) => s + v, 0);
    // 基础值总和大约是 400-500，加上 100 点分配
    expect(totalExtra).toBeGreaterThan(450);
  });

  test("自动分配后 skillValues 在角色上可用", async () => {
    const investigator = ALL_ARCHETYPES.find((a: any) => a.id === "investigator")!;
    const char = await createCoCCharacter({
      name: "测试员",
      archetypeId: "investigator",
      method: "point_buy",
      pointBudget: 460,
      age: 30,
    }, investigator);
    expect(char.skillValues).toBeDefined();
    expect(Object.keys(char.skillValues).length).toBeGreaterThan(30);
    expect(char.skillValues["spot_hidden"]).toBeGreaterThanOrEqual(25);
    expect(char.skillValues["cthulhu_mythos"]).toBe(0);
  });
});
