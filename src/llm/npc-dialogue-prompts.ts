/**
 * NPC 自由对话 LLM Prompt 模板与生成函数
 * ========================================
 *
 * 职责：处理运行时"未知对话"场景：
 *   - NPC → PL: NPC根据上下文主动开口
 *   - PL → NPC: 调查员提问后NPC的自然回应
 *
 * 两种模式：
 *   1. LLMClient API 可用 → 用 prompt 模板调用 LLM 生成高质量回应
 *   2. 降级模式 → 从 NPC 数据中选取/组装回应
 *
 * 用法：
 *   // PL 提问 → NPC 回应
 *   const reply = await generateNpcReply(npc, "加比平时和谁来往密切？", sceneContext, llmClient);
 *
 *   // NPC 主动开口
 *   const line = await generateNpcProactive(npc, sceneContext, llmClient);
 */

import type { ModuleNPC } from "../module/types";
import type { LLMClient } from "./client";
import { ConstraintEngine, DEFAULT_CONSTRAINTS } from "../world/world-constraint";
import { MYTHOS_CREATURES } from "../rules/mythos-expansion";

// ============================================================
// NPC 上下文构造 — 给 LLM 的 NPC 描述块
// ============================================================

export interface NpcContextBlock {
  name: string;
  role: string;
  personality: string;
  knowledge: string[];
  secrets: string[];
  speakingStyle: string;
  dialogueSamples: string[];
  /** 神话生物外观设定（如 Mi-Go 是甲壳质外骨骼的真菌）；普通 NPC 无此字段 */
  appearance?: string;
}

/**
 * 从 ModuleNPC 构建 NPC 上下文块（供 LLM prompt 使用）
 */
export function buildNpcContext(npc: ModuleNPC): NpcContextBlock {
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();
  const role = (npc.role || "").replace(/[（(].*[）)]$/, "").trim();
  const traits = npc.personality.traits?.join("、") || "无";
  const samples: string[] = [];

  if (npc.llmExpanded?.firstEncounter) {
    samples.push(npc.llmExpanded.firstEncounter);
  }
  if (npc.llmExpanded?.knowledgeReveals) {
    samples.push(...npc.llmExpanded.knowledgeReveals.slice(0, 2));
  }
  if (npc.llmExpanded?.revisitEncounter) {
    samples.push(npc.llmExpanded.revisitEncounter);
  }

  // 神话生物外观注入：NPC 是神话生物（Mi-Go 等）时，注入其设定外观，
  // 防止 LLM 凭场景氛围/流行印象自由发挥（如把 Mi-Go 写成"金属关节"的机械体）。
  const creature = MYTHOS_CREATURES.find(c =>
    npc.id.toLowerCase().includes(c.id.toLowerCase()) || npc.name.includes(c.name)
  );

  return {
    name,
    role,
    personality: `${traits}。说话方式: ${npc.personality.speech || "普通"}。`,
    knowledge: npc.knowledge || [],
    secrets: npc.secrets || [],
    speakingStyle: npc.personality.speech || "普通",
    dialogueSamples: samples,
    appearance: creature?.description,
  };
}

// ============================================================
// Prompt 模板
// ============================================================

const SYSTEM_PROMPT_NPC_REPLY = `你是一个 1920 年代克苏鲁神话 TRPG 中的 NPC 扮演者。
你要根据 NPC 的设定，对调查员的问题做出自然、符合角色性格的回应。

扮演规则：
1. 语气、用词、态度必须严格符合 NPC 的角色和性格标签
2. 回应的内容可以来自 NPC 的"知识"（知道的事实）或"秘密"（不愿透露的信息）
3. 如果问题涉及秘密，NPC 可能会含糊其辞、转移话题或撒谎
4. 不要说出游戏机制信息（"这是线索"、"提示你"等）
5. 每次回应 1-3 句话，简洁自然
6. 如果是中文 NPC，用中文回应；如果是英文 NPC，用英文回应
7. 回应必须带有自然的叙述形式：用小括号括起的动作/神态/语气描写开头或穿插（如（抬眼打量他们）（声音低沉）（指尖敲着桌面）），让台词像真人表演，不要干巴巴地复述资料
8. 禁止"想了想""斟酌了一下""沉思片刻"这类机械化思考动词——真人不会这样提示自己的内心活动
9. 角色标签通过叙述内容和形式自然体现，不要直接念出性格标签
10. **情绪优先于职业身份**：NPC 当前处境中的情感状态（对失踪亲人的焦虑、悲伤、恐惧、慌乱）必须主导语气；职业身份（银行职员/警员等）只是背景装点，绝不能把情绪化的人物演成冷静客套、公事公办的谈判对象。焦虑的母亲开口应是急切、坐立难安、恳求式的，而不是"我的时间很宝贵"这类职场口吻
11. 台词正文不要使用任何引号包裹或强调（""''“”‘’），引号由系统统一添加——直接输出台词内容本身
12. **外貌一致性**：若【外貌】不是"普通人类"（如神话生物 Mi-Go），描述其外观、动作、出场时必须严格符合该设定——Mi-Go 是甲壳质外骨骼的真菌生物（膜翅、触角、粉色甲壳），绝不可写成金属机械（"金属关节""齿轮""机械"等一律禁止）。普通人类 NPC 则不要编造与其身份不符的夸张外形
13. **信息叙述化**：案件事实、背景信息（失踪者的性格/经历、事件经过等）不要用台词逐条直述成"念设定"；用叙述转述的方式自然带出（如"她低下头，声音发抖，断断续续地告诉你们……"），把信息揉进叙述里，台词本身只保留情绪、态度、请求与反应
14. **按需回答，不提前倒出**：只回答调查员问到的内容；被问及的信息才叙述出来，提问未涉及的信息不要主动提前说出（信息在提及时才叙述）。例如调查员只问"他最后一次出现是什么时候"，就不要顺势把警察、银行、邻居等无关细节一次说完
15. **禁止提及同场景其他 NPC 的即时行为**：不得编造其他 NPC 正在做/刚做过的事（如"XX已经带路""刚才XX说的"）——其他 NPC 是否在场、做了什么，以场景氛围为准，不得虚构超出其范围的互动
16. **素材边界（硬性）**：回答的全部事实内容只能来自【尚未告诉过调查员的素材】或【已经告诉过调查员的】两段清单；清单之外不得编造任何具体事实（地点细节、事件经过、物品、人物关系、时间等）。可以在清单事实基础上做情绪化表达，但不得添加清单中没有的事实（如清单只说"拖车房空着"，就不得编造"我让人把里面的东西清空了"）`;

