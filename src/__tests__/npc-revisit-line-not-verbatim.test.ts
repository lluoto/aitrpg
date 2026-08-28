// 五项开发（第二轮）·任务2：整句台词重复。
//
// 起因：npc-dialogue.ts 的 generateNpcDialogue() 与 scene-pipeline.ts 里
// 处理 npc.llmExpanded 的回访分支各有一份 `revisitEncounter ?? firstEncounter`
// ——LLM 没生成 revisitEncounter（很常见）时，再遇就逐字重复首见台词。
// 探针 probe-dialogue-lead.ts §⑤ 实跑抓到过酒吧保镖那句连说四次。
//
// ⚠ 重复引导句不是本任务的目标（提交 a4fdb58 已判定"同一人举止一致，不是
// 病"），本任务只管**整句台词**——两者要分开测，不能顺手把引导句也改了。
//
// bun test src/__tests__/npc-revisit-line-not-verbatim.test.ts

import { describe, test, expect } from "bun:test";
import { generateNpcDialogue, classifySpeechStyle } from "../play/npc-dialogue";
import type { ModuleNPC, NPCInstanceState } from "../module/types";

function npc(overrides: Partial<ModuleNPC> = {}): ModuleNPC {
  return {
    id: "bouncer", name: "酒吧保镖", role: "保镖", description: "维森酒吧的保镖",
    personality: { traits: ["粗鲁"], speech: "粗声粗气", attitude: "警惕" },
    knowledge: [],
    sceneId: "weisen_bar",
    llmExpanded: {
      firstEncounter: "不想挨揍就老实点。这地方不欢迎生面孔，除非你有正经事。",
      knowledgeReveals: [],
      // revisitEncounter 故意不给——这正是 LLM 常有的情况
    },
    ...overrides,
  } as ModuleNPC;
}

function npcState(): NPCInstanceState {
  return {
    locationSceneId: "weisen_bar", mood: "警惕", relationship: -2,
    isAlive: true, isConscious: true, knownByPlayers: true, metCount: 2,
  } as NPCInstanceState;
}

const profile = classifySpeechStyle("粗声粗气");

describe("generateNpcDialogue —— revisitEncounter 缺失时不逐字重复 firstEncounter", () => {
  test("**错误行为红线**：再遇且没有 revisitEncounter → 不得与 firstEncounter 完全相同", () => {
    const n = npc();
    const line = generateNpcDialogue(n, npcState(), profile, {} as any, true);
    expect(line).not.toBe(n.llmExpanded!.firstEncounter);
  });

  test("**正确**：连续多次再遇（模拟反复重进同一场景）——不能每次都和 firstEncounter 相同", () => {
    // 逐字重复的判定不能只看一次抽样：pick() 有随机性，多跑几次，
    // 只要一次撞见与 firstEncounter 完全相同就说明回落逻辑没摘干净。
    const n = npc();
    for (let i = 0; i < 20; i++) {
      const line = generateNpcDialogue(n, npcState(), profile, {} as any, true);
      expect(line).not.toBe(n.llmExpanded!.firstEncounter);
    }
  });

  test("**目标行为错误的对照**：revisitEncounter 存在时仍然原样使用，不被这次改动误伤", () => {
    const n = npc({
      llmExpanded: {
        firstEncounter: "不想挨揍就老实点。",
        knowledgeReveals: [],
        revisitEncounter: "又是你们。有事快说。",
      },
    });
    const line = generateNpcDialogue(n, npcState(), profile, {} as any, true);
    expect(line).toBe("又是你们。有事快说。");
  });

  test("**文本相似但合法**：首次见面（isRevisit=false/undefined）仍然用 firstEncounter，不受这次改动影响", () => {
    const n = npc();
    expect(generateNpcDialogue(n, npcState(), profile, {} as any, false))
      .toBe(n.llmExpanded!.firstEncounter);
    expect(generateNpcDialogue(n, npcState(), profile, {} as any))
      .toBe(n.llmExpanded!.firstEncounter);
  });

  test("**正确**：没有 llmExpanded 的 NPC（纯模板路径）行为不受影响", () => {
    const n = npc({ llmExpanded: undefined, personality: { traits: ["粗鲁"], speech: "喃喃", attitude: "警惕" } });
    // 喃喃/含糊/意识不清 → 空字符串（既有行为），不应该因为这次改动报错或变化
    expect(generateNpcDialogue(n, npcState(), classifySpeechStyle("喃喃"), {} as any, true)).toBe("");
  });
});
