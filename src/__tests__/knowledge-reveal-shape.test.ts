// NPC 一条条抖出来的知识，不能每条都用同一个收尾。
//
// 你原话贴的那两句：
//   「加比比较叛逆，喜欢出去玩，十五岁就搬到外面拖车住了……**我知道的就这些了**。」
//   「我已经半个多月没有他的消息了……**我知道的就这些了**。」
//
// 出自 `templateKnowledgeReveals`：`frame()` 不看位置，
// 给**每一条** knowledge 都套同一个尾巴。两个毛病叠在一起：
//   1. 读起来是复读机
//   2. **语义是错的** —— 第一条就说「就这些了」，可她明明还知道别的，
//      说完还会接着说下一条
//
// 收尾语只能挂在最后一条。中间的条目只染语气，不作总结。

import { describe, test, expect } from "bun:test";
import { applyLlmExpanded } from "../llm/generate-llm-expanded";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { ModuleNPC } from "../module/types";

/** 逼它走模板路径（正常跑时 LLM 优先，但世界观校验打回时就落到这里） */
function reveals(id: string): string[] {
  const src = BARN_OF_PREMIER.npcs.find((n) => n.id === id)!;
  const copy = JSON.parse(JSON.stringify(src)) as ModuleNPC;
  delete (copy as { llmExpanded?: unknown }).llmExpanded;
  applyLlmExpanded(copy);
  return copy.llmExpanded?.knowledgeReveals ?? [];
}

const CLOSINGS = /我知道的就这些了|就这些，别再问了|我能想起来的就这么多|案卷上就是这么记的|我知道的就这么多啦/;

describe("收尾语只能出现在最后一条", () => {
  test("**错误行为的红线**：焦虑型 NPC 不得每条都说「我知道的就这些了」", () => {
    // 变异检验：把 frame 改回不看位置，这条立刻红。
    const rs = reveals("phoebe_tricam");
    expect(rs.length).toBeGreaterThan(1); // 别让下面测了个空
    const withClosing = rs.filter((r) => CLOSINGS.test(r));
    expect(withClosing.length).toBe(1);
    expect(CLOSINGS.test(rs[rs.length - 1]!)).toBe(true);
  });

  test("**正确**：收尾语最多一条，且必在末尾（对全部 NPC 成立）", () => {
    // 比「最后一条必须有收尾语」更准：通用型 NPC 本来就没有署名式收尾语，
    // 强求它有会把判据变成「逼所有人都说同一句」—— 那正是要修的毛病的反面。
    for (const npc of BARN_OF_PREMIER.npcs) {
      const rs = reveals(npc.id);
      const idx = rs.map((r, i) => (CLOSINGS.test(r) ? i : -1)).filter((i) => i >= 0);
      expect(idx.length).toBeLessThanOrEqual(1);
      if (idx.length === 1) expect(idx[0]).toBe(rs.length - 1);
    }
  });

  test("**正确**：有署名收尾语的性格，末尾确实收了尾 —— 不是把收尾语删光了事", () => {
    const rs = reveals("phoebe_tricam");
    expect(CLOSINGS.test(rs[rs.length - 1]!)).toBe(true);
  });

  test("**干扰输入**：只有一条 knowledge 时，那一条就是最后一条，照样收尾", () => {
    const one = {
      id: "x", name: "某人", role: "路人",
      personality: { traits: ["焦虑"], speech: "急促", attitude: "紧张" },
      knowledge: ["他昨天见过那辆车"],
    } as unknown as ModuleNPC;
    applyLlmExpanded(one);
    const rs = one.llmExpanded?.knowledgeReveals ?? [];
    expect(rs.length).toBe(1);
    expect(CLOSINGS.test(rs[0]!)).toBe(true);
  });
});

describe("中间条目不复读", () => {
  test("**错误行为的红线**：多条 knowledge 的 NPC，中间条目不得互相重复", () => {
    for (const id of ["phoebe_tricam", "police"]) {
      const rs = reveals(id);
      if (rs.length < 3) continue;
      const middles = rs.slice(0, -1);
      // 取每条的尾巴（收尾语的位置）比对
      const tails = middles.map((m) => m.slice(-8));
      expect(new Set(tails).size).toBeGreaterThan(1);
    }
  });

  test("**干扰输入**：每条都还带着原始 knowledge 的内容，没被框架吃掉", () => {
    const src = BARN_OF_PREMIER.npcs.find((n) => n.id === "phoebe_tricam")!;
    const rs = reveals("phoebe_tricam");
    src.knowledge.forEach((k, i) => {
      const core = k.replace(/[。！？…]+$/, "").slice(0, 8);
      expect(rs[i]).toContain(core);
    });
  });

  test("**干扰输入**：不重复标点（没有「。。」或「……。」）", () => {
    for (const id of ["phoebe_tricam", "police", "tramp", "mir_tricam"]) {
      for (const r of reveals(id)) {
        expect(r).not.toContain("。。");
        expect(r).not.toMatch(/…+。/);
      }
    }
  });
});