const SYSTEM_PROMPT_NPC_PROACTIVE = `你是一个 1920 年代克苏鲁神话 TRPG 中的 NPC 扮演者。
你要根据当前的场景和 NPC 的设定，让 NPC 主动开口说一句话。

规则：
1. 这句开场白必须符合 NPC 的性格（焦虑/天真/冷漠/热情等）
2. 可以提及当前场景中的事物，或调查员明显在关注的事情
3. 不要直接给出核心线索——自然引出即可
4. 每次只说 1-2 句话
5. 如果是中文 NPC，用中文；如果是英文 NPC，用英文
6. **情绪优先于职业身份**：NPC 当前处境中的情感状态（对失踪亲人的焦虑、悲伤、恐惧、慌乱）必须主导语气；职业身份只是背景装点，绝不能把情绪化的人物演成冷静客套、公事公办的谈判对象`;

const PROMPT_TEMPLATE_REPLY = `【NPC 设定】
名字: {name}
身份: {role}
性格: {personality}
说话方式: {speakingStyle}
【外貌】
{appearance}
尚未告诉过调查员的素材（回答时只从中挑选与提问相关的内容说出）:
{knowledge}
已经告诉过调查员的（不要重复叙述，仅供承接）:
{revealedKnowledge}
隐藏的: {secrets}

【对话风格参考】
以下是她/他此前的对话方式：
{dialogueSamples}

【当前场景】
{sceneContext}

{worldContext}

【调查员的问题】
{playerInput}

【在场的调查员】
{playerOccupations}

请以 NPC 的身份做出回应：`;

const PROMPT_TEMPLATE_PROACTIVE = `【NPC 设定】
名字: {name}
身份: {role}
性格: {personality}
说话方式: {speakingStyle}
【外貌】
{appearance}
知道的信息（素材——用叙述转述带出，不要逐条原样复述成台词）:
{knowledge}
隐藏的: {secrets}

【对话风格参考】
她/他此前的对话方式：
{dialogueSamples}

【当前场景】
{sceneContext}

{worldContext}

【调查员当前行动/关注】
{playerOccupations}

请让 NPC 根据当前场景主动开口说一句话：`;

// ============================================================
// 降级模板 — 无 LLM 时的 fallback
// ============================================================

/** 分析 NPC 语气特征 */
function analyseNpc(npc: ModuleNPC) {
  const speech = npc.personality.speech?.toLowerCase() || "";
  return {
    isChild: /奶声|童言|天真|child/.test(speech),
    isAnxious: /焦虑|急切|颤抖|anxious/.test(speech),
    isSilent: /昏迷|瘫痪|无法.*交流|unconscious/.test(speech),
    isFormal: /公事|官方|official/.test(speech),
    isHostile: /敌意|警惕|hostile/.test(speech),
  };
}

/** 降级：用 NPC 知识库回答 */
function templateReply(npc: ModuleNPC, question: string, usedRevealIndices?: Set<number>, preferredIndex?: number): string {
  const a = analyseNpc(npc);
  if (a.isSilent) return "……";

  // Prefer llmExpanded.knowledgeReveals as conversational responses.
  // Use question text to pick a relevant reveal (same question → same reveal;
  // different questions → different reveals), avoiding the "random = same answer twice" problem.
  const reveals = npc.llmExpanded?.knowledgeReveals;
  if (reveals && reveals.length > 0) {
    // Filter out already-revealed indices, but keep at least 1
    const candidateIndices = reveals
      .map((_, i) => i)
      .filter(i => !usedRevealIndices?.has(i));
    const pool = candidateIndices.length > 0 ? candidateIndices : reveals.map((_, i) => i);

    // 问答对齐：调用方指定了本轮目标 reveal（conductNpcConversation 已按 knowledge 锚点定题）
    // → 直接采用该下标，不再靠匹配猜；否则走内容 2-gram 加权匹配。
    let bestIdx: number;
    if (preferredIndex !== undefined && pool.includes(preferredIndex)) {
      bestIdx = preferredIndex;
    } else {
      // ── 问答对齐匹配：question 内容 2-gram（reveal 文本 +1，对应 knowledge 浓缩 +1.5）──
      // 模组约定 knowledge[i] ↔ reveals[i] 按下标对应，reveal 是 knowledge 的意译展开；
      // 同时匹配 reveal 本身与其对应 knowledge（词更浓缩、区分度更高），取总分最高者。
      // 无命中则回落 hash 轮转（保持"不同问题 → 不同回答"的稳定）。
      const qGrams = contentGrams(question);
      bestIdx = pool[0];
      let bestScore = -1;
      if (qGrams.size > 0) {
        const knowledge = npc.knowledge ?? [];
        for (const i of pool) {
          const r = reveals[i];
          const k = knowledge[i];
          let score = 0;
          for (const g of qGrams) {
            if (r.includes(g)) score += 1;      // reveal 直接命中
            if (k?.includes(g)) score += 1.5;   // 对应 knowledge 浓缩命中（权重更高）
          }
          // Tiebreaker: use position to ensure different rounds tend different directions
          score += i * 0.01;
          if (score > bestScore) { bestScore = score; bestIdx = i; }
        }
      }
      // No content overlap → round-robin based on question hash
      if (bestScore <= 0) {
        let hash = 0;
        for (let i = 0; i < question.length; i++) {
          hash = ((hash << 5) - hash) + question.charCodeAt(i); hash |= 0;
        }
        bestIdx = pool[Math.abs(hash) % pool.length];
      }
    }
    let answer = reveals[bestIdx];
    // 世界观穿透过滤 — 使用统一约束引擎的四类处置
    const penResult = worldPenetrationCheck(answer);
    if (penResult) {
      switch (penResult.action) {
        case "block":
          // block: 跳过这个 reveal，改用下一段或通用话术
          const safeReveals = reveals.filter(r => !worldPenetrationCheck(r));
          if (safeReveals.length > 0) {
            const safeIdx = bestIdx % safeReveals.length;
            answer = safeReveals[safeIdx];
          } else {
            answer = fallbackSilence(a);
          }
          break;
        case "redirect":
          // redirect: 自然转换话题，不是直接沉默
          answer = worldRedirectFallback(a);
          break;
        case "allow_with_cost":
          // allow_with_cost: 允许通过
          break;
        case "replace":
          // replace: 替换为约束定义的替代文本
          answer = penResult.replacement ?? answer;
          break;
      }
    }
    if (a.isChild) answer = pick(["嗯……", "那个……", "我记得……"]) + answer;
    if (a.isAnxious) answer = pick(["呃……这个……"]) + answer;
    return answer;
  }

  // Fallback: raw knowledge items — same question-hash approach
  const allKnowledge = [...(npc.knowledge || [])];
  if (allKnowledge.length > 0) {
    let hash = 0;
    for (let i = 0; i < question.length; i++) {
      hash = ((hash << 5) - hash) + question.charCodeAt(i); hash |= 0;
    }
    const idx = Math.abs(hash) % allKnowledge.length;
    let answer = allKnowledge[idx].replace(/[。！？]+$/, "");
    const prefix = a.isChild ? pick(["嗯……我记得", "那个……"]) :
      a.isAnxious ? pick(["这个……", "说起这个……"]) :
      pick(["我记得", "是这样的"]);
    return `${prefix}${answer}。`;
  }

  return pick([
    "这个……我也不太清楚。",
    "让我想想……实在想不起来什么了。",
    "我知道的都已经告诉你们了。",
    "我现在脑子很乱，想不起更多了。",
    "该说的我都说了，你们自己看着办吧。",
  ]);
}

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** 中文内容 2-gram 停用词（代词/虚词/泛问词，无区分度） */
const GRAM_STOP_WORDS = new Set([
  "什么", "怎么", "为什么", "这个", "那个", "哪个", "我们", "你们", "他们",
  "咱们", "自己", "请问", "知道", "告诉", "说说", "讲讲", "详细", "具体",
  "情况", "事情", "回事", "关于", "还有", "别的", "其他", "刚才", "现在",
  "时候", "地方", "这里", "那里", "哪里", "真的", "是不是", "没有",
]);

