// 摄取管线 · assembleModule 接线 era/meta 抽取
//
// 只测新接的这条线（era / meta.playerCount / meta.expectedDuration 从
// extractHeaderMeta 灌进 module），不重复 ingest-extract-header-meta.test.ts
// 已经测过的抽取细节，也不重复其余字段（npcs/scenes/warnings 的既有覆盖
// 分散在 build-scenes/classify-items 等各自的测试里）。

import { describe, test, expect } from "bun:test";
import { assembleModule } from "../ingest/assemble-module";
import type { Section, SectionItem } from "../ingest/sectionize";
import type { SectionKind } from "../ingest/classify-sections";

const sec = (title: string, body = "", items: SectionItem[] = []): Section => ({
  title,
  body,
  items,
  source: { page: 1, line: 1 },
});

const kinds = (pairs: Array<[string, SectionKind]>) => new Map<string, SectionKind>(pairs);

describe("assembleModule 接线 era / meta", () => {
  test("前言块里的年代与人数被灌进 module.era / module.meta", () => {
    const r = assembleModule(
      {
        sections: [sec("前言", "在 1921 年某日。模组推荐人数为 2~3 人，长度中短。"), sec("农场外围", "正文")],
        kinds: kinds([["前言", "structure"], ["农场外围", "scene"]]),
        scenes: [],
        items: [],
        provenance: [],
      },
      { id: "test_module", title: "测试模组" },
    );
    expect(r.module.era).toBe("1921");
    expect(r.module.meta.playerCount).toBe("2~3");
    expect(r.module.meta.expectedDuration).toBe("中短");
  });

  test("summary 恒为空字符串——本轮不做编辑判断（见 extract-header-meta.ts 头部注释）", () => {
    const r = assembleModule(
      { sections: [sec("前言", "1921 年，人数为 2~3 人，长度中短")], kinds: kinds([]), scenes: [], items: [], provenance: [] },
      { id: "m", title: "t" },
    );
    expect(r.module.summary).toBe("");
    expect(r.module.meta.triggerWarnings).toEqual([]);
  });

  test("原文没有年代/人数标记时，字段留空并进 warnings，不猜", () => {
    const r = assembleModule(
      { sections: [sec("前言", "没有任何结构标记的正文")], kinds: kinds([]), scenes: [], items: [], provenance: [] },
      { id: "m", title: "t" },
    );
    expect(r.module.era).toBe("");
    expect(r.module.meta.playerCount).toBe("");
    expect(r.module.meta.expectedDuration).toBe("");
    expect(r.warnings).toContain("era 没抽到 —— 原文没找到「四位数字 + 年」的年代标记");
    expect(r.warnings).toContain("meta.playerCount 没抽到 —— 原文没找到「人数……人」的推荐人数标记");
    expect(r.warnings).toContain("meta.expectedDuration 没抽到 —— 原文没找到「长度……」的时长标记");
  });
});
