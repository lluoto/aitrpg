// Player Agent — LLM 驱动的调查员角色
// 接收 KP 场景描述 → 做出角色内决策 → 返回行动描述
// 有 LLM 时用 LLM，无 LLM 时用性格模板

import type { CoCGeneratedCharacter } from "../character/coc-character";

export interface PlayerCharacter {
  name: string;
  occupation: string;
  char: CoCGeneratedCharacter;
  /** 角色性格描述（用于 LLM 扮演提示） */
  personality: string;
  /** 角色背景故事 */
  backstory: string;
  /** 角色当前目标 */
  currentGoal: string;
}

export interface PlayerDecision {
  action: string; // 玩家行动的文字描述
  intent: "investigate" | "talk" | "search" | "move" | "combat" | "use_item" | "observe" | "other";
  targetClueId?: string; // 尝试调查的线索 ID
  targetNpcId?: string; // 尝试交谈的 NPC ID
  skillToUse?: string; // 尝试使用的技能
  targetSceneId?: string; // 尝试前往的场景 ID
}

export interface FallbackContext {
  sceneDescription: string;
  availableActions: string[];
  availableClues: string[];
  npcCount: number;
  round: number;
}

// ====== 行动库类型 ======
interface FallbackAction {
  text: string;          // 文本模板，{name} 会被替换为角色名
  intent: PlayerDecision["intent"];
  baseWeight: number;    // 基础权重
  tags: string[];        // 行为标签，用于职业偏好匹配
}

interface OccupationProfile {
  name: string;
  match: (occupation: string) => boolean;
  preferredTags: string[];  // 偏好标签 → 权重 x1.5
  avoidedTags: string[];    // 回避标签 → 权重 x0.5
}

// ====== 行动库（概率池） ======
// 每个行动有基础权重 + 情境加权 → 概率选择
const ACTION_LIBRARY: FallbackAction[] = [
  // ── search（搜索） ──
  { text: "{name}沉默地扫视四周，目光掠过每一个角落。", intent: "search", baseWeight: 1.0, tags: ["search", "cautious", "methodical"] },
  { text: "{name}俯身检查地面，不放过任何痕迹。", intent: "search", baseWeight: 1.0, tags: ["search", "detail_oriented"] },
  { text: "{name}开始系统地翻查这个区域，动作熟练而有条理。", intent: "search", baseWeight: 1.0, tags: ["search", "methodical", "professional"] },
  { text: "{name}环顾四周，本能地检查每一个可能藏东西的地方。", intent: "search", baseWeight: 1.0, tags: ["search", "instinctive"] },
  { text: "{name}仔细检查那些不起眼的角落和缝隙。", intent: "search", baseWeight: 0.9, tags: ["search", "detail_oriented", "cautious"] },
  // ── investigate（调查） ──
  { text: "{name}停在原地，目光锁定某个可疑的细节。", intent: "investigate", baseWeight: 1.0, tags: ["investigate", "observant"] },
  { text: "{name}眯起眼睛，仔细审视着周围的一切。", intent: "investigate", baseWeight: 1.0, tags: ["investigate", "analytical"] },
  { text: "{name}径直走向最可疑的地方。", intent: "investigate", baseWeight: 1.0, tags: ["investigate", "direct", "impulsive"] },
  { text: "{name}蹲下身，用手指轻轻划过某个表面，感受着触感。", intent: "investigate", baseWeight: 0.9, tags: ["investigate", "sensory"] },
  { text: "{name}的目光被什么东西吸引了——那东西不太对劲。", intent: "investigate", baseWeight: 0.9, tags: ["investigate", "observant", "instinctive"] },
  // ── talk（交谈） ──
  { text: "{name}朝可能知情的人走去，打算先聊聊。", intent: "talk", baseWeight: 1.0, tags: ["talk", "social", "cautious"] },
  { text: "{name}直接向在场的人打招呼，试着获取信息。", intent: "talk", baseWeight: 1.0, tags: ["talk", "social", "direct"] },
  { text: "{name}清了清嗓子，开始询问周围的人。", intent: "talk", baseWeight: 1.0, tags: ["talk", "professional"] },
  { text: "{name}观察了一下谁看起来最可能开口，然后走过去。", intent: "talk", baseWeight: 1.0, tags: ["talk", "social", "perceptive"] },
  { text: "{name}决定先打听一下情况，走向附近的人。", intent: "talk", baseWeight: 0.8, tags: ["talk", "social", "cautious"] },
  // ── observe（观察） ──
  { text: "{name}闭上眼睛，仔细感受周围的气氛。", intent: "observe", baseWeight: 1.0, tags: ["observe", "sensory", "analytical"] },
  { text: "{name}退后一步，从全局观察这个场景。", intent: "observe", baseWeight: 1.0, tags: ["observe", "analytical", "strategic"] },
  { text: "{name}凝神细听，试图捕捉微弱的声响。", intent: "observe", baseWeight: 1.0, tags: ["observe", "sensory", "cautious"] },
  { text: "{name}站在那里一动不动，目光缓慢地扫过整个空间。", intent: "observe", baseWeight: 1.0, tags: ["observe", "methodical", "patient"] },
  { text: "{name}像一尊雕像般静止，只用感官去捕捉每一个细节。", intent: "observe", baseWeight: 0.8, tags: ["observe", "sensory", "patient"] },
  // ── move（移动） ──
  { text: "{name}觉得应该去别处看看。", intent: "move", baseWeight: 1.0, tags: ["move", "decisive"] },
  { text: "{name}认为这里暂时没有更多发现，决定换个地方。", intent: "move", baseWeight: 1.0, tags: ["move", "cautious", "strategic"] },
  { text: "{name}环顾一圈后，向另一个方向走去。", intent: "move", baseWeight: 0.8, tags: ["move", "decisive", "curious"] },
  // ── combat（战斗） ──
  { text: "{name}握紧拳头，做好了随时动手的准备。", intent: "combat", baseWeight: 0.5, tags: ["combat", "cautious"] },
  { text: "{name}警惕地环顾四周，手不自觉地摸向可以防身的东西。", intent: "combat", baseWeight: 0.6, tags: ["combat", "cautious", "survival"] },
];

