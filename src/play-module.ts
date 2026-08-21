// 普瑞米尔的谷仓 — 交互式跑团模拟
// 核心架构：KP 场景描述 -> PL 决策 -> 引擎检定 -> 世界推进
// 有 LLM 时 LLM 驱动，无 LLM 时模板驱动
// bun run src/play-module.ts

import { createCoCCharacter, getCoCArchetypes, resolveCheckValue, type CoCGeneratedCharacter, type BackgroundProfile } from "./character/coc-character";
import { randomCoCName, buildBaseBackgroundProfile, composeBackstory, pickDistinctArchetypes, randomPersonAnchors, type PersonAnchors } from "./character/background-profile";
import { CoCEngine, SanityEngine, SUCCESS_LEVEL_LABELS, sanOutcomeLabel, type CoCCheckResult } from "./rules/coc-engine";
import { BARN_OF_PREMIER, BARN_SUPPORT, renderPrologue, renderPartySetup, evaluateEpilogues } from "./module/barn-of-premier";
import { WorldState } from "./world/state";
import { PlayerAgent, createPlayerCharacter, occupationTagWeight } from "./agent/player-agent";
import { displayCharacterSheet, characterSummary, getHighlightedSkills } from "./pl/character-display";
import type { Clue, Scene, SceneConnection, ModuleNPC, ModuleData, ModuleItem, ModuleSupport, NPCInstanceState, NarrativeEntity } from "./module/types";
import type { PlayerDecision } from "./agent/player-agent";
import { buildNpcContext, generateNpcReply, generatePcQuestion, generateNpcTransition, generateOpeningTransition, generateFailRescue, generateClueRevelation } from "./llm/npc-dialogue-prompts";
import type { SceneContext, WorldContext } from "./llm/npc-dialogue-prompts";
import { LLMClient, extractMessageContent } from "./llm/client";
import { applyAllLlmExpandedWithLLM } from "./llm/generate-llm-expanded";
import { analyzeThreats, getWeaponPolicy } from "./module/threat-analyzer";
import { checkDialogueText } from "./world/world-constraint";
import { sharedWorldModel, DEFAULT_CTHULHU_PATH } from "./world/world-model-loader";
import { WorldModelIntegrator, type SceneContext as WmSceneContext } from "./world/world-model-integrator";

import { writeFileSync, mkdirSync } from "fs";
import { calcSeverity, severityLabel, woundPenaltyDice, type WoundSeverity } from "./combat/wound-effects";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 一局的运行上下文。
 *
 * 用 AsyncLocalStorage 而不是模块级变量：原先输出写在模块级的 log 数组里，
 * 一个进程只能跑一局。接进 API 之后会有多局并发，而它们在每个 await 处交错，
 * 共享一个数组会让两局的播报串台。异步上下文能让 runModule 里所有嵌套调用
 * （包括那些定义在 runModule 之外的辅助函数）自动拿到本局的那一份。
 */
// 播报输出层已抽到 src/play/narration.ts —— 拆出去的子模块要够到 say()，
// 留在这里它们就得反过来 import play-module，成环。
export type { LineOrigin, Decider, RunContext } from "./play/narration";
import { runCtx, say, sayMech, divider } from "./play/narration";
import {
  buildPcImpression, stripDoorOpenPrefix, stripDialogueLead, classifySpeechStyle,
  mentalVoiceBridge, handleNonSpeakingNpc, brainwaveFlavor, buildIdentityLine,
  buildDialogueForRel, buildFollowUp, buildToneBridge, revealNpcKnowledge,
  generateNpcDialogue,
} from "./play/npc-dialogue";
import {
  analyseNpcData, splitLeadingStageDirection, stripOuterQuotes, quoteDialogue, noteEntityMentions,
  partnerRemark, speechLead, askerScore,
} from "./play/npc-text";
import {
  check, sanCheck, applyDamage, discoveryFlavor, failFlavor,
  recordWound, healWound, woundPenaltyOf,
} from "./play/checks";
import { runSceneTraps } from "./play/traps";
import { newCursor, newDedup, standing, type Cast, type WorldModelCtx } from "./play/run-state";
import { buildWmContext, buildWorldContext } from "./play/llm-context";
import {
  runClueCheck, narrateClueDiscovery, checkClueSanLoss, investigableClues,
  isPassiveClue, sayPartnerRemark, sanitizeRevelation,
  MAX_SCENE_ACTIONS, type ClueCtx,
} from "./play/clue-check";
import { nextRevealBridge } from "./play/reveal-bridge";
import { runCombatEncounter } from "./play/combat";
import { processScene, type SceneCtx } from "./play/scene-pipeline";
import { rollDice, trapsInScene, attributeValue, isMajorWound } from "./play/trap-util";
// 这几个测试按老路径从 play-module import，转出去别断
export { worseWound } from "./play/checks";
export { rollDice, trapsInScene, attributeValue, isMajorWound } from "./play/trap-util";
export { partnerRemark, speechLead, askerScore } from "./play/npc-text";
export {
  noticesEntity, isRedundantMoveLine, chooseConnection,
  type MoveWorldView, type MoveChoice,
} from "./play/move-util";
import type { LineOrigin, Decider, RunContext } from "./play/narration";

