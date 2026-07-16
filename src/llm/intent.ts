// 意图解析器 — LLM 驱动 + 硬编码 fallback
// LLM 可用时：自然语言 → 结构化 ActionIntent
// LLM 不可用时：退化为 regex 模式匹配

import type { ActionIntent } from "../types";
import type { LLMClient } from "./client";

// ============================================================
// 硬编码 fallback（regex 模式匹配）
// ============================================================

// 常见生物/怪物名（用于目标提取）
const TARGET_PATTERNS = ["狼", "野狼", "哥布林", "地精", "熊", "蛇", "蜘蛛", "骷髅", "僵尸", "怪物", "敌人", "守卫", "法师", "骑士", "盗贼"];

// 攻击动词检测
const ATTACK_VERBS = /(?:攻击|砍|刺|射|劈|斩|偷袭|潜行|暗杀|狙击)/;

/** 从输入中提取瞄准部位 */
function extractCalledShot(input: string): string | undefined {
  const parts = input.match(/瞄准\s*(头部|头|左腿|右腿|腿部|左臂|右臂|手臂|腹部|胸部|胸口|眼睛|武器|手|脚|脖子|颈部)/);
  if (!parts) return undefined;
  const raw = parts[1];
  const map: Record<string, string> = {
    "头": "头部", "头部": "头部", "胸口": "胸部", "胸部": "胸部", "腹部": "腹部", "腰部": "腹部",
    "左腿": "左腿", "右腿": "右腿", "腿部": "左腿",
    "左臂": "左臂", "右臂": "右臂", "手臂": "右臂",
    "眼睛": "眼睛", "手": "手", "脚": "脚",
    "脖子": "头部", "颈部": "头部", "武器": "武器",
  };
  return map[raw] || raw;
}

