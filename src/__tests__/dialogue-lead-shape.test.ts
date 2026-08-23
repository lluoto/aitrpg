// NPC 说话前那一句引导的**形状**。
//
// 你原话点的两条，都出自 `templateFirstEncounter` 的同一行拼接
// （`${神态}${名字}${语调桥}`）：
//
//   「**眉头紧锁，**菲碧·特里坎声音发颤地说：」
//     —— 无主语的神态词起头，读起来是剧本的舞台指示，不是小说叙述
//   「**孩子**米尔·特里坎眨巴着眼睛说：」
//     —— `isChild` 那支返回的是名词标签「孩子」，等于把角色分类写进正文
//
// 中文自然的写法是人在前、神态在后。
//
// ⚠ 这条模板路径**经常真的在用**：实跑日志里能看到
// 「[llm-expanded] phoebe_tricam 降级为模板：世界观约束命中」——
// LLM 写的被世界观校验打回时就落到这里，所以模板不是摆设。

import { describe, test, expect, afterEach } from "bun:test";
import { applyLlmExpanded, overlaps } from "../llm/generate-llm-expanded";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import type { ModuleNPC } from "../module/types";

const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });

const bare = (n: ModuleNPC) => n.name.replace(/[（(].*[）)]$/, "").trim();

/** 拿一份没有 llmExpanded 的副本，逼它走模板路径 */
function npcById(id: string): ModuleNPC {
  const src = BARN_OF_PREMIER.npcs.find((n) => n.id === id)!;
  const copy = JSON.parse(JSON.stringify(src)) as ModuleNPC;
  delete (copy as { llmExpanded?: unknown }).llmExpanded;
  return copy;
}

/** 首次见面那句的引导部分（台词之前） */
function leadOf(npc: ModuleNPC): string {
  const copy = JSON.parse(JSON.stringify(npc)) as ModuleNPC;
  delete (copy as { llmExpanded?: unknown }).llmExpanded;
  applyLlmExpanded(copy);
  const text = copy.llmExpanded?.firstEncounter ?? "";
  const i = text.search(/[：:]/);
  return i < 0 ? text : text.slice(0, i + 1);
}

describe("引导句必须以人起头，不是以神态起头", () => {
  test("**错误行为的红线**：焦虑的 NPC 不得写成「眉头紧锁，菲碧……」", () => {
    // 变异检验：把拼接改回 `${神态}${名字}${桥}`，这条立刻红。
    for (let i = 0; i < 12; i++) {
      Math.random = () => i / 12;
      const npc = npcById("phoebe_tricam");
      const lead = leadOf(npc);
      expect(lead.startsWith(bare(npc))).toBe(true);
    }
  });

  test("**错误行为的红线**：公事公办的 NPC 同样不得以「表情严肃，」起头", () => {
    for (let i = 0; i < 12; i++) {
      Math.random = () => i / 12;
      const npc = npcById("police");
      expect(leadOf(npc).startsWith(bare(npc))).toBe(true);
    }
  });

  test("**正确**：神态没丢，只是挪到了人后面", () => {
    Math.random = () => 0;
    const npc = npcById("phoebe_tricam");
    const lead = leadOf(npc);
    expect(lead).toContain(bare(npc));
    // 神态词仍在句中（「菲碧·特里坎神色焦虑，声音发颤地说：」）
    expect(/神色焦虑|面带忧色|眉头紧锁/.test(lead)).toBe(true);
  });

  test("**干扰**：没有神态的 NPC 不该多出一个逗号", () => {
    Math.random = () => 0;
    for (const id of ["gabi_tricam", "tramp", "bar_bouncer"]) {
      const lead = leadOf(npcById(id));
      expect(lead).not.toMatch(/^[，,]/);
      expect(lead).not.toMatch(/[，,][，,]/);
    }
  });
});

describe("神态与语调桥不得同义反复", () => {
  test("**错误行为的红线**：不得出现「态度公事公办，用公事公办的口吻说」", () => {
    // 两者都从同一批 traits 抽，撞车是必然的，不是偶发。
    // 实跑第一次修完就撞出来了 —— 形状对了，内容却在重复。
    for (let i = 0; i < 12; i++) {
      Math.random = () => i / 12;
      const lead = leadOf(npcById("police"));
      const before = lead.split("，")[0] ?? "";
      const after = lead.slice(before.length);
      if (before && after) expect(overlaps(before.replace(/^.*?(?=态度|表情|神色|面带|眉头|神情|面色|看起来)/, ""), after)).toBe(false);
    }
  });

  test("overlaps — 正例/反例/干扰", () => {
    expect(overlaps("态度公事公办", "用公事公办的口吻说：")).toBe(true);
    expect(overlaps("神色焦虑", "声音发颤地说：")).toBe(false);
    expect(overlaps("", "开口说道：")).toBe(false);
    expect(overlaps("面带微笑", "")).toBe(false);
  });

  test("**干扰**：撞车时保留语调桥（信息量更大），不是两个都删", () => {
    for (let i = 0; i < 12; i++) {
      Math.random = () => i / 12;
      const lead = leadOf(npcById("police"));
      expect(/说[：:]$/.test(lead)).toBe(true);
    }
  });
});

describe("角色标签不得写进正文", () => {
  test("**错误行为的红线**：孩子不得被写成「孩子米尔·特里坎……」", () => {
    // `isChild` 原先返回名词标签「孩子」/「5岁、孩子」，直接拼在名字前面。
    for (let i = 0; i < 12; i++) {
      Math.random = () => i / 12;
      const npc = npcById("mir_tricam");
      const lead = leadOf(npc);
      expect(lead.startsWith(bare(npc))).toBe(true);
      expect(lead).not.toContain(`孩子${bare(npc)}`);
    }
  });

  test("**正确**：童稚仍然表达得出来 —— 由语调桥承担", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      Math.random = () => i / 20;
      seen.add(leadOf(npcById("mir_tricam")));
    }
    // 「奶声奶气地说」「歪着头天真地说」「眨巴着眼睛说」至少出现一种
    expect([...seen].some((s) => /奶声奶气|歪着头|眨巴着眼睛/.test(s))).toBe(true);
  });

  test("**干扰**：模组里确实有个孩子（别让上面几条测了个空）", () => {
    const mir = npcById("mir_tricam");
    expect(mir.name).toContain("米尔");
    expect(JSON.stringify(mir.personality)).toMatch(/岁|孩子|天真|怯/);
  });
});
