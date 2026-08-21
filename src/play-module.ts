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
} from "./play/npc-text";
import {
  check, sanCheck, applyDamage, discoveryFlavor, failFlavor,
  recordWound, healWound, woundPenaltyOf,
} from "./play/checks";
import { runSceneTraps } from "./play/traps";
import { newCursor, newDedup, type Cast } from "./play/run-state";
import { nextRevealBridge } from "./play/reveal-bridge";
import { runCombatEncounter } from "./play/combat";
import { rollDice, trapsInScene, attributeValue, isMajorWound } from "./play/trap-util";
// 这几个测试按老路径从 play-module import，转出去别断
export { worseWound } from "./play/checks";
export { rollDice, trapsInScene, attributeValue, isMajorWound } from "./play/trap-util";
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
export function noticesEntity(occupation: string, ent: Pick<NarrativeEntity, "noticedBy">): boolean {
  const habits = ent.noticedBy ?? [];
  return habits.length === 0 || habits.some((h) => occupation.includes(h));
}

/**
 * 这句移动示意是不是纯粹在复述目的地。
 *
 * 紧接着就会打出场景标题（"━ 再次来到 农场外围（陷阱区）"），
 * 所以"返回农场外围。"这种只报地名的句子等于把同一件事说了两遍。
 * 但"前往艾德里安的病房（需通过门口警员的检查）"带着额外条件，那句得留下 ——
 * 判据是去掉动词与括号补充之后，剩下的是不是就等于场景名本身。
 */
export function isRedundantMoveLine(condition: string, targetSceneName: string): boolean {
  // 括号只从场景名剥：标题里的"（陷阱区）"是标注，而 condition 里的括号
  // 往往是真信息（"（需通过门口警员的检查）"），跟着一起剥掉就会把它误判成复述、
  // 连那句提示一并吞掉。
  const tidy = (s: string) => s.replace(/[。，、\s]+$/, "").trim();
  const full = tidy(targetSceneName);
  // 场景名自己就可能带括号，而且两种写法都算复述：
  //   "农场外围（陷阱区）" ← "进入农场外围（陷阱区）" 连括号一起复述
  //   "建筑内（谷仓大厅）" ← "返回谷仓大厅" 只复述括号里那部分
  const bare = tidy(full.replace(/[（(][^）)]*[）)]/g, ""));
  const inner = tidy((full.match(/[（(]([^）)]*)[）)]/) ?? [])[1] ?? "");
  const stripped = tidy(condition).replace(/^(返回|回到|前往|进入|离开|去)/, "").trim();
  if (!stripped) return true;
  return stripped === full || stripped === bare || (inner !== "" && stripped === inner);
}

/** `chooseConnection` 要问世界的那几件事。抽成接口是为了让它能脱离 WorldState 单测 */
export interface MoveWorldView {
  isSceneVisited(sceneId: string): boolean;
  visitCount(sceneId: string): number;
  /** 模组里到底有没有这个场景。指向不存在场景的连接必须排最后 —— 见下面 -5 那一支 */
  sceneExists(sceneId: string): boolean;
  /** 目标场景的真名。condition 和场景名可以不一样（「返回镇上」→「普瑞米尔」）*/
  sceneName(sceneId: string): string;
}

export interface MoveChoice {
  conn: SceneConnection | null;
  /**
   * true = 玩家说的话没对上任何一条连接，这个目的地是引擎按分数替他挑的。
   *
   * 这个字段是重点。原先这段逻辑埋在 `processScene` 的闭包里，
   * 「玩家自己选的」和「引擎替他选的」出来一模一样，
   * 外面无从分辨，也就没人能发现玩家的话被丢掉了。
   */
  forced: boolean;
}

/**
 * 一条连接可以用哪些说法认出来。
 *
 * 原先只有一个键：condition 去掉动词后取前 8 字。它在括号上会断成半个 ——
 * 「前往艾德里安的农场（沿着小路向北）」截出来是「艾德里安的农场（」，
 * 于是玩家说「我去艾德里安的农场」永远对不上，被判成引擎替他挑的。
 *
 * 现在给三个键，命中任意一个就算：
 *   1. 去掉动词的整句（最严，最准）
 *   2. 再去掉括号补充 —— 括号里往往是"（沿着小路向北）"这类走法说明，玩家不会照念
 *   3. 目标场景的**真名** —— condition 和场景名可以不一样（「返回镇上」→「普瑞米尔」）
 *
 * 短于 2 字的键丢掉：单个字满大街都是，会把不相干的话判成移动。
 */
function matchKeys(c: SceneConnection, world: MoveWorldView): string[] {
  const noVerb = c.condition.replace(/^(前往|进入|返回|回到|离开|去|到)\s*/, "").trim();
  const noParen = noVerb.replace(/[（(][^）)]*[）)]/g, "").trim();
  const sceneName = world.sceneName(c.targetSceneId).trim();
  return [noVerb, noParen, sceneName].filter(k => k.length >= 2);
}

/**
 * 把玩家的一句话对到一条连接上。**纯函数，没有行为改动** ——
 * 原样搬自 `processScene`，只是从闭包里挪出来好让它可测。
 *
 * 为什么值得挪：这个仓库已经栽过一次 —— 见
 * `src/__tests__/narrative-entity-recognition.test.ts:55`，
 * 「这道门原先长在 runModuleInner 的闭包里，测不到 —— 于是四局实跑一次都没演」。
 * 主循环至今没有任何测试覆盖，改它之前先让它能被测。
 */