/**
 * 提取文本中的中文内容 2-gram（连续两字，剔除停用词）。
 * 用于问答对齐：question 与 reveal/knowledge 的语义匹配。
 */
function contentGrams(text: string): Set<string> {
  const out = new Set<string>();
  for (let j = 0; j < text.length - 1; j++) {
    const g = text.slice(j, j + 2);
    if (/[\u4e00-\u9fa5]/.test(g[0]) && /[\u4e00-\u9fa5]/.test(g[1]) && !GRAM_STOP_WORDS.has(g)) {
      out.add(g);
    }
  }
  return out;
}

/** fallbackSilence — 当 NPC 无合适回答时使用（修复 worldPenetration 路径引用） */
function fallbackSilence(a: ReturnType<typeof analyseNpc>): string {
  if (a.isSilent) return "……";
  return pick([
    "这个……我也不太清楚。",
    "让我想想……实在想不起来什么了。",
    "我知道的都已经告诉你们了。",
    "我现在脑子很乱，想不起更多了。",
    "该说的我都说了，你们自己看着办吧。",
  ]);
}

/**
 * 世界模型穿透过滤 — 确保 NPC 对话不破坏世界观
 *
 * 基于统一约束引擎的四种处置（DESIGN-LOG.md §3）：
 * - block:   直接拒绝该回答，改用通用话术（当前 blocklist 行为）
 * - redirect:用自然话题转换代替沉默
 * - allow_with_cost: 允许通过但记录警告
 * - replace: 替换为约束定义的替代文本
 *
 * 模组可通过 setDialogueConstraintEngine 注入 override 约束。
 */
let _dialogueEngine: ConstraintEngine | null = null;
function getDialogueEngine(): ConstraintEngine {
  if (!_dialogueEngine) {
    _dialogueEngine = new ConstraintEngine(DEFAULT_CONSTRAINTS);
  }
  return _dialogueEngine;
}

export function setDialogueConstraintEngine(engine: ConstraintEngine): void {
  _dialogueEngine = engine;
}

interface PenetrationResult {
  action: "block" | "redirect" | "allow_with_cost" | "replace";
  matchedTerm: string | null;
  replacement?: string;
  message?: string;
}

/** 检查文本是否违反世界观约束。返回处置结果或 null（无违反）。 */
function worldPenetrationCheck(text: string): PenetrationResult | null {
  const engine = getDialogueEngine();
  const result = engine.checkDialogue(text);
  if (!result) return null;

  // 定位具体词汇（用于日志）— meta 词 + 时代科技词
  const metaTerms = ["旅店","旅馆","客栈","场景","关卡","地图","线索","任务","道具","物品","装备","调查进度","剧情","调查员","PL","KP","跑团","游戏","模组","剧本","存档","读档","save","load","NPC","PC","玩家角色","非玩家角色"];
  const anachronismTerms = ["手机","移动电话","智能手机","电脑","平板电脑","笔记本电脑","互联网","无线网络","上网","wifi","wi-fi","蓝牙","gps","卫星导航","扫码","二维码","微信","短信","短视频","数码相机","无人机","电子支付","智能设备","打他电话","打她电话","给他打电话","给她打电话","他打来电话","她打来电话","挂断电话","接起电话","放下听筒"];
  const matchedTerm = metaTerms.find(w => text.includes(w)) ?? anachronismTerms.find(w => text.includes(w)) ?? "<约束命中>";

  switch (result.type) {
    case "block":
      return { action: "block", matchedTerm, message: result.blockMessage };
    case "redirect":
      return { action: "redirect", matchedTerm, message: result.redirectMessage };
    case "allow_with_cost":
      return { action: "allow_with_cost", matchedTerm, message: result.costDescription };
    case "replace":
      return { action: "replace", matchedTerm, replacement: result.replacement };
  }
}

/** 世界观违反时的自然转移 — NPC 绕开话题而不是沉默 */
function worldRedirectFallback(a: ReturnType<typeof analyseNpc>): string {
  if (a.isSilent) return "……";
  if (a.isChild) return pick(["咦？那个……我说不清楚……", "唔……这个我不能说……"]);
  if (a.isAnxious) return pick(["这个……我不太方便说……", "算了算了，不说这个了……"]);
  if (a.isFormal) return pick(["此事不便多谈。", "请理解，这不在讨论范围内。"]);
  if (a.isHostile) return pick(["哼。", "无可奉告。"]);
  return pick([
    "这个嘛……先不说这个了。",
    "不提这个了。还是说说你们的事吧。",
    "啊，这个……咱们还是说正事吧。",
    "唔……我觉得你们可能搞错了什么。",
  ]);
}