// ====== 模块级工具：供 runModule 内外所有层可见 ======
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/**
 * 这个职业会不会下意识把话里的东西和眼前景物对上。
 *
 * 抽成模块级纯函数只为一件事：能测。识别桥段的其余部分（提起过／看得见／没演过）
 * 都在 WorldState 上，测得到；唯独这道职业门原先长在 runModuleInner 的闭包里，
 * 拿不到手，而它恰恰是最容易悄悄失效的一处 ——
 * 比的是 pc.occupation，那是 archetype.label（中文「私家侦探」），
 * 不是角色卡上印的 archetype.id（英文 sailor）。谁把 label 改成英文或改了字，
 * 门就再也开不了，不报错、不失败，只是这段桥从此不再出现。
 *
 * noticedBy 留空表示人人都会注意到。
 */

/** 场景氛围要点：给 LLM 做风格约束的精简描述（防 prologue 与进场描述重复） */
function extractSceneEssence(description: string): string {
  const first = (description ?? "").split(/[。；\n]/)[0]?.trim() ?? "";
  return first.length > 60 ? first.slice(0, 60) + "…" : first;
}

// ── 角色创建 ──
async function createPC(name: string, archId: string, archetype: any) {
  return await createCoCCharacter({ name, archetypeId: archId, method: "point_buy" as const, pointBudget: 480 }, archetype);
}

// ====== 车卡随机化 + 背景故事生成 ======
// 每次开新局随机抽取职业与人名，打破"固定两人同职业"；
// 八项背景元素（形象/信念/重要之人/意义之地/宝贵之物/特质/伤口疤痕/恐惧症躁狂症）先由模板池生成，
// 再经 LLM 增强并据此撰写背景故事（LLM 不可用时回退模板拼接）。

/**
 * 这一局到底能不能打 LLM。
 *
 * 抽出来是因为原先有两份判据：`llmOnce` 只看有没有 key，
 * runModuleInner 里那份还看 `LLM_DISABLED`/`LLM_MODE`。
 * 于是开发机上只要 key 在环境里，`LLM_DISABLED=true` **拦不住车卡阶段打网络** ——
 * 离线跑（测试、CI）会莫名其妙变慢甚至挂在超时上。两份判据只留一份。
 */
export function llmEnabled(): boolean {
  if (process.env.LLM_DISABLED === "true" || process.env.LLM_MODE === "template") return false;
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "sk-placeholder" || apiKey.startsWith("${")) return false;
  return true;
}

/** 一次 LLM 对话（不可用/失败 → 返回空串，由调用方回退） */
async function llmOnce(system: string, user: string, maxTokens = 500): Promise<string> {
  if (!llmEnabled()) return "";
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  try {
    const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
    const model = process.env.LLM_MODEL || "gpt-4o-mini";
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.85,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (!resp.ok) return "";
    const data = await resp.json();
    return extractMessageContent(data).trim();
  } catch {
    return "";
  }
}

/**
 * LLM 增强八项背景元素：按 职业+时代+人设锚点 从零塑造八项（草稿仅作失败兜底，不喂给 LLM）。
 *
 * 刻意不喂案件背景：八项是这个人在被卷进案子之前就有的东西。把案情喂进来，
 * 模型会把每一项都写成伏笔 —— 实跑里出现过"他怀表中那早已停摆的指针仿佛与墓园里
 * 那些无碑孤魂的低语产生共鸣，让他隐约察觉到加比的失踪背后……"，一个还没接案子的人
 * 已经预感到了案情。人物档案要独立于模组。
 */
async function enhanceBackgroundProfile(
  base: BackgroundProfile,
  ctx: { name: string; occupation: string; era: string; anchors: PersonAnchors },
): Promise<BackgroundProfile> {
  const prompt = [
    `为以下 CoC 7e 调查员塑造"背景故事八项"。`,
    `名字: ${ctx.name}  职业: ${ctx.occupation}  时代: ${ctx.era}年  年龄: ${ctx.anchors.age}岁`,
    `家庭状况: ${ctx.anchors.household}`,
    `出身来历: ${ctx.anchors.provenance}`,
    ``,
    `围绕上面这个具体的人，从零写出八项。硬性要求：`,
    `1. 八项必须属于同一个人：年龄、家庭、出身要能在八项里相互印证，读起来像一份真人档案，而不是职业的抽象化身`,
    `2. 用事实、习惯、具体经历描写（如"他总在周五晚上去酒吧角落独坐"）；禁止比喻句和形容词堆砌，"眼神如停尸房般冷冽审视"这类句子是反面教材，一律不要出现`,
    `3. 每项 1-2 句话、不超过 80 字`,
    `4. 贴合 ${ctx.era} 年（1920s 美国小镇）的生活质感：物件、场所、称谓都要符合那个年代`,
    ``,
    `严格按以下 JSON 输出（不要 markdown 代码块、不要其他文字）：`,
    `{"appearance":"…","beliefs":"…","significantPeople":"…","meaningfulPlace":"…","treasuredPossession":"…","traits":"…","woundsAndScars":"…","phobiasAndManias":"…"}`,
  ].join("\n");
  const raw = await llmOnce("你是 CoC 7e 车卡系统，输出严格 JSON。", prompt, 600);
  if (!raw) return base;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return base;
    const parsed = JSON.parse(m[0]);
    return {
      appearance: parsed.appearance || base.appearance,
      beliefs: parsed.beliefs || base.beliefs,
      significantPeople: parsed.significantPeople || base.significantPeople,
      meaningfulPlace: parsed.meaningfulPlace || base.meaningfulPlace,
      treasuredPossession: parsed.treasuredPossession || base.treasuredPossession,
      traits: parsed.traits || base.traits,
      woundsAndScars: parsed.woundsAndScars || base.woundsAndScars,
      phobiasAndManias: parsed.phobiasAndManias || base.phobiasAndManias,
    };
  } catch {
    return base;
  }
}

