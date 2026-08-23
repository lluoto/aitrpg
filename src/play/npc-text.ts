// 从 play-module.ts 抽出来的一段（脚本搬运，见 tools/_extract-block.ts）。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
//
// ⚠ 纯搬运，不改行为。判据是全量测试与主循环脚手架全绿。

import type { ModuleNPC } from "../module/types";
import { occupationTagWeight } from "../agent/player-agent";
import type { WorldState } from "../world/state";

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


const OUTGOING = /健谈|外向|好奇|直率|急躁|热情|多话|爱管闲事|喜欢打听|口无遮拦/;
const RESERVED = /寡言|沉默|内向|谨慎|冷淡|木讷|不善言辞|惜字如金|怕生/;

/**
 * 同伴的一句话 —— 两名调查员之间的非叙事性交流。
 *
 * 之前整局日志里，两个人从头到尾没对彼此说过一个字：所有输出要么是对 NPC 提问，
 * 要么是引擎旁白。两个人一起走完全程，却像各自在演独角戏。
 *
 * 这类话故意不推动情节（模板也推动不了）：它的作用是让现场有两个人。
 * 寡言的人给短句，外向的人给长句 —— 同一个发现，不同的人反应本来就不一样。
 * 返回空串表示这次不说话，由调用方决定频率。
 */
export function partnerRemark(
  personality: string,
  kind: "clue" | "san",
  avoid?: string,
): string {
  const reserved = RESERVED.test(personality) && !OUTGOING.test(personality);
  const pools: Record<"clue" | "san", { terse: string[]; talkative: string[] }> = {
    clue: {
      terse: ["给我看看。", "嗯。收着。", "……先别动它。", "记下来。"],
      talkative: [
        "给我看看——这东西不该在这儿。",
        "等等，你从哪儿翻出来的？",
        "这跟刚才那位说的对得上。",
        "我不喜欢这个。真的。",
        "先记下来，回头我们对一遍。",
      ],
    },
    san: {
      terse: ["……你还好吧。", "站稳了。", "看着我。"],
      talkative: [
        "你脸色不对——先坐下，别硬撑。",
        "深呼吸。我在这儿。",
        "别看那边了，看我。",
      ],
    },
  };
  const pool = reserved ? pools[kind].terse : pools[kind].talkative;
  const usable = pool.length > 1 ? pool.filter((x) => x !== avoid) : pool;
  return usable[Math.floor(Math.random() * usable.length)];
}

/**
 * 这一轮谁开口的倾向分。
 *
 * 原先是 askTurn % 2 硬轮流 —— 两个人像在排队发言，不像两个人在办案。
 * 现在看三件事：
 *   1. 职业对"交谈"这件事的偏好（复用 player-agent 的标签体系，不另写职业正则）
 *   2. 性格是外向还是寡言（八项里的"特质"是自由文本，只能按词判）
 *   3. 话题跟这个人的经历沾不沾边 —— 谁的背景里出现过这些词，谁更可能接话。
 *      医生遇到伤情、记者遇到镇上的传闻，本来就该是他先开口。
 * 最后减去"刚说过"的惩罚：话多的那个不该把整局包圆，寡言的也得有开口的时候。
 */
export function askerScore(
  pc: { occupation: string; personality: string; background?: string },
  topic: string,
  recentAsks: number,
): number {
  let s = occupationTagWeight(pc.occupation, "talk") + occupationTagWeight(pc.occupation, "social");

  const traits = pc.personality || "";
  if (OUTGOING.test(traits)) s += 0.8;
  if (RESERVED.test(traits)) s -= 0.8;

  if (topic) {
    const bg = `${pc.background ?? ""}${traits}`;
    const words = [...new Set(topic.match(/[\u4e00-\u9fa5]{2,4}/g) ?? [])];
    s += Math.min(words.filter((w) => bg.includes(w)).length, 3) * 0.5;
  }

  return s - recentAsks * 0.6;
}

/**
 * 拆出台词开头的括号神态。
 *
 * 引擎会在台词前加一句叙述引导桥（"歪着头想了想，说："），而 LLM 常常在台词
 * 开头又写一遍括号神态，两者叠起来就成了：
 *   歪着头想了想，说："（歪着头想了想）加比哥哥半个月前就不回来了……"
 * 同一个动作说两遍。
 *
 * 提示词里已经明令不要用括号起头，实测仍有约四成台词照写 —— 模型守不住的
 * 约束就得由代码兜底。firstEncounter 那条路早就用 hasInlineAction 这么做了，
 * 这里是把同一个约定补齐。
 *
 * 只切开头那一处；句中穿插的括号是有效的韵律信息（见 docs/voice-readiness.md
 * 第五节），保留不动。
 */
export function speechLead(action: string): string {
  const a = action.trim();
  return /[说问道答]$/.test(a) ? `${a}：` : `${a}，说：`;
}

/** 剥离台词首尾引号 + 内部 LLM 残留的成对引号包裹（如 '整句'），避免"…'…。'"不对称 */
/**
 * NPC 说话时提到了什么 —— 把台词里出现过的叙事实体标成"已被提起"。
 *
 * 只扫 NPC 台词，故意不扫场景描述。特里坎家的原文描述里本来就写着院子一旁
 * 停着一座拖车房，调查员进门就看见了；但那时它只是一座拖车。要等菲碧说出
 * "他十五岁就搬到外面拖车住了"，它才变成"失踪男孩的房间"。
 * 看见与认出是两件事，混在一起这段桥就没得演了。
 */