/** 降级：NPC 主动说话 */
function templateProactive(npc: ModuleNPC, sceneContext: string): string {
  const a = analyseNpc(npc);
  if (a.isSilent) return "";
  const name = npc.name.replace(/[（(].*[）)]$/, "").trim();

  const lines: string[] = [];
  if (a.isChild) {
    lines.push(pick([
      "你们在找什么呀？",
      "那边……那边我都不敢去的。",
      "你们会带我哥哥回来吗？",
    ]));
  } else if (a.isAnxious) {
    lines.push(pick([
      "你们发现什么了吗？",
      "一定要找到他啊……",
      "你们有什么头绪吗？",
    ]));
  } else if (a.isFormal) {
    lines.push(pick([
      "有什么需要协助的，尽管开口。",
      "如果需要查阅档案，我可以帮忙。",
      "请配合我的工作。",
    ]));
  } else {
    lines.push(pick([
      "有什么问题尽管问。",
      "你们看着面生——第一次来镇上？",
      "你们在调查什么案子？",
    ]));
  }

  return `${name}${pick(["开口说道：", "望向你们说：", "主动说："])}\n${lines[0]}`;
}

// ============================================================
// 对话生成入口
// ============================================================

export interface SceneContext {
  sceneName: string;
  sceneDescription: string;
  presentNpcs: string[];
  knownClues: string[];
  recentEvents: string[];
  /** 调查员职业列表（如 ["侦探","医生"]），用于NPC感知玩家背景 */
  playerOccupations?: string[];
}

/**
 * 全局调查上下文（WorldContext）— 跨场景串联调查进度，供所有叙事生成点注入。
 * 目的：让 LLM 生成每段叙事时都能看到"调查走到哪一步、从哪来、要去哪"，
 * 避免逐段孤立生成导致的衔接断裂、前后矛盾（上下文幻觉）。
 */
export interface WorldContext {
  /** 已访问过的场景名（按访问顺序） */
  visitedScenes: string[];
  /** 当前所处场景名 */
  currentScene: string;
  /** 全部已发现的线索名（跨场景） */
  discoveredClues: string[];
  /** 调查员当前目标（PL 主动设定/系统推断） */
  currentGoals: string[];
  /** 最近发生的关键事件摘要（如"在加比的拖车房发现非法手枪"） */
  recentEvents: string[];
  /** 已见过/认识的 NPC 名 */
  metNpcs: string[];
  /** 已触发的关键事件/转折（如"警局得知疯子教授案"） */
  triggeredEvents: string[];
  /** 可选：尚未解锁的区域/未知事实（用于防剧透，不泄露具体内容） */
  unexploredHints?: string[];
  /**
   * 可选：剧情状态变量（DESIGN-LOG §2 结构化状态层）——
   * 已渲染好的行，如 "地下室: 发电机已停止"；内容是引擎维护的硬事实，LLM 可承接但不得虚构
   */
  stateVars?: string[];
  /**
   * 可选：世界模型注入块（DESIGN-LOG §1 权威事实层）——
   * 由 WorldModelIntegrator.buildKPContext 生成，是世界观设定/场所常识的权威文本；
   * 为空或未接时不注入
   */
  worldModelContext?: string;
}

/**
 * 将 WorldContext 渲染为 prompt 注入块（统一格式，防剧透由调用方控制内容）
 */
export function renderWorldContext(world: WorldContext | null | undefined): string {
  if (!world) return "";
  const lines: string[] = ["【调查进度（全局，仅供承接前文，不得编造未发生之事）】"];
  if (world.visitedScenes.length > 0) {
    lines.push(`已到访地点: ${world.visitedScenes.join(" → ")}`);
  }
  lines.push(`当前所在地点: ${world.currentScene || "未知"}`);
  if (world.unexploredHints && world.unexploredHints.length > 0) {
    lines.push(`尚未查探: ${world.unexploredHints.join("、")}`);
  }
  if (world.stateVars && world.stateVars.length > 0) {
    lines.push(`剧情状态(引擎维护的硬事实, 可承接不可虚构): ${world.stateVars.join("；")}`);
  }
  if (world.discoveredClues.length > 0) {
    lines.push(`已发现的线索: ${world.discoveredClues.join("、")}`);
  }
  if (world.metNpcs.length > 0) {
    lines.push(`已接触过的人物: ${world.metNpcs.join("、")}`);
  }
  if (world.recentEvents.length > 0) {
    lines.push(`刚刚发生: ${world.recentEvents.slice(-3).join("；")}`);
  }
  if (world.currentGoals.length > 0) {
    lines.push(`调查员当前目标: ${world.currentGoals.join("；")}`);
  }
  if (world.triggeredEvents.length > 0) {
    lines.push(`已触发的事件: ${world.triggeredEvents.join("；")}`);
  }
  lines.push(`注意：只可承接以上已发生的事实；未列出的地点/线索/真相尚未发生，禁止提及或暗示。`);
  // 世界模型注入块：世界观/场所常识的权威文本（独立于"已发生事实"，是永恒设定层）
  if (world.worldModelContext && world.worldModelContext.length > 0) {
    lines.push(world.worldModelContext);
  }
  return lines.join("\n");
}

/**
 * NPC 主动开口 — 根据当前场景生成一句 NPC 台词
 * @param npc NPC 数据
 * @param scene 当前场景上下文
 * @param llm 可选的 LLMClient（有则用 API，无则降级到模板）
 */
export async function generateNpcProactive(
  npc: ModuleNPC,
  scene: SceneContext,
  llm?: LLMClient,
  world?: WorldContext | null,
): Promise<string> {
  const ctx = buildNpcContext(npc);

  if (llm) {
    try {
      const prompt = PROMPT_TEMPLATE_PROACTIVE
        .replace(/\{name\}/g, ctx.name)
        .replace(/\{role\}/g, ctx.role)
        .replace(/\{personality\}/g, ctx.personality)
        .replace(/\{speakingStyle\}/g, ctx.speakingStyle)
        .replace(/\{appearance\}/g, ctx.appearance ?? "普通人类")
        .replace(/\{knowledge\}/g, ctx.knowledge.join("、") || "无")
        .replace(/\{secrets\}/g, ctx.secrets.join("、") || "无")
        .replace(/\{dialogueSamples\}/g, ctx.dialogueSamples.join("\n") || "无")
        .replace(/\{worldContext\}/g, renderWorldContext(world))
        .replace(/\{sceneContext\}/g, [
          `场景: ${scene.sceneName}`,
          scene.sceneDescription,
          `在场的: ${scene.presentNpcs.join("、") || "无"}`,
          `已发现的线索: ${scene.knownClues.join("、") || "无"}`,
        ].join("\n"))
        .replace(/\{playerOccupations\}/g, scene.playerOccupations?.join("、") || "无");

      const raw = await llm.chat([
        { role: "system", content: SYSTEM_PROMPT_NPC_PROACTIVE },
        { role: "user", content: prompt },
      ], { temperature: 0.8, maxTokens: 200, timeout: 120000 });

      const t = raw.trim();
      // 世界模型穿透过滤：LLM 原始输出同样可能含时代违禁词/ meta 词汇——命中即弃用走模板
      const pen = worldPenetrationCheck(t);
      if (pen && pen.action === "block") throw new Error("npc proactive contains blocked term");
      if (t.length > 0) return t;
    } catch {
      // fall through to template
    }
  }

  return templateProactive(npc, scene.sceneName);
}

