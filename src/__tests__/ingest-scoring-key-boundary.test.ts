// 摄取管线 · 评分键的边界
//
// 这份测试守的不是 scoring-key 的内容，是它的**用途边界**：
// 它绝不能被任何构造 prompt 的代码引用。把基准答案喂给模型，
// 测出来的准确率不说明任何事 —— 与「靠引文判场景」自我验证是同一类错误。
//
// 为什么用测试而不是注释：本仓已经有九处「注释断言了代码没有的性质」的先例。
// 口头约定拦不住下一个人手快，import 一加就过了。这条断言会红。
//
// 与 rule-content-boundary.test.ts 同一路数：只断言机器可查的结构事实
// （谁 import 了谁），不断言任何叙事文本。

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join, resolve } from "path";

import { ENTRY_SCORING_KEY, keyDistribution } from "../ingest/scoring-key";

const SRC_ROOT = resolve(import.meta.dir, "..");

/** 递归收集 src 下所有 .ts 源文件 */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** 会构造或发送 prompt 的模块 —— 评分键对它们必须不可见 */
const PROMPT_BUILDERS = [
  "ingest/classify-sections.ts",
  "ingest/classify-items.ts",
  "llm/client.ts",
  "llm/npc-dialogue-prompts.ts",
  "llm/generate-llm-expanded.ts",
  "llm/intent.ts",
  "llm/narrator.ts",
];

describe("评分键的用途边界", () => {
  test("没有构造 prompt 的模块引用评分键", () => {
    const offenders: string[] = [];
    for (const rel of PROMPT_BUILDERS) {
      const full = join(SRC_ROOT, rel);
      let text: string;
      try {
        text = readFileSync(full, "utf-8");
      } catch {
        continue; // 文件不存在就跳过，别让边界测试变成存在性测试
      }
      if (text.includes("scoring-key") || text.includes("ENTRY_SCORING_KEY")) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("全仓只有测试与实跑脚本可以引用它", () => {
    // tools/ 在 .gitignore 之外、不在 src 下，所以这里扫到的引用只该来自 src/__tests__
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      if (file.includes("__tests__")) continue;
      if (file.endsWith("scoring-key.ts")) continue;
      const text = readFileSync(file, "utf-8");
      if (text.includes("scoring-key") || text.includes("ENTRY_SCORING_KEY")) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("评分键的形状", () => {
  test("39 条，与全书 ▶ 条目数一致", () => {
    // 实测全书 45 个行首带 ▶ 的行，其中 6 个是「▶X：」冒号后无内容、被判成标题，
    // 最终 SectionItem 39 个。键要一一对应。
    expect(Object.keys(ENTRY_SCORING_KEY)).toHaveLength(39);
  });

  test("键的形态是 sourceKey 的 pN:LN", () => {
    for (const k of Object.keys(ENTRY_SCORING_KEY)) expect(k).toMatch(/^p\d+:L\d+$/);
  });

  test("每条至少标了一个类别", () => {
    for (const [k, v] of Object.entries(ENTRY_SCORING_KEY)) {
      expect(v.length, `${k} 没有标类别`).toBeGreaterThan(0);
    }
  });

  test("clue 与 item 必须带 id，其余不带", () => {
    for (const [k, kinds] of Object.entries(ENTRY_SCORING_KEY)) {
      for (const x of kinds) {
        if (x.kind === "clue" || x.kind === "item") {
          expect(("id" in x ? x.id : ""), `${k} 的 ${x.kind} 缺 id`).not.toBe("");
        } else {
          expect("id" in x, `${k} 的 ${x.kind} 不该带 id`).toBe(false);
        }
      }
    }
  });

  test("只有一条是双角色 —— 老旧文件同时是 Clue 与 ModuleItem", () => {
    // 这一条是量出来的，不是猜的（见 tools/_diag-confusion.ts）。
    // 下一轮做线索时不能假设「已判为 item ⇒ 不是 clue」，而这条测试钉住那个例外只有一个。
    const dual = Object.entries(ENTRY_SCORING_KEY).filter(
      ([, v]) => new Set(v.map((x) => x.kind)).size > 1,
    );
    expect(dual.map(([k]) => k)).toEqual(["p12:L6"]);
  });

  test("引用的 clue / item id 都能在基准里找到", async () => {
    // 键写错 id 是最容易犯又最难发现的错：拼错一个字，那条就永远算不中，
    // 而指标只会低一点，不会红
    const { BARN_OF_PREMIER } = await import("../module/barn-of-premier");
    const clueIds = new Set(BARN_OF_PREMIER.scenes.flatMap((s) => s.clues.map((c) => c.id)));
    const itemIds = new Set(BARN_OF_PREMIER.items.map((i) => i.id));
    const bad: string[] = [];
    for (const [k, kinds] of Object.entries(ENTRY_SCORING_KEY)) {
      for (const x of kinds) {
        if (x.kind === "clue" && !clueIds.has(x.id)) bad.push(`${k} → clue:${x.id}`);
        if (x.kind === "item" && !itemIds.has(x.id)) bad.push(`${k} → item:${x.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("分布与手判的一致", () => {
    // 数的是**类别标记数**不是条目数：39 条目 → 41 个标记，因为有两条一对多 ——
    // p8:L5 一条条目里同时有孕妇照片与金锭挂饰（对两条线索），
    // p12:L6 同时是 Clue 与 ModuleItem。
    // 第一版这里写 clue: 20，是把条目数当成了标记数，被这条测试抓住。
    expect(keyDistribution()).toEqual({
      clue: 21,
      item: 9,
      connection: 3,
      npc_knowledge: 1,
      npc_secret: 1,
      event: 1,
      none: 5,
    });
  });

  test("标记总数 = 条目数 + 一对多的额外标记", () => {
    const marks = Object.values(keyDistribution()).reduce((a, b) => a + b, 0);
    const extra = Object.values(ENTRY_SCORING_KEY).reduce((n, v) => n + v.length - 1, 0);
    expect(marks).toBe(Object.keys(ENTRY_SCORING_KEY).length + extra);
    expect(extra).toBe(2); // p8:L5 与 p12:L6
  });
});