// 宽松模式：先检测动词，再扫目标
const INTENT_PATTERNS: Array<{ verb: RegExp; intent: Partial<ActionIntent>; requiresTarget?: boolean }> = [
  { verb: /(?:偷袭|潜行).*(?:攻击|砍|刺)/, intent: { action: "attack", method: "stealth" } },
  // CoC 瞄准/专注射击
  { verb: /(?:瞄准|狙击|专心|专注).*(?:射击|攻击|射)/, intent: { action: "attack", method: "aimed" } },
  // CoC 瞄准部位（叫射：瞄准头部/腿部/HAND等）
  { verb: /瞄准\s*(头部|头|左腿|右腿|腿部|左臂|右臂|手臂|腹部|胸部|胸口|眼睛|武器|手|脚|脖子|颈部)/, intent: { action: "attack", method: "aimed" } },
  // CoC 点射/三发
  { verb: /(?:点射|三发|burst)/, intent: { action: "attack", method: "burst" } },
  // CoC 压制/扫射/掩护射击
  { verb: /(?:压制|扫射|掩护)/, intent: { action: "attack", method: "suppress" } },
  { verb: ATTACK_VERBS, intent: { action: "attack", method: "melee" }, requiresTarget: false },
  { verb: /(?:移动|走|跑|前进|前往).*(?:到|向|往|去)/, intent: { action: "move" } },
  { verb: /^去\s*\S+/, intent: { action: "move" } }, // "去谷仓" 等简短指令
  { verb: /(?:使用|释放|施放|施展).*(?:法术|魔法|咒语)/, intent: { action: "cast" } },
  { verb: /(?:使用|用|装备).*(?:道具|物品|药水|绷带|急救包|武器)/, intent: { action: "use_item" } },
  { verb: /(?:捡起|捡|拾取|拿起|拿走)/, intent: { action: "pickup" } },
  { verb: /(?:急救|包扎|止血|医疗|治疗).*(?:伤口|伤势|出血|伤)/, intent: { action: "first_aid" } },
  { verb: /(?:和|跟|与|对).*(?:说话|交谈|对话|聊聊|询问|问)/, intent: { action: "talk" } },
  { verb: /(?:休息|休息一下|休整|休养|睡觉|睡眠|治疗|包扎)/, intent: { action: "rest" } },
  { verb: /(?:环顾|环视|环顾四周|看看四周|周围|看.*环境|看.*场景|扫视|扫了一眼)/, intent: { action: "look" } },
  { verb: /(?:潜行|躲藏|隐蔽|隐匿)/, intent: { action: "skill_check", skill: "stealth" } },
  { verb: /(?:侦查|观察|搜索|寻找|环顾)/, intent: { action: "skill_check", skill: "perception" } },
  { verb: /(?:说服|交涉|谈判|劝说|聊天|对话)/, intent: { action: "skill_check", skill: "persuasion" } },
  { verb: /(?:调查|检查|研究)/, intent: { action: "skill_check", skill: "investigation" } },
  // 传承系统（先于 read/状态等模式，避免"读档"被"读"拦截）
  { verb: /(?:传承|继承角色|保存角色|读档|存档|save|load|传承增益)/i, intent: { action: "legacy" } },
  // CoC 创建角色（先于含"角色"的状态模式匹配）
  { verb: /(?:创建角色|车卡|我要当|创建调查员|新角色)/, intent: { action: "create_character" } },
  // CoC 职业列表
  { verb: /(?:职业列表|有哪些职业|可选职业|职业.*有)/, intent: { action: "list_occupations" } },
  // CoC 技能分配
  { verb: /(?:分配技能|调整技能|技能分配|分配.*技能点|手动.*技能)/, intent: { action: "allocate_skills" } },
  { verb: /^阅读\s*\S+|读\s*\S+|翻阅\s*\S+/, intent: { action: "read" } },
  { verb: /(?:状态|属性|角色|角色卡|人物卡|人物信息|我的信息|我是谁)/, intent: { action: "status" } },
  // CoC 商店 — 先于 inventory/物品 模式（避免"物品"拦截"购买 X"）
  { verb: /(?:购买|买|购置|采购)\s*(.*)/, intent: { action: "buy" } },
  { verb: /(?:出售|卖|卖掉|卖出)\s*(.*)/, intent: { action: "sell" } },
  { verb: /(?:商店|购物|shop|buy|买)/, intent: { action: "shop" } },
  { verb: /(?:背包|物品|物品栏|道具|查看.*物品|我的.*东西|有什么.*东西)/, intent: { action: "inventory" } },
  { verb: /(?:逃跑|逃走|逃离|撤退|撤|逃)/, intent: { action: "flee" } },
  // 故事生成
  { verb: /(?:生成故事|生成场景|生成剧本|生成模组|故事生成|随机生成|生成世界|生成.*冒险|generate.*story|new.*story)/, intent: { action: "generate_story" } },
  // 帮助
  { verb: /(?:帮助|指南|操作|指令|命令|help|该做|做什么|可.*做|能干|可以.*什么)/, intent: { action: "help" } },
  { verb: /(?:剧本杀|加载模组|导入模组|载入模组|load.*module|模块)/, intent: { action: "load_module" } },
  { verb: /(?:查看模组|模组详情|模组预览|模组内容|模组大纲|module.*info|module.*detail)/, intent: { action: "view_module" } },
  { verb: /(?:疯狂指引|疯狂状态|疯狂描述|我的疯狂|疯癫|怎样演|怎么演|角色扮演指引)/, intent: { action: "insanity_guidance" } },
  { verb: /(?:理智|san|SAN|疯狂|恐惧|恐怖|害怕|惊吓)/, intent: { action: "san_check", sanCost: "1/1d6", reason: "恐惧侵袭" } },
  { verb: /(?:目睹|看见|见到).*(?:恐怖|恐怖景象|可怕|怪物|尸体)/, intent: { action: "san_check", sanCost: "1/1d6", reason: "目睹恐怖景象" } },
  // D&D 施法
  { verb: /(?:施放|施展|释放|使用|吟唱|念咒|施法).*(?:魔法飞弹|燃烧之手|霜冻射线|火球术|闪电束|灼热射线|魔法弹)/, intent: { action: "cast" } },
  { verb: /(?:施放|施展|释放|使用|吟唱|念咒|施法).*(?:治疗伤势|治愈|治疗|魔法飞弹|火球术)/, intent: { action: "cast" } },
  { verb: /(?:法术|魔法|咒语).*(?:攻击|打|杀|对付)/, intent: { action: "cast" } },
  { verb: /(?:法术|魔法).*(?:列表|展示|查看|有什么|有哪些|会用|可用)/, intent: { action: "spell_list" } },
  // D&D 豁免
  { verb: /(?:豁免|抵抗|对抗|硬抗|扛).*(?:毒素|毒|毒药|中毒)/, intent: { action: "saving_throw", ability: "constitution", reason: "对抗毒素" } },
  { verb: /(?:豁免|抵抗|对抗).*(?:法术|魔法|咒语|法系)/, intent: { action: "saving_throw", reason: "抵抗法术" } },
  { verb: /(?:躲|闪避|闪).*(?:陷阱|机关|滚石|箭雨|落石)/, intent: { action: "saving_throw", ability: "dexterity", reason: "躲避机关" } },
  { verb: /(?:豁免|抵抗|对抗).*(?:恐惧|威吓|惊吓|魅惑|魅惑)/, intent: { action: "saving_throw", ability: "wisdom", reason: "抵抗精神效果" } },
  { verb: /(?:体质豁免|CON豁免|con豁免)/i, intent: { action: "saving_throw", ability: "constitution" } },
  { verb: /(?:力量豁免|STR豁免|str豁免)/i, intent: { action: "saving_throw", ability: "strength" } },
  { verb: /(?:敏捷豁免|DEX豁免|dex豁免)/i, intent: { action: "saving_throw", ability: "dexterity" } },
  { verb: /(?:智力豁免|INT豁免|int豁免)/i, intent: { action: "saving_throw", ability: "intelligence" } },
  { verb: /(?:感知豁免|WIS豁免|wis豁免)/i, intent: { action: "saving_throw", ability: "wisdom" } },
  { verb: /(?:魅力豁免|CHA豁免|cha豁免)/i, intent: { action: "saving_throw", ability: "charisma" } },
  { verb: /(?:豁免).*(?:火焰|冰霜|闪电|雷电|酸性|光耀|暗蚀|雷鸣|寒冷)/, intent: { action: "saving_throw", reason: "抵抗元素伤害" } },
  // CoC 装填/上弹
  { verb: /(?:装填|上弹|装弹|重新.*装弹|换.*弹匣|装.*子弹)/, intent: { action: "reload" } },
  // CoC 推动检定
  { verb: /(?:推动|push|再试一次|再来|重试|重新.*投|重新.*检定)/, intent: { action: "push" } },
  // CoC 神话法术
  { verb: /(?:念咒|吟唱|召唤|呼唤|驱逐|放逐).*(?:米戈|克苏鲁|神话|咒语)/, intent: { action: "occult_cast" } },
  // CoC 追逐
  { verb: /(?:追逐|逃跑|跑|追|逃)/, intent: { action: "chase" } },
  // CoC 模组结算/技能成长
  { verb: /(?:模组结算|冒险结束|场景结算|结算技能|技能成长|成长骰)/, intent: { action: "skill_advancement" } },
  // 装备
  { verb: /(?:装备|穿戴|穿上|佩戴|携带)\s*(.+)/, intent: { action: "equip" } },
  // 卸下装备
  { verb: /(?:脱下|卸下|解除|拆下)\s*(.+)/, intent: { action: "unequip" } },
  // 模组加载
  { verb: /(?:加载|装载|载入|启用|使用)\s*(?:模组|剧本|模块)/, intent: { action: "load_module" } },
];