/**
 * 调查员提问 → NPC 回应 — 根据 NPC 设定生成自然回答
 * @param npc NPC 数据
 * @param playerInput 调查员的提问或对话
 * @param scene 当前场景上下文
 * @param llm 可选的 LLMClient（有则用 API，无则降级到模板）
 */
export async function generateNpcReply(
  npc: ModuleNPC,
  playerInput: string,
  scene: SceneContext,
  llm?: LLMClient,
  usedRevealIndices?: Set<number>,
  preferredIndex?: number,
  world?: WorldContext | null,
): Promise<string> {
  const ctx = buildNpcContext(npc);

  if (llm) {
    try {
      // 知识子集过滤（硬边界）：只有未说出的素材注入 {knowledge}（物理上不可见 → 不可能提前爆出/重复）；
      // 已说出的注入 {revealedKnowledge} 标注"不要重复"，仅供承接对话。
      // usedRevealIndices 与 npc.knowledge 一一对应（llmExpanded.knowledgeReveals 同序生成）。
      const revealed = ctx.knowledge.filter((_, i) => usedRevealIndices?.has(i));
      const fresh = ctx.knowledge.filter((_, i) => !usedRevealIndices?.has(i));
      const prompt = PROMPT_TEMPLATE_REPLY
        .replace(/\{name\}/g, ctx.name)
        .replace(/\{role\}/g, ctx.role)
        .replace(/\{personality\}/g, ctx.personality)
        .replace(/\{speakingStyle\}/g, ctx.speakingStyle)
        .replace(/\{appearance\}/g, ctx.appearance ?? "普通人类")
        .replace(/\{knowledge\}/g, fresh.join("、") || "（无尚未透露的）")
        .replace(/\{revealedKnowledge\}/g, revealed.join("、") || "（无）")
        .replace(/\{secrets\}/g, ctx.secrets.join("、") || "无")
        .replace(/\{dialogueSamples\}/g, ctx.dialogueSamples.join("\n") || "无")
        .replace(/\{worldContext\}/g, renderWorldContext(world))
        .replace(/\{sceneContext\}/g, [
          `场景: ${scene.sceneName}`,
          scene.sceneDescription,
          `在场的: ${scene.presentNpcs.join("、") || "无"}`,
          `已发现的线索: ${scene.knownClues.join("、") || "无"}`,
        ].join("\n"))
        .replace(/\{playerInput\}/g, playerInput);

      const raw = await llm.chat([
        { role: "system", content: SYSTEM_PROMPT_NPC_REPLY },
        { role: "user", content: prompt },
      ], { temperature: 0.8, maxTokens: 300, timeout: 120000 });

      const t = raw.trim();
      // 世界模型穿透过滤：LLM 原始输出同样可能含时代违禁词/ meta 词汇（如"挂断电话"）——命中即弃用走模板
      const pen = worldPenetrationCheck(t);
      if (pen && pen.action === "block") throw new Error("npc reply contains blocked term");
      if (t.length > 0) return t;
    } catch {
      // fall through to template
    }
  }

  return templateReply(npc, playerInput, usedRevealIndices, preferredIndex);
}

// ============================================================
// 调查员提问生成 — LLM 生成自然的 PC 提问（弃用模板动词库）
// ============================================================

const SYSTEM_PROMPT_PC_QUESTION = `你是一个 1920 年代克苏鲁神话 TRPG 中的调查员扮演者。
你要根据调查员的设定，对 NPC 提出一个自然的问题。

扮演规则：
1. 提问方式必须符合调查员的职业与性格
2. 问题必须承接对话历史——顺着对方刚说的话或场景中的具体情况往下问，绝不能凭空跳题
3. 口语化，像真人交谈，每次只问一个问题，1 句话
4. 不要引用对方没说过的话；不要复述知识条目原文；不要机械套用"能再多说一点吗""能再详细讲讲吗"
5. 不要解释自己为什么问，直接开口
6. 不要带"我想问""请问一下"这类元语言前缀
7. 不要输出叙述性引导（如"想了想""开口问道"）——只输出问题正文本身
8. 如果是中文调查员，用中文提问
9. **禁止剧透**：不得提及调查员尚未访问、尚未在对话中出现的具体地点/人物/机构（如"警长局""谷仓""某某酒吧"）——只能基于刚发生的对话、当前场景与调查员已知道的线索提问；宁可问得笼统，也不要点破未接触过的事实`;

const PROMPT_TEMPLATE_PC_QUESTION = `【调查员设定】
名字: {pcName}
职业: {pcRole}
性格: {pcPersonality}

【对话对象】
名字: {npcName}
身份: {npcRole}
性格: {npcPersonality}

【当前场景】
{sceneContext}

{worldContext}

【对话历史】
{dialogueHistory}

【NPC 还知道、但尚未说出的信息（可选追问方向）】
{unrevealedKnowledge}

【调查员当前目标/重点】
{investigationFocus}

请以调查员的身份，结合当前场景、刚发生的对话和调查重点，向对方提出一个自然的问题：
- 问题必须承接对话历史（可以顺着对方刚说的话往下问），不能凭空跳题
- 口语化、像真人交谈，每次只问一个问题
- 不要引用对方没说过的话；不要复述知识条目原文`

/**
 * 调查员 → NPC 提问 — 根据场景上下文 + 对话历史 + 调查重点生成自然提问
 * @param pc 调查员信息（名字/职业/性格）
 * @param npc 对话对象
 * @param scene 场景上下文（用于组织提问的语境）
 * @param context 附加对话上下文（对话历史、未说出的知识、调查重点）
 * @param llm LLMClient（必须有，否则应走模板降级）
 */
