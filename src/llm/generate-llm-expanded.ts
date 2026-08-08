/**
 * NPC LLM预生成对话自动管线
 * ==========================
 *
 * 职责：为 ModuleData 中所有带 knowledge[] 的 NPC 自动生成 llmExpanded。
 * 使得模块读取后，NPC 对话内容立即可用，无需运行时模板拼凑。
 *
 * 工作模式（优先级）：
 *   1. 已有 llmExpanded → 跳过（尊重手动编写的黄金标准）
 *   2. LLMClient API 可用 → 通过 LLM 生成高质量对话
 *   3. 无 API → 降级到模板生成（基于 NPC personality.traits/speech/role 组装）
 *
 * 用法：
 *   import { applyLlmExpanded } from "./llm/generate-llm-expanded";
 *   applyLlmExpanded(moduleData);
 */

import type { ModuleNPC } from "../module/types";
import type { LLMClient } from "./client";
import { checkDialogueText } from "../world/world-constraint";
import { MYTHOS_CREATURES } from "../rules/mythos-expansion";

/** 模板生成的 llmExpanded 标记（区别于手写黄金标准，允许被 LLM 结果覆盖） */
const templateGenerated = new WeakSet<object>();

// ============================================================
// 降级模板 — 利用 NPC 人格特征组装自然对话
// ============================================================

