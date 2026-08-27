// 从 play-module.ts 的 runModuleInner 闭包里抽出来的 NPC 对话生成。
//
// 抽出来的理由是可寻址性：原先 runModuleInner 一个函数 2615 行、占全文件 74%，
// 里面按注释能切出近 30 个块，但没有一个是能整段读进来的单元 ——
// 每次改动只能靠行号开窗口猜，窄了缺上下文、宽了浪费。
// 这一段实测只依赖 ModuleNPC 与模块级的 say()，是耦合最松的一块，先拿它开刀。
//
// ⚠ 纯搬运，不改行为。判据是 1325 条测试与主循环脚手架全绿。

import type { ModuleNPC, NPCInstanceState } from "../module/types";
import type { WorldState } from "../world/state";
import { say } from "./narration";
import {
  analyseNpcData, splitLeadingStageDirection, stripOuterQuotes, noteEntityMentions,
} from "./npc-text";
import { nextRevealBridge } from "./reveal-bridge";
import type { Dedup } from "./run-state";
/**
 * Generate player-facing impression from NPC data (skip stat blocks / KP notes)
 *
 * ⚠ 返回值**永远不是 LLM 生成的**：每条路径要么是模组作者写的
 * （`npc.entrance` / `npc.description`），要么是引擎按 role/age/trait 拼的模板。
 * 所以调用方必须以 `"verbatim"` 播报。
 *
 * 原先用的是默认 origin（`"llm"`），两个后果：
 *   1. 语音层把一段整局不变的文本当成实时生成，白白多合成一次
 *   2. 「玩家读到的字有多少是写死的」量不准 —— `probe-narration-mix` 第一次
 *      跑出 verbatim 22.9%，而报告里最长的几段之一标着 [llm]、内容却是
 *      模组里 NPC 的 description 原文。判据被标记骗了。
 */
export function buildPcImpression(npc: ModuleNPC): string {
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();
  const role = (npc.role || "").replace(/[（(].*[）)]$/, "").trim();
  const age = npc.age;
  const rawTraits = npc.personality.traits ?? [];
  const desc = npc.description || "";

  // 作者手写的叙事口吻出场描写优先（剥掉连接词前缀，避免与模板前缀重复）
  const entrance = (npc.entrance || "").trim();
  if (entrance) {
    return entrance.replace(/^(就在这时|话音未落|忽然|突然)[，,、]?/, "").replace(/[。！？]+$/, "");
  }

  // If description is clearly player-facing narrative (no stat blocks), use it
  const hasStatBlock = /\bHP\d+\b|\bStr\d+\b|\bCON\s/i.test(desc);
  const startsWithAge = /^\d+\s*(岁|岁[。，])/.test(desc);
  if (!hasStatBlock && desc.length < 250) {
    // Strip age prefix if present
    const cleanDesc = startsWithAge
      ? desc.replace(/^\d+\s*岁[。，]?\s*/, "")
      : desc;

    // Detect behavioral/KP-instruction patterns — "会在...时", "当调查员", "会...如果" etc.
    // These are GM notes, NOT player-facing narrative
    const hasBehaviorPattern = /会在|当调查员|调查员会|会（.*）|如果.*会|见到.*会|遇到.*会|看到.*会/.test(cleanDesc);
    if (hasBehaviorPattern) {
      // Take only the first sentence (up to first period) as the impression
      const firstSentence = cleanDesc.split(/[。！？]/).filter(s => s.trim().length > 0)[0] || cleanDesc;
      return firstSentence.replace(/[。！？]+$/, "").trim();
    }

    // 剥离"开门动作"前缀：LLM 过渡已写"门被拉开/菲碧的身影出现在门后"，impression 再写
    // "开门的是一位……"会造成重复叙述。剥离后 impression 只保留外貌描写。
    const strippedAction = cleanDesc.replace(/^[^。！？，,]{0,12}?(开门|迎门|推门|拉开(了)?门)[的，,、]?/, "");

    // 补主语：模组描述常以"是一位四十岁上下的女性"开头（承接"开门的"被剥离后）——
    // 单独成段读起来缺主语，补"这是"两字使叙述完整："这是一位四十岁上下的女性……"
    const withSubject = /^是(一位|位|个|名|一名)/.test(strippedAction)
      ? strippedAction.replace(/^是/, "这是")
      : strippedAction;

    return withSubject.replace(/[。！？]+$/, "");
  }

  // Extract a short adjective from the first trait (take only first meaningful word)
  // "绝望的丈夫" → "绝望", "叛逆" → "叛逆", "食尸鬼" → "", "天真" → "天真"
  const firstTrait = rawTraits.length > 0 ? rawTraits[0] : "";
  const traitShort = firstTrait.replace(/的.*$/, "").trim();
  const adj = (traitShort && traitShort !== "食尸鬼" && traitShort !== name) ? traitShort : "";

  // For non-human / monstrous entities, return a simple description
  const isMonster = /食尸鬼|鬼|怪|神|异|Mi-Go|米戈/i.test(name);
  if (isMonster) return `一只${role || "不明生物"}`;

  // Build a natural impression: "一个X岁上下、Y的Z" or "X岁的Z"
  const ageStr = age ? `${age}岁` : "";
  const adjStr = adj ? (ageStr ? `、${adj}` : `${adj}`) : "";
  const roleStr = role || "人";

  return `${ageStr}${adjStr}的${roleStr}`;
}