export async function generatePcQuestion(
  pc: { name: string; occupation: string; personality: string },
  npc: ModuleNPC,
  scene: SceneContext,
  context: {
    dialogueHistory?: string;
    unrevealedKnowledge?: string;
    investigationFocus?: string;
  },
  llm: LLMClient,
  world?: WorldContext | null,
): Promise<string> {
  const ctx = buildNpcContext(npc);
  // 未注入方向时移除模板中的"可选追问方向"段落，避免 LLM 凭空编造调查员不该知道的话题（防剧透）
  let template = PROMPT_TEMPLATE_PC_QUESTION;
  if (!context.unrevealedKnowledge) {
    template = template.replace(/【NPC 还知道、但尚未说出的信息（可选追问方向）】\n\{unrevealedKnowledge\}\n/, "");
  }
  const prompt = template
    .replace(/\{pcName\}/g, pc.name)
    .replace(/\{pcRole\}/g, pc.occupation)
    .replace(/\{pcPersonality\}/g, pc.personality)
    .replace(/\{npcName\}/g, ctx.name)
    .replace(/\{npcRole\}/g, ctx.role)
    .replace(/\{npcPersonality\}/g, ctx.personality)
    .replace(/\{worldContext\}/g, renderWorldContext(world))
    .replace(/\{sceneContext\}/g, [
      `场景: ${scene.sceneName}`,
      scene.sceneDescription || "（无）",
      `在场的: ${scene.presentNpcs.join("、") || "无"}`,
      scene.knownClues.length > 0 ? `本场景已发现的线索: ${scene.knownClues.join("、")}` : "",
    ].filter(Boolean).join("\n"))
    .replace(/\{dialogueHistory\}/g, context.dialogueHistory || "（刚刚开始交谈）")
    .replace(/\{unrevealedKnowledge\}/g, context.unrevealedKnowledge || "（无特别方向）")
    .replace(/\{investigationFocus\}/g, context.investigationFocus || "（自由交谈，寻找线索）");

  const raw = await llm.chat([
    { role: "system", content: SYSTEM_PROMPT_PC_QUESTION },
    { role: "user", content: prompt },
  ], { temperature: 0.8, maxTokens: 100, timeout: 120000 });

  return raw.trim().replace(/^["“]|["”]$/g, "");
}

// ============================================================
// NPC 出场过渡生成 — 场景内多个 NPC 之间自然衔接（弃用硬编码跳转）
// ============================================================

const SYSTEM_PROMPT_NPC_TRANSITION = `你是一个 1920 年代克苏鲁神话 TRPG 中的主持人（KP）。
场景中连续出场了多位 NPC。上一场对话刚结束，下一位 NPC 即将登场。
请写一段 1-2 句的过渡叙述，把镜头从上一位 NPC 自然地接到下一位 NPC，让出场不生硬。

规则：
1. 纯叙述，不包含对话内容，不用引号
2. 可以描写动作、环境变化、下一位 NPC 的出场方式（推门、从里屋出来、从门口探出身等）
3. 结合场景氛围与上一位 NPC 的说话内容做自然的因果衔接（如"话音未落""就在这时""转身之际"），但不要每个都用"就在这时"
4. 不要直接念出下一位 NPC 的性格标签或设定（如"这是一个天真的孩子"）
5. 不要提及检定、骰子等游戏机制
6. 只输出过渡叙述本身，中文，不加括号注释
7. **叙事必须采用第二人称"你/你们"视角**（调查员在场经历），NPC 是"你们看到/听到/察觉"的对象，不得用旁观者第三人称（如"他们看到米尔跑了"应写成"你们看到米尔跑回了屋内"）；环境变化同样以调查员的感官呈现
8. **只承接【上一位 NPC 刚说的话】中的实际内容**：过渡句可以引用/呼应其中真实出现过的语句（如"话音未落""她说完那句话后"），但**禁止提及她/他没说过的话**（如编造"她对警察的抱怨""她刚才的追问"——若清单里没有，就是没说过，不得脑补）`;

const PROMPT_TEMPLATE_NPC_TRANSITION = `【场景】
{sceneName}
{sceneDescription}

{worldContext}

【上一位 NPC（对话已结束）】
名字: {prevName}
身份: {prevRole}
性格: {prevPersonality}

【上一位 NPC 刚说的话（过渡句只能承接其中的实际内容，不得提及清单之外的话）】
{prevLines}

【即将登场的 NPC】
名字: {nextName}
身份: {nextRole}
性格: {nextPersonality}
外貌/行为: {nextDescription}

请写 1-2 句过渡叙述，让 {nextName} 自然地出现在场景中：`;

const PROMPT_TEMPLATE_OPENING_TRANSITION = `【时代背景】
1920 年代，技术条件符合当时现实：没有手机、无绳电话、无线对讲等现代通讯设备；电话为有线的固定电话，听筒用线缆连接机身，不能举着听筒离开话机位置。

【场景】
{sceneName}
{sceneDescription}

{worldContext}

【开场氛围（场景刚进入时的叙事，已展示）】
{openingAtmosphere}

【玩家此刻的空间位置】
调查员刚从 {sceneName} 的入口进入/接近，站在 {sceneName} 的场外或门口，尚未进屋、未深入到场景内部。

【首位登场的 NPC】
名字: {nextName}
身份: {nextRole}
性格: {nextPersonality}
外貌/行为: {nextDescription}

请写 1-2 句承接叙述，完成这件事：调查员在门口敲门（或按门铃）之后，门内传来回应（足音/询问/窸窣），然后门被打开，{nextName} 出现在门口。

硬性要求：
1. **必须包含"调查员敲门/按门铃 → 门内回应 → 开门"的完整因果链**：先写你们叩门，再写门内传来动静，最后门被打开；绝不能跳过敲门直接"门被拉开"（屋内人不会凭空知道你们来了）
2. **结尾停在"门被打开"即可**：不要写"XX 出现在门口"、不要写 NPC 名字、不要写人物外貌——人物出场与外貌由随后单独介绍的 impression 承接（印象段会写"这是一位……"）
3. 只写承接动作（敲门/门开/走出/相迎/招呼），不要写外貌细节——外貌稍后单独介绍
4. 禁止虚构超出模块描述的物件（如电话、听筒、手机、报纸等）；除非模块明确提到
5. 动作必须符合玩家在屋外/门口的空间位置：NPC 从屋内出来迎客，而不是 NPC 抢先冲出屋外、离开房子
6. 只用模块提供的信息做推断，不添加模块没有的事实
7. **叙事必须采用第二人称"你/你们"视角**（调查员在场经历），NPC 是"你们看到/听到/察觉"的对象，不得用旁观者第三人称（如"他们看到"应写成"你们看到"）`;