/** 从 NPC 人格标签判断语气特征 */
function analyseNpc(npc: ModuleNPC): {
  isChild: boolean;
  isAnxious: boolean;
  isFormal: boolean;
  isWarm: boolean;
  isHostile: boolean;
  isRough: boolean;
  isSilent: boolean;
} {
  const traits = npc.personality.traits.map(t => t.toLowerCase());
  const speech = npc.personality.speech.toLowerCase();
  const attitude = npc.personality.attitude.toLowerCase();

  return {
    isChild: traits.some(t => /天真|幼|孩|child|naive/.test(t)) || /童言|幼/.test(speech),
    isAnxious: traits.some(t => /焦虑|不安|anxious|紧张/.test(t)) || /焦虑|急切|颤抖/.test(speech) || /焦虑/.test(attitude),
    isFormal: traits.some(t => /正式|公事|formal|official/.test(t)) || /公事|官方/.test(speech) || /冷漠|neutral/.test(attitude),
    isWarm: /友好|热心|合作|friendly|warm|cooperative/.test(attitude) || traits.some(t => /热心|友好/.test(t)),
    isHostile: /敌意|警惕|hostile|wary/.test(attitude) || traits.some(t => /敌意|警惕/.test(t)),
    isRough: traits.some(t => /粗鲁|粗|rough|暴躁/.test(t)) || /粗声|不耐烦/.test(speech),
    isSilent: /昏迷|瘫痪|无法|沉默|unconscious|paralyzed/.test(speech) || /无法.*交流/.test(speech),
  };
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** 根据 NPC 特征选择第一句语调桥 */
function pickToneBridge(npc: ModuleNPC): string {
  const traits = npc.personality.traits.map(t => t.toLowerCase());
  const speech = npc.personality.speech;
  const a = analyseNpc(npc);

  if (a.isSilent) return "";
  if (a.isChild) return pick(["奶声奶气地说：", "歪着头天真地说：", "眨巴着眼睛说："]);
  if (a.isAnxious) return pick(["声音发颤地说：", "急切地开口道：", "焦虑不安地说："]);
  if (a.isFormal) return pick(["面无表情地说：", "用公事公办的口吻说：", "语气平淡地说："]);
  if (a.isWarm) return pick(["温和地笑了笑说：", "友善地开口道：", "热情地说："]);
  if (a.isHostile) return pick(["警惕地打量着你们说：", "冷冷地说：", "语气不善地说："]);
  if (a.isRough) return pick(["粗声粗气地说：", "叼着烟含糊地说：", "不耐烦地咂了咂嘴说："]);
  if (/温和|温柔|gentle/.test(speech)) return pick(["温和地说：", "语气轻柔地说："]);
  return pick(["开口说道：", "点了点头说：", "看向你们说："]);
}

/** 根据 NPC 特征选择首次见面时对调查员的印象描述前缀 */
function pickImpression(npc: ModuleNPC): string {
  const traits = npc.personality.traits.map(t => t.toLowerCase());
  const speech = npc.personality.speech;
  const a = analyseNpc(npc);

  if (a.isSilent) return "";
  if (a.isChild) {
    const ages = nlpExtractAge(npc);
    return `${ages ?? ""}孩子`;
  }
  if (a.isAnxious) return pick(["神色焦虑，", "面带忧色，", "眉头紧锁，"]);
  if (a.isFormal) return pick(["表情严肃，", "态度公事公办，"]);
  if (a.isWarm) return pick(["面带微笑，", "态度友善，"]);
  if (a.isHostile) return pick(["神情戒备，", "面色不善，"]);
  if (a.isRough) return pick(["看起来不太好惹，"]);
  if (/温和|温柔|gentle/.test(speech)) return pick(["态度温和，"]);
  return "";
}

/** 尝试从 personality.traits 中提取年龄信息 */
function nlpExtractAge(npc: ModuleNPC): string {
  for (const t of npc.personality.traits) {
    const m = t.match(/(\d+)\s*岁/);
    if (m) return `${m[1]}岁、`;
  }
  return "";
}

/** 生成首次见面对话 */
function templateFirstEncounter(npc: ModuleNPC): string {
  const a = analyseNpc(npc);
  if (a.isSilent) return "";

  const impression = pickImpression(npc);
  const bridge = pickToneBridge(npc);
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();
  const knowledge = npc.knowledge;

  let line = "";
  if (a.isChild) {
    line = `你们……你们是来找${knowledge.length > 0 ? "人" : "我"}的吗？`;
  } else if (a.isAnxious) {
    // 焦虑者：承接调查员自报家门后的回应，案情细节留给后续 knowledgeReveals 自然说出
    line = knowledge.length > 0
      ? `你们总算来了……我一直盼着有人能来帮帮我。`
      : `你们总算来了……我等你们好久了。`;
  } else if (a.isFormal) {
    line = `你们好。我是${npc.role}${name}。请说明来意。`;
  } else if (a.isHostile) {
    line = `你们是什么人？来这里有什么事？`;
  } else if (a.isWarm) {
    line = `欢迎！快请进。有什么需要我帮忙的，尽管说。`;
  } else {
    line = `你们好。我就是${name}。听说你们在调查什么？`;
  }

  return `${impression}${name}${bridge}${line}`;
}

/** 生成线索揭示文本（把 NPC.knowledge 转为自然的引用形式） */
function templateKnowledgeReveals(npc: ModuleNPC): string[] {
  return npc.knowledge.map(k => {
    // 句子已自带标点时不再追加"。"，避免"。。"双句号；去掉尾部残句标点后补全
    const trimmed = k.replace(/[。！？…]+$/, "");
    return `${trimmed}。`;
  });
}

/** 生成再次返回对话 */
function templateRevisitEncounter(npc: ModuleNPC): string {
  const a = analyseNpc(npc);
  if (a.isSilent) return "";

  const bridge = pickToneBridge(npc);
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();

  if (a.isChild) {
    return `${name}抱着皮球，歪着头天真地说：\n……又是你们呀。你们找到哥哥了吗？`;
  }
  if (a.isAnxious) {
    return `${name}焦虑不安地搓着手说：\n你们回来了！怎么样？有消息吗？`;
  }
  if (a.isFormal) {
    return `${name}面无表情地说：\n又是你们。还有什么需要协助的吗？`;
  }
  if (a.isWarm) {
    return `${name}温和地说：\n你们回来了！快请坐。`;
  }
  if (a.isHostile) {
    return `${name}警惕地说：\n你们怎么又来了？`;
  }
  return `${name}${bridge}\n你们回来了。还有什么要问的吗？`;
}

// ============================================================
// API 生成路径（LLMClient 可用时调用，失败降级到模板）
// ============================================================

/** LLM 生成 llmExpanded 的 SYSTEM_PROMPT */
const SYSTEM_PROMPT = `你是《克苏鲁的呼唤 7e》模组剧本的 NPC 对话设计师。为给定 NPC 生成自然的中文对话数据，输出严格 JSON（不要 markdown 代码块）。

要求：
- firstEncounter: 调查员第一次见到 NPC 时，NPC 的开场白（含动作/神态描写，带引号或无引号均可，需符合人物性格与处境）；**1-3 句话，不超过 80 字**
- **NPC 已被告知来意**：生成 firstEncounter 时，假设调查员敲门后已经自报家门（表明身份与来意），NPC 的回应是承接这个前提的自然反应——不要写"你们是来干什么的？"这类再次询问来意的句子（除非 NPC 性格警惕/敌意）
- **不要写进屋/落座的过渡动作**（让进屋里、示意坐下、关门等场景过渡由引擎在私宅场景统一处理），firstEncounter 只写台词与神态，避免与引擎插入的过渡重复
- **不要跳进案情正题**：firstEncounter 只做"迎接/寒暄/表露情绪"，具体案情（孩子失踪、凶案等）留给 knowledgeReveals 由 NPC 自然说出，不要在开场白里一口气倒出全部案情
- knowledgeReveals: 数组，每条对应一条 NPC.knowledge 素材。**用叙述性交代自然带出信息**：以动作/神态括号开头（如"（她低下头，声音发抖）加比那孩子……"）或转述口吻（"她断断续续地告诉你们……"），把素材信息揉进叙述里；**不要逐条直述成"念设定"的台词**（"加比比较叛逆，喜欢出去玩，十五岁就搬出去了"这类干巴巴复述禁止）。每条 1-2 句话，不超过 60 字
- **动作括号只允许情绪/神态/语气/视线类**（如（她垂下眼帘）、（声音发颤）、（目光躲闪））；**禁止依赖场景道具的肢体动作**（从抽屉/柜子/口袋取物、坐下、绞桌布、翻文件、倒茶、递东西、拍桌子）——预生成时无法预知调查员所处阶段（可能在门口、路上、屋内），此类动作会造成叙述穿越
- revisitEncounter: 调查员再次到访时 NPC 的回应（可省略，缺省用 firstEncounter）；**1-2 句话，不超过 50 字**
- 全部用简体中文，符合 1920 年代风格；**台词要简短克制，像真人交谈，不要长篇大论**
- **情绪优先于职业身份**：NPC 当前处境中「情感状态」（如对失踪亲人的焦虑、悲伤、恐惧、慌乱）必须主导台词；职业身份（银行职员/警员等）只是背景装点，绝不能把情绪化的人物演成冷静客套、公事公办的谈判对象。例如焦虑的母亲开口应该是急切、坐立难安、恳求式的，而不是"我的时间很宝贵"这类职场口吻
- **禁止职业事务台词**：台词中不得提及工作安排/职业事务（如"我只有十分钟，之后还要去处理账目""还有会议要开""得回去上班"）——深陷情绪处境的人不会在求助交谈时谈这些
- **禁止编造其他 NPC 的即时行为**：firstEncounter 不得提及同场景其他 NPC 正在做/刚做过的事（如"米尔已经带路""刚才XX说的"）——其他 NPC 是否在场、做了什么，只以开场氛围与场景描述为准，不得编造超出其范围的互动

JSON 结构：
{"firstEncounter": string, "knowledgeReveals": string[], "revisitEncounter"?: string}`;

/** 组装单条 NPC 的 LLM prompt */
function buildApiPrompt(npc: ModuleNPC, scenes?: Array<{ id: string; name: string; description: string; openingAtmosphere?: string }>): string {
  const lines: string[] = [];
  lines.push(`NPC 名: ${npc.name}`);
  lines.push(`身份/角色: ${npc.role}`);
  lines.push(`性格标签: ${(npc.personality.traits ?? []).join("、")}`);
  lines.push(`说话风格: ${npc.personality.speech}`);
  lines.push(`态度: ${npc.personality.attitude}`);
  // 神话生物外观注入：NPC 是神话生物时注入设定外观，防止 LLM 凭场景氛围/流行印象自由发挥
  const creature = MYTHOS_CREATURES.find(c =>
    npc.id.toLowerCase().includes(c.id.toLowerCase()) || npc.name.includes(c.name)
  );
  if (creature) {
    lines.push(`外貌设定(必须严格遵守，禁止写成机械/金属): ${creature.description}`);
  }
  // 场景原文注入：NPC 所在场景的名称与描述，台词须与场景一致，禁止凭想象改写
  const homeScene = scenes?.find(s => s.id === npc.sceneId);
  if (homeScene) {
    lines.push(`所在场景: ${homeScene.name}`);
    lines.push(`场景描述(原文): ${homeScene.description}`);
    // 开场氛围注入：NPC 首见时的场景状态（如"孩子在院里拍球，看到你们后跑回屋内"）。
    // firstEncounter 的动作/神态必须与此一致，禁止编造与开场氛围矛盾的状态。
    if (homeScene.openingAtmosphere) {
      lines.push(`开场氛围(原文): ${homeScene.openingAtmosphere}`);
      lines.push(`（firstEncounter 须承接开场氛围：氛围里已发生的事不要重复演一遍，氛围里 NPC 已进屋就不要写她在屋外玩耍）`);
      lines.push(`（其他 NPC 状态（硬性）：开场氛围中出现的其他人物与调查员没有任何交谈——他们看到调查员后跑回屋内/继续做事即可，没有说过话、没有带过路、没有介绍过任何人。firstEncounter 中一律不得提及他们的言语、行为或与调查员/本 NPC 的互动，只允许当前 NPC 说话）`);
    }
  }
  if (npc.secrets?.length) lines.push(`隐藏秘密: ${npc.secrets.join("；")}`);
  lines.push(`已知信息(knowledge):`);
  npc.knowledge.forEach((k, i) => lines.push(`  ${i + 1}. ${k}`));
  return lines.join("\n");
}

/**
 * 用 LLM 生成单条 NPC 的 llmExpanded。
 * 返回生成的扩展数据；LLM 失败/解析失败返回 null（由调用方降级到模板）。
 */
async function generateViaAPI(
  npc: ModuleNPC,
  client: LLMClient,
  scenes?: Array<{ id: string; name: string; description: string; openingAtmosphere?: string }>,
): Promise<NonNullable<ModuleNPC["llmExpanded"]> | null> {
  const prompt = buildApiPrompt(npc, scenes);
  let raw: string;
  try {
    raw = await client.chat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      { jsonMode: true, timeout: 120000 },
    );
  } catch {
    return null; // LLM 不可用/超时 → 降级模板
  }

  try {
    const data = JSON.parse(raw);
    const firstEncounter = typeof data.firstEncounter === "string" ? data.firstEncounter : "";
    const knowledgeReveals = Array.isArray(data.knowledgeReveals)
      ? data.knowledgeReveals.filter((k: unknown): k is string => typeof k === "string")
      : [];
    if (!firstEncounter || knowledgeReveals.length === 0) return null; // 结构不完整 → 降级

    // 世界模型约束：LLM 生成的对话文本不得含时代科技/ meta 词汇，命中 → 降级模板（模板无违规词）
    const textsToCheck = [firstEncounter, ...knowledgeReveals];
    if (typeof data.revisitEncounter === "string") textsToCheck.push(data.revisitEncounter);
    if (textsToCheck.some(t => checkDialogueText(t))) return null;

    const expanded: NonNullable<ModuleNPC["llmExpanded"]> = {
      firstEncounter,
      knowledgeReveals,
    };
    if (typeof data.revisitEncounter === "string" && data.revisitEncounter) {
      expanded.revisitEncounter = data.revisitEncounter;
    }
    return expanded;
  } catch {
    return null; // JSON 解析失败 → 降级模板
  }
}