export function chooseConnection(
  decision: { action: string },
  unlocked: SceneConnection[],
  world: MoveWorldView,
): MoveChoice {
  if (unlocked.length === 0) return { conn: null, forced: false };

  for (const c of unlocked) {
    if (matchKeys(c, world).some(k => decision.action.includes(k))) {
      return { conn: c, forced: false };
    }
  }

  // 没对上 —— 按"哪个更值得去"排个序替他挑一个。
  const scored = unlocked.map(c => {
    let score = 0;
    // 目标场景不存在（模组数据有洞）→ 直接垫底。
    // 少了这一支，坏连接反而会因为"没访问过"拿 +10 排到第一个去。
    if (!world.sceneExists(c.targetSceneId)) return { conn: c, score: -5 };
    if (!world.isSceneVisited(c.targetSceneId)) score += 10; else score -= 3;
    const vc = world.visitCount(c.targetSceneId);
    if (vc >= 3) score -= 8;
    else if (vc >= 2) score -= 4;
    return { conn: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return { conn: scored[0]!.conn, forced: true };
}

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
  let wmIntegrator: WorldModelIntegrator | null = null;
  let wmCacheSceneId = "";
  let wmCacheText = "";
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
  // 克苏鲁神话世界模型：同样共享，按路径各一份
  const cthulhuLoader = sharedWorldModel(DEFAULT_CTHULHU_PATH);
  function buildCthulhuContext(): string {
    try {
      if (!cthulhuLoader.isLoaded()) {
        cthulhuLoader.load(DEFAULT_CTHULHU_PATH);
      }
      if (!cthulhuLoader.isLoaded()) return "";
      const lines: string[] = [];
      lines.push("[克苏鲁神话上下文]");
      const deities = cthulhuLoader.getByType("deity");
      if (deities.length > 0) {
        lines.push("神话存在:");
        for (const d of deities.slice(0, 6)) {
          const name = d.name || "未知";
          const domains = (d as any).domains ? `(领域: ${(d as any).domains.join("、")})` : "";
          const mechanic = d.mechanic ? ` ${d.mechanic.slice(0, 80)}` : "";
          lines.push(`  - ${name}${domains}${mechanic}`);
        }
      }
      const mechanics = [
        ...cthulhuLoader.getByType("power_system"),
        ...cthulhuLoader.getByType("game_mechanic"),
        ...cthulhuLoader.getByType("crafting"),
        ...cthulhuLoader.getByType("cosmology"),
      ].slice(0, 8);
      if (mechanics.length > 0) {
        lines.push("神秘机制:");
        for (const m of mechanics) {
          const name = m.name || "未知";
          const mechanic = m.mechanic ? m.mechanic.slice(0, 90) : (m.description || "").slice(0, 90);
          lines.push(`  - ${name}: ${mechanic}`);
        }
      }
      const causals = cthulhuLoader.getByType("causal").slice(0, 3);
      if (causals.length > 0) {
        lines.push("可推进的怪异事件方向:");
        for (const c of causals) {
          const name = c.name || "未知";
          const mechanic = c.mechanic ? c.mechanic.slice(0, 90) : "";
          lines.push(`  - ${name}: ${mechanic}`);
        }
      }
      return lines.length > 1 ? lines.join("\n") : "";
    } catch {
      return "";
    }
  }
  /** 按当前场景构建世界模型注入块；同场景内节流复用（场景切换才重算） */
  function buildWmContext(w: WorldState): string | undefined {
    if (!wmIntegrator) return undefined;
    const scene = w.currentScene;
    const sceneId = scene?.id ?? "";
    if (wmCacheSceneId === sceneId && wmCacheText) return wmCacheText;
    const wmCtx: WmSceneContext = {
      sceneId,
      sceneName: scene?.name ?? "",
      // 关键词 = 场景名 + 场景内线索名（保守匹配，避免噪声条目）
      keywords: [scene?.name ?? "", ...(scene?.clues.map(c => c.name) ?? [])].filter(k => k.length > 0),
      presentNPCs: scene?.npcIds ?? [],
      discoveredClues: scene?.clues.filter(c => w.isClueFound(c.id)).map(c => c.name) ?? [],
      round: w.round,
      ruleset: "cosmic-horror",
    };
    let wmText = wmIntegrator.buildKPContext(wmCtx);
    // 克苏鲁神话上下文（独立 loader，失败静默跳过；随缓存一并复用）
    const cthulhuText = buildCthulhuContext();
    if (cthulhuText) {
      wmText = wmText ? `${wmText}\n\n${cthulhuText}` : cthulhuText;
    }
    wmCacheText = wmText;
    wmCacheSceneId = sceneId;
    return wmCacheText;
  }
  const pl1 = new PlayerAgent(createPlayerCharacter(
    c1, p0.name, p0.occupation,
    p0.personality,
    p0.background,
    p0.motive
  ));
  const pl2 = new PlayerAgent(createPlayerCharacter(
    c2, p1.name, p1.occupation,
    p1.personality,
    p1.background,
    p1.motive
  ));

  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const llmOk = llmEnabled(); // 判据见 llmEnabled —— 别再在这里重写一份
  // LLM connection status — not printed to output, available for debug
  // say(`LLM: ${llmOk ? "connected" : "template mode"}`);
  // LLM client for NPC conversation (PC questions + NPC replies) — template mode falls back inside
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
  /** 从 knowledge 条目中提取干净的话题核心（去掉第一人称/所有格前缀，截取到句末标点或第一逗号分句） */
  function extractTopic(raw: string): string {
    // Strip leading first-person / possessive / time phrases, including "自己"
    // Longest alternatives first so "我这里有" isn't partially consumed as "我这"
    let t = raw.replace(/^(我这里有|我这里|我已经|我这儿|我这|我们这儿|我们|我自己|自己|我)[，,：:、]?\s*/, "");
    // Strip leading 的 left by possessive phrases like "自己的孩子" → "孩子"
    t = t.replace(/^的/, "");
    // Cut at sentence-ending punctuation (single occurrence suffices — "镇上警察？他们不会管的。"
    // must collapse to "镇上警察", not the whole rhetorical question) or long dash
    const cut = t.search(/[。！？…—\u2014]/);
    if (cut > 0) t = t.slice(0, cut);
    // Strip trailing 的 to avoid "关于xxx的的事" from template "关于${k}的事"
    t = t.replace(/[的]+$/, "");
    // Cut at awkward trailing verbs/adverbs to avoid "又" / "还" dangling after truncation
    t = t.replace(/[又还][要再]?$/, "");
    // Long run-on statements (>15 chars) collapse to the first comma clause,
    // so "加比比较叛逆，喜欢出去玩，十五岁就搬到外面拖车住了" becomes "加比比较叛逆"
    if (t.length > 15) {
      const comma = t.search(/[，,]/);
      if (comma > 0) t = t.slice(0, comma);
    }
    // Trim whitespace/punctuation and cap at 25 chars
    return t.replace(/[，,、\s]+$/, "").slice(0, 25);
  }

  /** 构建全局调查上下文（WorldContext）— 跨场景串联，供所有 LLM 叙事生成点注入 */
  function buildWorldContext(w: WorldState): WorldContext {
    // 跨场景已发现线索名（跳过对话追踪用合成 id，如 clue_kn_/conv_kn_）
    const discovered: string[] = [];
    for (const sc of module.scenes) {
      for (const cl of sc.clues) {
        if (w.isClueFound(cl.id)) discovered.push(cl.name);
      }
    }
    // 已接触的 NPC（按模块 npcIds 顺序）
    const met = module.npcs
      .filter(n => w.getNpcState(n.id)?.knownByPlayers)
      .map(n => n.name.replace(/[（(].*[）)]$/, "").trim());
    // 已访问场景名（sceneHistory 存的是 id，转成名字；当前场景去重）
    const visited = w.getSnapshot().sceneHistory
      .map(id => module.scenes.find(s => s.id === id)?.name)
      .filter((n): n is string => !!n);
    const current = w.currentScene?.name ?? "";
    if (current && !visited.includes(current)) visited.push(current);
    // 调查员目标
    const goals = [pl1.pc.currentGoal, pl2.pc.currentGoal].filter((g): g is string => !!g && g.length > 0);
    // 最近事件：WorldState 记录的历史（场景历史含事件串）
    const history = w.getHistorySummary(5).filter(e => !module.scenes.some(s => s.name === e));
    // 未探索的核心线索场景（模糊提示——引导调查方向，不点名场景内部细节）
    const unexplored: string[] = [];
    for (const sc of module.scenes) {
      if (sc.id === w.currentScene?.id) continue;
      const hasCore = sc.clues.some(cl => cl.importance === "core" && !w.isClueFound(cl.id));
      if (hasCore) unexplored.push(sc.name);
    }
    // 剧情状态变量（DESIGN-LOG §2）：当前场景全量（含初始声明），其他场景只列运行时被修改过的（≠初始值）
    const stateVars: string[] = [];
    const curId = w.currentScene?.id ?? "";
    for (const sc of module.scenes) {
      const vars = w.getStateVars(sc.id);
      const keys = Object.keys(vars);
      if (keys.length === 0) continue;
      const initial = sc.stateVars ?? {};
      const shown = keys.filter(k => sc.id === curId || vars[k] !== initial[k]);
      if (shown.length === 0) continue;
      stateVars.push(`${sc.name}: ${shown.map(k => `${k}=${vars[k]}`).join("、")}`);
    }
    return {
      visitedScenes: visited,
      currentScene: current,
      discoveredClues: discovered,
      currentGoals: goals,
      recentEvents: history,
      metNpcs: met,
      triggeredEvents: [],
      // 只给"还有地方没去"这个事实，不给名字。
      //
      // 原先这里把未访问场景名拼进去，而这段会一路注入到 PC 提问的 prompt 里 ——
      // 于是调查员会张口就问"拖车房在镇子哪里"，可那时根本没人提过拖车房。
      // 上面第一行注释本来就写着"不点名场景内部细节"，是实现没做到。
      // 地点该由 NPC 说出口或被玩家撞见来引入，不该从进度提示里漏出去。
      unexploredHints: unexplored.length > 0
        ? ["镇上仍有与案件相关的场所未曾到访（是哪些，调查员目前并不知道）"]
        : [],
      stateVars: stateVars.length > 0 ? stateVars : undefined,
      worldModelContext: buildWmContext(w),
    };
  }

  /** 在 NPC 首次对话后，给 PL 1-2 轮追问机会 */
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
  function maybeRecognitionBeat(w: WorldState): boolean {
    const ent = w.getPendingRecognition();
    if (!ent) return false;
    const candidates = [pl1, pl2].filter((p) => noticesEntity(p.pc.occupation, ent));
    if (candidates.length === 0) return false;
    const who = pick(candidates);
    // 先落状态再输出：即便下游抛错也不会在下一轮重演同一段
    w.markEntityRecognized(ent.id);
    say(`\n${ent.recognition.replaceAll("{name}", who.name)}`);
    return true;
  }

  /** 每人已经开口过几次 —— 供 askerScore 做"别包场"的惩罚项 */
  const askCounts = new Map<string, number>();

  /**
   * 这一轮谁开口。
   *
   * 提问者原先写死 pl1，第二名调查员整局一句话都没说过；改成硬轮流之后
   * 又变成了两人排队发言。真实的队伍里谁接话取决于这个人是谁、这话题跟他有没有关系，
   * 所以交给 askerScore 打分，同分时才随机。
   */
  function pickAsker(topic: string): PlayerAgent {
    const scored = [pl1, pl2].map((p) => ({
      p,
      // 微小抖动：分数持平时不至于每次都选同一个
      score: askerScore(p.pc, topic, askCounts.get(p.name) ?? 0) + Math.random() * 0.2,
    }));
    scored.sort((a, b) => b.score - a.score);
    const chosen = scored[0].p;
    askCounts.set(chosen.name, (askCounts.get(chosen.name) ?? 0) + 1);
    return chosen;
  }

  // 叙事去重收进 dedup（见 play/run-state.ts）—— 抽 npc-dialogue 时
  // 就是这几个变量够不到，逼出了一处回调注入；收成对象后那处已经去掉。
  const dedup = newDedup();

  /**
   * 同伴接一句话。
   *
   * 不是每个发现都配一句 —— 每次都接会变成噪音，反而更假。寡言的人开口更少。
   */
  function sayPartnerRemark(partner: PlayerAgent, kind: "clue" | "san"): void {
    const traits = partner.pc.personality || "";
    const chance = RESERVED.test(traits) && !OUTGOING.test(traits) ? 0.25 : 0.5;
    if (Math.random() > chance) return;
    const remark = partnerRemark(traits, kind, dedup.lastPartnerRemark);
    dedup.lastPartnerRemark = remark;
    const gesture = kind === "san" ? "转过头" : "凑过来看了一眼";
    say(`\n${partner.name}${speechLead(gesture)}"${remark}"`);
  }
  // nextRevealBridge 已随 buildRevealBridge 一起搬到 src/play/reveal-bridge.ts

  async function conductNpcConversation(npc: ModuleNPC, w: WorldState): Promise<void> {
    const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();

    // 识别先于提问：这一轮归它，不再叠一个提问上去（顶替本轮 Q&A）
    if (maybeRecognitionBeat(w)) return;

    // Build scene context for NPC
    const curScene = w.currentScene;
    const sceneCtx: SceneContext = {
      sceneName: curScene?.name ?? "未知",
      sceneDescription: curScene?.description ?? "",
      presentNpcs: [displayName],
      knownClues: curScene?.clues.filter(cl => w.isClueFound(cl.id)).map(cl => cl.name) ?? [],
      recentEvents: [],
      playerOccupations: [pl1.pc.occupation, pl2.pc.occupation],
    };

    // ── 全局调查上下文（跨场景串联）：供所有 LLM 叙事生成点注入 ──
    const worldCtx = buildWorldContext(w);

    // 未说出的知识：knowledgeReveals 中尚未作为线索展开的条目（保留下标 → 与 knowledge 一一对应）
    const unrevealedReveals = (npc.llmExpanded?.knowledgeReveals ?? [])
      .map((text, ki) => ({ text, ki }))
      .filter(({ ki }) => !w.isClueFound(`clue_kn_${npc.id}_${ki}`));
    // knowledge 原文中尚未问过的话题（作为后备方向）
    const unrevealedKnowledge = (npc.knowledge ?? [])
      .map((k, ki) => ({ text: extractTopic(k), ki }))
      .filter(t => t.text.length > 2)
      .filter(t => !w.isClueFound(`conv_kn_${npc.id}_${t.ki}`))
      .map(t => t.text);

    // 标记本轮问过的话题（避免下次重复）
    if (unrevealedKnowledge.length > 0) {
      for (const k of (npc.knowledge ?? [])) {
        const ki = npc.knowledge.indexOf(k);
        w.discoverClue(`conv_kn_${npc.id}_${ki}`);
      }
    }

    // 全部信息都已说出 → 无需追问
    if (unrevealedReveals.length === 0 && unrevealedKnowledge.length === 0) return;

    // 调查重点：玩家当前目标 + 已发现的线索
    const focus = [
      pl1.pc.currentGoal ? `调查员1目标: ${pl1.pc.currentGoal}` : "",
      pl2.pc.currentGoal ? `调查员2目标: ${pl2.pc.currentGoal}` : "",
      sceneCtx.knownClues.length > 0 ? `已发现线索: ${sceneCtx.knownClues.join("、")}` : "",
    ].filter(Boolean).join("\n") || "继续调查当前案件";

    // 对话历史：本场景内已经发生的 NPC 发言（firstEncounter + 已说出的 reveal）。
    // 注意：必须是"已说出的"，不能包含未说出的 reveal——否则 LLM 会把没说过的话当历史引用/重复
    const revealedReveals = (npc.llmExpanded?.knowledgeReveals ?? [])
      .map((text, ki) => ({ text, ki }))
      .filter(({ ki }) => w.isClueFound(`clue_kn_${npc.id}_${ki}`));
    const dialogueHistory = [npc.llmExpanded?.firstEncounter, ...revealedReveals.map(r => r.text)]
      .filter(Boolean)
      .slice(0, 3)
      .map(t => `${displayName}：${t}`)
      .join("\n");

    // ── 问答对齐：先定本轮揭示目标（第一条未说出的 reveal），问话围绕它生成 ──
    const target = unrevealedReveals[0];
    const targetTopic = target
      ? extractTopic(npc.knowledge?.[target.ki] ?? target.text)
      : "";

    // 谁开口要等 targetTopic 定下来才能判：话题跟谁的经历沾边，谁才更可能接这一句
    const asker = pickAsker(targetTopic);

    // ── PC question: 交给 LLM 结合场景/历史/重点生成自然提问（无 LLM 时降级为锚点引导话术） ──
    let question: string;
    if (llmClient) {
      try {
        question = await generatePcQuestion(
          { name: asker.name, occupation: asker.pc.occupation, personality: asker.pc.personality },
          npc,
          sceneCtx,
          {
            dialogueHistory,
            investigationFocus: focus,
          },
          llmClient,
          worldCtx,
        );
      } catch (e) {
        // 静默降级会伪装成"模型写得很平庸"：fallbackQuestion 的池子只有四条万能追问，
        // 一局问下来全是"能跟我们细说说当时的情形吗？"，看日志的人只会以为提示词不行，
        // 根本想不到 LLM 这一路每次都抛了异常。原因必须打出来。
        console.warn(`[pc-question] ${asker.name} 提问降级为模板：${e instanceof Error ? e.message : String(e)}`);
        question = fallbackQuestion(targetTopic);
      }
      if (!question.trim()) {
        console.warn(`[pc-question] ${asker.name} 提问降级为模板：LLM 返回空串`);
        question = fallbackQuestion(targetTopic);
      }
    } else {
      question = fallbackQuestion(targetTopic);
    }
    // PC 提问用自然引导（"开口问道：'……'"），避免机械"名字：内容"直出。
    // 池子原先只有 4 条且纯随机，一局里"沉吟片刻，问道："出现了三次、
    // "向前一步，问道："两次。扩池 + 躲开上一条，比继续加大随机池有效。
    const askBridges = [
      "开口问道：", "追问道：", "沉吟片刻，问道：", "向前一步，问道：",
      "皱了皱眉，问：", "点点头，接着问：", "换了个语气问：", "顿了顿，问：",
      "看了对方一眼，问：", "压低声音问：", "不太确定地问：", "直截了当地问：",
    ];
    const pool = askBridges.filter((b) => b !== dedup.lastAskBridge);
    const askBridge = pick(pool);
    dedup.lastAskBridge = askBridge;
    say(`\n${asker.name}${askBridge}"${stripOuterQuotes(question)}"`);

    // NPC 回复：LLM 可用时走 LLM；无 LLM 时 generateNpcReply 内 templateReply 按 preferredIndex
    // 精确返回目标 reveal（问答对齐：问话锚定 knowledge[target.ki]，回复即 reveals[target.ki]）
    const usedRevealIndices = new Set(
      (npc.llmExpanded?.knowledgeReveals ?? [])
        .map((_, i) => i)
        .filter(i => w.isClueFound(`clue_kn_${npc.id}_${i}`))
    );
    const reply = await generateNpcReply(
      npc, question, sceneCtx,
      llmClient ?? undefined,
      usedRevealIndices,
      target?.ki,
      worldCtx,
    );
    if (reply) {
      // 回复用数据驱动引导桥（"顿了顿，又说："类），避免机械"名字：内容"直出
      const s = analyseNpcData(npc);
      // 台词自带开头神态时，把它转成叙述句当引导桥，不要再叠一层 —— 否则同一个
      // 动作会被说两遍。转成叙述句而不是保留括号，是因为"（面带忧虑）我儿子失踪了"
      // 读起来是剧本提示，"面带忧虑，说：「我儿子失踪了」"才像人话。
      const { action, speech } = splitLeadingStageDirection(stripOuterQuotes(reply), displayName);
      const lead = action ? speechLead(action) : nextRevealBridge(dedup, npc, s, false);
      say(`\n${displayName}${lead}"${speech}"`);
      noteEntityMentions(speech, w);
      // 标记本轮实际说出的 reveal（避免下次重复）。
      // LLM 路径：按回答内容与 reveal 的重叠匹配标记——回答"按需叙述"后可能偏离 target，
      //   未说出的信息不标记、留待玩家再问（符合"信息在提及时才叙述"）；
      // 模板路径：按 preferredIndex 锚定 target（问答对齐）。
      const reveals = npc.llmExpanded?.knowledgeReveals ?? [];
      const norm = (x: string) => x.replace(/（[^）]*）/g, "").replace(/[\s，。！？、：；…"“”‘’]/g, "");
      if (llmClient) {
        const core = norm(reply);
        for (let i = 0; i < reveals.length; i++) {
          if (w.isClueFound(`clue_kn_${npc.id}_${i}`)) continue;
          const rc = norm(reveals[i]);
          if (rc.length > 4 && (core.includes(rc) || rc.includes(core))) {
            w.discoverClue(`clue_kn_${npc.id}_${i}`);
          }
        }
      } else {
        const replyKi = target?.ki ?? reveals.findIndex(r => r === reply);
        if (replyKi >= 0) w.discoverClue(`clue_kn_${npc.id}_${replyKi}`);
      }
    }
  }

  /** 无 LLM 时的追问降级 — 抽象化提问（不把 knowledge 信息内容塞进问句，避免"提问即剧透、回答即复述"的逐条打印感）。
   *  回复由 generateNpcReply 按 preferredIndex 锚定对应 reveal，问句抽象不影响答对内容。 */
  function fallbackQuestion(topic?: string): string {
    if (topic && topic.length > 1) {
      return [
        "这件事的具体情况，您还知道些什么吗？",
        "能跟我们细说说当时的情形吗？",
        "关于这一点，您还记得什么吗？",
      ][Math.floor(Math.random() * 3)];
    }
    return [
      "关于这个案子，你们还知道些什么吗？",
      "能再说说你们知道的情况吗？",
    ][Math.floor(Math.random() * 2)];
  }

  // ── Scene processor: entry → exploration → analysis → advance ──
  async function processScene(): Promise<SceneConnection | null> {
    const scene = world.currentScene!;
    world.advanceRound();
    const round = world.round;

    // Use global visit tracking — moveToScene increments before processScene runs,
    // so count > 1 means this is a revisit
    const prevVisits = globalVisitCount.get(scene.id) ?? 0;
    const isRevisit = prevVisits > 0;
    say(`\n${isRevisit ? "\u2501 \u518d\u6b21\u6765\u5230" : "\u2501"} ${scene.name}`);

    // ── Phase 1: Scene entry - KP roleplay narration ──
    // On revisit, skip full description for immersion; use a short restatement
    if (isRevisit) {
      const revisitPhrases = ["这里和刚才来时一样。", "一切如旧。", "和之前离开时没什么变化。", "场景依旧。"];
      say(`\n${revisitPhrases[Math.floor(Math.random() * revisitPhrases.length)]}`);
    } else {
      say(`\n${scene.description}`, "verbatim");
      // 首次到访：开场氛围描写（场景级，先于 NPC 出场——如"孩子玩球跑回屋内"这类场景开场动作）
      if (scene.openingAtmosphere) {
        say(`\n${scene.openingAtmosphere}`, "verbatim");
      }
    }

    // ── NPC encounters woven into scene ──
    for (let nIdx = 0; nIdx < scene.npcIds.length; nIdx++) {
      const npcId = scene.npcIds[nIdx];
      const npc = module.npcs.find(n => n.id === npcId) as ModuleNPC;
      if (!npc) continue;
      const npcState = world.getNpcState(npc.id);
      if (!npcState || !npcState.isAlive) continue;

      // 场景内多个 NPC 之间插入过渡衔接（LLM 生成，模板 fallback）
      let introShown = false;
      // 记录刚展示的过渡文本（用于剥离 firstEncounter 中与过渡重复的开门动作，避免"门被拉开"后又说"猛地拉开门"）
      let lastTransitionText = "";
      if (nIdx > 0) {
        const prevId = scene.npcIds[nIdx - 1];
        const prevNpc = module.npcs.find(n => n.id === prevId) as ModuleNPC | undefined;
        if (prevNpc) {
          try {
            // prevNpc 已经说过的话（供过渡句承接，防止脑补未发生的内容，如编造"她对警察的抱怨"）
            const prevLines = [
              prevNpc.llmExpanded?.firstEncounter,
              ...(prevNpc.llmExpanded?.knowledgeReveals ?? [])
                .map((text, ki) => ({ text, ki }))
                .filter(({ ki }) => world.isClueFound(`clue_kn_${prevNpc.id}_${ki}`))
                .map(r => r.text),
            ].filter(Boolean).join(" / ");
            const transition = await generateNpcTransition(prevNpc, npc, scene, llmClient, buildWorldContext(world), prevLines);
            say(`\n${transition}`);
            lastTransitionText = transition;
            introShown = true;
          } catch { /* 过渡失败则直接进入下一位 NPC */ }
        }
      } else if (scene.openingAtmosphere) {
        // 场景有开场氛围（如"孩子跑回屋内"）时，首位 NPC 出场前生成承接过渡，
        // 只做"承接动作"衔接（孩子进屋→大人开门），外貌由后续 impression 单独给出，
        // 不设 introShown，避免首 NPC 的外貌信息缺失。
        try {
          const transition = await generateOpeningTransition(npc, scene, scene.openingAtmosphere, llmClient, buildWorldContext(world));
          say(`\n${transition}`);
          lastTransitionText = transition;
        } catch { /* 承接失败则不打印，直接进入首 NPC */ }
      }

      const firstMeeting = !npcState.knownByPlayers;
      if (firstMeeting) world.meetNpc(npc.id);
      const speechProfile = classifySpeechStyle(npc.personality.speech);

      if (npc.llmExpanded) {
        // ── LLM预生成对话分支：统一处理，跳过模板链 ──
        const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();
        const pcImpression = buildPcImpression(npc);
        const approachBehavior = npc.behaviors?.find(b => b.trigger === "player_approach");
        const behaviorText = approachBehavior
          ? approachBehavior.action.replace(npc.name, "").trim().replace(/^，+/, "")
          : "";
        const toneBridge = buildToneBridge(npc, speechProfile);

        if (firstMeeting) {
          // 开头的括号神态在这里就切掉，下面三个分支拿到的都是干净台词。
          // 切出来的动作留给普通分支当引导桥用（见下），mental_voice / coma_rapid
          // 自带固定引导句，多一段神态只会打架，直接丢。
          const rawFirst = stripDoorOpenPrefix(npc.llmExpanded.firstEncounter, lastTransitionText);
          const { action: leadAction, speech: dialogueText } = splitLeadingStageDirection(rawFirst, displayName);
          noteEntityMentions(dialogueText, world);
          if (speechProfile.type === "mental_voice") {
            if (!introShown) say(`\n${pcImpression}`);
            say(`\n${mentalVoiceBridge(speechProfile, displayName, "——")}`);
            say(quoteDialogue(dialogueText));
          } else if (speechProfile.type === "coma_rapid") {
            if (!introShown) say(`\n${pcImpression}`);
            say(`\n${displayName}昏迷中似乎在说着什么。`, "verbatim");
            say(quoteDialogue(dialogueText));
          } else {
            if (!introShown) {
              say(`\n${pcImpression}。`);
              // 首次见面自报家门：调查员先表明身份与来意（承接敲门/进屋），NPC 才承接回应进入正题
              say(`\n你们上前，向对方表明了自己的身份与来意。`, "verbatim");
              // 私宅场景：插入"进屋坐下"过渡，建立叙事节奏（先落座 → 再求助 → 再谈案情），
              // 避免 NPC 站在门口就把所有话倒完
              if (world.currentScene?.isHome) {
                say(`\n${displayName}侧身把你们让进屋里，示意你们在桌边坐下。`, "verbatim");
              }
            }
            if (behaviorText) say(behaviorText);
            // firstEncounter 若自带"XX说："引导（LLM 生成的神态更贴合），直接用它的引导，
            // 避免与 toneBridge 叠加成两个"说"；否则统一用 displayName + toneBridge
            const { lead, rest } = stripDialogueLead(dialogueText);
            if (lead) {
              // LLM 引导常以"他/她/它"开头（如"他像堵墙一样挡住去路……"），前置名字避免指代不明
              const leadWithName = /^[他她它]/.test(lead) ? `${displayName}${lead.slice(1)}` : lead;
              say(`\n${leadWithName.trim()}`);
              say(quoteDialogue(rest));
            } else {
              // 台词自带开头神态时拿它当引导桥（转成叙述句）。原先是"有括号就不加桥"，
              // 可括号仍留在台词里，读起来还是剧本提示而不是人话。
              say(`\n${displayName}${leadAction ? speechLead(leadAction) : toneBridge}`);
              say(quoteDialogue(dialogueText));
            }
          }
          // ── 玩家背景提及反应 ──
          // 模组数据定义 mentionReactions，引擎做匹配：PL的occupation命中trigger时触发
          const reactions = npc.llmExpanded?.mentionReactions;
          if (reactions && reactions.length > 0) {
            for (const pl of [pl1, pl2]) {
              const matched = reactions.find(r =>
                pl.pc.occupation.toLowerCase().includes(r.trigger.toLowerCase())
              );
              if (matched) {
                say(`\n${matched.reaction.replace(/\{name\}/g, pl.name)}`);
                break;
              }
            }
          }
        } else {
          // 同 firstMeeting：开头括号在源头切掉，三个分支拿到的都是干净台词
          const rawRevisit = stripDoorOpenPrefix(npc.llmExpanded.revisitEncounter ?? npc.llmExpanded.firstEncounter, lastTransitionText);
          const { action: leadAction, speech: dialogueText } = splitLeadingStageDirection(rawRevisit, displayName);
          noteEntityMentions(dialogueText, world);
          if (speechProfile.type === "mental_voice") {
            say(`\n${mentalVoiceBridge(speechProfile, displayName, "——", true)}`);
            say(quoteDialogue(dialogueText));
          } else if (speechProfile.type === "coma_rapid") {
            if (!introShown) say(`\n${pcImpression}——依然昏迷，但嘴唇仍在翕动。`);
            say(quoteDialogue(dialogueText));
          } else {
            const { lead, rest } = stripDialogueLead(dialogueText);
            if (lead) {
              // LLM 引导常以"他/她/它"开头（如"他像堵墙一样挡住去路……"），前置名字避免指代不明
              const leadWithName = /^[他她它]/.test(lead) ? `${displayName}${lead.slice(1)}` : lead;
              say(`\n${leadWithName.trim()}`);
              say(quoteDialogue(rest));
            } else {
              say(`\n${displayName}${leadAction ? speechLead(leadAction) : toneBridge}`);
              say(quoteDialogue(dialogueText));
            }
          }
        }
        revealNpcKnowledge(npc, world, dedup, speechProfile);
        world.adjustRelationship(npc.id, 1);
        // 自由对话：PL 可以追问 NPC 1-2 轮
        if (firstMeeting && speechProfile.type !== "coma_rapid" && speechProfile.type !== "none") {
          await conductNpcConversation(npc, world);
        }
      } else if (firstMeeting) {
        // Set mood from attitude
        const moodMap: Record<string, string> = { "友好": "friendly", "热心": "friendly", "合作": "cooperative", "冷漠": "neutral", "警惕": "wary", "敌意": "hostile", "畏惧": "fearful" };
        for (const [kw, m] of Object.entries(moodMap)) {
          if (npc.personality.attitude.includes(kw)) { world.setNpcMood(npc.id, m); break; }
        }

        // Clean name for narration (strip parenthetical role suffixes like "（缸中脑）")
        const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();
          // Generate player-facing impression from NPC name + role instead of raw data dump
          const pcImpression = buildPcImpression(npc);

        if (speechProfile.type === "none" || speechProfile.type === "coma_rapid") {
          // 出场过渡已显示（entrance）则不重复打印印象
          if (!introShown) say(`\n就在你们面前，${pcImpression}——似乎无法与你们正常交流。`);
        } else if (speechProfile.type === "brainwave") {
          // 出场过渡已显示（entrance）则不重复打印印象
          if (!introShown) say(`\n${pcImpression}`);
          say(brainwaveFlavor(npc, displayName));
        } else if (speechProfile.type === "mental_voice") {
          // Telepathic encounter: full description, then direct mental communication
          if (!introShown) say(`\n${pcImpression}`);
          const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world);
          say(`\n${mentalVoiceBridge(speechProfile, displayName, "：")}`);
          say(`"${dialogueText}"`);
          revealNpcKnowledge(npc, world, dedup, speechProfile);
          world.adjustRelationship(npc.id, 1);
        } else {
          const approachBehavior = npc.behaviors?.find(b => b.trigger === "player_approach");
          const behaviorText = approachBehavior
            ? approachBehavior.action.replace(npc.name, "").trim().replace(/^，+/, "")
            : "";

          const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world);
          if (!introShown) say(`\n${pcImpression}。`);
          if (dialogueText) {
            const toneBridge = buildToneBridge(npc, speechProfile);
            const behaviorBridge = behaviorText ? `${behaviorText}，${toneBridge}` : `${displayName}${toneBridge}`;
            say(behaviorBridge);
            say(`"${dialogueText}"`);
          }
          revealNpcKnowledge(npc, world, dedup, speechProfile);
          world.adjustRelationship(npc.id, 1);
          // 自由对话：PL 可以追问 NPC 1-2 轮。
          // 此处无需再判 firstMeeting 或排除 coma_rapid/none：外层已是 else if (firstMeeting)，
          // 且上面的 if/else if 链已把这两种 type 分流走，条件恒为真。
          await conductNpcConversation(npc, world);
        }
      } else {
        // Returning encounter
        const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();
        if (speechProfile.type === "none" || speechProfile.type === "brainwave") {
          handleNonSpeakingNpc(npc, speechProfile, introShown);
        } else if (speechProfile.type === "coma_rapid") {
          // Unconscious NPC: show impression, then reveal mumbling knowledge
          const pcImpression = buildPcImpression(npc);
          if (!introShown) say(`\n${pcImpression}——依然处于昏迷状态，无法交流。`);
          revealNpcKnowledge(npc, world, dedup, speechProfile);
        } else if (speechProfile.type === "mental_voice") {
          const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world, true);
          say(`\n${mentalVoiceBridge(speechProfile, displayName, "：", true)}`);
          say(`"${dialogueText}"`);
          revealNpcKnowledge(npc, world, dedup, speechProfile);
          world.adjustRelationship(npc.id, 1);
        } else {
          const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world, true);
          if (dialogueText) {
            const toneBridge = buildToneBridge(npc, speechProfile);
            say(`\n${displayName}${toneBridge}`);
            say(`"${dialogueText}"`);
          }
          revealNpcKnowledge(npc, world, dedup, speechProfile);
          world.adjustRelationship(npc.id, 1);
        }
      }

      // npc_dialogue clues
      for (const clue of scene.clues) {
        if (world.isClueFound(clue.id)) continue;
        for (const method of clue.findMethods) {
          if (method.type === "npc_dialogue") { world.discoverClue(clue.id); }
        }
      }
    }

    /** Strip game mechanic suffixes (ScX/Y, CM+X) from revelation text */
    function sanitizeRevelation(text: string): string {
      // Remove full parenthetical SAN blocks: （Sc0/1d3） (SC1d3+1/1d6+1)
      let s = text.replace(/[（(]\s*[Ss][Cc]\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?(?:\s*\/\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?)?\s*[）)]/g, "");
      // Remove bare Sc0/1d3 / sc1/1d3+1 / SC1d3+1/1d6+1
      s = s.replace(/[Ss][Cc]\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?(?:\s*\/\s*\d+(?:[dD]\d+)?(?:\s*\+\s*\d+)?)?/g, "");
      // Remove ,CM+3 / CM+3
      s = s.replace(/[，,]?\s*[Cc][Mm]\s*\+\s*\d+/g, "");
      // Remove game mechanic stats: 故障值\d+, 伤害[dD]\d+[+-]?\d*, 贯穿属性, 之类
      s = s.replace(/[，,]\s*(?:故障值\s*\d+|伤害\s*(?:为\s*)?[dD]\s*\d+(?:\s*[+-]\s*\d+)?|具有?贯穿属性|因为磨损[\s\S]*?(?=[。，]|$))/g, "");
      // 贯穿属性 without 具有 prefix (e.g. "，贯穿属性。")
      s = s.replace(/[，,]\s*贯穿属性/g, "");
      // Remove isolated dice patterns like 1D4+1, 1d6 that survived
      s = s.replace(/[，,]\s*(?:\d+\s*[dD]\s*\d+(?:\s*[+-]\s*\d+)?)/g, "");
      // Remove dangling punctuation from partially-stripped parentheticals
      s = s.replace(/[（(]\s*[，,、]+\s*/g, "（").replace(/\s*[，,、]+\s*[）)]/g, "）");
      // Remove now-empty parentheses （） （） etc.
      s = s.replace(/[（(]\s*[）)]/g, "");
      // Fix trailing punctuation
      return s.replace(/[。，]+\s*$/, "。").trim();
    }

    // 陷阱结算已抽到 src/play/traps.ts
    await runSceneTraps(cast, world, cursor, module, scene);

    // Boss 遭遇战已抽到 src/play/combat.ts
    await runCombatEncounter(cast, world, module, scene, support);

    // ── Phase 4-5: PL decision loop — investigate clues OR move ──
    // After scene entry + NPC encounters + auto events, the PL decides
    // what to do. Loop until they choose to move (or run out of options).

    /** Gather available scene-level connections, filtered by state */
    function getUnlockedConnections(): SceneConnection[] {
      return scene.connections.filter(c => {
        if (c.requiredClueId && !world.isClueFound(c.requiredClueId)) return false;
        const tgt = module.scenes.find(s => s.id === c.targetSceneId);
        if (tgt && world.isSceneVisited(c.targetSceneId)) {
          const remainingCore = tgt.clues.filter(cl => !world.isClueFound(cl.id) && cl.importance === "core");
          // Don't filter out if this scene is a passage to unexplored areas
          if (remainingCore.length === 0) {
            const leadsToUnexplored = tgt.connections.some(conn =>
              !world.isSceneVisited(conn.targetSceneId)
            );
            if (!leadsToUnexplored) return false;
          }
        }
        return true;
      }) as SceneConnection[];
    }

    /** 如果线索有 SAN 损失定义，触发检定 */
    function checkClueSanLoss(clue: Clue): void {
      const cost = support.traumaticClues[clue.id];
      if (cost) {
        sanCheck(p0.shortName, san1, cost);
        sanCheck(p1.shortName, san2, cost);
        // 刚一起看过让人失去理智的东西，两个人之间总该有句话
        sayPartnerRemark(pick([pl1, pl2]), "san");
      }
    }

    /** 线索发现叙述：LLM 可用时生成情景叙述（动作/现场描写，非"结果清单"直出）；不可用/失败降级 flavor+revelation */
    async function narrateClueDiscovery(clue: Clue, level: string, pcName: string): Promise<string> {
      if (llmClient) {
        const text = await generateClueRevelation(
          { name: clue.name, description: clue.description, revelation: clue.revelation },
          { name: scene.name, description: scene.description },
          pcName,
          llmClient,
          buildWorldContext(world),
        );
        if (text) return text;
      }
      return `${discoveryFlavor(level)}${sanitizeRevelation(clue.revelation)}`;
    }

    /**
     * Run a single clue check (observation or skill) and return true if discovered.
     *
     * ── skill 优先，passive 退化成兜底 ──
     * 同一条线索如果既有 skill 又有 passive 方法，原先的实现遇到第一个 passive
     * 就 return，于是 skill 检定**永远不会执行**。普查 32 条线索：4 条是这样，
     * 而且全是 core（黑色钱包、尸体、床位、日记本）。
     *
     * 这直接导致**结局不区分**——True End 要的两条线索（日记、文件）都在卧室，
     * 进门即得，去终局必须穿过卧室，所以走到头必得 True End。实测 10 局全 True End。
     *
     * 现在改成：
     * 1. 先把 methods 分成 skill 组和 passive 组
     * 2. 有 skill 就只跑 skill，不碰 passive
     * 3. skill 失败累计 >= maxFails 时，**如果有 passive 方法**用它揭示
     *    （比 failback/revelation 更自然：作者写的就是"这里还有另一种发现方式"）
     * 4. 没有 skill 的线索，passive 照旧立即生效
     */
    async function runClueCheck(clue: Clue): Promise<boolean> {
      if (world.isClueFound(clue.id)) return false;

      const PASSIVE_TYPES = new Set(["observation", "automatic", "item"]);
      const skillMethods = clue.findMethods.filter(
        (m) => m.type === "skill" && m.skillName,
      );
      const passiveMethods = clue.findMethods.filter((m) =>
        PASSIVE_TYPES.has(m.type),
      );

      // ── 有 skill 方法：skill 优先，passive 退化成兜底 ──
      if (skillMethods.length > 0) {
        for (const method of skillMethods) {
          const pcList = [c1, c2].sort((a, b) => {
            const va = resolveCheckValue(a, method.skillName!);
            const vb = resolveCheckValue(b, method.skillName!);
            return vb - va;
          });
          const offset = cursor.stepCounter++ % 2;
          const pc = pcList[offset % pcList.length];
          const val = resolveCheckValue(pc, method.skillName!);
          if (val > 0) {
            const name = pc === c1 ? p0.shortName : p1.shortName;
            say(`\n${name}${method.description}……`);
            const r = check(
              val,
              name,
              method.skillName!,
              (method.difficulty as "regular" | "hard" | "extreme") ??
                "regular",
            );

            if (r.isSuccess) {
              say(await narrateClueDiscovery(clue, r.successLevel, name));
              sayPartnerRemark(pc === c1 ? pl2 : pl1, "clue");
              world.discoverClue(clue.id);
              checkClueSanLoss(clue);
              return true;
            } else {
              // 失败 → 累计失败次数；大失败额外加重
              const failCount = world.incrementClueFail(clue.id);
              if (r.successLevel === "fumble") {
                say(`${failFlavor(true)}`);
                const fumbleCost = "0/1d3";
                sanCheck(name, pc === c1 ? san1 : san2, fumbleCost);
              } else {
                say(`${failFlavor(false)}`);
              }

              // ── 兜底：连续失败达到阈值 → 用 passive 方法揭示（比 failback 更自然） ──
              const fb = clue.failback;
              if (fb || clue.importance === "core") {
                const maxFails = fb?.maxFails ?? 2;
                if (failCount >= maxFails) {
                  // 优先用 passive 方法 —— 作者写的"另一种发现方式"
                  if (passiveMethods.length > 0) {
                    say(await narrateClueDiscovery(clue, "regular", ""));
                    world.discoverClue(clue.id);
                    world.resetClueFails(clue.id);
                    checkClueSanLoss(clue);
                    return true;
                  }
                  // 无 passive → 用 failback/revelation
                  const authored = fb
                    ? fb.fallbackRevelation
                    : clue.revelation;
                  let rescueText = "";
                  const fallbackText = authored
                    ? `历经周折，${sanitizeRevelation(authored)}`
                    : "";
                  if (!fallbackText && llmClient) {
                    rescueText = await generateFailRescue(
                      { name: clue.name, description: clue.description },
                      { name: scene.name, description: scene.description },
                      failCount,
                      llmClient,
                      buildWorldContext(world),
                    );
                  }
                  const finalText = fallbackText || rescueText;
                  say(
                    `\n${finalText ? "（屡次搜寻未果，你们决定换个方式）\n" : ""}${finalText}`,
                  );
                  if (fb?.sanCost) {
                    sanCheck(p0.shortName, san1, fb.sanCost);
                    sanCheck(p1.shortName, san2, fb.sanCost);
                  }
                  world.discoverClue(clue.id);
                  world.resetClueFails(clue.id);
                  return true;
                }
              }
              // 失败 → 继续尝试下一个 skill method
            }
          }
          // PC 没有此技能/属性 → 尝试下一个 skill method
        }
        attemptedClueIds.add(clue.id); // 所有 skill 方法均失败 → 标记防死循环
        return false;
      }

      // ── 只有 passive 方法：直接揭示 ──
      if (passiveMethods.length > 0) {
        say(await narrateClueDiscovery(clue, "regular", ""));
        world.discoverClue(clue.id);
        checkClueSanLoss(clue);
        return true;
      }

      // 没有任何方法（数据错误）
      return false;
    }

    /**
     * 这一次进场里已经试过的线索 —— 试过就从选项里拿掉。
     *
     * 这个 Set 原先是**只写不读**的死变量（注释说防重复调查循环，实际不起作用）。
     * 现在真的用上了：检定失败的线索必须退出选项，
     * 否则玩家会在同一个抽屉上反复失败直到用完行动次数。
     */
    const attemptedClueIds = new Set<string>();

    /** 一个场景里最多让玩家行动几次。存在只为兜底：别把整局锁死在一个房间 */
    const MAX_SCENE_ACTIONS = 6;

    /**
     * 这条线索不动手也会注意到吗。
     *
     * 判据跟 runClueCheck 的实际行为对齐：它遍历 findMethods，
     * 碰到 observation/automatic/item 就直接揭示，只有 skill 才掷骰。
     * 所以"有任一被动方法"= 进门就会看见。
     */
    const isPassiveClue = (cl: Clue) =>
      cl.findMethods.some(m => m.type === "observation" || m.type === "automatic" || m.type === "item");

    /**
     * 要动手查才拿得到的线索 —— 这些**不再自动掷骰**，交给玩家决定查不查。
     *
     * 这是"循环反转"的核心：原先进场就把所有线索解光，
     * 走到岔口时玩家已经无事可做，只剩"去哪"可选。
     * color（花絮）仍走自动 —— 让玩家逐条勾选氛围描写只是噪音。
     */
    const investigableClues = () => scene.clues.filter(cl =>
      !world.isClueFound(cl.id) &&
      cl.importance !== "color" &&
      !isPassiveClue(cl) &&
      !attemptedClueIds.has(cl.id));

    // ── 进场自动揭示：只处理"不动手也会注意到"的 ──
    for (const clue of scene.clues) {
      if (world.isClueFound(clue.id)) continue;
      if (clue.importance !== "color" && !isPassiveClue(clue)) continue; // 留给玩家
      if (clue.importance === "color") {
        // Color clues: skill 类线索走 runClueCheck（有检定输出）；
        // 纯 automatic/observation 自动揭示但用 flavor+revelation 叙述（不再裸输出"发现了X。"）
        const hasSkillMethod = clue.findMethods.some(m => m.type === "skill");
        if (hasSkillMethod) {
          await runClueCheck(clue);
          continue;
        }
        for (const method of clue.findMethods) {
          if (method.type === "automatic" || method.type === "observation") {
            say(await narrateClueDiscovery(clue, "regular", ""));
            world.discoverClue(clue.id);
            checkClueSanLoss(clue);
          }
        }
        continue;
      }
      await runClueCheck(clue);
    }

    // ── 场景内行动：玩家自己决定查什么 ──
    //
    // 这是"循环反转"。原先进场就把线索全解光，走到岔口时玩家已经无事可做，
    // 只剩"去哪"可选 —— 他对"查什么"零决定权。
    //
    // 没有可查线索时整段跳过，不产生任何额外的 LLM 调用。
    for (let act = 0; act < MAX_SCENE_ACTIONS; act++) {
      const clueOpts = investigableClues();
      if (clueOpts.length === 0) break;

      const labels = clueOpts.map(cl => `调查${cl.name}`);
      const leaveLabel = "离开这里";
      const ctx = [
        `【场景】${scene.name}`,
        scene.description,
        clueOpts.length > 0 ? `你注意到这里还有些地方值得细看。` : "",
        `\n你要做什么？（也可以选择离开）`,
      ].filter(Boolean).join("\n");

      const decider = runCtx.getStore()?.decide;
      const decision = decider
        ? await decider(ctx, [...labels, leaveLabel])
        : await pl1.decideViaLLM(ctx, labels, [leaveLabel]);

      // 先看他有没有点名某条线索。名字是专有名词，出现即命中。
      // 放在 intent 前面是有意的：**不能只信 intent**。
      // 不设 intent 的决策器（PlayerDecision.intent 是可选的）会让"永远不调查"
      // 成为默认行为，而那正是这次要修的毛病。点了名就照做。
      const hit = clueOpts.find(cl =>
        decision.action.includes(cl.name) ||
        (decision.targetName ? cl.name.includes(decision.targetName) : false));

      // 没点名 —— 说要走就走，说不清要查什么也当作不查了，别替他挑一个
      if (!hit) break;

      // 记进 attemptedClueIds：检定失败的线索不能一直挂在选项里，
      // 否则玩家会在同一个抽屉上反复失败直到用完行动次数。
      attemptedClueIds.add(hit.id);
      await runClueCheck(hit);
    }

    // ── Gather movement options ──
    const unlocked = getUnlockedConnections().filter(c => {
      const tgt = module.scenes.find(s => s.id === c.targetSceneId);
      if (!tgt) return true;
      // If all remaining undiscovered clues in this scene are unfindable skill-checks (no PC has the skill),
      // filter it out so the PL can't waste cycles bouncing to a dead end
      const undiscovered = tgt.clues.filter(cl => !world.isClueFound(cl.id) && cl.importance !== "color");
      const allUnfindable = undiscovered.length > 0 && undiscovered.every(cl => {
        return cl.findMethods.every(m => {
          if (m.type !== "skill") return false;
          if (!m.skillName) return false;
          return resolveCheckValue(c1, m.skillName) <= 0 && resolveCheckValue(c2, m.skillName) <= 0;
        });
      });
      if (allUnfindable) return false; // skip this dead-end scene
      return true;
    });

    if (unlocked.length === 0) return null;

    // Single move option — just take it without LLM call
    if (unlocked.length === 1) {
      const only = unlocked[0] as SceneConnection;
      // 同下面那条分支：只报地名的示意会被紧跟的场景标题重复一遍
      const dest = module.scenes.find(s => s.id === only.targetSceneId);
      if (!isRedundantMoveLine(only.condition, dest?.name ?? "")) {
        say(`\n${only.condition}。`, "verbatim");
      }
      return only;
    }

    // Multiple move options — let LLM decide
    const foundClues = scene.clues.filter(cl => world.isClueFound(cl.id)).map(cl => cl.name);
    const knownCluesFormatted = foundClues.length > 0 ? `已发现线索: ${foundClues.join("、")}` : "已发现线索: 暂无";

    // Global investigation progress (all scenes)
    const allScenes = module.scenes;
    const visitedCount = allScenes.filter(s => world.isSceneVisited(s.id)).length;
    let allFoundCount = 0;
    const unexploredCoreScenes: string[] = [];
    for (const s of allScenes) {
      for (const cl of s.clues) {
        if (world.isClueFound(cl.id)) allFoundCount++;
      }
      const hasUndiscoveredCore = s.clues.some(cl => cl.importance === "core" && !world.isClueFound(cl.id));
      if (hasUndiscoveredCore && !world.isSceneVisited(s.id)) {
        unexploredCoreScenes.push(s.name);
      }
    }
    const progressLine = `调查进度: 已访问 ${visitedCount}/${allScenes.length} 场景, 共发现 ${allFoundCount} 条线索`;
    const remainingLine = unexploredCoreScenes.length > 0
      ? `\n还有关键线索未探索的场景: ${unexploredCoreScenes.join("、")}`
      : "";

    const npcPresent = scene.npcIds
      .map(id => module.npcs.find(n => n.id === id)?.name ?? id)
      .filter(Boolean);
    const npcLine = npcPresent.length > 0 ? `在场的人: ${npcPresent.join("、")}` : "";
    const isFirstVisit = (globalVisitCount.get(scene.id) ?? 0) === 0;

    // ── 移动排序：保证关键场景（医院等）不被线性捷径跳过 ──
    // 规则（分数越低越优先）：
    //   0  目标场景有未发现 core 线索 且 从镇上不可达（如医院病房）→ 必须现在去，否则绕不回来
    //   10 当前场景不是镇上 且 全局仍有未发现 core 线索 → 回镇上枢纽重新分派
    //  20  目标场景未访问 且有未发现 core 线索 且 从镇上可达（回镇上后按连接序选，医院排镇内住宅前）
    //  25  目标场景已访问 但有未发现 core 线索（检定失败未拿到——已试过，别死循环，先探索新场景）
    //  30  未访问过
    //  40+ 已访问（次数越多越靠后，"已充分探索"最后）
    const HUB_SCENE_ID = support.hubSceneId;
    const hubTargets = new Set(
      module.scenes.find(s => s.id === HUB_SCENE_ID)?.connections.map(c => c.targetSceneId) ?? []
    );
    const anyCoreUndiscovered = allScenes.some(s =>
      s.clues.some(cl => cl.importance === "core" && !world.isClueFound(cl.id))
    );
    const sortedUnlocked = [...unlocked as SceneConnection[]].sort((a, b) => {
      const score = (c: SceneConnection): number => {
        const tgt = module.scenes.find(s => s.id === c.targetSceneId);
        const tgtHasCore = tgt
          ? tgt.clues.some(cl => cl.importance === "core" && !world.isClueFound(cl.id))
          : false;
        const tgtViaHub = hubTargets.has(c.targetSceneId);
        const visits = globalVisitCount.get(c.targetSceneId) ?? 0;
        if (tgtHasCore && !tgtViaHub) return 0;                      // 仅当前场景可达的 core 场景
        if (c.targetSceneId === HUB_SCENE_ID && scene.id !== HUB_SCENE_ID && anyCoreUndiscovered) return 10; // 回枢纽
        if (tgtHasCore && visits === 0) return 20;                   // 未访问的 core 场景
        if (tgtHasCore) return 25;                                   // 已访问的 core 场景（避免死循环）
        if (visits === 0) return 30;                                 // 未访问
        return 40 + visits;                                          // 已访问（充分探索最后）
      };
      return score(a) - score(b);
    });

    const moveLabels = sortedUnlocked.map((c) => {
      const vc = globalVisitCount.get(c.targetSceneId) ?? 0;
      const suffix = vc >= 3 ? " (已充分探索)" : vc >= 1 ? ` (已访问${vc}次)` : "";
      return `${c.condition.trim()}${suffix}`;
    });

    const plContext = [
      `【场景】${scene.name}${isFirstVisit ? "" : "（再次来到）"}`,
      scene.description,
      npcLine,
      knownCluesFormatted,
      progressLine + remainingLine,
      `\n接下来去哪？`,
    ].filter(Boolean).join("\n");

    // 走上下文里的决策器；没给就是内置 AI 玩家，与原有跑法完全一致
    const decider = runCtx.getStore()?.decide;
    const decision = decider
      ? await decider(plContext, moveLabels)
      : await pl1.decideViaLLM(plContext, [], moveLabels);

    // 匹配逻辑见 chooseConnection（本文件顶部）—— 挪出闭包是为了能单测
    const picked = chooseConnection(decision, unlocked as SceneConnection[], {
      isSceneVisited: (id) => world.isSceneVisited(id),
      visitCount: (id) => globalVisitCount.get(id) ?? 0,
      sceneExists: (id) => module.scenes.some(s => s.id === id),
      sceneName: (id) => module.scenes.find(s => s.id === id)?.name ?? "",
    });
    const chosenConn = picked.conn;
    if (!chosenConn) return null;
    // 记下"接下来这一步是玩家自己选的还是引擎替他挑的"。
    // 主循环的「访问≥6次强制改道」要看它 —— 玩家明确要去的地方不能把人弹走。
    cursor.arrivedByPlayerChoice = !picked.forced;

    // 只报地名的那种就别说了 —— 下一行的场景标题会把同一件事再讲一遍
    const dest = module.scenes.find(s => s.id === chosenConn.targetSceneId);
    if (!isRedundantMoveLine(chosenConn.condition, dest?.name ?? "")) {
      say(`\n${chosenConn.condition}。`, "verbatim");
    }
    return chosenConn;
  }

  // ── Game loop: scene entry → exploration → analysis → advance ──
  //
  // 循环游标收进 cursor（见 play/run-state.ts）：
  // 这几个看着像局部变量，实际是跨场景的不变量，而且 stepCounter 是
  // 线索检定与陷阱**共享**的 —— 散在闭包里时这层共享看不出来，
  // arrivedByPlayerChoice 更是「静默传送」那个 bug 的所在。
  const cursor = newCursor();
  const globalVisitCount = new Map<string, number>();
  const recentSceneIds: string[] = []; // anti-bounce: track last few scene transitions

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
    const visitCount = globalVisitCount.get(currentId) ?? 0;
    // 玩家自己要来的地方不算数 —— 他说了要来，就让他来，来几次是他的事。
    // 兜底仍在：上面的 anti-bounce 和 rounds < 40 都还拦着，不会真的转不出去。
    if (visitCount >= 6 && currentId !== support.finaleSceneId && !cursor.arrivedByPlayerChoice) {
      const currentScene = module.scenes.find(s => s.id === currentId);
      const forcedConn = currentScene?.connections.find(c => !world.isSceneVisited(c.targetSceneId));
      if (forcedConn) {
        // 出声。原先这里是**静默**传送：玩家说"返回镇上"，
        // 引擎回一句"返回镇上。"，然后人在报亭，中间一个字都没有。
        say(`\n这地方已经翻来覆去看过太多遍，再耗下去也不会有新东西了。`, "verbatim");
        globalVisitCount.set(currentId, visitCount + 1);
        cursor.arrivedByPlayerChoice = false;
        world.moveToScene(forcedConn.targetSceneId);
        continue;
      }
      cursor.done = true;
      break;
    }
    const nextConn = await processScene();
    globalVisitCount.set(currentId, (globalVisitCount.get(currentId) ?? 0) + 1);
    if (nextConn) {
      const movingToFinale = nextConn.targetSceneId === support.finaleSceneId && world.isClueFound(support.finaleClueId);
      world.moveToScene(nextConn.targetSceneId);
      // 叙事高潮场景：让 processScene 渲染后再退出
      if (movingToFinale) {
        await processScene(); // 渲染终局场景（NPC对话+线索发现）
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

  // Evaluate ending narrative from module support
  const ending = support.evaluateEnding(
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