/**
 * 生成场景「开场氛围 → 首位 NPC」的承接过渡。
 * 场景有 openingAtmosphere（如"孩子玩球跑回屋内"）时，首位 NPC 出场前调用，
 * 只做"承接动作"衔接（孩子进屋→大人开门/走出），外貌由后续 impression 单独给出。
 * @param nextNpc 首位登场的 NPC
 */
export async function generateOpeningTransition(
  nextNpc: ModuleNPC,
  scene: { name: string; description: string },
  openingAtmosphere: string,
  llm: LLMClient | null,
  world?: WorldContext | null,
): Promise<string> {
  const clean = (s: string) => s.replace(/[（(].*[）)]$/, "").trim();
  const nextCtx = buildNpcContext(nextNpc);
  if (llm) {
    try {
      const prompt = PROMPT_TEMPLATE_OPENING_TRANSITION
        .replace(/\{sceneName\}/g, scene.name)
        .replace(/\{sceneDescription\}/g, scene.description || "")
        .replace(/\{worldContext\}/g, renderWorldContext(world))
        .replace(/\{openingAtmosphere\}/g, openingAtmosphere)
        .replace(/\{nextName\}/g, clean(nextNpc.name))
        .replace(/\{nextRole\}/g, nextCtx.role)
        .replace(/\{nextPersonality\}/g, nextCtx.personality)
        .replace(/\{nextDescription\}/g, nextNpc.description || "");
      const raw = await llm.chat([
        { role: "system", content: SYSTEM_PROMPT_NPC_TRANSITION },
        { role: "user", content: prompt },
      ], { temperature: 0.8, maxTokens: 120, timeout: 120000 });
      const t = raw.trim();
      // 时代违禁词过滤：1920 年代不存在无线/无绳通讯，发现即弃用 LLM 结果走模板
      if (/手机|电话听筒|无绳电话|对讲机|打电话|接电话|挂断电话|冲出屋外|冲出屋子/.test(t)) {
        throw new Error("opening transition contains anachronism");
      }
      if (t.length > 0 && t.length < 120) return t;
    } catch {
      // fall through to template
    }
  }
  // 模板 fallback：承接动作衔接氛围（如"片刻后门被拉开"），不含外貌
  const name = clean(nextNpc.name);
  const descNoAge = (nextNpc.description || "").replace(/^\d+\s*岁[。，]?\s*/, "");
  const isDoorOpener = /开门|从门|门口|门后/.test(descNoAge);
  const variants = isDoorOpener
    ? [
        `片刻后，屋门被从里面拉开——`,
        `过了片刻，那扇屋门吱呀一声从里面打开。`,
        `一阵脚步声从屋内传来，紧接着门被拉开。`,
      ]
    : [
        `就在这时，一个身影从${name.replace(/。/g, "")}的方向转了出来。`,
        `片刻后，一个身影朝你们走来——是${name}。`,
      ];
  return variants[Math.floor(Math.random() * variants.length)];
}

/**
 * 生成场景内 NPC 之间的过渡衔接（如菲碧说完后米尔出场）
 * @param prevNpc 上一位已结束对话的 NPC
 * @param nextNpc 即将登场的 NPC
 * @param scene 当前场景（名称/描述/氛围）
 * @param llm 可选的 LLMClient（有则用 API，无则走模板 fallback）
 */
export async function generateNpcTransition(
  prevNpc: ModuleNPC,
  nextNpc: ModuleNPC,
  scene: { name: string; description: string },
  llm: LLMClient | null,
  world?: WorldContext | null,
  prevLines?: string,
): Promise<string> {
  const clean = (s: string) => s.replace(/[（(].*[）)]$/, "").trim();
  const prevCtx = buildNpcContext(prevNpc);
  const nextCtx = buildNpcContext(nextNpc);
  // 剥离年龄前缀后再取第一句，避免 "5岁。特里坎家的小女儿。..." 被截成 "5岁"
  // 若作者手写了 entrance（叙事口吻出场描写），优先作为 LLM 素材
  const entranceForPrompt = (nextNpc.entrance || "").trim();
  const descNoAge = (nextNpc.description || "").replace(/^\d+\s*岁[。，]?\s*/, "");
  const nextDesc = entranceForPrompt || descNoAge.split(/[。！？]/)[0] || "";
  if (llm) {
    try {
      const prompt = PROMPT_TEMPLATE_NPC_TRANSITION
        .replace(/\{sceneName\}/g, scene.name)
        .replace(/\{sceneDescription\}/g, scene.description || "")
        .replace(/\{worldContext\}/g, renderWorldContext(world))
        .replace(/\{prevName\}/g, clean(prevNpc.name))
        .replace(/\{prevRole\}/g, prevCtx.role)
        .replace(/\{prevPersonality\}/g, prevCtx.personality)
        .replace(/\{prevLines\}/g, prevLines || "（无——上一位 NPC 尚未说过话）")
        .replace(/\{nextName\}/g, clean(nextNpc.name))
        .replace(/\{nextRole\}/g, nextCtx.role)
        .replace(/\{nextPersonality\}/g, nextCtx.personality)
        .replace(/\{nextDescription\}/g, nextDesc);

      const raw = await llm.chat([
        { role: "system", content: SYSTEM_PROMPT_NPC_TRANSITION },
        { role: "user", content: prompt },
      ], { temperature: 0.8, maxTokens: 120, timeout: 120000 });

      const t = raw.trim();
      if (t.length > 0 && t.length < 120) return t;
    } catch {
      // fall through to template
    }
  }

  // 模板 fallback
  // 优先使用作者手写的出场描写（叙事口吻的当下动作），如
  // "米尔·特里坎正在屋外的篮球场玩球，见你们走近，丢下皮球跑回屋内寻找母亲。"
  // 没有 entrance 时退回"身份——名字"的简单出场（绝不直接念 description 数据稿）。
  const entrance = (nextNpc.entrance || "").trim();
  if (entrance) {
    // 剥离作者手写时已带的连接词（如"就在这时，"），避免模板前缀重复拼出"就在这时，就在这时"
    const coreEntrance = entrance.replace(/^(就在这时|话音未落|忽然|突然)[，,、]?/, "");
    const entranceVariants = [
      entrance,
      `就在这时，${coreEntrance}`,
      `话音未落，${coreEntrance}`,
      `一阵脚步声由远及近——${coreEntrance}`,
    ];
    return entranceVariants[Math.floor(Math.random() * entranceVariants.length)];
  }

  const descNoAgeFull = (nextNpc.description || "").replace(/^\d+\s*岁[。，]?\s*/, "").trim();
  const name = clean(nextNpc.name);
  // 机制/属性类描述（stat block，如"每回合攻击2次"）不能当同位语——只留名字
  const isMechanic = /每回合攻击|格斗|闪避|伤害|HP|MP|d\d|%|法术/.test(descNoAgeFull);
  // 拆句：身份句（首句）+ 行为句（后续句，含动作过程）
  const sentences = descNoAgeFull.split(/[。！？]/).map(s => s.trim()).filter(Boolean);
  const identity = sentences[0] || "";
  const intro = identity && !isMechanic ? `${identity}——${name}` : name;
  const entrances = [
    `${intro}从一旁走了过来。`,
    `${intro}的身影出现在${scene.name}中。`,
    `${intro}出现在${scene.name}的门口。`,
    `${intro}来到了${scene.name}。`,
  ];
  return entrances[Math.floor(Math.random() * entrances.length)];
}