// ====== 职业档案 ======
const OCCUPATION_PROFILES: OccupationProfile[] = [
  {
    name: "detective",
    match: (occ) => /侦探|警探|刑警|探员|警察|detective|investigator/i.test(occ),
    preferredTags: ["search", "cautious", "observant", "methodical", "detail_oriented", "analytical", "investigate"],
    avoidedTags: ["impulsive", "sensory"],
  },
  {
    name: "doctor",
    match: (occ) => /医生|医者|医师|外科|doctor|physician|surgeon|medicine/i.test(occ),
    preferredTags: ["sensory", "analytical", "cautious", "professional", "patient", "methodical", "social"],
    avoidedTags: ["impulsive", "direct", "combat"],
  },
  {
    name: "scholar",
    match: (occ) => /教授|学者|研究员|考古|历史|记者|作家|writer|journalist|scholar|professor|researcher|archaeologist|historian|library/i.test(occ),
    preferredTags: ["analytical", "methodical", "patient", "cautious", "observant", "strategic"],
    avoidedTags: ["impulsive", "combat", "direct", "instinctive"],
  },
  {
    name: "soldier",
    match: (occ) => /士兵|退伍|军人|雇佣兵|soldier|veteran|military|marine|army|guard|security|保镖/i.test(occ),
    preferredTags: ["cautious", "direct", "survival", "decisive", "strategic", "professional"],
    avoidedTags: ["patient", "sensory"],
  },
  {
    name: "criminal",
    match: (occ) => /混混|骗子|线人|黑客|流氓|小偷|criminal|hacker|thief|rogue|smuggler|走私/i.test(occ),
    preferredTags: ["instinctive", "direct", "curious", "sensory", "survival", "impulsive"],
    avoidedTags: ["professional", "methodical", "patient"],
  },
  {
    name: "occultist",
    match: (occ) => /灵媒|神秘|玄学|通灵|占卜|occult|medium|mystic|mysteries|神秘学家|神父|牧师|priest/i.test(occ),
    preferredTags: ["sensory", "observant", "instinctive", "patient"],
    avoidedTags: ["direct", "impulsive", "combat", "methodical"],
  },
  { name: "default", match: () => true, preferredTags: [], avoidedTags: [] },
];