const WEAPON_PATTERNS: Array<{ pattern: RegExp; weapon: string }> = [
  { pattern: /短剑/, weapon: "shortsword" },
  { pattern: /长剑/, weapon: "longsword" },
  { pattern: /匕首/, weapon: "dagger" },
  { pattern: /长弓|弓/, weapon: "longbow" },
  { pattern: /剑/, weapon: "longsword" },
  { pattern: /法杖|杖/, weapon: "quarterstaff" },
  // CoC 武器
  { pattern: /左轮|\.38|手枪/, weapon: ".38左轮" },
  { pattern: /霰弹|霰弹枪|12号/, weapon: "12号霰弹枪" },
  { pattern: /拳头|徒手|肉搏/, weapon: "格斗(肉搏)" },
];

/** 从输入中提取目标名（返回匹配的第一个目标词） */
function extractTarget(input: string, action: string): string | undefined {
  for (const t of TARGET_PATTERNS) {
    if (input.includes(t)) return t;
  }
  // 攻击类：取动词后的文本做模糊目标
  if (action === "attack") {
    const match = input.match(/(?:攻击|砍|刺|射|劈|斩)\s*(.{1,6})$/);
    if (match && match[1].length >= 1) return match[1];
  }
  // 移动类：取"到/向/往/去"后面的内容
  if (action === "move") {
    const match = input.match(/(?:到|向|往|去)\s*(.{2,10})$/);
    if (match && match[1].length >= 1) return match[1].trim();
    // "去谷仓" → "谷仓"
    const match2 = input.match(/^去\s*(.{2,10})$/);
    if (match2 && match2[1].length >= 1) return match2[1].trim();
  }
  // 对话类：取"和/跟/与/对"和"说/问"之间的内容
  if (action === "talk") {
    const match = input.match(/(?:和|跟|与|对)\s*(.{2,6})\s*(?:说话|交谈|对话|聊聊|询问|问)/);
    if (match && match[1].length >= 1) return match[1].trim();
  }
  // 施法类：取法术名（动词后的内容）
  if (action === "cast") {
    const match = input.match(/(?:施放|施展|释放|使用|吟唱|念咒|施法)\s*(.{2,12})$/);
    if (match && match[1].length >= 1) return match[1].trim();
  }
  // 神话法术类：取动词后的法术名
  if (action === "occult_cast") {
    const match = input.match(/(?:念咒|吟唱|召唤|呼唤|驱逐|放逐)\s*(.{2,12})$/);
    if (match && match[1].length >= 1) return match[1].trim();
  }
  return undefined;
}

