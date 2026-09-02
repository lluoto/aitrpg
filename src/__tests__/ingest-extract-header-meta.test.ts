// 摄取管线 · era / 部分 meta 抽取
//
// 只测有位置信号的三个字段（era / playerCount / expectedDuration）。
// summary / triggerWarnings 没有位置信号，本轮不做，测试只断言它们恒为空
// 并且 warnings 里说明了理由——不是漏测，是刻意划界。

import { describe, test, expect } from "bun:test";
import { extractHeaderMeta } from "../ingest/extract-header-meta";
import type { Section, SectionItem } from "../ingest/sectionize";

const sec = (title: string, body = "", items: SectionItem[] = []): Section => ({
  title,
  body,
  items,
  source: { page: 1, line: 1 },
});

describe("era", () => {
  test("抽到「四位数字 + 年」", () => {
    const r = extractHeaderMeta([sec("前言", "在 1921 年某日，你们坐在自己的家中……")]);
    expect(r.era).toBe("1921");
  });

  test("真实前言原文（premiers_barn 00_header.txt 逐字节，含清洗前的制表符间隔）", () => {
    const r = extractHeaderMeta([
      sec(
        "前言",
        "在 \t1921 \t年某日。你们坐在自己的家中，享用着咖啡查看着报纸，一则寻人委托吸引了你们的注意力。",
      ),
    ]);
    expect(r.era).toBe("1921");
  });

  test("没有年代标记就留空，并报 warning", () => {
    const r = extractHeaderMeta([sec("前言", "这是一段没有年代信息的正文。")]);
    expect(r.era).toBe("");
    expect(r.warnings).toContain("era 没抽到 —— 原文没找到「四位数字 + 年」的年代标记");
  });

  test("取文档序上第一个命中，不是全部块乱序合并", () => {
    const r = extractHeaderMeta([sec("附录A", "参考 1980 年的另一个案子"), sec("前言", "故事发生在 1921 年")]);
    expect(r.era).toBe("1980");
  });

  test("年份超出 1500~2099 范围不认，避免把电话号码/页码误当年代", () => {
    const r = extractHeaderMeta([sec("前言", "联系电话 12345 年？？不对，这不是年份")]);
    expect(r.era).toBe("");
  });
});

describe("meta.playerCount", () => {
  test("抽到「人数……人」区间", () => {
    const r = extractHeaderMeta([sec("前言", "模组推荐人数为 2~3 人，难度可以较为灵活地调整。")]);
    expect(r.meta.playerCount).toBe("2~3");
  });

  test("单一数字也能抽到", () => {
    const r = extractHeaderMeta([sec("前言", "本模组建议人数 4 人。")]);
    expect(r.meta.playerCount).toBe("4");
  });

  test("波浪号统一成半角 ~", () => {
    const r = extractHeaderMeta([sec("前言", "人数为 2～3 人")]);
    expect(r.meta.playerCount).toBe("2~3");
  });

  test("没有人数标记就留空，并报 warning", () => {
    const r = extractHeaderMeta([sec("前言", "没有提到人数的正文")]);
    expect(r.meta.playerCount).toBe("");
    expect(r.warnings).toContain("meta.playerCount 没抽到 —— 原文没找到「人数……人」的推荐人数标记");
  });
});

describe("meta.expectedDuration", () => {
  test("抽到「长度……」标记", () => {
    const r = extractHeaderMeta([sec("前言", "模组为线性半 City 类模组。长度中短，比较适合新人适应。")]);
    expect(r.meta.expectedDuration).toBe("中短");
  });

  test("没有长度标记就留空，并报 warning", () => {
    const r = extractHeaderMeta([sec("前言", "没有提到长度的正文")]);
    expect(r.meta.expectedDuration).toBe("");
    expect(r.warnings).toContain("meta.expectedDuration 没抽到 —— 原文没找到「长度……」的时长标记");
  });
});

describe("summary / triggerWarnings —— 刻意不抽，划清与 era/playerCount/duration 的边界", () => {
  test("summary 恒为空字符串（本函数不产 summary，由调用方决定字段值）", () => {
    const r = extractHeaderMeta([sec("前言", "模组为线性半 City 类模组。长度中短。")]);
    expect(r.meta).not.toHaveProperty("summary");
  });

  test("triggerWarnings 恒为空数组，即使原文有「可能包含」这类预警句式", () => {
    const r = extractHeaderMeta([
      sec("前言", "模组中可能包含一些稍微过激的场景，与一些比较令人胃痛的设定，KP 在带团时可酌情降低难度。"),
    ]);
    expect(r.meta.triggerWarnings).toEqual([]);
  });

  test("warnings 里显式说明 summary/triggerWarnings 未抽取的理由", () => {
    const r = extractHeaderMeta([sec("前言", "1921 年，人数为 2~3 人，长度中短")]);
    expect(r.warnings.some((w) => w.includes("summary") && w.includes("triggerWarnings"))).toBe(true);
  });
});

describe("端到端：真实 premiers_barn 前言全文一次抽三个字段", () => {
  test("era / playerCount / expectedDuration 同时命中", () => {
    const body = [
      "本模组是在吃安眠药的情况下想到的，灵感有来自 2077 瑞弗警官的支线任务。",
      "模组为线性半 City 类模组。长度中短，比较适合新人 PL 适应 COC 的环境，且难度不高。",
      "模组推荐人数为 2~3 人，难度可以较为灵活地调整。",
      "在 1921 年某日。你们坐在自己的家中，享用着咖啡查看着报纸。",
    ].join("\n");
    const r = extractHeaderMeta([sec("前言", body)]);
    expect(r.era).toBe("1921");
    expect(r.meta.playerCount).toBe("2~3");
    expect(r.meta.expectedDuration).toBe("中短");
    // 2077 出现在「灵感来自」这句里，不是真年代，且不该被当成命中——
    // 这里恰好验证了「长度」标记比「四位数字+年」更靠后也不影响 era 判定
    // （era 命中的是 1921，不是 2077，因为 2077 后面没有紧跟「年」）。
  });
});