/**
 * LLM 依据八项撰写背景故事（3-5 句连贯叙事）；失败回退模板拼接。
 *
 * 同 enhanceBackgroundProfile：不喂案件背景，也不要求结尾留悬念。
 * 原先那句"结尾留一点与调查有关的悬念"是purple prose 的直接来源 ——
 * 模型为了收束到悬念，会把怀表、墓园、祷告一路堆到"比罪恶更古老的黑暗"。
 * 小传写完这个人就够了，与案件的关系由卷入方式（hooks）交代。
 */
async function writeBackstory(
  profile: BackgroundProfile,
  ctx: { name: string; occupation: string; era: string },
): Promise<string> {
  const fallback = composeBackstory(profile, { name: ctx.name, occupation: ctx.occupation, era: ctx.era });
  const prompt = [
    `依据以下 CoC 7e 调查员的八项背景元素，撰写一段 3-5 句的连贯背景故事。`,
    `要求：用第三人称自然叙事，把这些元素织进一段真实可感的人生里；不要逐条罗列八项；不要出现"形象描述：""思想与信念："这类标签。`,
    `只写这个人自己：不要提到任何案件、失踪者或调查，也不要在结尾留悬念或作命运暗示。`,
    ``,
    `名字: ${ctx.name}  职业: ${ctx.occupation}  时代: ${ctx.era}年`,
    ``,
    `【八项背景元素】`,
    `形象描述: ${profile.appearance}`,
    `思想与信念: ${profile.beliefs}`,
    `重要之人: ${profile.significantPeople}`,
    `意义非凡之地: ${profile.meaningfulPlace}`,
    `宝贵之物: ${profile.treasuredPossession}`,
    `特质: ${profile.traits}`,
    `伤口和疤痕: ${profile.woundsAndScars}`,
    `恐惧症和躁狂症: ${profile.phobiasAndManias}`,
  ].join("\n");
  const raw = await llmOnce("你是 CoC 跑团主持人，擅长撰写调查员背景故事。用中文输出，简洁克制。", prompt, 400);
  return raw && raw.length >= 20 ? raw : fallback;
}

/**
 * 随机创建一名调查员：随机职业（避开已用职业）+ 随机人名 + 八项背景 + 背景故事。
 * 返回与 ModulePlayerSetup 兼容的配置对象。
 */
async function createRandomPlayerSetup(
  module: ModuleData,
  usedArchetypeIds: string[],
): Promise<{ p0: any; pc: CoCGeneratedCharacter }> {
  const archs = getCoCArchetypes();
  const available = archs.filter(a => !usedArchetypeIds.includes(a.id));
  const archetype = pick(available.length > 0 ? available : archs);
  const { full, short } = randomCoCName(archetype.id);
  const pc = await createPC(full, archetype.id, archetype);
  const anchors = randomPersonAnchors();
  const profile = await enhanceBackgroundProfile(pc.backgroundProfile ?? buildBaseBackgroundProfile(archetype), {
    name: full, occupation: archetype.label, era: module.era, anchors,
  });
  pc.backgroundProfile = profile;
  pc.backstory = await writeBackstory(profile, { name: full, occupation: archetype.label, era: module.era });
  return {
    p0: {
      name: full,
      shortName: short,
      archetypeId: archetype.id,
      occupation: archetype.label,
      personality: profile.traits,
      background: pc.backstory,
      motive: `查明${module.title}案件的真相`,
    },
    pc,
  };
}


// ── 主流程 ──
// 引擎通用化：module 承载纯数据（场景/线索/NPC），support 承载模块专属钩子/常量
// （SAN 映射、结局评估、战斗遭遇、枢纽/终局定位、调查员配置）。
// 新模组接入 = 提供 ModuleData + ModuleSupport，无需改动引擎。
export interface RunOptions {
  /**
   * 每产生一行播报就回调一次；CLI 传 console.log，API 会话推进消息流。
   *
   * origin 供语音层分流（见 LineOrigin）。只关心文本的调用方照旧写
   * `(line) => ...` 即可 —— 少接一个参数在类型上是合法的。
   */
  onLine?: (line: string, origin: LineOrigin) => void;
  /** 由谁做决策。缺省用内置 AI 玩家，即原有的自动跑法 */
  decide?: Decider;
}