/**
 * 剥离 firstEncounter/revisitEncounter 开头与过渡重复的"开门动作"。
 * 过渡已写"门被猛地拉开，一位神情紧绷的女性出现在门口"，firstEncounter 若再写
 * "她猛地拉开门，……"则动作重复。仅当过渡文本包含开门动作时才剥离。
 */
export function stripDoorOpenPrefix(text: string, transitionText: string): string {
  if (!text) return text;
  if (!transitionText || !/开门|拉门|推门|门被|门锁|门已|门开了/.test(transitionText)) return text;
  // 形如 "（她猛地拉开门）" 的行内动作
  const inline = text.match(/^（[^）]{0,30}?(猛地|一把|用力|急忙|顺手|狠狠)?(拉|推|打)开(了)?(门|房门|大门)[^）]{0,15}?）\s*/);
  if (inline) return text.slice(inline[0].length);
  // 形如 "她猛地拉开门，眼底的青黑遮不住……" 或 "她猛地拉开房门。" 的前缀
  const plain = text.match(/^[^“”。，,]{0,20}?(猛地|一把|用力|急忙|顺手|狠狠)?(拉|推|打)开(了)?(门|房门|大门)[，,。]\s*/);
  if (plain) return text.slice(plain[0].length);
  return text;
}

/**
 * 剥离 LLM 生成的 firstEncounter 开头自带的说话引导（"眉头紧锁，菲碧·特里坎声音发颤地说："）。
 * 引擎会统一用 displayName + toneBridge 拼引导，若 firstEncounter 自带引导会造成
 * "菲碧·特里坎神色焦虑，语速很快地开口说道：" + "……菲碧·特里坎声音发颤地说：" 两个"说"重复。
 * 返回 { lead, rest }：lead = 剥离出的引导（保留，比 toneBridge 更贴合 LLM 生成的神态），rest = 纯台词。
 */
