// PlayerAgent 三个扮演字段（personality/backstory/currentGoal）的兜底链解析。
//
// 链：HTTP（优先）→ 模组 → backgroundProfile 推导（currentGoal 跳过）→ LLM。
// 放在纯函数层（src/character/player-metadata.ts），web 的 POST /sessions
// 与 POST /party、文本命令「创建队友」都复用它，不掰成多套做法。

import { describe, test, expect } from "bun:test";
import {
  resolvePlayerMeta,
  resolvePlayerMetaSync,
  derivePersonalityFromProfile,
  deriveBackstoryFromProfile,
} from "../character/player-metadata";

const profile = {
  appearance: "外表",
  beliefs: "信念甲",
  significantPeople: "重要之人乙",
  meaningfulPlace: "意义之地丙",
  treasuredPossession: "宝贵之物",
  traits: "性格特质丁",
  woundsAndScars: "伤疤戊",
  phobiasAndManias: "恐惧",
} as const;

describe("resolvePlayerMetaSync —— 前三层（无 LLM）", () => {
  test("**正确**：HTTP 字段最优先，压过模组与推导", () => {
    const r = resolvePlayerMetaSync({
      http: { personality: "手填性格", backstory: "手填背景", currentGoal: "手填目标" },
      module: { personality: "模组性格", background: "模组背景", motive: "模组目标" },
      profile: profile as any,
    });
    expect(r).toEqual({ personality: "手填性格", backstory: "手填背景", currentGoal: "手填目标" });
  });

  test("**正确**：无 HTTP 字段时，模组层按字段映射补上（personality/background→backstory/motive→currentGoal）", () => {
    const r = resolvePlayerMetaSync({
      module: { personality: "模组性格", background: "模组背景", motive: "模组目标" },
      profile: profile as any,
    });
    expect(r.personality).toBe("模组性格");
    expect(r.backstory).toBe("模组背景");
    expect(r.currentGoal).toBe("模组目标");
  });

  test("**正确**：无 HTTP/模组时，从 backgroundProfile 推导", () => {
    const r = resolvePlayerMetaSync({ profile: profile as any });
    expect(r.personality).toBe(derivePersonalityFromProfile(profile as any));
    expect(r.backstory).toBe(deriveBackstoryFromProfile(profile as any));
  });

  test("**错误行为红线**：currentGoal 没有推导来源——无 HTTP/模组/LLM 时**缺席**，不塞假数据", () => {
    const r = resolvePlayerMetaSync({ profile: profile as any });
    expect(r.currentGoal).toBeUndefined();
  });

  test("**HTTP 优先的对照**：只给 currentGoal，别的字段仍走模组/推导，不被 HTTP 的空值污染", () => {
    const r = resolvePlayerMetaSync({
      http: { currentGoal: "我自己的目标" },
      module: { personality: "模组性格" },
      profile: profile as any,
    });
    expect(r.currentGoal).toBe("我自己的目标");
    expect(r.personality).toBe("模组性格"); // HTTP 没给 this，落模组
    expect(r.backstory).toBe(deriveBackstoryFromProfile(profile as any)); // 落推导
  });

  test("**文本相似但不同**：trims 掉空白，纯空白视为没给", () => {
    const r = resolvePlayerMetaSync({ http: { personality: "   " } as any, module: { personality: "模组" } });
    expect(r.personality).toBe("模组");
  });
});

describe("deriveXxxFromProfile —— 推导口径", () => {
  test("personality = traits + beliefs", () => {
    expect(derivePersonalityFromProfile(profile as any)).toBe("性格特质丁；信念甲");
  });
  test("backstory = significantPeople + meaningfulPlace + woundsAndScars", () => {
    expect(deriveBackstoryFromProfile(profile as any)).toBe("重要之人乙；意义之地丙；伤疤戊");
  });
});

describe("resolvePlayerMeta —— 带 LLM 层", () => {
  test("**正确**：某字段前三层都没给时，LLM 补上", async () => {
    const r = await resolvePlayerMeta({
      profile: profile as any, // 有推导 → personality/backstory 已有
      llm: async () => "LLM 目标",
    });
    // personality/backstory 已由推导层给定 → LLM 不覆盖
    expect(r.personality).toBe(derivePersonalityFromProfile(profile as any));
    // currentGoal 无推导 → 由 LLM 补上
    expect(r.currentGoal).toBe("LLM 目标");
  });

  test("**错误行为红线**：HTTP 给了的字段，LLM 不得覆盖", async () => {
    const r = await resolvePlayerMeta({
      http: { personality: "手填" },
      llm: async (_f) => "LLM 覆盖值",
    });
    expect(r.personality).toBe("手填");
  });

  test("**失败兜底**：LLM 返回空串 → 该字段缺席，不塞空串", async () => {
    const r = await resolvePlayerMeta({ llm: async () => "" });
    expect(r.personality).toBeUndefined();
  });

  test("**无 LLM 提供者时退化为同步版行为**", async () => {
    const r = await resolvePlayerMeta({ http: { currentGoal: "x" } });
    expect(r.currentGoal).toBe("x");
    expect(r.personality).toBeUndefined();
  });
});
