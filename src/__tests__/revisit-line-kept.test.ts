// LLM 生成不完整时，不许把已经有的回访台词抹掉。
//
// 起因：跑一局完整对局，酒吧保镖那句
//     「酒吧保镖挡在门口，眼神凶狠地扫视着你，说：
//       "不想挨揍就老实点。这地方不欢迎生面孔，除非你有正经事。"」
// **一字不差地出现了四次** —— 玩家每次重进维森酒吧都听同一句。
//
// 而模组数据里本来写着回访台词：「你们回来了。还有什么要问的吗？」
//
// 根因：`applyLlmExpandedWithLLM` 是 `npc.llmExpanded = apiResult` ——
// 整个对象替换。而 `revisitEncounter` 是**可选**字段，LLM 没吐它时
// apiResult 里就没有，原本准备好的那句被一并丢掉；
// 下游 `revisitEncounter ?? firstEncounter` 于是永远回落到首见。
//
// 这个 bug 单测很难想到 —— 它要求「LLM 返回了部分字段」这个前提。
// 是实跑一局、读播报读出来的。

import { describe, test, expect } from "bun:test";
import { applyAllLlmExpandedWithLLM, applyLlmExpanded } from "../llm/generate-llm-expanded";
import type { ModuleNPC } from "../module/types";

// ⚠ `applyLlmExpandedWithLLM` 开头有一道闸：`llmExpanded` 存在**且不是模板生成的**
//   就当作手写黄金标准，绝不覆盖。所以夹具不能直接手塞 llmExpanded ——
//   得让 `applyLlmExpanded()` 生成一份（它会把对象登记进 templateGenerated），
//   否则测的是「黄金标准不被覆盖」那条路径，跟这里要测的不是一回事。
//   第一版就是这么红的。
function templated(n: ModuleNPC, revisit?: string): ModuleNPC {
  delete (n as { llmExpanded?: unknown }).llmExpanded;
  applyLlmExpanded(n);
  if (revisit !== undefined) n.llmExpanded!.revisitEncounter = revisit;
  else delete n.llmExpanded!.revisitEncounter;
  return n;
}

/** 只吐 firstEncounter + knowledgeReveals，不吐 revisitEncounter 的假客户端 */
function partialClient() {
  return {
    chat: async () => JSON.stringify({
      firstEncounter: "新的首见台词。",
      knowledgeReveals: ["新的知识台词。"],
      // revisitEncounter 故意不给 —— 这正是线上 LLM 常有的情况
    }),
  } as unknown as Parameters<typeof applyAllLlmExpandedWithLLM>[1];
}

function npc(): ModuleNPC {
  return {
    id: "probe", name: "测试保镖", role: "保镖",
    personality: { traits: ["粗鲁"], speech: "粗声粗气", attitude: "警惕" },
    knowledge: ["有人包场办派对"],
  } as ModuleNPC;
}

describe("LLM 部分返回时不抹掉已有字段", () => {
  test("**错误行为的红线**：LLM 没给回访台词时，原有的那句必须留着", async () => {
    // 变异检验：改回 `npc.llmExpanded = apiResult` → 这条红。
    const n = templated(npc(), "你们回来了。还有什么要问的吗？");
    await applyAllLlmExpandedWithLLM([n], partialClient());
    expect(n.llmExpanded?.firstEncounter).toBe("新的首见台词。");   // 新的覆盖了
    expect(n.llmExpanded?.revisitEncounter).toBe("你们回来了。还有什么要问的吗？"); // 旧的还在
  });

  test("**正确**：LLM 给了回访台词时用新的", async () => {
    const full = {
      chat: async () => JSON.stringify({
        firstEncounter: "新首见。",
        knowledgeReveals: ["新知识。"],
        revisitEncounter: "新回访。",
      }),
    } as unknown as Parameters<typeof applyAllLlmExpandedWithLLM>[1];
    const n = templated(npc(), "旧回访。");
    await applyAllLlmExpandedWithLLM([n], full);
    expect(n.llmExpanded?.revisitEncounter).toBe("新回访。");
  });

  test("**干扰输入**：原本就没有回访台词时，不该凭空造一个", async () => {
    const n = templated(npc()); // 不给回访台词
    await applyAllLlmExpandedWithLLM([n], partialClient());
    expect(n.llmExpanded?.revisitEncounter).toBeUndefined();
  });

  test("**干扰输入**：回访与首见不得是同一句 —— 那等于没有回访", async () => {
    // 玩家能察觉的就是这件事：重进一次，NPC 又把打招呼那句说一遍。
    const n = templated(npc(), "你们回来了。还有什么要问的吗？");
    await applyAllLlmExpandedWithLLM([n], partialClient());
    expect(n.llmExpanded?.revisitEncounter).not.toBe(n.llmExpanded?.firstEncounter);
  });
});