export function stripDialogueLead(text: string): { lead: string; rest: string } {
  // 结构化主规则：台词被引号包裹时，引号前的完整叙述段就是引导。
  // 不枚举动词——任何"神态/动作/场景 + 引号台词"的组合都能识别，
  // 例如 "他像堵墙一样挡住去路，眼神阴鸷地扫视着你……冷哼。'站住。'"。
  const qi = text.search(/[“‘'"]/);
  if (qi > 0) {
    const before = text.slice(0, qi).trim();
    // 引导句以句读（冒号/句号/叹号/问号/省略号）或言语动词收尾才剥离，
    // 避免把"他看着'那东西'"这类强调性引号误判为台词
    const leadEnd = /[：:。！？…]$/.test(before) || /[\u4e00-\u9fa5](说|道|问|喊道|低语|开口)$/.test(before);
    if (before.length > 0 && leadEnd) {
      return { lead: before, rest: text.slice(qi).trim() };
    }
  }
  // 回退1：说/问动词 + 冒号（"声音发颤地说："）——无引号或引号前非完整句读
  const m1 = text.match(/^(.{1,45}?(?:开口道|说道|问道|低声道|小声道|喃喃自语|开口|说|问)[：:])\s*(.+)$/);
  if (m1) return { lead: m1[1], rest: m1[2] };
  // 回退2：动作/神态引导 + 冒号，无"说/问"动词（"警惕地盯着你们："、"嘴里无意识地重复着："）
  const m2 = text.match(/^(.{1,45}?(?:盯着|看着|望着|打量着|重复着|念叨着|嘟囔着|呢喃着|低语着|喃喃|抬起头|低下头|皱眉|沉默|顿了顿|凑近|上前|站起身来|坐在|站在|蹲在|缩在|蜷缩|拦住|挡住|堵在|挡在|扫视|审视|打量|环顾)[^：:]{0,15}?[：:])\s*(.+)$/);
  if (m2) return { lead: m2[1], rest: m2[2] };
  return { lead: "", rest: text };
}

// ====== Utility: random pick from arrays ======
export function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

// ====== Speech style classification ======
type SpeechProfile = {
  type: "fast_anxious" | "short_terse" | "mumbling" | "gentle_slow"
       | "coma_rapid" | "official" | "rude_timid" | "talkative"
       | "mental_voice" | "brainwave" | "childish" | "none" | "generic";
  keywords: string[];
};

export function classifySpeechStyle(desc: string): SpeechProfile {
  if (!desc || desc === "无") return { type: "none", keywords: [] };
  // Check in priority order (most specific first)
  if (desc.includes("脑波")) return { type: "brainwave", keywords: ["脑波", "情绪"] };
  if (desc.includes("电子音") || desc.includes("脑海") || desc.includes("心灵感应") || desc.includes("意念") || desc.includes("思维")) return { type: "mental_voice", keywords: ["电子音", "脑海", "心灵感应"] };
  if (desc.includes("昏迷") || desc.includes("意识不清")) return { type: "coma_rapid", keywords: ["昏迷", "急促"] };
  if (desc.includes("欲言又止")) return { type: "fast_anxious", keywords: ["快", "焦虑", "欲言又止"] };
  if (desc.includes("粗鲁") || desc.includes("强硬")) return { type: "rude_timid", keywords: ["粗鲁", "强硬", "胆怯"] };
  if (desc.includes("含糊") || desc.includes("喃喃")) return { type: "mumbling", keywords: ["含糊", "喃喃"] };
  if (desc.includes("话多") || desc.includes("插科打诨") || desc.includes("喜欢聊") || desc.includes("健谈")) return { type: "talkative", keywords: ["话多", "聊", "插科打诨"] };
  if (desc.includes("官方") || desc.includes("漫不经心") || desc.includes("公事公办")) return { type: "official", keywords: ["官方", "漫不经心", "公事公办"] };
  if (desc.includes("奶声奶气") || desc.includes("天真") || desc.includes("儿童") || desc.includes("孩子气")) return { type: "childish", keywords: ["奶声奶气", "稚嫩", "天真"] };
  if (desc.includes("温和") || desc.includes("温柔") || desc.includes("轻柔") || desc.includes("甜美")) return { type: "gentle_slow", keywords: ["温和", "温柔", "慢"] };
  if (desc.includes("不喜欢多说") || desc.includes("简短") || desc.includes("话不多")) return { type: "short_terse", keywords: ["短", "不喜", "话不多"] };
  if (desc.includes("焦虑") || desc.includes("不安") || desc.includes("急切") || desc.includes("快") || desc.includes("急促")) return { type: "fast_anxious", keywords: ["快", "焦虑"] };
  return { type: "generic", keywords: [] };
}

/** mental_voice 引导句：心灵感应/思维（无声）用"思维波动传入脑海"，电子音/机械声保留"声音在脑海响起" */
export function mentalVoiceBridge(profile: SpeechProfile, displayName: string, punct: string, again = false): string {
  const telepathic = profile.keywords?.includes("心灵感应") ?? false;
  if (telepathic) {
    const mid = again ? "再次" : "直接";
    return `${displayName}的思维波动${mid}传入你们脑海${punct}`;
  }
  const mid = again ? "再次" : "";
  return `${displayName}的声音${mid}在你们脑海中响起${punct}`;
}

// ====== Non-speaking NPC handling (data-driven bridges) ======
export function handleNonSpeakingNpc(npc: ModuleNPC, profile: SpeechProfile, introShown = false): void {
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();
  const pcImpression = buildPcImpression(npc);
  if (profile.type === "none") {
    if (!introShown) say(`\n就在你们面前，${pcImpression}——似乎无法与你们正常交流。`);
  } else if (profile.type === "brainwave") {
    if (!introShown) say(`\n${pcImpression}`);
    say(brainwaveFlavor(npc, name));
  }
}

/** Shared brainwave flavor — uses NPC data for specific descriptions */
export function brainwaveFlavor(npc: ModuleNPC, displayName: string): string {
  const traits = npc.personality.traits ?? [];
  const hasBabyMind = traits.includes("婴儿心智");
  const hasMaternal = traits.some(t => t.includes("母亲") || t.includes("母爱"));
  const desc = npc.description;

  if (hasBabyMind) {
    // Baby-like brain — cries and coos
    const cries = ["啼哭", "哭", "呜咽"];
    const isCrying = desc ? cries.some(c => desc.includes(c)) : false;
    if (isCrying) {
      const moods = [
        `${displayName}的脑波带着婴儿般的急促啼哭——不安、害怕，在陌生的环境中寻找母亲的声音`,
        `${displayName}发出呜呜的脑波啼哭，像是在呼唤什么人`,
        `${displayName}的脑波时强时弱，带着婴儿特有的委屈和不安`,
      ];
      return moods[Math.floor(Math.random() * moods.length)];
    }
    const coos = [
      `${displayName}的脑波平静下来，发出咯咯般的愉快波动——像是在笑`,
      `${displayName}传来安宁的脑波，节奏平稳，仿佛正在安睡`,
      `${displayName}的脑波轻轻荡漾，像婴儿被母亲抱在怀里时满足的哼唧`,
    ];
    return coos[Math.floor(Math.random() * coos.length)];
  }

  if (hasMaternal) {
    const moods = [
      `${displayName}的脑波带着母性的温柔——温暖、包容，像在轻轻拥抱你的意识`,
      `${displayName}传来一阵关切的情绪波动——仿佛在问你们是否安好`,
      `${displayName}的脑波柔和而平缓，带着一种深沉的善意`,
    ];
    return moods[Math.floor(Math.random() * moods.length)];
  }

  // Generic brainwave NPC
  const generic = [
    `${displayName}的脑波在空间中轻轻回荡——像是无声的呼吸`,
    `${displayName}的脑波节奏变化——似乎感知到了你们的到来`,
    `${displayName}的情绪波动传入你们的意识——安宁中带着一丝好奇`,
  ];
  return generic[Math.floor(Math.random() * generic.length)];
}

// ====== Data-driven NPC dialogue generation ======
// Builds dialogue from NPC data fields (traits, role, age, speech description)
// instead of switching on a hardcoded speech profile type.
// "模组情况" — the module data drives the dialogue.

/** Normalize role for prose — converts "/" to "、" */
function roleContext(role: string): string {
  const c = role.includes("——") ? role.split("——").pop()!.trim() : role;
  return c.replace(/\s*\/\s*/g, "、");
}
/** Extract short role label */
function roleShort(role: string): string {
  return role.includes("——") ? role.split("——")[0].trim() : role;
}

/** Data-driven identity/opening line — reads from NPC's actual module data */
function buildIdentityLine(npc: ModuleNPC, rel: number, profile?: SpeechProfile): string {
  if (rel < 0) return "";
  // Unconscious/mumbling NPCs: no opening line — they can't introduce themselves
  const speechText = npc.personality.speech || "";
  if (/喃喃|昏迷|含糊|意识不清/.test(speechText)) return "";
  const role = npc.role || "";
  const ctx = roleContext(role);
  const s = analyseNpcData(npc);

  // Mental-voice: disembodied entity, no "这里的" — simple identity
  if (profile?.type === "mental_voice") {
    return ctx ? `我是${ctx}。` : "";
  }

  if (s.isChild && ctx) return pick([
    `我是这里的${ctx}，你们有什么事呀？`,
    `我、我是${ctx}，你们是来找我玩的吗？`,
    `我是${ctx}！你们好呀！`,
  ]);
  if (s.isAnxious) return ctx ? pick([
    `求求你了……我真的不知道该怎么办了……`,
    `我、我没办法了……请你们一定要帮帮我……`,
    `我真的走投无路了……求求你们了……`,
  ]) : pick([
    `我、我真的不知道该怎么办了……`,
    `求求你们……请一定要帮帮我……`,
  ]);
  if (s.isShy && ctx) return pick([
    `我、我是${ctx}……你们有什么事吗？`,
    `那个……我是这里的${ctx}……请问你们是？`,
    `我、我叫${ctx}……你们好……`,
  ]);
  if (s.isGentle) return ctx ? pick([
    `我是这里的${ctx}，有什么需要尽管说。`,
    `你们好，我是${ctx}，不着急，慢慢说。`,
    `我是${ctx}，能帮上忙的我会尽力。`,
  ]) : pick([
    `有什么需要尽管说。`,
    `别着急，慢慢说。`,
  ]);
  if (s.isOfficial) return ctx ? pick([
    `我是${ctx}，请配合我的工作。`,
    `我是${ctx}，有什么事请讲。`,
    `我就是${ctx}，你们有什么需要？`,
  ]) : pick([
    `请配合我的工作。`,
    `我是这里的负责人，有什么事请讲。`,
  ]);
  if (s.isTalkative) return ctx ? pick([
    `嘿嘿，我这个${ctx}可是知道不少事的！`,
    `哟，来新人了！我这${ctx}在镇子上住了几十年，什么都清楚！`,
    `你们可算找对人啦！我是${ctx}，这镇上的事没有我不知道的！`,
  ]) : pick([
    `嘿嘿，我可是知道不少事的！`,
    `你们来得正好！我知道些你们感兴趣的事。`,
  ]);
  if (s.isCautious) return ctx ? pick([
    `我就是个${ctx}，你们想问什么？`,
    `我是${ctx}……你们是什么人？`,
    `我就是这里的${ctx}，有什么事直说吧。`,
  ]) : pick([
    `我就是个这里的人，你们想问什么？`,
    `我是这儿的，你们是外地来的？`,
  ]);
  if (s.isRough || s.isLazy) return ""; // don't introduce
  return ctx ? pick([
    `我是${ctx}，你们好。`,
    `你好，我是${ctx}。`,
    `我就是${ctx}，请多关照。`,
  ]) : pick([
    `你们好。`,
    `你好。`,
  ]);
}

/** Data-driven dialogue per relationship level — uses NPC traits, not speech type label */
function buildDialogueForRel(npc: ModuleNPC, relLevel: string): string[] {
  const s = analyseNpcData(npc);
  const role = npc.role || "";
  const rShort = roleShort(role);
  const rAware = rShort.length > 0 && rShort.length < 12;

  switch (relLevel) {
    case "hostile":
      if (s.isChild) return [pick([
        "呜……不要过来……！",
        "哇——！走开、走开！",
        "（躲到树后）坏人……不要过来……",
      ])];
      if (s.isRough) return [pick([
        "滚、滚开！别过来！",
        "你他妈耳朵聋了？我说了滚！",
        "（捏紧拳头）再走近一步试试看。",
      ])];
      if (s.isOfficial) return [pick([
        `我${rAware ? `这个${rShort}可` : ""}没空跟你们纠缠。请离开。`,
        `我现在警告你们——${rAware ? `${rShort}的耐心是有限的。` : "我的耐心是有限的。"}`,
        `到此为止了。${rAware ? `作为${rShort}，` : ""}我再说一遍——离开这里。`,
      ])];
      if (s.isCautious) return [pick([
        "别烦我。",
        "（冷冷地盯着你们）走开。",
        "我说了不想惹麻烦——别逼我。",
      ])];
      if (s.isAnxious) return [pick([
        `我${rAware ? `只是个${rShort}` : ""}……真的不想说这些……请走……`,
        `你、你别问我了……我真的什么都不知道……求你了……`,
        `我什么都不知道……请、请离开……`,
      ])];
      if (s.isGentle) return [pick([
        `对、对不起……我现在${rAware ? `作为${rShort}` : ""}真的不能和你们说话……`,
        `我、我很抱歉……但请你们先离开好吗？我现在真的……`,
        `请理解……我真的不想给任何人添麻烦……请走吧……`,
      ])];
      if (s.isTalkative) return [pick([
        "嘿，现在不是聊天的时候，没看到我正忙着吗？",
        "啧，你们来得真不是时候。我现在可没心情聊天。",
        "改天吧。今天不是说话的日子。",
      ])];
      return [pick([
        "别来烦我。",
        "我跟你们没什么好说的。",
        "请你们离开。",
      ])];
    case "cold":
      if (s.isCautious) return [pick([
        `嗯。${rAware ? `我这${rShort}还有事，` : ""}快点说。`,
        `（打量了你们一眼）什么事？我忙着呢。`,
        `我不喜欢浪费时间。说重点。`,
      ])];
      if (s.isRough) return [pick([
        "你想干嘛？我警告你，我不好惹。",
        "喂，瞅啥呢？有话快说有屁快放。",
        "（上下打量）我看着像是有空跟你们闲聊的人？",
      ])];
      if (s.isChild) return [pick([
        "……",
        "（怯生生地看了一眼，又把头缩了回去）",
      ])];
      if (s.isOfficial) return [pick([
        `有什么事？我${rAware ? `是${rShort}` : "是公职人员"}，长话短说。`,
        `请说明来意。${rAware ? `我这个${rShort}每天都很忙。` : ""}`,
        `我是${rAware ? rShort : "这里的负责人"}。有什么事？`,
      ])];
      if (s.isAnxious) return [pick([
        "我、我现在有点忙……你是？",
        "那个……请问你们是……？我现在不太方便……",
        "你们找我有事吗？我、我今天状态不太好……",
      ])];
      if (s.isTalkative) return [pick([
        "哟，新面孔啊。不过我现在没空闲聊。",
        "嘿嘿，你们来得不是时候——我今天有点事。改天吧。",
        "哦，你们啊。今天我心情一般，长话短说。",
      ])];
      return [pick([
        "我跟你不熟。",
        "我们认识吗？",
        "有什么事？我们好像不熟吧。",
      ])];
    case "neutral":
      if (s.isChild) return [pick([
        "……你们是谁？",
        "你、你们是什么人呀？",
        "你们好呀……有什么事吗？",
      ])];
      if (s.isCautious) return [pick([
        "你是？……什么事？",
        "（上下打量了一番）你们找谁？",
        "嗯？有什么事吗？",
      ])];
      if (s.isOfficial) return [pick([
        `你好，${rAware ? `我是${rShort}。` : ""}请说明来意。`,
        `我是${rAware ? rShort : "这里的"}，你们有什么事要办？`,
        `你好。这里不是闲逛的地方，有什么事吗？`,
      ])];
      if (s.isAnxious) return [pick([
        "你、你好……求、求求你们……请一定要帮帮我……",
        "请、请问你们是……太好了，终于有人来了……",
        "你、你们好……我……我有事想拜托你们……",
      ])];
      if (s.isRough) return [pick([
        `喂，干什么的？${rAware ? `我这儿${rShort}不欢迎闲人。` : ""}`,
        `嗯？你们是干什么的？这可不是随便进的地方。`,
        `（叼着烟）找谁？没事别乱晃。`,
      ])];
      if (s.isGentle) return [pick([
        `你好。${rAware ? `我是这儿的${rShort}，` : ""}慢慢来，不用着急。`,
        `欢迎你们。${rAware ? `我是${rShort}，` : ""}有什么可以帮到你们的吗？`,
        `你们好啊。别紧张，有什么事坐下慢慢说。`,
      ])];
      if (s.isTalkative) return [pick([
        "你好你好！来来来，坐下说！",
        "哟，来客人了！快请进快请进！",
        "嘿！生面孔啊！来来来，有什么事跟我说！",
      ])];
      return [pick([
        "你好。",
        "你们好，有什么事吗？",
        "请问你们是……？",
      ])];
    case "friendly":
      if (s.isAnxious) return [pick([
        "啊，你们来了！太好了！我一直在这里等你们……",
        "谢天谢地你们来了！快、快请进！",
        "你们终于来了！我等了好久好久……",
      ])];
      if (s.isGentle) return [pick([
        `欢迎，欢迎。${rAware ? `我是这儿的${rShort}，` : ""}慢慢来，不用着急。`,
        `啊，是你们啊。快请坐。${rAware ? `我${rShort}正想着你们可能会来呢。` : ""}`,
        `又见面了。来，别站着说话，坐下聊。`,
      ])];
      if (s.isCautious) return [pick([
        "又来了？行，问吧。",
        "哦，是你们啊。这次想打听什么？",
        "（点了点头）又是你们。说吧，什么事。",
      ])];
      if (s.isTalkative) return [pick([
        `嘿！又见面了！${rAware ? `我这个${rShort}可是知道些事情的。` : ""}来来来，我跟你说点有意思的。`,
        `哦！你们又来了！正好正好，我刚好听说了件事！`,
        `哈哈，我就猜你们还会来找我！来，我跟你们说道说道。`,
      ])];
      if (s.isOfficial) return [pick([
        `又见面了。${rAware ? `作为${rShort}，` : ""}这次有什么需要？`,
        `哦，是你们。进来吧。${rAware ? `我${rShort}正好有点线索要告诉你们。` : ""}`,
        `你们又来了。行，这次又查到什么了？`,
      ])];
      if (s.isRough) return [pick([
        "哦，又是你们啊……行吧，有啥事？",
        "啧，你们还没放弃呢？行行行，想问什么快问。",
        "哼，又是你们。进来吧，别杵在门口。",
      ])];
      if (s.isChild) return [pick([
        "你们好呀……又见面啦！",
        "（抱着皮球，好奇地看着你们）你们又来啦！",
        "大哥哥！你们是来找我的吗？",
      ])];
      return [pick([
        "你们好，又见面了。",
        "哦，是你们啊。请进请进。",
        "又来了？欢迎欢迎。",
      ])];
    case "warm":
      if (s.isGentle) return [pick([
        `啊，亲爱的朋友们。能再见到你们真是太好了。来，坐下慢慢说${rAware ? `，我这${rShort}慢慢讲给你们听` : ""}。`,
        `你们来了。我一直等着你们呢。来，我沏了茶，边喝边聊。`,
        `太好了，又见到你们了。来，别客气，坐下说话。`,
      ])];
      if (s.isTalkative) return [pick([
        `哈哈，我就知道你们还会来找我的！来来来，${rAware ? `我这${rShort}正好有件事要告诉你们` : "我正好有件事要告诉你们"}！`,
        `我正想着你们呢你们就来了！来来来，快坐下！我跟你们说个大消息！`,
        `嘿！我就说你们会来的！我这两天打听到了不少新东西！`,
      ])];
      if (s.isAnxious) return [pick([
        "谢天谢地你们来了！我等了你们好久……快、快请进！",
        "你们可算来了！我等得都快急死了！快进来快进来！",
        "太好了……你们终于来了。我、我有新的情况要告诉你们！",
      ])];
      if (s.isCautious) return [pick([
        `来了？好。${rAware ? `我这${rShort}这边说。` : "坐。"}要说什么？`,
        `你们来了啊。我正好有些话想跟你们说。这边来。`,
        `嗯，进来吧。注意点，隔墙有耳。`,
      ])];
      if (s.isChild) return [pick([
        "（开心地跑过来）大哥哥你们又来啦！",
        "大哥哥！我等了你们好久好久呀！",
        "嘻嘻，我就知道你们还会来的！",
      ])];
      return [pick([
        "欢迎回来，我的朋友。",
        "你们终于回来了，我一直在等你们。",
        "又见面了，真好。快请进。",
      ])];
    default:
      return [pick([
        "你好。",
        "有什么事吗？",
        "你好，我是这里的人。",
      ])];
  }
}

/** Data-driven follow-up — reads NPC data to generate contextually appropriate closing */
function buildFollowUp(npc: ModuleNPC, profile: SpeechProfile): string[] {
  if (profile.type === "coma_rapid") return [pick([
    "我……我不能说太多……他们……他们还在监视……",
    "太晚了……一切都太晚了……你们不该来这里……",
    "求求你……救救我的妻子……和女儿……",
  ])];
  const s = analyseNpcData(npc);
  // Mental-voice + maternal traits: NPC with a child concern
  if (profile.type === "mental_voice" && s.isMaternal) return [pick([
    "求求你……请帮我……救救我的女儿……",
    "我的孩子……她还那么小……求你们去救她……",
    "求求你们了……我怎么样都好……但一定要救她……",
  ])];
  if (profile.type === "mental_voice" && s.isChild) return [pick([
    "你……你能听到我吗？",
    "我在这里……好黑……你能帮帮我吗？",
  ])];
  if (s.isAnxious) return [pick([
    "求求你们了，请一定要帮我找到他……",
    "拜托了……我真的不知道还能找谁了……",
    "我什么条件都可以答应……只求你们帮我这一次……",
  ])];
  if (s.isChild) return [pick([
    "我慢慢讲给你听……我记性可好了！",
    "你们还想知道什么呀？我知道的可多了！",
    "嘻嘻，我告诉你们一个秘密好不好？",
  ])];
  if (s.isCautious) return [pick([
    "……还有事？",
    "该说的我都说了。你们自己小心点。",
    "我劝你们别管太多。有些事知道了反而不好。",
  ])];
  if (s.isGentle) return [pick([
    "你想了解些什么呢？我慢慢讲给你听。",
    "别着急，你想问什么我都告诉你。",
    "有什么问题尽管问，我知道的都会跟你说。",
  ])];
  if (s.isOfficial) return [pick([
    "请在规定范围内提问。",
    "有新的进展我会通知你们的。",
    "还有什么需要协助的？",
  ])];
  if (s.isRough) return [pick([
    "啧，问吧问吧，快点啊。",
    "行行行，想问什么赶紧问。别耽误我时间。",
    "问完了吗？没事我走了。",
  ])];
  if (s.isTalkative) return [pick([
    "我跟你说啊，这事情可复杂了！你问对人了！",
    "这还不算完呢！你要是想知道更多，我还能跟你说一大堆！",
    "嘿嘿，你要问别的我也知道！在这镇子上没有我不清楚的！",
  ])];
  if (s.isLazy) return [pick([
    "唔……你想问啥……",
    "啊——好麻烦……不过你说吧，我听着。",
    "行行行……你问吧……快点就行……",
  ])];
  return [pick([
    "你想问什么？",
    "还有什么我能帮你们的？",
    "有什么问题尽管说吧。",
  ])];
}

/**
 * Data-driven tone bridge — uses NPC speech description to build action narration.
 *
 * ⚠ 下面这段说明原先躺在 `src/play/npc-text.ts` 里、挂在完全不相关的函数上
 * （本轮订正，见 docs/notes/engine.md）。挪过来是因为它描述的正是这个函数：
 *
 * 数据驱动（按 NPC 特质分派"接着说"类引导），避免"裸引号/名字：内容"机械
 * 直出。每个桶只有三四条、又是纯随机，一局里同一句必然撞好几次 ——
 * 实跑中菲碧连着两次"垂下眼帘，声音低沉下来："。generic 兜底桶（见下方
 * 最后一个 `return pick(...)`）另外扩了容：不匹配任何人格的角色
 * （缸中脑、Mi-Go）全都落在这里，原先三条让一个濒死的人和一个外星生物
 * 共用了同一句"想了想，开口道："。
 */
export function buildToneBridge(npc: ModuleNPC, profile: SpeechProfile): string {
  const s = analyseNpcData(npc);
  const speech = npc.personality.speech || "";
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();
  if (profile.type === "mental_voice") return mentalVoiceBridge(profile, name, "：");
  if (profile.type === "coma_rapid") return "昏迷中眉头紧锁，含糊地吐出几个词：";
  if (profile.type === "brainwave") return "";
  // Unconscious/mumbling NPCs
  if (/喃喃|昏迷|含糊|意识不清/.test(speech)) return "昏迷中眉头紧锁，含糊地吐出几个词：";
  if (s.isAnxious) return pick([
    "神色焦虑，语速很快地开口说道：",
    "焦虑不安地搓着手，急切地说：",
    "眼眶微红，声音带着明显的焦虑：",
    "指间夹着烟，声音发颤地说：",
  ]);
  if (s.isCautious) return pick([
    "简短地应了一声，说道：",
    "警惕地打量了你们一番，说：",
    "微微皱眉，语气低沉地说：",
  ]);
  if (s.isChild) return pick([
    "眨巴着大眼睛，好奇地打量着你们：",
    "歪着小脑袋，用稚嫩的声音说：",
    "双手背在身后，仰起头奶声奶气地说：",
    "怯生生地看着你们，小声地说：",
    "凑近了半步，睁大眼睛天真的说：",
  ]);
  if (s.isGentle) return pick([
    "温和地笑了笑，不紧不慢地说：",
    "语气温和，面带微笑地说：",
    "声音轻柔，耐心地开口说道：",
  ]);
  if (s.isOfficial) return pick([
    "站姿笔直，用官方口吻说道：",
    "面无表情，公事公办地说：",
    "背着手，语气平淡地说：",
  ]);
  if (s.isRough) return pick([
    "粗声粗气地说：",
    "叼着烟，满不在乎地说：",
    "不耐烦地咂了咂嘴，说道：",
  ]);
  if (s.isTalkative) return pick([
    "眼睛一亮，兴致勃勃地说：",
    "凑近了一步，压低声音兴致盎然地说：",
    "咧嘴一笑，话匣子一下就打开了：",
  ]);
  // generic 兜底：speech 描述无任何可识别特征时，用中性引导，避免硬套"说"与
  // "没有声音/无法言语"等描述矛盾（如 Mi-Go 心灵感应场景）
  return pick([
    "目光落在你们身上：",
    "将视线转向你们：",
    "微微侧过头，看向你们：",
  ]);
}

/**
 * Data-driven knowledge reveal — bridges from NPC data, not hardcoded by type
 *
 * 拿 `dedup` 而不是拿一个 `nextBridge` 回调：
 * 早先这里确实是回调注入，因为引导桥要读写 `lastRevealBridge`，
 * 而那个变量还埋在 runModuleInner 的闭包里够不到。
 * 去重状态收进 `Dedup` 之后，这里直接调 `nextRevealBridge` 即可。
 */
export function revealNpcKnowledge(
  npc: ModuleNPC,
  w: WorldState,
  dedup: Dedup,
  profile?: SpeechProfile,
): void {
  /** 检查 reveal 是否满足可见条件 */
  function canReveal(idx: number): boolean {
    const conditions = npc.llmExpanded?.revealConditions ?? [];
    const cond = conditions.find(c => c.index === idx);
    if (!cond) return true; // 无条件 = 可见
    if (cond.requiresClue?.some(cid => !w.isClueFound(cid))) return false;
    if (cond.blocksClue?.some(cid => w.isClueFound(cid))) return false;
    return true;
  }

  // LLM 预生成扩展优先
  if (npc.llmExpanded?.knowledgeReveals) {
    const reveals = npc.llmExpanded.knowledgeReveals
      .map((text, ki) => ({ text, ki }))
      .filter(({ ki }) => !w.isClueFound(`clue_kn_${npc.id}_${ki}`))
      .filter(({ ki }) => canReveal(ki))
      .map(({ text }) => text);
    if (reveals.length === 0) return;
    // Only show 1 reveal initially; follow-up questions reveal the rest naturally
    const text = reveals[0];
    const ki = npc.llmExpanded.knowledgeReveals.indexOf(text);
    // LLM 台词可能自带首尾引号（“…”/‘…’/""），若已带引号则不再整体包裹，避免双重引号
    // 引导桥已经用叙述句交代了神态（"眨巴着眼睛说："），台词开头若再来一个
    // 括号神态就是同一件事说两遍 —— 切掉括号那份，留引导桥。
    const clean = splitLeadingStageDirection(
      stripOuterQuotes(text),
      npc.name.replace(/[（(].*[）)]$/, "").trim(),
    ).speech;
    // 知识揭示用数据驱动引导桥，避免"裸引号知识条目"直出（不像人话）
    const s = analyseNpcData(npc);
    say(`\n${nextRevealBridge(dedup, npc, s, true)}"${clean}"`);
    noteEntityMentions(clean, w);
    w.discoverClue(`clue_kn_${npc.id}_${ki}`);
    return;
  }

  if (npc.knowledge.length === 0) return;
  const revealed = npc.knowledge.filter((_k, ki) =>
    !w.isClueFound(`clue_kn_${npc.id}_${ki}`)
  );
  if (revealed.length === 0) return;
  const s = profile ? analyseNpcData(npc) : null;
  // Only show 1 knowledge initially; follow-up questions reveal the rest
  for (let i = 0; i < Math.min(1, revealed.length); i++) {
    const hint = revealed[i];
    const hintIndex = npc.knowledge.indexOf(hint);
    // Data-driven bridges — use mumbling frame for unconscious NPCs
    say(`\n${nextRevealBridge(dedup, npc, s, i === 0)}"${hint}"`);
    noteEntityMentions(hint, w);
    w.discoverClue(`clue_kn_${npc.id}_${hintIndex}`);
  }
}

export function generateNpcDialogue(
  npc: ModuleNPC, npcState: NPCInstanceState,
  profile: SpeechProfile, _w: WorldState,
  isRevisit?: boolean
): string {
  // LLM 预生成文本优先
  if (npc.llmExpanded) {
    return isRevisit
      ? (npc.llmExpanded.revisitEncounter ?? npc.llmExpanded.firstEncounter)
      : npc.llmExpanded.firstEncounter;
  }

  const s = analyseNpcData(npc);
  const rel = npcState.relationship;
  const lines: string[] = [];

  // Unconscious/mumbling NPCs: no conscious dialogue
  const speechText = npc.personality.speech || "";
  if (/喃喃|昏迷|含糊|意识不清/.test(speechText)) return "";

  // Layer 1: Relationship-based opening (data-driven from NPC traits)
  // Only ONE layer is emitted — opening line OR identity line, never stacked,
  // so the quoted dialogue stays a single natural utterance.
  if (rel <= -3) {
    lines.push(...buildDialogueForRel(npc, "hostile"));
  } else if (rel <= -1) {
    lines.push(...buildDialogueForRel(npc, "cold"));
  } else if (rel <= 0) {
    lines.push(...buildDialogueForRel(npc, "neutral"));
  } else if (rel <= 3) {
    lines.push(...buildDialogueForRel(npc, "friendly"));
  } else {
    lines.push(...buildDialogueForRel(npc, "warm"));
  }

  // Layer 2 (only if opening is empty): NPC identity line
  if (lines.length === 0) {
    const identityLine = buildIdentityLine(npc, rel, profile);
    if (identityLine) lines.push(identityLine);
  }

  // Layer 3 (only if still empty): follow-up question
  if (lines.length === 0) {
    lines.push(...buildFollowUp(npc, profile));
  }

  // Age-based simplification (统计结果 — youngest NPCs get simpler language)
  if (s.isToddler) {
    return lines.join(" ")
      .replace(/(?<=[，。！？])/g, " ") // insert pauses after every punctuation
      .replace(/我的/g, "我的")
      .replace(/你们/g, "你们") // keep original — toddlers don't use 你们 much
      // Actually let's just return shorter first sentence for toddlers
      .split(/[。！？]/).slice(0, 1).join("") + "……";
  }

  return lines.join(" ");
}

// NOTE: getInvestigateFlavor / getFlavorAction were dead code —
// NPC flavor is now rendered inline in processScene() via
// generateNpcDialogue() + buildToneBridge() + handleNonSpeakingNpc().