// ====== 情境加权函数 ======
function scoreActionByContext(action: FallbackAction, ctx: FallbackContext): number {
  let score = 1.0;
  const desc = ctx.sceneDescription;

  // 场景关键词匹配
  if (action.intent === "search" && /痕迹|角落|地面|翻|找|藏|检查/.test(desc)) score += 0.4;
  if (action.intent === "talk" && /人|问|打听|对话|谈话|询问/.test(desc)) score += 0.4;
  if (action.intent === "observe" && /黑暗|模糊|听|闻|感|安静|寂静/.test(desc)) score += 0.4;
  if (action.intent === "investigate" && /可疑|不对|异常|线索|奇怪/.test(desc)) score += 0.4;
  if (action.intent === "move" && /没有|什么也没有|空|无聊/.test(desc)) score += 0.5;
  if (action.intent === "combat" && /危险|攻击|敌人|威胁|袭击|战斗/.test(desc)) score += 1.0;

  // 回合进展：后期更可能交谈或移动
  if (ctx.round > 6 && action.intent === "talk") score += 0.2;
  if (ctx.round > 10 && (action.intent === "move" || action.intent === "talk")) score += 0.3;

  // NPC 数量影响
  if (ctx.npcCount >= 2 && action.intent === "talk") score += 0.3;
  if (ctx.npcCount === 0) {
    if (action.intent === "talk") score -= 0.5;
    if (action.intent === "search" || action.intent === "investigate") score += 0.2;
  }

  // 线索密度
  if (ctx.availableClues.length >= 3 && (action.intent === "search" || action.intent === "investigate")) score += 0.2;
  if (ctx.availableClues.length === 0 && (action.intent === "search" || action.intent === "investigate")) score -= 0.3;

  return Math.max(0.1, score);
}

const PL_SYSTEM_PROMPT = `你是一个 CoC 7e 调查员角色。你正在参与一场 TRPG 游戏。

规则：
1. 你只能基于你的角色知道的信息做决定
2. 你的决策要符合你的角色性格和背景
3. 简短的行动描述（1-3句），不要输出内心独白
4. 不要替 KP 或 GM 做任何事——只描述你的角色要做什么
5. 如果你要使用某个技能，明确说出技能名

格式：直接输出你的角色的行动。`;

export class PlayerAgent {
  private pc: PlayerCharacter;
  private history: { kp: string; action: string }[] = [];
  private isLLMAvailable = false;
  /** Round counter for cycling fallback patterns */
  private _fallbackTurn = 0;

  constructor(pc: PlayerCharacter) {
    this.pc = pc;
  }