/** 尝试 LLM 生成；失败时回退模板。返回 true = 使用了 LLM 结果。 */
export async function applyLlmExpandedWithLLM(
  npc: ModuleNPC,
  client: LLMClient,
  scenes?: Array<{ id: string; name: string; description: string; openingAtmosphere?: string }>,
): Promise<boolean> {
  // 手写黄金标准 → 绝不覆盖
  if (npc.llmExpanded && !templateGenerated.has(npc.llmExpanded)) return false;
  // 没有 knowledge → 无需生成
  if (!npc.knowledge || npc.knowledge.length === 0) return false;

  const apiResult = await generateViaAPI(npc, client, scenes);
  if (apiResult) {
    npc.llmExpanded = apiResult;
    return true;
  }
  // 降级模板（已有模板生成的 llmExpanded 时保持不变）
  if (!npc.llmExpanded) applyLlmExpanded(npc);
  return false;
}

/**
 * 批量尝试 LLM 生成（逐个失败降级模板）。
 * 并发执行：每个 NPC 的生成相互独立（各自解析/校验/降级），
 * 使用有界工作池（默认 4 并发）避免一次性打爆 API 限流。
 * 熔断语义保持：首个连接失败置 _defeated 后，尚未发出的调用立即抛错 → 各自降级模板。
 */