// ============================================================
// 失败补救（failback）— 连续检定失败后，关键线索改道可得
// ============================================================

const SYSTEM_PROMPT_FAIL_RESCUE = `你是一个 1920 年代 CoC 跑团主持人（KP）。调查员在关键线索的检定上连续失败（甚至大失败）。
你的任务：生成一段简短的补救叙事（1-3 句），让这条关键线索以【另一种方式】被找到——但必须有代价或转折，不能是"白送"。
原则：
- 线索必须通过替代途径浮现：NPC 主动递话 / 环境意外暴露 / 调查员凭借直觉重新审视（可让玩家付出 SAN 代价）
- 叙事保持 1920 年代 CoC 克苏鲁氛围，中文
- 只输出叙事文本，不要解释、不要标题、不要引号`;

const PROMPT_TEMPLATE_FAIL_RESCUE = `场景: {sceneName}
场景描述: {sceneDescription}
{worldContext}
调查员反复搜寻的关键线索: {clueName}
线索原本的获取方式: {clueMethod}
已连续失败次数: {failCount}{failCountNote}

请给出这条线索被"改道找到"的补救叙事。`;

/** 生成"失败补救"叙事——LLM 可用时生成；不可用/失败时降级到模板 */
export async function generateFailRescue(
  clue: { name: string; description?: string },
  scene: { name: string; description?: string },
  failCount: number,
  llm: LLMClient | null,
  world?: WorldContext | null,
): Promise<string> {
  if (llm) {
    try {
      const methods = clue.description
        ? clue.description.split(/[。；;]/)[0].slice(0, 60)
        : "";
      const prompt = PROMPT_TEMPLATE_FAIL_RESCUE
        .replace(/\{sceneName\}/g, scene.name || "")
        .replace(/\{sceneDescription\}/g, (scene.description || "").slice(0, 120))
        .replace(/\{worldContext\}/g, renderWorldContext(world))
        .replace(/\{clueName\}/g, clue.name || "")
        .replace(/\{clueMethod\}/g, methods || "未知")
        .replace(/\{failCount\}/g, String(failCount))
        .replace(/\{failCountNote\}/g, failCount >= 3 ? "\n（多次失败，线索应当以更直接的方式出现，但代价也更重）" : "");

      const raw = await llm.chat([
        { role: "system", content: SYSTEM_PROMPT_FAIL_RESCUE },
        { role: "user", content: prompt },
      ], { temperature: 0.85, maxTokens: 150, timeout: 120000 });

      const t = raw.trim();
      if (t.length > 8 && t.length < 150) return t;
    } catch {
      // fall through to template
    }
  }

  // 模板 fallback
  const fallbacks = [
    "正当你们准备放弃时，一阵细微的响动吸引了注意——在某个不起眼的角落，线索静静地躺在那里，仿佛一直在等你们。",
    "反复搜寻无果后，你们决定换个角度。这一次，运气终于站在了你们这边。",
    "一个不经意的转身，让所有人的目光落在了一处此前被忽略的地方——正是要找的东西。",
  ];
  return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

const SYSTEM_PROMPT_CLUE_REVELATION = `你是一个 1920 年代 CoC 跑团主持人（KP）。调查员在场景检定的【成功】后发现了线索。
你的任务：把这条线索的发现过程写成一段简短的情景叙述（2-3 句，60-120 字）——描写调查员的动作、视线、发现瞬间的细节与氛围，让读者"看到"发现过程，而不是"读到结果清单"。
原则：
- 用叙述带出线索：谁在什么位置、翻找/注视/触碰的动作、发现的瞬间（如"她掀开床垫一角，下面压着……"），不要写成"找到了一些毒品"这类结果直述
- 线索的关键信息必须完整保留（名称与细节），可以补充动作/位置/光线等现场描写
- 1920 年代 CoC 氛围，中文，只输出叙事文本，不要解释、不要标题、不要引号`;

const PROMPT_TEMPLATE_CLUE_REVELATION = `场景: {sceneName}
场景描述: {sceneDescription}
{worldContext}
检定的调查员: {investigator}
发现的线索: {clueName}
线索描述: {clueDescription}
线索揭示文本: {revelation}

请给出这条线索被发现的情景叙述。`;

/** 生成侦查/检定成功后的线索发现叙述——LLM 可用时生成；不可用/失败返回空串（调用方降级 flavor+revelation） */
export async function generateClueRevelation(
  clue: { name: string; description?: string; revelation?: string },
  scene: { name: string; description?: string },
  investigator: string,
  llm: LLMClient | null,
  world?: WorldContext | null,
): Promise<string> {
  if (llm) {
    try {
      const prompt = PROMPT_TEMPLATE_CLUE_REVELATION
        .replace(/\{sceneName\}/g, scene.name || "")
        .replace(/\{sceneDescription\}/g, (scene.description || "").slice(0, 120))
        .replace(/\{worldContext\}/g, renderWorldContext(world))
        .replace(/\{investigator\}/g, investigator || "调查员")
        .replace(/\{clueName\}/g, clue.name || "")
        .replace(/\{clueDescription\}/g, (clue.description || "").slice(0, 120))
        .replace(/\{revelation\}/g, clue.revelation || "");

      const raw = await llm.chat([
        { role: "system", content: SYSTEM_PROMPT_CLUE_REVELATION },
        { role: "user", content: prompt },
      ], { temperature: 0.85, maxTokens: 200, timeout: 120000 });

      const t = raw.trim();
      if (t.length > 10 && t.length < 200) return t;
    } catch {
      // fall through to template
    }
  }
  return "";
}