/** 从输入中提取燃运点数，返回 { luckSpend, remainingInput } */
function extractLuckSpend(input: string): { luckSpend: number; remaining: string } {
  // 模式: "燃运N" / "用N点幸运" / "消耗N幸运" / "luck N"
  const m = input.match(/(?:燃运|消耗幸运|用幸运)\s*(\d+)(?:点)?/);
  if (m) {
    const pts = parseInt(m[1]);
    const remaining = input.replace(m[0], "").trim();
    return { luckSpend: pts, remaining };
  }
  const m2 = input.match(/luck\s+(\d+)/i);
  if (m2) {
    const pts = parseInt(m2[1]);
    const remaining = input.replace(m2[0], "").trim();
    return { luckSpend: pts, remaining };
  }
  return { luckSpend: 0, remaining: input };
}

function parseIntentRegex(input: string): ActionIntent {
  // 先提取燃运，再用剩余文本匹配意图
  const luckExtract = extractLuckSpend(input);
  const effectiveInput = luckExtract.remaining || input;
  const luckSpend = luckExtract.luckSpend;
  for (const { verb, intent, requiresTarget } of INTENT_PATTERNS) {
    const verbMatch = effectiveInput.match(verb);
    if (!verbMatch) continue;
    // console.log(`  [parseIntentRegex] match: ${effectiveInput} → action=${intent.action}`);

    // 如果需要特定目标词但找不到，跳过这个模式（继续尝试下一个）
    if (requiresTarget && !TARGET_PATTERNS.some(t => effectiveInput.includes(t))) continue;

    const target = extractTarget(effectiveInput, intent.action || "");
    let weapon: string | undefined;
    for (const { pattern: wp, weapon: w } of WEAPON_PATTERNS) {
      if (wp.test(effectiveInput)) { weapon = w; break; }
    }

    // 对 cast / occult_cast 动作提取法术名（target 字段存法术名，同时设 spell 字段）
    let spell = (intent.action === "cast" || intent.action === "occult_cast") ? target : undefined;

    // 瞄准部位提取
    const calledShot = extractCalledShot(effectiveInput);

    return {
      action: intent.action || "unknown",
      target,
      spell,
      weapon,  // 仅在输入显式指定时设置；默认由战斗处理器根据角色职业决定
      method: intent.method,
      skill: intent.skill,
      ability: intent.ability,
      dc: intent.dc,
      reason: intent.reason,
      luckSpend: luckSpend || undefined,
      calledShot,
      item: verbMatch[1] || intent.item,
    };
  }
  return { action: "unknown", luckSpend: luckSpend || undefined };
}

// ============================================================
// LLM 驱动解析
// ============================================================