export async function applyAllLlmExpandedWithLLM(
  npcs: ModuleNPC[],
  client: LLMClient,
  scenes?: Array<{ id: string; name: string; description: string; openingAtmosphere?: string }>,
  concurrency: number = 4,
): Promise<void> {
  const queue = [...npcs];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const npc = queue.shift()!;
      try {
        await applyLlmExpandedWithLLM(npc, client, scenes);
      } catch {
        // 单 NPC 生成失败（熔断/网络）→ 该 NPC 降级模板，不影响其他
      }
    }
  });
  await Promise.all(workers);
}

// ============================================================
// 管线入口
// ============================================================

/**
 * 为 ModuleData 中所有带 knowledge[] 但无 llmExpanded 的 NPC
 * 自动生成 llmExpanded 对话数据。
 *
 * 已有 llmExpanded（手动编写的黄金标准）不会被覆盖。
 */
export function applyLlmExpanded(npc: ModuleNPC): void {
  // 已有 llmExpanded → 跳过（手写黄金标准或已生成）
  if (npc.llmExpanded) {
    // 读取路径时代校验：手写黄金标准同样可能含跨时代内容（历史数据/人工编写时引入）。
    // 命中 → 只预警不覆盖（手写标准是模块数据，不在此层改动）；
    // 运行时输出兜底由 npc-dialogue-prompts.ts templateReply / narrator / agent 层负责。
    const revealHits = (npc.llmExpanded.knowledgeReveals ?? [])
      .filter((r) => checkDialogueText(r))
      .length;
    const firstHit = npc.llmExpanded.firstEncounter && checkDialogueText(npc.llmExpanded.firstEncounter);
    const revisitHit = npc.llmExpanded.revisitEncounter && checkDialogueText(npc.llmExpanded.revisitEncounter);
    if (revealHits > 0 || firstHit || revisitHit) {
      console.warn(
        `  ⚠ 模组数据 ${npc.name} 的 llmExpanded 含跨时代内容 ` +
        `(reveals=${revealHits}, first=${!!firstHit}, revisit=${!!revisitHit}) — 建议人工修订`,
      );
    }
    return;
  }
  // 没有 knowledge → 无需生成
  if (!npc.knowledge || npc.knowledge.length === 0) return;

  const expanded = {
    firstEncounter: templateFirstEncounter(npc),
    knowledgeReveals: templateKnowledgeReveals(npc),
    revisitEncounter: templateRevisitEncounter(npc),
  };
  templateGenerated.add(expanded);
  npc.llmExpanded = expanded;
}

/**
 * 批量处理整个模块的所有 NPC
 */
export function applyAllLlmExpanded(npcs: ModuleNPC[]): void {
  for (const npc of npcs) {
    applyLlmExpanded(npc);
  }
}
