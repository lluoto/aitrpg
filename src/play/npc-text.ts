// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { ModuleNPC, NPCInstanceState } from "../module/types";
import type { WorldState } from "../world/state";
import { say } from "./narration";
export function noteEntityMentions(text: string, w: WorldState): void {
  if (!text) return;
  for (const ent of w.narrativeEntities) {
    if (w.isEntityIntroduced(ent.id)) continue;
    if (ent.mentionKeywords.some((k) => k && text.includes(k))) {
      w.introduceEntity(ent.id);
    }
  }
}

export function stripOuterQuotes(s: string): string {
  let t = s.trim();
  // 首尾引号（可能多重，如 "…" 包 '…'）
  while (/^[“‘'"]/.test(t) && /[”’'"]$/.test(t) && t.length >= 2) {
    t = t.slice(1, -1).trim();
  }
  // 内部成对引号：剥离包裹连续内容的引号对，保留内容本身
  t = t.replace(/[“‘'"]\s*([^“‘'"]+?)\s*[”’'"]/g, "$1");
  return t.trim();
}

/**
 * 台词统一引号：剥离首尾/内部残留引号后，统一包一层中文双引号。
 * 各处输出（firstEncounter/revisit/mental_voice/coma/reveal）格式保持一致。
 */
export function quoteDialogue(s: string): string {
  return `"${stripOuterQuotes(s).trim()}"`;
}

/** 分析 NPC 人格信号（年龄带 + 特质 + 说话方式），供引导桥/语气桥做数据驱动分派 */
export function analyseNpcData(npc: ModuleNPC): {
  isToddler: boolean; isChild: boolean; isTeen: boolean;
  isAnxious: boolean; isTalkative: boolean;
  isShy: boolean; isGentle: boolean; isCautious: boolean;
  isOfficial: boolean; isRough: boolean; isMaternal: boolean;
  isCurious: boolean; isLazy: boolean; isSmart: boolean;
  isDesperate: boolean;
  /** Primary personality trait for tiebreaking conflicting signals */
  dominantTrait: string;
} {
  const t = npc.personality.traits ?? [];
  const s = npc.personality.speech ?? "";
  const age = npc.age;

  // Age band — affects language complexity at generation time
  const isToddler = age !== undefined && age < 7;
  const isChild = age !== undefined && age >= 7 && age < 12; // narrower: only school-age
  const isTeen = age !== undefined && age >= 12 && age < 18;
  // Re-derive isChild for backward compat (any age < 10)
  const isAnyChild = age !== undefined && age < 10;

  // Trait-based signals
  const signals = {
    isAnxious: t.some(x => ["焦虑","不安"].includes(x)),
    isTalkative: t.some(x => ["健谈","话多"].includes(x)) || s.includes("话多") || s.includes("插科打诨"),
    isShy: t.some(x => ["害羞","怕生"].includes(x)),
    isGentle: t.some(x => ["温和","友善","温柔"].includes(x)),
    isCautious: t.some(x => ["警惕","多疑","守规矩","懒散"].includes(x)),
    isOfficial: s.includes("官方") || s.includes("漫不经心") || t.includes("官僚"),
    isRough: s.includes("粗鲁") || t.includes("虚张声势"),
    isMaternal: t.includes("慈爱") || t.includes("母爱深沉"),
    isCurious: t.some(x => ["好奇心强","好奇","观察力敏锐"].includes(x)),
    isLazy: t.includes("懒散") || t.includes("怕麻烦"),
    isSmart: t.includes("聪明") || t.includes("精明"),
    isDesperate: t.includes("绝望") || t.includes("被利用"),
  };

  // Dominant trait: first match in priority order
  const priority = [
    ["绝望", "isDesperate"], ["焦虑", "isAnxious"], ["健谈", "isTalkative"],
    ["害羞", "isShy"], ["温和", "isGentle"], ["警惕", "isCautious"],
    ["粗鲁", "isRough"], ["慈爱", "isMaternal"], ["聪明", "isSmart"],
    ["好奇", "isCurious"], ["懒散", "isLazy"], ["友善", "isGentle"],
  ] as const;
  const dominantTrait = t.length > 0
    ? (priority.find(([kw]) => t.includes(kw))?.[1] ?? t[0])
    : "generic";

  return {
    isToddler,
    isChild: isAnyChild, // keep backward compat for existing callers
    isTeen,
    ...signals,
    dominantTrait,
  };
}

/**
 * 知识揭示/追问的引导桥 — 数据驱动（按 NPC 特质分派"接着说"类引导），
 * 避免"裸引号/名字：内容"机械直出。
 *
 * avoid 传上一次用过的那条，用来躲开紧挨着的重复。每个桶只有三四条、又是纯随机，
 * 一局里同一句必然撞好几次 —— 实跑中菲碧连着两次"垂下眼帘，声音低沉下来："。
 * 默认桶另外扩了容：不匹配任何人格的角色（缸中脑、Mi-Go）全都落在这里，
 * 原先三条让一个濒死的人和一个外星生物共用了同一句"想了想，开口道："。
 */

export function splitLeadingStageDirection(text: string, speakerName?: string): { action: string; speech: string } {
  const m = /^\s*（([^）]*)）\s*/.exec(text);
  if (m) {
    // 括号里常自带主语（"她低下头"），拼到 NPC 名后面会变成"菲碧她低下头"
    const action = m[1].trim().replace(/^[她他它]/, "");
    return { action, speech: text.slice(m[0].length) };
  }

  // 禁掉括号之后，模型会改用白话写同一段叙述，没有括号就漏过上面那条，
  // 整段被当台词包进引号，于是出现「米尔·特里坎悄声说："米尔歪着小脑袋，
  // 眼神有些迷茫。哥哥……"」—— 小孩在说一段对自己的第三人称描写。
  //
  // 判据取得很窄：只有当台词以说话人自己的名字起头时才切。真人开口不会先用
  // 第三人称报自己的名字，误伤的可能极低。
  // 名字要连短名一起试："米尔·特里坎"的台词实际以"米尔"起头，只比全名会漏。
  // 分隔符也要带上冒号 —— 模型爱写"米尔歪着小脑袋，眼神迷茫：谷仓在那边很远呢"。
  for (const n of speakerName ? [speakerName, speakerName.split(/[·・]/)[0]] : []) {
    if (!n || n.length < 2 || !text.startsWith(n)) continue;
    const end = text.search(/[。！？：:]/);
    if (end <= 0 || end >= text.length - 1) continue;
    return {
      action: text.slice(n.length, end).replace(/^[，、\s]+/, "").trim(),
      speech: text.slice(end + 1).trim(),
    };
  }

  return { action: "", speech: text };
}

/**
 * 用切出来的神态动作拼引导桥。
 *
 * 动作本身经常已经以"说/问/道/答"收尾（"焦虑不安地搓着手说"），再拼一个"，说："
 * 就成了「菲碧·特里坎焦虑不安地搓着手说，说：」—— 同一个"说"字连着出现两次。
 * 实跑里抓到的原文见 play-logs/run-2026-08-18T06-06-34.txt。
 *
 * 这是把括号神态转成叙述句时带出来的：括号里写的是"（焦虑不安地搓着手说）"，
 * 切出来就自带了动词，而拼接方按"动作 + 说："的模板无条件补了一个。
 */