const INTENT_SYSTEM_PROMPT = `你是一个 TRPG 意图解析器。分析玩家的中文输入，提取为结构化 JSON。

支持的动作类型 (action):
- "attack" — 攻击、砍、刺、射、施法攻击
- "move" — 移动、走、跑、前往
- "cast" — 施法、使用法术/魔法
- "skill_check" — 技能检定（侦查、潜行、说服、调查等）
- "san_check" — SAN 检定/理智检定（目睹恐怖、疯狂、恐惧）
- "saving_throw" — D&D 豁免检定（抵抗毒素/法术/陷阱/恐惧等）
- "talk" — 对话、交谈、询问 NPC
- "use_item" — 使用物品、道具、绷带、急救包
- "rest" — 休息、休整、治疗、睡觉（恢复 HP/SAN）
- "look" — 观察、环顾四周、查看环境
- "flee" — 逃跑、逃走、脱离战斗（CoC 模式触发追逐）
- "chase" — 追逐行动、跑、追（在追逐中继续逃跑或追击）
- "status" — 角色状态、属性、角色卡
- "inventory" — 背包、查看物品
- "pickup" — 捡起、拾取物品
- "help" — 帮助、操作指南
- "reload" — 装填弹药、换弹匣
- "first_aid" — 急救、包扎伤口
- "push" — 推动检定（失败后重试）
- "occult_cast" — 克苏鲁神话咒文、吟唱召唤/驱逐咒语
- "spell_list" — 查看已知法术/咒文列表
- "generate_story" — 生成新故事/场景/模组
- "create_character" — 创建角色、车卡、我要当调查员
- "list_occupations" — 职业列表、有哪些职业
- "allocate_skills" — 分配技能、调整技能点、手动分配技能
- "buy" — 购买物品（CoC 商店购买道具/装备）
- "sell" — 出售物品、卖东西
- "skill_advancement" — 模组结算、技能成长（在模组结束时投成长骰）
- "legacy" — 传承系统、继承角色、保存角色、读档、存档
- "load_module" — 加载/导入模组、剧本杀
- "view_module" — 查看模组详情、模组预览、模组内容
- "unknown" — 无法识别

方法 (method, 可选):
- "melee" — 近战
- "ranged" — 远程
- "stealth" — 偷袭/潜行
- "aimed" — 瞄准/专注（增加暴击率，配合 calledShot 指定部位）

技能 (skill, 可选, 仅 skill_check 时填写):
stealth, perception, investigation, persuasion, medicine, history, occult, library_use

saving_throw 时额外字段:
- ability: 属性名 "strength" | "dexterity" | "constitution" | "intelligence" | "wisdom" | "charisma"
- dc: 目标 DC（数字，可选）
- reason: 豁免原因（如"对抗毒素""抵抗法术"）

目标名 (target) 提取原文字符串。
武器名 (weapon) 提取为英文: shortsword, longsword, dagger, longbow, fist。

san_check 时额外字段:
- sanCost: SAN 损失格式 "1/1d6"（成功/失败）
- reason: 检定原因的中文字符串

cast 时额外字段:
- spell: 法术名（中文，如"魔法飞弹""燃烧之手""治疗伤势"）

CoC 额外字段:
- luckSpend: 燃运点数（数字，玩家说"燃运5"时设为5）
- weaponName: CoC 武器名（中文，如".38左轮""12号霰弹枪""格斗(肉搏)"）
- calledShot: 瞄准部位（字符串，如"头部""腿部""腹部""胸部""右臂""左腿""武器""眼睛"）

只输出 JSON，不要任何额外文字。格式:
{"action":"attack","target":"哥布林","weapon":"shortsword","method":"melee"}`;

export async function parseIntentLLM(
  input: string,
  llm: LLMClient
): Promise<ActionIntent> {
  const raw = await llm.chat(
    [
      { role: "system", content: INTENT_SYSTEM_PROMPT },
      { role: "user", content: input },
    ],
    { temperature: 0.1, maxTokens: 200, jsonMode: true }
  );

  try {
    const parsed = JSON.parse(raw.trim());
    return {
      action: parsed.action || "unknown",
      target: parsed.target,
      weapon: parsed.weapon,
      method: parsed.method,
      skill: parsed.skill,
      ability: parsed.ability,
      dc: parsed.dc,
      sanCost: parsed.sanCost,
      reason: parsed.reason,
    };
  } catch {
    // JSON 解析失败 → 退化到 regex
    // console.warn(`  ⚠ LLM 意图解析失败，退化到 regex: ${raw.slice(0, 80)}`);
    return parseIntentRegex(input);
  }
}

// ============================================================
// 统一入口
// ============================================================

let _llmClient: LLMClient | null = null;

export function setIntentLLM(client: LLMClient | null) {
  _llmClient = client;
}

export async function parseIntent(input: string): Promise<ActionIntent> {
  if (_llmClient) {
    try {
      return await parseIntentLLM(input, _llmClient);
    } catch (err) {
      // console.warn(`  ⚠ LLM 调用失败，退化到 regex: ${(err as Error).message.slice(0, 80)}`);
    }
  }
  return parseIntentRegex(input);
}

// 保留旧接口兼容
export { parseIntentRegex as llmParseIntent };