  /** 构建 LLM 提示 — 当前情景 + 角色信息 */
  buildPrompt(kpNarration: string, availableClues: string[], availableActions: string[]): string {
    return [
      `【你的角色】`,
      `名字: ${this.pc.name}`,
      `职业: ${this.pc.occupation}`,
      `性格: ${this.pc.personality}`,
      `背景: ${this.pc.backstory}`,
      `当前目标: ${this.pc.currentGoal}`,
      ``,
      `【当前情景】`,
      kpNarration,
      ``,
      availableClues.length > 0 ? `【你可以调查的线索】\n${availableClues.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n` : "",
      availableActions.length > 0 ? `【你可以做的事】\n${availableActions.map((a, i) => `${i + 1}. ${a}`).join("\n")}\n` : "",
      `【历史行动】`,
      this.history.slice(-3).map((h) => `KP: ${h.kp}\n你: ${h.action}`).join("\n\n") || "（这是你的第一回合）",
      ``,
      `现在，作为 ${this.pc.name}，你要怎么做？简短描述你的行动。`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** 使用 LLM 做出决策 */
  async decideViaLLM(kpNarration: string, availableClues: string[], availableActions: string[]): Promise<PlayerDecision> {
    const prompt = this.buildPrompt(kpNarration, availableClues, availableActions);

    try {
      // Try to use a direct LLM call via fetch
      const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
      const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
      const model = process.env.LLM_MODEL || "gpt-4o-mini";

      if (!apiKey || apiKey === "sk-placeholder" || apiKey.startsWith("${")) {
        this.isLLMAvailable = false;
        return this.fallbackDecision(kpNarration, availableActions);
      }

      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: PL_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.8,
          max_tokens: 200,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.warn(`  ⚠ PL LLM API ${resp.status}`);
        return this.fallbackDecision(kpNarration, availableActions);
      }

      const json = await resp.json();
      const content: string = json.choices?.[0]?.message?.content?.trim();
      if (!content) return this.fallbackDecision(kpNarration, availableActions);

      this.isLLMAvailable = true;
      const decision = this.parseAction(content);
      this.history.push({ kp: kpNarration, action: decision.action });
      return decision;
    } catch {
      this.isLLMAvailable = false;
      return this.fallbackDecision(kpNarration, availableActions);
    }
  }

  /** 无 LLM 时的模板决策 — 行动库概率选择 + 情境加权 */
  fallbackDecision(kpNarration: string, availableActions: string[], extCtx?: Partial<FallbackContext>): PlayerDecision {
    const p = this.pc;
    this._fallbackTurn++;

    // 构建上下文（最小上下文 = 仅场景描述 + 可用行动）
    const ctx: FallbackContext = {
      sceneDescription: kpNarration,
      availableActions,
      availableClues: extCtx?.availableClues ?? [],
      npcCount: extCtx?.npcCount ?? 0,
      round: extCtx?.round ?? 0,
    };

    // 1. 匹配职业档案
    const profile = OCCUPATION_PROFILES.find(pr => pr.match(p.occupation))
      ?? OCCUPATION_PROFILES.find(pr => pr.name === "default")!;

    // 2. 对所有行动加权
    type Entry = { action: FallbackAction; weight: number };
    const entries: Entry[] = [];
    const rng = this._fallbackTurn * 7 + 13; // 伪随机种子

    for (const act of ACTION_LIBRARY) {
      let weight = act.baseWeight;

      // 职业偏好加权
      const hasPreferred = act.tags.some(t => profile.preferredTags.includes(t));
      const hasAvoided = act.tags.some(t => profile.avoidedTags.includes(t));
      if (hasPreferred) weight *= 1.8;
      if (hasAvoided) weight *= 0.4;

      // 情境加权
      weight *= scoreActionByContext(act, ctx);

      // 小幅度随机扰动（基于 turn 种子，保证同回合不同 PL 不同）
      const variety = 0.8 + ((rng + act.text.length + entries.length) % 7) * 0.1;
      weight *= variety;

      if (weight > 0.05) entries.push({ action: act, weight });
    }

    // 3. 加权随机选择
    const totalWeight = entries.reduce((s, e) => s + e.weight, 0);
    let roll = Math.random() * totalWeight;
    for (const entry of entries) {
      roll -= entry.weight;
      if (roll <= 0) {
        const name = p.name;
        return { action: entry.action.text.replace("{name}", name), intent: entry.action.intent };
      }
    }

    // 安全回退
    const fallbacks = [
      `${p.name}打量着四周，"嗯……让我看看。"`,
      `${p.name}站在原地思考下一步该怎么做。`,
      `${p.name}环顾了一圈。`,
    ];
    return { action: fallbacks[this._fallbackTurn % fallbacks.length], intent: "investigate" };
  }

  /** 解析 LLM 输出的行动文本为结构化决策 */
  parseAction(content: string): PlayerDecision {
    // 尝试提取技能名
    const skillKeywords = [
      "侦查", "spot_hidden", "聆听", "listen", "图书馆", "library_use", "医学", "medicine",
      "急救", "first_aid", "说服", "persuade", "话术", "fast_talk", "恐吓", "intimidate",
      "心理学", "psychology", "精神分析", "psychoanalysis", "神秘学", "occult",
      "格斗", "fighting", "手枪", "firearms_pistol", "步枪", "firearms_rifle",
      "潜行", "stealth", "妙手", "sleight_of_hand", "机械维修", "mechanical_repair",
    ];

    let foundSkill: string | undefined;
    for (const sk of skillKeywords) {
      if (content.includes(sk)) {
        foundSkill = sk;
        break;
      }
    }

    // 判断意图
    let intent: PlayerDecision["intent"] = "other";
    const lower = content.toLowerCase();
    if (lower.includes("调查") || lower.includes("检查") || lower.includes("查看") || lower.includes("search") || lower.includes("examine")) {
      intent = "investigate";
    } else if (lower.includes("说") || lower.includes("问") || lower.includes("talk") || lower.includes("say") || lower.includes("ask") || lower.includes("speak")) {
      intent = "talk";
    } else if (lower.includes("搜索") || lower.includes("翻") || lower.includes("找") || lower.includes("look") || lower.includes("search")) {
      intent = "search";
    } else if (lower.includes("走") || lower.includes("去") || lower.includes("前往") || lower.includes("move") || lower.includes("go") || lower.includes("walk")) {
      intent = "move";
    } else if (lower.includes("打") || lower.includes("攻击") || lower.includes("fight") || lower.includes("attack") || lower.includes("shoot")) {
      intent = "combat";
    } else if (lower.includes("观察") || lower.includes("听") || lower.includes("闻") || lower.includes("observe") || lower.includes("listen")) {
      intent = "observe";
    }

    return {
      action: content,
      intent,
      skillToUse: foundSkill,
    };
  }

  getHistory(): { kp: string; action: string }[] {
    return this.history;
  }

  getCharacter(): PlayerCharacter {
    return this.pc;
  }
}

/** 创建默认的 PL 角色性格配置 */
export function createPlayerCharacter(
  char: CoCGeneratedCharacter,
  name: string,
  occupation: string,
  personality: string,
  backstory: string,
  goal: string,
): PlayerCharacter {
  return {
    name,
    occupation,
    char,
    personality,
    backstory,
    currentGoal: goal,
  };
}