/**
 * 跑一局剧本。返回本局的全部播报行。
 *
 * 真正的流程在 runModuleInner，这里只负责建立本局的异步上下文 ——
 * say() 与决策点都从上下文里取，因此多局并发互不干扰。
 */
export async function runModule(
  module: ModuleData,
  support: ModuleSupport,
  opts: RunOptions = {},
): Promise<{ lines: string[]; origins: LineOrigin[] }> {
  const ctx: RunContext = { lines: [], origins: [], onLine: opts.onLine, decide: opts.decide, wounds: new Map() };
  await runCtx.run(ctx, () => runModuleInner(module, support));
  return { lines: ctx.lines, origins: ctx.origins };
}

async function runModuleInner(module: ModuleData, support: ModuleSupport) {
  divider(`\u300a${module.title}\u300bCoC 7e \u4ea4\u4e92\u5f0f\u6a21\u62df`);

  // 1. Create characters — 车卡随机化：随机职业+人名，八项背景+背景故事
  // 默认两名调查员（模块 players 配置仅作为人数/兜底参考，不再写死身份）
  const r1 = await createRandomPlayerSetup(module, []);
  const r2 = await createRandomPlayerSetup(module, [r1.p0.archetypeId]);
  const p0 = r1.p0;
  const p1 = r2.p0;
  const c1 = r1.pc;
  const c2 = r2.pc;

  const san1 = new SanityEngine(c1.attributes.power ?? 50);
  san1.state.currentSAN = c1.attributes.power ?? 50;
  san1.state.maxSAN = c1.attributes.power ?? 50;
  const san2 = new SanityEngine(c2.attributes.power ?? 50);
  san2.state.currentSAN = c2.attributes.power ?? 50;
  san2.state.maxSAN = c2.attributes.power ?? 50;

  // 名字/角色卡/SAN 引擎三者一一对应，收成一个概念传给下游 ——
  // 散着传最容易出的错是错位：拿 p0 的名字配 c2 的角色卡，
  // 日志上看不出来（名字是对的），掉的却是另一个人的血。
  const cast: Cast = { p0, p1, c1, c2, san1, san2 };

  // 1.5 模块威胁分析 → 武器许可重审
  const threat = analyzeThreats(module, {
    encounterNarrations: support.encounters,
    traumaticClues: support.traumaticClues,
  });
  // archetypeId → 中文字段（用于 getWeaponPolicy 的职业判断）
  const archetypeLabel = (id: string): string => ({
    investigator: "调查员·警官", archaeologist: "考古学家", antiquarian: "古物学者",
    journalist_coc: "记者", dilettante: "业余艺术爱好者", doctor_medicine: "医生",
    engineer: "工程师", soldier: "士兵", librarian: "图书馆管理员",
    occultist: "神秘学家", parapsychologist: "超心理学家", photographer: "摄影师",
    pilot: "飞行员", professor: "教授", scientist: "科学家",
    psychiatrist: "精神科医生", artist: "艺术家", musician: "音乐家",
    athlete: "运动员", boxer: "拳击手", mechanic: "机械师",
    explorer: "探险家", missionary: "传教士", firefighter: "消防员",
    undertaker: "殡葬师", antique_dealer: "古董商", architect: "建筑师",
    drifter: "流浪者", forester: "林务员", hunter_trapper: "猎人/捕兽者",
    lumberjack: "伐木工", museum_curator: "博物馆馆长",
    detective: "私家侦探", driver: "司机",
    federal_agent: "联邦探员", hacker: "黑客", criminal: "罪犯",
    police: "警察", nurse: "护士", lawyer: "律师",
  }[id] ?? id);
  // 先报威胁评分，再报配枪结论 —— 配枪本来就是拿威胁分算出来的（见下面的 getWeaponPolicy），
  // 原先反过来印，读日志的人会以为是先定了配枪再回头评估威胁。
  const THREAT_LABELS: Record<string, string> = { easy:"简单", medium:"中等", hard:"困难", deadly:"致命" };
  sayMech(`模组威胁评分: ${threat.score}（${THREAT_LABELS[threat.tier]}）— 详情: ${threat.details.hostileNpcCount}敌对NPC, ${threat.details.trapCount}陷阱, ${threat.details.hardCheckCount}困难${threat.details.extremeCheckCount > 0 ? `+${threat.details.extremeCheckCount}极难` : ""}检定`);

  const weaponRule = (pc: CoCGeneratedCharacter) => {
    // 只有手枪超过 base (20%) 才算受过射击训练——步枪/机枪 base 低但自动分配后所有人都会超过
    const hasFirearms = ((pc.skillValues as any)["firearms_pistol"] ?? 20) > 20;
    return getWeaponPolicy(threat, hasFirearms, archetypeLabel(pc.archetypeId), pc.creditRating ?? 0);
  };
  for (const pc of [c1, c2]) {
    const policy = weaponRule(pc);
    // 从 CR 发放的物品中移除或修正枪械（如 wealthy 默含左轮手枪×6发）
    if (!policy.allowed) {
      pc.startingItems = pc.startingItems.filter(i => !i.includes("手枪") && !i.includes("枪"));
      say(`  ➜ 武器携带评估 · ${pc.name}：不配发枪械——${policy.deniedReason ?? "不允许持枪。"}`);
    } else {
      // 替换已有枪械的弹药数（未含枪者不补发，仅校正既有枪支）
      if (policy.ammo > 0) {
        pc.startingItems = pc.startingItems.map(i =>
          /手枪|左轮/.test(i) ? `${policy.weaponType === "pistol" ? "自动手枪" : "左轮手枪"}×${policy.ammo}发` : i
        );
      }
      const weaponLabel = policy.weaponType === "pistol" ? "自动手枪" : "左轮手枪";
      const ammoLabel = policy.ammo > 0 ? `×${policy.ammo}发` : "";
      say(`  ➜ 武器携带评估 · ${pc.name}：获准配枪——${weaponLabel}${ammoLabel}。`);
    }
  }

  // 2. Show full sheets
  divider("调查员创建完成");
  say(displayCharacterSheet(c1));
  say(displayCharacterSheet(c2));

  // 3. Init world + agents — 调查员角色卡来自 support.players
  const world = new WorldState(module);

  // ── 世界模型（权威事实层，DESIGN-LOG §1）：懒加载；文件缺失/损坏时静默降级为 null ──
  // 三样收进 wm（见 play/run-state.ts）：上下文构建器抽出去之后
  // 谁都不该再从闭包里摸这几个变量。
  let wmIntegrator: WorldModelIntegrator | null = null;
  try {
    // 必须走共享实例：v18 是 383688 条只读参考数据，独占一份约 229MB。
    // 命令行下一进程一局，自己 new 一个无所谓；接进服务端之后每开一局
    // 就会再吃一份，实测日志里已经出现过同一份模型被载入两次。
    const wmLoader = sharedWorldModel();
    if (!wmLoader.isLoaded()) wmLoader.load();
    wmIntegrator = new WorldModelIntegrator(wmLoader);
  } catch {
    wmIntegrator = null; // 世界模型不可用 → 跳过注入，其余流程不受影响
  }
  const wm: WorldModelCtx = {
    integrator: wmIntegrator,
    // 克苏鲁神话世界模型：同样共享，按路径各一份
    cthulhuLoader: sharedWorldModel(DEFAULT_CTHULHU_PATH),
    cacheSceneId: "",
    cacheText: "",
  };

  const pl1 = new PlayerAgent(createPlayerCharacter(
    c1, p0.name, p0.occupation, p0.personality, p0.background, p0.motive,
  ));
  const pl2 = new PlayerAgent(createPlayerCharacter(
    c2, p1.name, p1.occupation, p1.personality, p1.background, p1.motive,
  ));

  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const llmOk = llmEnabled(); // 判据见 llmEnabled —— 别再在这里重写一份
  const llmClient: LLMClient | null = llmOk
    ? new LLMClient({
        apiKey,
        baseUrl: process.env.LLM_BASE_URL || "https://api.openai.com/v1",
        model: process.env.LLM_MODEL || "gpt-4o-mini",
        maxTokens: parseInt(process.env.LLM_MAX_TOKENS || "1024"),
        temperature: parseFloat(process.env.LLM_TEMPERATURE || "0.7"),
      })
    : null;

  // ── NPC 对话数据：LLM 可用时用 LLM 生成（覆盖模板生成，手写黄金标准不被覆盖） ──
  if (llmClient) {
    try {
      await applyAllLlmExpandedWithLLM(module.npcs, llmClient, module.scenes);
    } catch {
      // LLM 失败 → 保持模块加载时生成的模板数据
    }
  }

  // ── Prologue generator: LLM-driven, falls back to module data ──
  async function generatePrologue(
    a: PlayerAgent, b: PlayerAgent,
  ): Promise<string[]> {
    const hooks = module.partySetup?.hooks ?? [];
    const hookText = (i: number, name: string, occupation: string) =>
      (hooks[i] ?? "")
        .replace(/\{name\}/g, name)
        .replace(/\{occupation\}/g, occupation);
    // 案件起点场景：首个场景的名称与描述——开场地点必须据此，禁止凭想象改写
    const startScene = module.scenes?.[0];
    const prompt = [
      `你是一个 1920 年代 CoC 跑团主持人（KP）。请根据以下信息，为模组《${module.title}》写一段开场叙事。`,
      ``,
      `时代背景: ${module.era}年。案件背景见下方【案件】。`,
      ``,
      `【调查员 1】`,
      `名字: ${a.name}`,
      `职业: ${a.pc.occupation}`,
      `性格: ${a.pc.personality}`,
      `背景: ${a.pc.backstory}`,
      ...(hookText(0, a.name, a.pc.occupation) ? [`卷入方式: ${hookText(0, a.name, a.pc.occupation)}`] : []),
      `目标: ${a.motive}`,
      ``,
      `【调查员 2】`,
      `名字: ${b.name}`,
      `职业: ${b.pc.occupation}`,
      `性格: ${b.pc.personality}`,
      `背景: ${b.pc.backstory}`,
      ...(hookText(1, b.name, b.pc.occupation) ? [`卷入方式: ${hookText(1, b.name, b.pc.occupation)}`] : []),
      `目标: ${b.motive}`,
      ``,
      `【案件】`,
      ...(module.partySetup?.context?.length
        ? module.partySetup.context.map(c => `- ${c}`)
        : [`- ${module.partySetup?.closing?.[0] ?? `你们受雇前往调查。`}`]),
      ``,
      `【案件起点场景（开场只做"抵达"的姿态，场景外观细节由进入时展示，不要在这里复述）】`,
      `场景名称: ${startScene?.name ?? module.title}`,
      `场景氛围要点: ${extractSceneEssence(startScene?.description ?? "")}`,
      ``,
      `要求:`,
      `- 自然地融入两名调查员的背景与卷入方式，让故事听起来像真实的发生`,
      `- 用 3-5 句精炼的中文叙事，不分点、不加括号注释`,
      `- 不要直接复制"背景"原文——把它变成角色的自然描述`,
      `- 结尾落在两人抵达案件起点场景（${startScene?.name ?? "起点"}）的门口/入口，只写"抵达/停车/走近"，不要展开室内外的细节描写（篮球场、拖车房、院落等留给进入场景时展示），地点整体风格须符合【场景氛围要点】而不是古宅/庄园/破败建筑`,
      `- **动作链必须完整**：若写了"停车"，必须写"熄火→下车→关上车门→走向门口"，不得出现"熄了火，两人并肩走向"这类跳过下车/关车门的断裂（人物不可能不下车就直接走向门口）`,
      `- 不得提前揭示案件真相、不得把调查员直接引向终局地点（如谷仓）、不得暗示结局`,
    ].join("\n");

    // Try LLM
    if (llmOk) {
      try {
        const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
        const baseUrl = process.env.LLM_BASE_URL || "https://api.openai.com/v1";
        const model = process.env.LLM_MODEL || "gpt-4o-mini";
        const resp = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: "你是一个 CoC 7e 跑团主持人。用中文输出，简洁克制，不分点不加注释。" },
              { role: "user", content: prompt },
            ],
            temperature: 0.8,
            max_tokens: 500,
          }),
          signal: AbortSignal.timeout(20000),
        });
        if (resp.ok) {
          const data = await resp.json();
          const content = extractMessageContent(data).trim();
          if (content) {
            const lines = content.split("\n").filter(l => l.trim()).map(l => l.trim());
            // 世界模型约束：开场叙事不得含时代科技/ meta 词汇，命中 → 降级模块文案
            if (lines.every(l => !checkDialogueText(l))) return lines;
          }
        }
      } catch { /* fall through */ }
    }

    // Fallback: partySetup (per-character hooks, no hierarchy)
    if (module.partySetup) {
      return renderPartySetup(
        module.partySetup,
        [
          { name: a.name, occupation: a.pc.occupation },
          { name: b.name, occupation: b.pc.occupation },
        ],
      );
    }

    // Fallback: authored prologue
    if (module.prologue) {
      return renderPrologue(
        module.prologue,
        { name: a.name, background: a.background, motive: a.motive },
        { name: b.name, background: b.background, motive: b.motive },
      );
    }

    // Last-resort fallback — 无 partySetup/prologue 时用模块元数据兜底。
    // 上面的 if (module.partySetup) 分支必定 return，所以走到这里 partySetup 一定为空：
    // 原先这里读 partySetup?.context / ?.closing，取值恒为 undefined，等同于下面的字面量。
    return [
      `${module.era}年。`,
      `一封委托信递到了${a.name}的手中。`,
      `${a.name}和${b.name}在约定地点碰头——调查开始了。`,
      `他们的调查，从这里开始……`,
    ];
  }

  say(`\n${"\u2501".repeat(48)}`);
  const prologueLines = await generatePrologue(pl1, pl2);
  for (const line of prologueLines) say(line);

  // ── Free-form NPC conversation helper ──
    // NPC 对话生成已抽到 src/play/npc-dialogue.ts（纯搬运，见该文件头部说明）

  /**
   * 识别桥段 —— NPC 刚提起的东西，正好就在眼前，于是有这习惯的调查员自己看了过去。
   *
   * 三个条件缺一不可（见 WorldState.getPendingRecognition）：被提起过、此刻看得见、还没演过。
   * 再加一道职业门：不是谁都会下意识把话里的东西和眼前景物对上，
   * 门开给所有人这段就不再是"某个人的习惯"，而是引擎在提示玩家该去哪。
   *
   * 命中即占用本轮，调用方直接 return —— 人在认出什么东西的当口，
   * 不会同时开口问下一个问题。
   */
    // NPC 对话生成已抽到 src/play/npc-dialogue.ts（纯搬运，见该文件头部说明）

  // ── Game loop: scene entry → exploration → analysis → advance ──
  //
  // 循环游标收进 cursor（见 play/run-state.ts）：
  // 这几个看着像局部变量，实际是跨场景的不变量，而且 stepCounter 是
  // 线索检定与陷阱**共享**的 —— 散在闭包里时这层共享看不出来，
  // arrivedByPlayerChoice 更是「静默传送」那个 bug 的所在。
  const cursor = newCursor();  const recentSceneIds: string[] = []; // anti-bounce: track last few scene transitions

  // 叙事去重（见 play/run-state.ts）—— 「上次用的是哪句」，避免连着两次一样
  const dedup = newDedup();

  // 场景流水线已抽到 src/play/scene-pipeline.ts
  // 当前场景由它内部从 world.currentScene 取 —— ctx 里其余东西整局不变，
  // 放进来就得每轮重建。
  const sceneCtx: SceneCtx = {
    module, support, world, cast, cursor, dedup, wm,
    agents: [pl1, pl2], llmClient,
  };

  while (!cursor.done && cursor.rounds < 40) {
    cursor.rounds++;
    const currentId = world.currentSceneId;
    recentSceneIds.push(currentId);
    if (recentSceneIds.length > 5) recentSceneIds.shift();

    // Anti-bounce: if same 2 scenes repeat 3+ times in last 6 moves, force end
    if (recentSceneIds.length >= 6) {
      const last6 = recentSceneIds.slice(-6);
      const unique = new Set(last6);
      if (unique.size <= 2) {
        cursor.done = true;
        break;
      }
    }
    // Hard limit: auto-redirect if scene visited 6+ times
    const visitCount = cursor.visitCount.get(currentId) ?? 0;
    // 玩家自己要来的地方不算数 —— 他说了要来，就让他来，来几次是他的事。
    // 兜底仍在：上面的 anti-bounce 和 rounds < 40 都还拦着，不会真的转不出去。
    if (visitCount >= 6 && currentId !== support.finaleSceneId && !cursor.arrivedByPlayerChoice) {
      const currentScene = module.scenes.find(s => s.id === currentId);
      const forcedConn = currentScene?.connections.find(c => !world.isSceneVisited(c.targetSceneId));
      if (forcedConn) {
        // 出声。原先这里是**静默**传送：玩家说"返回镇上"，
        // 引擎回一句"返回镇上。"，然后人在报亭，中间一个字都没有。
        say(`\n这地方已经翻来覆去看过太多遍，再耗下去也不会有新东西了。`, "verbatim");
        cursor.visitCount.set(currentId, visitCount + 1);
        cursor.arrivedByPlayerChoice = false;
        world.moveToScene(forcedConn.targetSceneId);
        continue;
      }
      cursor.done = true;
      break;
    }
    const nextConn = await processScene(sceneCtx);
    cursor.visitCount.set(currentId, (cursor.visitCount.get(currentId) ?? 0) + 1);

    // 两人都还倒着 → 收尾。不能落进下面的「死路兜底」寻路：
    // 那段会把 null 当成「这个场景没得做」，接着替他们规划下一站 ——
    // 而他们此刻躺在地上，走不了。
    if (standing([c1, c2]).length === 0) {
      cursor.done = true;
      break;
    }

    if (nextConn) {
      const movingToFinale = nextConn.targetSceneId === support.finaleSceneId && world.isClueFound(support.finaleClueId);
      world.moveToScene(nextConn.targetSceneId);
      // 叙事高潮场景：让 processScene 渲染后再退出
      if (movingToFinale) {
        await processScene(sceneCtx); // 渲染终局场景（NPC对话+线索发现）
        cursor.done = true;
      }
    } else {
      // Dead-end safeguard: processScene returned null (no actions),
      // but check if there are still unvisited scenes in the module
      // 这条路上的移动不是玩家选的，别让它豁免下一轮的强制改道
      cursor.arrivedByPlayerChoice = false;
      const allModuleScenes = module.scenes;
      const unvisitedScenes = allModuleScenes.filter(s => !world.isSceneVisited(s.id));
      if (unvisitedScenes.length > 0) {
        // There are unvisited scenes — try to force-navigate toward one
        // BFS from current scene to find the shortest path to an unvisited scene
        const currentId = world.currentSceneId;
        const visited = new Set<string>();
        const queue: { sceneId: string; path: string[] }[] = [];
        // Only try to navigate from scenes directly or via previously visited scenes
        for (const s of allModuleScenes) {
          if (world.isSceneVisited(s.id)) {
            for (const conn of s.connections) {
              if (!conn.requiredClueId || world.isClueFound(conn.requiredClueId)) {
                queue.push({ sceneId: s.id, path: [conn.targetSceneId] });
              }
            }
          }
        }
        // Find any reachable unvisited scene
        let target: { sceneId: string; path: string[] } | null = null;
        while (queue.length > 0 && !target) {
          const entry = queue.shift()!;
          const lastScene = entry.path[entry.path.length - 1];
          if (unvisitedScenes.some(s => s.id === lastScene)) {
            target = entry;
            break;
          }
          if (visited.has(lastScene)) continue;
          visited.add(lastScene);
          const sceneData = allModuleScenes.find(s => s.id === lastScene);
          if (sceneData) {
            for (const conn of sceneData.connections) {
              if ((!conn.requiredClueId || world.isClueFound(conn.requiredClueId))
                  && !visited.has(conn.targetSceneId)) {
                queue.push({ sceneId: entry.sceneId, path: [...entry.path, conn.targetSceneId] });
              }
            }
          }
        }
        if (target) {
          // Take the first step toward the target
          const firstStep = target.path[0];
          const currentSceneData = allModuleScenes.find(s => s.id === currentId);
          const conn = currentSceneData?.connections.find(c => c.targetSceneId === firstStep);
          if (conn) {
            world.moveToScene(firstStep);
            continue;
          }
          // Current scene doesn't directly connect to first step — jump to the connecting scene
          world.moveToScene(firstStep);
          continue;
        }
      }
      cursor.done = true;
    }
  }

  // ── Ending (data-driven from module) ──
  say(`\n${"\u2501".repeat(48)}`);

  // 全员倒下：这不是「查完了」而是「没能查下去」，不该按线索进度评结局。
  // CoC 7e 的 0 HP 是失去意识不是死亡 —— 醒来时案子还在那儿，只是他们退出了。
  const allDown = standing([c1, c2]).length === 0;
  if (allDown) {
    say("");
    divider("调查中止");
    say(
      "两名调查员再没能站起来。\n" +
      "不知过了多久，意识回笼时天已经亮了 —— 有人把他们拖到了路边，或者他们自己爬了出来。\n" +
      "案子还在那儿，只是这一次，他们没能走到最后。",
      "verbatim",
    );
  }

  // Evaluate ending narrative from module support
  const ending = allDown ? null : support.evaluateEnding(
    (id: string) => world.isClueFound(id),
    (id: string) => world.isSceneVisited(id),
  );

  if (ending) {
    say(``);
    divider(support.endLabels[ending.id] ?? ending.id);
    for (const line of ending.lines) {
      say(line, "verbatim");
    }
  }

  // ── Epilogue (data-driven from module) ──
  if (module.epilogues) {
    const epilogues = evaluateEpilogues(
      module.epilogues,
      (id) => world.isClueFound(id),
      (id) => world.isSceneVisited(id),
    );
    for (const ep of epilogues) {
      say(``);
      for (const line of ep.lines) say(line, "verbatim");
    }
  }
  // ── SAN / HP 最终状态 ──
  say(`\n🧠 理智状态:`);
  const san1Phobias = san1.state.phobias.length > 0 ? ` 恐惧症: ${san1.state.phobias.join("、")}` : "";
  const san1Manias = san1.state.manias.length > 0 ? ` 狂躁症: ${san1.state.manias.join("、")}` : "";
  const san1Insane = san1.state.indefiniteInsanity ? ` (不定疯狂: ${san1.state.indefiniteLevel}级)` : san1.state.temporaryInsanity ? " (已触发临时疯狂)" : "";
  say(`  ${p0.name}: SAN ${san1.state.currentSAN}/${san1.state.maxSAN}${san1Insane}${san1Phobias}${san1Manias}`);
  const san2Phobias = san2.state.phobias.length > 0 ? ` 恐惧症: ${san2.state.phobias.join("、")}` : "";
  const san2Manias = san2.state.manias.length > 0 ? ` 狂躁症: ${san2.state.manias.join("、")}` : "";
  const san2Insane = san2.state.indefiniteInsanity ? ` (不定疯狂: ${san2.state.indefiniteLevel}级)` : san2.state.temporaryInsanity ? " (已触发临时疯狂)" : "";
  say(`  ${p1.name}: SAN ${san2.state.currentSAN}/${san2.state.maxSAN}${san2Insane}${san2Phobias}${san2Manias}`);

  say(`\n模组结束。 约 ${cursor.rounds} 轮回合`);
  say(`\n${"\u2501".repeat(48)}`);
  say(characterSummary(c1));
  say(characterSummary(c2));

}

/** 把一局的播报落盘。只有命令行跑法需要，API 会话的记录走会话历史。 */
function saveRunLog(lines: string[]): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const dir = "play-logs";
  try { mkdirSync(dir, { recursive: true }); } catch { /* 目录已存在 */ }
  const logPath = `${dir}/run-${ts}.txt`;
  writeFileSync(logPath, lines.join("\n"), "utf-8");
  return logPath;
}

// 只有直接执行本文件才自动开一局。
// 原先是顶层裸调用，被 import 的瞬间就会开跑 —— API 想复用这套剧本引擎，
// 光是引入模块就会凭空跑掉一局并写一份日志。
if (import.meta.main) {
  runModule(BARN_OF_PREMIER, BARN_SUPPORT, { onLine: (l) => console.log(l) })
    .then(({ lines }) => {
      console.log(`\n📜 日志已保存: ${saveRunLog(lines)}`);
    })
    .catch(console.error);
}
