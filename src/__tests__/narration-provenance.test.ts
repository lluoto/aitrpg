// 开发·三档约束 阶段7 任务③：叙事文本出处强制的通道 + 判据。
//
// module/types.ts:44 的 ModuleData.provenance? 从未真正启用过——保护
// 写在类型里，没有任何数据填过、没有任何判据查过。本文件不追溯全模组
// （全模组出处补全至今没有专门一轮做），只钉住这一件事：本轮新增/修改的两条结局
// 文案（True End、near_truth）必须带 sourceRef；没核对过的旧条目显式
// 登记在 UNREVIEWED_NARRATION_REGISTRY 里，不是悄悄放行。
//
// bun test src/__tests__/narration-provenance.test.ts

import { describe, it, expect } from "bun:test";
import { findMissingSourceRef, UNREVIEWED_NARRATION_REGISTRY } from "../ingest/narration-provenance";
import { END_NARRATIONS } from "../module/barn-of-premier";
import type { EndNarration } from "../module/types";

function fakeNarration(id: string, sourceRef?: string): EndNarration {
  return {
    id,
    priority: 99,
    condition: { requiredClues: [] },
    lines: ["占位文本"],
    sourceRef,
  };
}

describe("findMissingSourceRef：找出缺 sourceRef（未填或全空白）的条目", () => {
  it("**正确**：sourceRef 非空的条目不算缺失", () => {
    expect(findMissingSourceRef([fakeNarration("a", "section_01:1-2")])).toEqual([]);
  });

  it("**错误行为红线**：sourceRef 未定义、空字符串、纯空白都算缺失", () => {
    expect(findMissingSourceRef([fakeNarration("a")])).toEqual(["a"]);
    expect(findMissingSourceRef([fakeNarration("b", "")])).toEqual(["b"]);
    expect(findMissingSourceRef([fakeNarration("c", "   ")])).toEqual(["c"]);
  });

  it("多条混合：只报出真的缺失的那些，不误伤已经填了的", () => {
    const result = findMissingSourceRef([
      fakeNarration("has-ref", "section_02:5-6"),
      fakeNarration("missing-ref"),
    ]);
    expect(result).toEqual(["missing-ref"]);
  });
});

describe("**主判据**：END_NARRATIONS 里 sourceRef 缺失的集合必须与 UNREVIEWED_NARRATION_REGISTRY 精确相等", () => {
  it("名单外不能再多任何缺失，名单内的也不能凭空消失（消失了要同步删名单）", () => {
    const missing = findMissingSourceRef(END_NARRATIONS);
    const registryIds = UNREVIEWED_NARRATION_REGISTRY.map((e) => e.id);
    expect(new Set(missing)).toEqual(new Set(registryIds));
  });
});

describe("本轮新增/修改的两条结局必须带 sourceRef——不在未核对名单里", () => {
  it("True End：this round's rewrite, sourceRef 必须存在且不在 UNREVIEWED_NARRATION_REGISTRY", () => {
    const trueEnd = END_NARRATIONS.find((e) => e.id === "true")!;
    expect(trueEnd.sourceRef).toBeTruthy();
    expect(UNREVIEWED_NARRATION_REGISTRY.some((e) => e.id === "true")).toBe(false);
  });

  it("near_truth：本轮新增，sourceRef 必须存在且不在 UNREVIEWED_NARRATION_REGISTRY", () => {
    const nearTruth = END_NARRATIONS.find((e) => e.id === "near_truth")!;
    expect(nearTruth.sourceRef).toBeTruthy();
    expect(UNREVIEWED_NARRATION_REGISTRY.some((e) => e.id === "near_truth")).toBe(false);
  });
});

describe("未核对名单本身诚实——不是拿来掩盖问题的挡箭牌", () => {
  it("每条登记都必须给出不为空的理由（note），不能只列 id 不说为什么", () => {
    for (const entry of UNREVIEWED_NARRATION_REGISTRY) {
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  it("登记的 id 必须真的对应 END_NARRATIONS 里存在的条目——不能登记一个不存在的占位符", () => {
    const realIds = new Set(END_NARRATIONS.map((e) => e.id));
    for (const entry of UNREVIEWED_NARRATION_REGISTRY) {
      expect(realIds.has(entry.id)).toBe(true);
    }
  });
});
