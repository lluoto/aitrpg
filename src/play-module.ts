// 普瑞米尔的谷仓 — 交互式跑团模拟
// 核心架构：KP 场景描述 -> PL 决策 -> 引擎检定 -> 世界推进
// 有 LLM 时 LLM 驱动，无 LLM 时模板驱动
// bun run src/play-module.ts

import { createCoCCharacter, getCoCArchetypes, resolveCheckValue, type CoCGeneratedCharacter, type BackgroundProfile } from "./character/coc-character";
import { randomCoCName, buildBaseBackgroundProfile, composeBackstory, pickDistinctArchetypes, randomPersonAnchors, type PersonAnchors } from "./character/background-profile";
import { CoCEngine, SanityEngine, SUCCESS_LEVEL_LABELS, sanOutcomeLabel, type CoCCheckResult } from "./rules/coc-engine";
import { BARN_OF_PREMIER, BARN_SUPPORT, renderPrologue, renderPartySetup, evaluateEpilogues } from "./module/barn-of-premier";
import { WorldState } from "./world/state";
import { PlayerAgent, createPlayerCharacter } from "./agent/player-agent";
import { displayCharacterSheet, characterSummary, getHighlightedSkills } from "./pl/character-display";
import type { Clue, Scene, SceneConnection, ModuleNPC, ModuleData, ModuleSupport, NPCInstanceState } from "./module/types";
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
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 一局的运行上下文。
 *
 * 用 AsyncLocalStorage 而不是模块级变量：原先输出写在模块级的 log 数组里，
 * 一个进程只能跑一局。接进 API 之后会有多局并发，而它们在每个 await 处交错，
 * 共享一个数组会让两局的播报串台。异步上下文能让 runModule 里所有嵌套调用
 * （包括那些定义在 runModule 之外的辅助函数）自动拿到本局的那一份。
 */
interface RunContext {
  lines: string[];
  onLine?: (line: string) => void;
  decide?: Decider;
}
const runCtx = new AsyncLocalStorage<RunContext>();

/**
 * 决策器：给出当前处境与可选项，返回玩家的决定。
 *
 * 抽出来是为了让同一套剧本既能由内置 AI 玩家自动跑（原有行为），
 * 也能由真人通过 API 驱动 —— 剧本逻辑不需要知道对面是谁。
 */
export type Decider = (context: string, options: string[]) => Promise<PlayerDecision>;

function say(m: string) {
  const ctx = runCtx.getStore();
  if (!ctx) { console.log(m); return; }
  ctx.lines.push(m);
  ctx.onLine?.(m);
}
/** Output game-mechanics text (rolls, damage, rules) — visually distinct from story narration */
function sayMech(m: string) { say(`  [检定] ${m}`); }
function divider(t?: string) { say(""); say("\u2501".repeat(60)); if (t) say("  " + t); say("\u2501".repeat(60)); }

// ====== 模块级工具：供 runModule 内外所有层可见 ======
function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

/** 剥离台词首尾引号 + 内部 LLM 残留的成对引号包裹（如 '整句'），避免"…'…。'"不对称 */
function stripOuterQuotes(s: string): string {
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
function quoteDialogue(s: string): string {
  return `"${stripOuterQuotes(s).trim()}"`;
}

/** 分析 NPC 人格信号（年龄带 + 特质 + 说话方式），供引导桥/语气桥做数据驱动分派 */
function analyseNpcData(npc: ModuleNPC): {
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

/** 知识揭示/追问的引导桥 — 数据驱动（按 NPC 特质分派"接着说"类引导），避免"裸引号/名字：内容"机械直出 */
function buildRevealBridge(npc: ModuleNPC, s: ReturnType<typeof analyseNpcData> | null, isFirst: boolean): string {
  const speechText = npc.personality.speech || "";
  const isMumbling = /喃喃|昏迷|含糊|意识不清/.test(speechText);
  if (isMumbling) return isFirst ? "昏迷中喃喃道：" : "含混不清地继续说：";
  if (isFirst) {
    // isFirst=true：紧跟开场白后的首次信息吐露。用叙述化承接引导（情绪/神态类，无"说"字、
    // 无重复"急切"、无依赖屋内道具的肢体动作——对话可能在门口/任意阶段发生，避免叙述穿越）
    return s?.isChild ? pick(["歪着头想了想，说：", "眨巴着眼睛说：", "抱着皮球晃了晃，说："]) :
      s?.isAnxious ? pick(["抿了抿嘴唇，声音有些发颤：", "垂下眼帘，声音低沉下来：", "深吸一口气，声音发紧："]) :
      s?.isTalkative ? pick(["压低声音说：", "凑近了些，兴致勃勃地说：", "眉飞色舞地说："]) :
      s?.isCautious ? pick(["压低声音说：", "环顾了一下四周，低声说：", "皱着眉头说："]) :
      s?.isGentle ? pick(["温和地说：", "语气柔和地继续说：", "不紧不慢地开口："]) :
      s?.isOfficial ? pick(["用公事公办的口吻说：", "面无表情地说：", "语气平淡地告知：", "目光扫过你们："]) :
      s?.isRough ? pick(["粗声粗气地说：", "叼着烟含糊地说：", "不耐烦地咂了咂嘴，说："]) :
      pick(["接着说：", "想了想，开口道：", "告诉你们："]);
  }
  return s?.isChild ? pick(["又小声补充道：", "压低声音，神秘兮兮地说：", "朝你们招招手，悄声说："]) :
    s?.isAnxious ? pick(["声音颤抖着补充说：", "吸了吸鼻子，又说：", "用袖口擦了擦眼角，接着说：", "声音越来越小："]) :
    s?.isTalkative ? pick(["又说：", "话锋一转，继续道：", "跟连珠炮似的接着说："]) :
    s?.isCautious ? pick(["顿了顿，又说：", "略微犹豫了一下，补充道：", "压着嗓子又说："]) :
    s?.isGentle ? pick(["想了想，又说：", "语气依然温和地补充：", "耐心地继续说道："]) :
    s?.isOfficial ? pick(["又翻了一页，说：", "补充道：", "面无表情地继续说："]) :
    s?.isRough ? pick(["又补了一句：", "哼了一声，继续说：", "叼着烟含混地说："]) :
    pick(["又说：", "想了想，补充道：", "继续说道："]);
}

// ── 场景氛围要点：给 LLM 做风格约束的精简描述（防止 prologue 与进入场景时的完整描述重复）──
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

/** 一次 LLM 对话（无 key/失败 → 返回空串，由调用方回退） */
async function llmOnce(system: string, user: string, maxTokens = 500): Promise<string> {
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey === "sk-placeholder" || apiKey.startsWith("${")) return "";
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

/** LLM 增强八项背景元素：按 职业+时代+案件+人设锚点 从零塑造八项（草稿仅作失败兜底，不喂给 LLM） */
async function enhanceBackgroundProfile(
  base: BackgroundProfile,
  ctx: { name: string; occupation: string; era: string; caseSummary: string; anchors: PersonAnchors },
): Promise<BackgroundProfile> {
  const prompt = [
    `为以下 CoC 7e 调查员塑造"背景故事八项"。`,
    `名字: ${ctx.name}  职业: ${ctx.occupation}  时代: ${ctx.era}年  年龄: ${ctx.anchors.age}岁`,
    `家庭状况: ${ctx.anchors.household}`,
    `出身来历: ${ctx.anchors.provenance}`,
    `案件背景: ${ctx.caseSummary}`,
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

/** LLM 依据八项撰写背景故事（3-5 句连贯叙事）；失败回退模板拼接 */
async function writeBackstory(
  profile: BackgroundProfile,
  ctx: { name: string; occupation: string; era: string; caseSummary: string },
): Promise<string> {
  const fallback = composeBackstory(profile, { name: ctx.name, occupation: ctx.occupation, era: ctx.era });
  const prompt = [
    `依据以下 CoC 7e 调查员的八项背景元素，撰写一段 3-5 句的连贯背景故事。`,
    `要求：用第三人称自然叙事，把这些元素织进一段真实可感的人生里；不要逐条罗列八项；不要出现"形象描述：""思想与信念："这类标签；结尾留一点与调查有关的悬念。`,
    ``,
    `名字: ${ctx.name}  职业: ${ctx.occupation}  时代: ${ctx.era}年`,
    `案件背景: ${ctx.caseSummary}`,
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
  const caseSummary = module.partySetup?.context?.join(" ") ?? module.title;
  const anchors = randomPersonAnchors();
  const profile = await enhanceBackgroundProfile(pc.backgroundProfile ?? buildBaseBackgroundProfile(archetype), {
    name: full, occupation: archetype.label, era: module.era, caseSummary, anchors,
  });
  pc.backgroundProfile = profile;
  pc.backstory = await writeBackstory(profile, { name: full, occupation: archetype.label, era: module.era, caseSummary });
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

// ── 检定 ──
function check(skillVal: number, pcName: string, skillLabel: string, diff: "regular"|"hard"|"extreme" = "regular"): CoCCheckResult {
  const r = CoCEngine.skillCheck(skillVal, diff);
  sayMech(`➜ ${pcName} 【${skillLabel}】 ${skillVal}% → d100=${r.roll} → ${SUCCESS_LEVEL_LABELS[r.successLevel]}`);
  return r;
}

// ── 根据成功等级生成发现 flavor ──
function discoveryFlavor(level: string): string {
  const m: Record<string, string[]> = {
    critical: ["仔细查看之下，一个令人震惊的发现——", "拨开遮挡物，露出的东西让所有人都倒吸一口凉气——", "当视线落定，真相让人心头一震——"],
    extreme:  ["凑近仔细观察，目光停在一处——", "翻开杂物，下面的东西引起了注意——", "移开遮挡物，露出了一样东西——"],
    hard:     ["仔细查看之下有了发现——", "目光扫过一处不寻常的地方——", "定睛看去，那里确实有什么——"],
    regular:  ["目光扫过，注意到一个细节——", "手指触到某个不寻常的东西——", "视线在某处停了一下——", "靠近查看，发现了一些东西——"],
  };
  const pool = m[level] || m.regular;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── 失败 flavor ──
function failFlavor(fumble: boolean): string {
  if (fumble) {
    return ["可惜没能发现什么——反而一个失手把东西碰乱了。", "糟糕，什么也没找到，还弄出了不小的动静。"][Math.floor(Math.random() * 2)];
  }
  return ["可惜没能发现什么有用的东西。", "搜索了一番，一无所获。", "什么也没有。"][Math.floor(Math.random() * 3)];
}

// ── SAN 检定 ──
function sanCheck(pcName: string, engine: SanityEngine, sanCost: string): void {
  const result = engine.sanityCheck(sanCost);
  const outcome = sanOutcomeLabel(result.passed);
  sayMech(`🧠 ${pcName} 【理智检定】 SAN ${engine.state.currentSAN + result.sanLoss} → d100=${result.roll} → ${outcome}，损失 ${result.sanLoss} SAN (剩余 ${engine.state.currentSAN})`);
  if (result.temporaryInsanityTriggered) {
    say(`\n⚠ ${pcName} 陷入了临时疯狂！${result.boutOfMadness ?? ""}`);
  }
  if (result.indefiniteInsanityTriggered) {
    say(`\n⚠ ${pcName} 陷入了不定疯狂（${result.indefiniteLevel}级）！${result.newPhobia ? `获得恐惧症: ${result.newPhobia}` : ""}`);
  }
}

// ── HP 伤害处理 ──
function applyDamage(pc: CoCGeneratedCharacter, pcName: string, dmg: number): void {
  pc.hp = Math.max(0, pc.hp - dmg);
  const ratio = pc.hp / pc.maxHp;
  sayMech(`❤ ${pcName} HP ${pc.hp + dmg} → ${pc.hp}${pc.hp <= 0 ? "（昏迷/濒死！）" : pc.hp <= pc.maxHp * 0.5 ? "（轻伤）" : ""}`);
}

// ── 主流程 ──
// 引擎通用化：module 承载纯数据（场景/线索/NPC），support 承载模块专属钩子/常量
// （SAN 映射、结局评估、战斗遭遇、枢纽/终局定位、调查员配置）。
// 新模组接入 = 提供 ModuleData + ModuleSupport，无需改动引擎。
export interface RunOptions {
  /** 每产生一行播报就回调一次；CLI 传 console.log，API 会话推进消息流 */
  onLine?: (line: string) => void;
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
): Promise<{ lines: string[] }> {
  const ctx: RunContext = { lines: [], onLine: opts.onLine, decide: opts.decide };
  await runCtx.run(ctx, () => runModuleInner(module, support));
  return { lines: ctx.lines };
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
  const THREAT_LABELS: Record<string, string> = { easy:"简单", medium:"中等", hard:"困难", deadly:"致命" };
  sayMech(`模组威胁评分: ${threat.score}（${THREAT_LABELS[threat.tier]}）— 详情: ${threat.details.hostileNpcCount}敌对NPC, ${threat.details.trapCount}陷阱, ${threat.details.hardCheckCount}困难${threat.details.extremeCheckCount > 0 ? `+${threat.details.extremeCheckCount}极难` : ""}检定`);

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

  const llmDisabled = process.env.LLM_DISABLED === "true" || process.env.LLM_MODE === "template";
  const apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
  const llmOk = !llmDisabled && !!(apiKey && !apiKey.startsWith("${") && apiKey !== "sk-placeholder");
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
      unexploredHints: unexplored.length > 0
        ? [`镇上还有与案件相关的场所尚未查探（${unexplored.join("、")}）`]
        : [],
      stateVars: stateVars.length > 0 ? stateVars : undefined,
      worldModelContext: buildWmContext(w),
    };
  }

  /** 在 NPC 首次对话后，给 PL 1-2 轮追问机会 */
  async function conductNpcConversation(npc: ModuleNPC, w: WorldState): Promise<void> {
    const displayName = npc.name.replace(/[（(].*[）)]$/, "").trim();

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

    // ── PC question: 交给 LLM 结合场景/历史/重点生成自然提问（无 LLM 时降级为锚点引导话术） ──
    let question: string;
    if (llmClient) {
      try {
        question = await generatePcQuestion(
          { name: pl1.name, occupation: pl1.pc.occupation, personality: pl1.pc.personality },
          npc,
          sceneCtx,
          {
            dialogueHistory,
            investigationFocus: focus,
          },
          llmClient,
          worldCtx,
        );
      } catch {
        question = fallbackQuestion(targetTopic);
      }
    } else {
      question = fallbackQuestion(targetTopic);
    }
    // PC 提问用自然引导（"开口问道：'……'"），避免机械"名字：内容"直出
    const askBridges = ["开口问道：", "追问道：", "沉吟片刻，问道：", "向前一步，问道："];
    say(`\n${pl1.name}${askBridges[Math.floor(Math.random() * askBridges.length)]}"${stripOuterQuotes(question)}"`);

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
      say(`\n${displayName}${buildRevealBridge(npc, s, false)}"${stripOuterQuotes(reply)}"`);
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
      say(`\n${scene.description}`);
      // 首次到访：开场氛围描写（场景级，先于 NPC 出场——如"孩子玩球跑回屋内"这类场景开场动作）
      if (scene.openingAtmosphere) {
        say(`\n${scene.openingAtmosphere}`);
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
          const dialogueText = stripDoorOpenPrefix(npc.llmExpanded.firstEncounter, lastTransitionText);
          const hasInlineAction = dialogueText.startsWith("（");
          if (speechProfile.type === "mental_voice") {
            if (!introShown) say(`\n${pcImpression}`);
            say(`\n${mentalVoiceBridge(speechProfile, displayName, "——")}`);
            say(quoteDialogue(dialogueText));
          } else if (speechProfile.type === "coma_rapid") {
            if (!introShown) say(`\n${pcImpression}`);
            say(`\n${displayName}昏迷中似乎在说着什么。`);
            say(quoteDialogue(dialogueText));
          } else {
            if (!introShown) {
              say(`\n${pcImpression}。`);
              // 首次见面自报家门：调查员先表明身份与来意（承接敲门/进屋），NPC 才承接回应进入正题
              say(`\n你们上前，向对方表明了自己的身份与来意。`);
              // 私宅场景：插入"进屋坐下"过渡，建立叙事节奏（先落座 → 再求助 → 再谈案情），
              // 避免 NPC 站在门口就把所有话倒完
              if (world.currentScene?.isHome) {
                say(`\n${displayName}侧身把你们让进屋里，示意你们在桌边坐下。`);
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
              if (!hasInlineAction) { say(`\n${displayName}${toneBridge}`); }
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
          const dialogueText = stripDoorOpenPrefix(npc.llmExpanded.revisitEncounter ?? npc.llmExpanded.firstEncounter, lastTransitionText);
          const hasInlineAction = dialogueText.startsWith("（");
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
              if (!hasInlineAction) { say(`\n${displayName}${toneBridge}`); }
              say(quoteDialogue(dialogueText));
            }
          }
        }
        revealNpcKnowledge(npc, world, speechProfile);
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
          revealNpcKnowledge(npc, world, speechProfile);
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
          revealNpcKnowledge(npc, world, speechProfile);
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
          revealNpcKnowledge(npc, world, speechProfile);
        } else if (speechProfile.type === "mental_voice") {
          const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world, true);
          say(`\n${mentalVoiceBridge(speechProfile, displayName, "：", true)}`);
          say(`"${dialogueText}"`);
          revealNpcKnowledge(npc, world, speechProfile);
          world.adjustRelationship(npc.id, 1);
        } else {
          const dialogueText = generateNpcDialogue(npc, npcState, speechProfile, world, true);
          if (dialogueText) {
            const toneBridge = buildToneBridge(npc, speechProfile);
            say(`\n${displayName}${toneBridge}`);
            say(`"${dialogueText}"`);
          }
          revealNpcKnowledge(npc, world, speechProfile);
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

    /** Generate player-facing impression from NPC data (skip stat blocks / KP notes) */
    function buildPcImpression(npc: ModuleNPC): string {
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
    function stripDoorOpenPrefix(text: string, transitionText: string): string {
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
    function stripDialogueLead(text: string): { lead: string; rest: string } {
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
    function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

    // ====== Speech style classification ======
    type SpeechProfile = {
      type: "fast_anxious" | "short_terse" | "mumbling" | "gentle_slow"
           | "coma_rapid" | "official" | "rude_timid" | "talkative"
           | "mental_voice" | "brainwave" | "childish" | "none" | "generic";
      keywords: string[];
    };

    function classifySpeechStyle(desc: string): SpeechProfile {
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
    function mentalVoiceBridge(profile: SpeechProfile, displayName: string, punct: string, again = false): string {
      const telepathic = profile.keywords?.includes("心灵感应") ?? false;
      if (telepathic) {
        const mid = again ? "再次" : "直接";
        return `${displayName}的思维波动${mid}传入你们脑海${punct}`;
      }
      const mid = again ? "再次" : "";
      return `${displayName}的声音${mid}在你们脑海中响起${punct}`;
    }

    // ====== Non-speaking NPC handling (data-driven bridges) ======
    function handleNonSpeakingNpc(npc: ModuleNPC, profile: SpeechProfile, introShown = false): void {
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
    function brainwaveFlavor(npc: ModuleNPC, displayName: string): string {
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

    /** Data-driven tone bridge — uses NPC speech description to build action narration */
    function buildToneBridge(npc: ModuleNPC, profile: SpeechProfile): string {
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

    /** Data-driven knowledge reveal — bridges from NPC data, not hardcoded by type */
    function revealNpcKnowledge(npc: ModuleNPC, w: WorldState, profile?: SpeechProfile): void {
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
        const clean = stripOuterQuotes(text);
        // 知识揭示用数据驱动引导桥，避免"裸引号知识条目"直出（不像人话）
        const s = analyseNpcData(npc);
        say(`\n${buildRevealBridge(npc, s, true)}"${clean}"`);
        w.discoverClue(`clue_kn_${npc.id}_${ki}`);
        return;
      }

      if (npc.knowledge.length === 0) return;
      const revealed = npc.knowledge.filter((k, ki) =>
        !w.isClueFound(`clue_kn_${npc.id}_${ki}`)
      );
      if (revealed.length === 0) return;
      const s = profile ? analyseNpcData(npc) : null;
      // Only show 1 knowledge initially; follow-up questions reveal the rest
      for (let i = 0; i < Math.min(1, revealed.length); i++) {
        const hint = revealed[i];
        const hintIndex = npc.knowledge.indexOf(hint);
        // Data-driven bridges — use mumbling frame for unconscious NPCs
        say(`\n${buildRevealBridge(npc, s, i === 0)}"${hint}"`);
        w.discoverClue(`clue_kn_${npc.id}_${hintIndex}`);
      }
    }

    function generateNpcDialogue(
      npc: ModuleNPC, npcState: NPCInstanceState,
      profile: SpeechProfile, w: WorldState,
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

    // ── Scene-specific auto events (fire once on entry) ──
    // Farm periphery: when entering without trap detection → take damage
    if (scene.id === support.trapSceneId && !world.isClueFound(support.trapClueId)) {
      if (stepCounter > 0) {
        const vName = stepCounter % 2 === 0 ? p0.shortName : p1.shortName;
        const pc = stepCounter % 2 === 0 ? c1 : c2;
        const dmg = 1 + Math.floor(Math.random() * 3);
        say(`\n${vName}没注意到脚下的捕兽夹！咔嚓一声——锋利的铁齿咬进了${vName}的小腿！`);
        applyDamage(pc, vName, dmg);
      }
    }

    // Mi-Go Combat Encounter — 多回合战斗系统
    const migoEncounter = support.encounters.find(e =>
      e.sceneId === scene.id &&
      world.isClueFound(e.requiredClue) &&
      !world.isClueFound(e.excludedClue)
    );
    let migoFought = false;
    if (migoEncounter) {
      migoFought = true;
      const enemyName = migoEncounter.enemyName ?? "敌人";
      const fmt = (t: string) => t.replaceAll("{enemy}", enemyName);
      say(`\n${"═".repeat(48)}`);
      say(`  ⚔ ${enemyName}战斗轮 ⚔`);
      say(`${"═".repeat(48)}`);
      for (const line of migoEncounter.encounterLines) say(fmt(line));
      say("");

      // Read Mi-Go HP from module NPC data: "HP11 MP15 DB无" → 11
      const migoNpc = module.npcs.find(n => support.bossNpcIdPattern.test(n.id));
      const hpMatch = migoNpc?.description?.match(/\bHP\s*(\d+)/i);
      const migoMaxHp = hpMatch ? parseInt(hpMatch[1], 10) : 11;
      let migoHp = migoMaxHp;
      const pcCombatants = [
        { pc: c1, name: p0.shortName, fightingKey: "fighting", firearmsKey: "firearms_pistol" },
        { pc: c2, name: p1.shortName, fightingKey: "fighting", firearmsKey: "firearms_pistol" },
      ];

      // ── 战斗行动 & 伤害叙事 ──
      // 值是扁平的 string[]（每个键一组候选台词），此前误写成 string[][]，
      // 导致 pick() 的返回类型被推成 string[]，下游 fmt() 才会报参数类型不符。
      const actionVariants: Record<string, string[]> = {
        [`${p0.shortName}_格斗`]: [
          "抄起身边的家伙迎了上去！", "握紧拳头沉身逼近！", "抓起一张椅子猛砸过去！",
          "顺手抄起一根铁管挥去！", "低喝一声侧身冲上前！",
        ],
        [`${p0.shortName}_射击`]: [
          "拔出左轮手枪冷静瞄准！", "举枪对准{enemy}扣动扳机！", "侧身闪避的同时抬手就是一枪！",
          "双手握枪，目光如炬地瞄准！",
        ],
        [`${p1.shortName}_格斗`]: [
          "抓起一把手术刀冲向{enemy}！", "握紧拳头摆出军体拳架势！",
          "抡起一张折叠椅砸了过去！", "抄起金属器械猛掷过去！",
        ],
        [`${p1.shortName}_射击`]: [
          "掏出左轮手枪瞄准{enemy}！", "举枪冷静射击！",
          "双手握枪对准{enemy}的翼膜扣动扳机！",
        ],
      };
      const dmgFlavors: Record<string, string[]> = {
        graze: ["只是擦破了甲壳表层，几乎没有实质伤害。", "子弹在甲壳上弹开，留下一道浅痕。"],
        light: ["命中了！在甲壳上留下了一道裂痕。", "打击奏效，{enemy}的甲壳出现了细纹。"],
        medium: ["有力的打击！甲壳出现明显裂纹，荧光绿的血液渗了出来！", "重击！{enemy}的身体猛地一震，体液渗出！"],
        heavy: ["一记重击！{enemy}发出一声痛苦的嘶叫，墨绿色的体液喷溅而出！", "猛烈的攻击！{enemy}的甲壳碎裂，体液横流！"],
      };
      const missTexts: Record<string, string[]> = {
        normal: ["的攻击被{enemy}灵巧地躲开了。", "的攻击落空了——{enemy}以不符合体型的速度闪避了。", "的攻击划过空气，没能碰到{enemy}。"],
        fumble: ["的攻击落空，反而一个踉跄差点摔倒！", "用力过猛失去平衡，差点扑倒在地！"],
      };
      function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

      // ── 疲劳系统 ──
      const FATIGUE_THRESHOLDS = [
        { min: 0, label: "", skillPenalty: 0, penaltyDice: 0 },
        { min: 2, label: "  ⚠ 手臂开始发酸，动作不如之前灵活了。", skillPenalty: 0, penaltyDice: 0 },
        { min: 3, label: "  ⚠ 呼吸变得急促，准头开始下降。", skillPenalty: 10, penaltyDice: 0 },
        { min: 4, label: "  ⚠ 汗水模糊了视线，持枪的手微微发抖。", skillPenalty: 0, penaltyDice: 1 },
        { min: 5, label: "  ⚠ 体力严重透支，肌肉不受控制地颤抖！", skillPenalty: 0, penaltyDice: 2 },
      ];
      const fatigue: Record<string, number> = { [p0.shortName]: 0, [p1.shortName]: 0 };

      // 单名调查员攻击一次
      function pcAttack(combatant: typeof pcCombatants[0]): number {
        const { name, pc, fightingKey, firearmsKey } = combatant;
        const fightVal = (pc.skillValues as Record<string, number>)[fightingKey] ?? 25;
        const gunVal = (pc.skillValues as Record<string, number>)[firearmsKey] ?? 20;
        const usingGun = gunVal > fightVal && Math.random() > 0.3;
        const skillLabel = usingGun ? "射击(手枪)" : "格斗(肉搏)";
        const actionKey = `${name}_${usingGun ? "射击" : "格斗"}`;
        const actionText = pick(actionVariants[actionKey] ?? [usingGun ? "开枪射击！" : "冲了上去！"]);

        // 疲劳修正
        fatigue[name] = (fatigue[name] ?? 0) + 1;
        const f = FATIGUE_THRESHOLDS.slice().reverse().find(t => fatigue[name] >= t.min)!;
        const effectiveSkill = Math.max(5, (usingGun ? gunVal : fightVal) - f.skillPenalty);

        say(`${name}${fmt(actionText)}`);
        const r = CoCEngine.skillCheck(effectiveSkill, "hard", 0, f.penaltyDice);
        sayMech(`➜ ${name} 【${skillLabel}】 ${effectiveSkill}%${f.skillPenalty > 0 ? `(-${f.skillPenalty}疲劳)` : ""}${f.penaltyDice > 0 ? ` [惩罚骰×${f.penaltyDice}]` : ""} → d100=${r.roll} → ${SUCCESS_LEVEL_LABELS[r.successLevel]}`);

        if (r.isSuccess) {
          // 伤害：格斗 1d6，射击 1d8 + 暴击加成
          const dieMax = usingGun ? 8 : 6;
          let dmg = 1 + Math.floor(Math.random() * dieMax);
          if (r.successLevel === "critical") dmg += dieMax;
          else if (r.successLevel === "extreme") dmg += Math.floor(dieMax / 2);
          const dmgTier = dmg >= 7 ? "heavy" : dmg >= 4 ? "medium" : dmg >= 2 ? "light" : "graze";
          say(`  ${fmt(pick(dmgFlavors[dmgTier]))}（${dmg}点伤害）`);
          return dmg;
        } else {
          const missPool = r.successLevel === "fumble" ? missTexts.fumble : missTexts.normal;
          say(`  ${name}${fmt(pick(missPool))}`);
          return 0;
        }
      }

      let round = 0;
      const MAX_ROUNDS = 4;
      let miGoFled = false;

      while (migoHp > 0 && round < MAX_ROUNDS && !miGoFled) {
        round++;
        if (round > 1) say(`\n── 第 ${round} 回合 ──`);

        // 调查员攻击
        for (const combatant of pcCombatants) {
          if (migoHp <= 0) break;
          migoHp -= pcAttack(combatant);
        }
        if (migoHp <= 0) break;

        // 显示调查员疲劳状态（从第2回合起）
        if (round >= 2) {
          const shown = new Set<string>();
          for (const { name } of pcCombatants) {
            const f = FATIGUE_THRESHOLDS.slice().reverse().find(t => fatigue[name] >= t.min)!;
            if (f.label && !shown.has(f.label)) {
              shown.add(f.label);
              say(`  ${name}：${f.label.trim()}`);
            }
          }
        }

        // 米戈反击：SAN 检定
        say("");
        sanCheck(p0.shortName, san1, "0/1d3");
        sanCheck(p1.shortName, san2, "0/1d3");

        // 显示米戈状态
        const hpPct = migoHp / migoMaxHp;
        const statusText = hpPct > 0.6 ? "甲壳完好，行动自如" : hpPct > 0.3 ? "甲壳多处碎裂，动作开始迟缓" : "浑身伤痕累累，踉跄后退";
        say(`\n[${enemyName} HP: ${migoHp}/${migoMaxHp} — ${fmt(statusText)}]`);

        // 米戈受伤过半时尝试逃跑
        if (hpPct <= 0.6 && round >= 2) {
          const fleeChance = 0.3 + (1 - hpPct) * 0.5;
          if (Math.random() < fleeChance) {
            miGoFled = true;
            break;
          }
        }
      }

      // ── 结局判定 ──
      say("");
      if (migoHp <= 0) {
        // 击败：Mi-Go 重伤逃走，没带走大脑
        if (migoEncounter.victoryClueId) world.discoverClue(migoEncounter.victoryClueId);
        for (const line of migoEncounter.victoryLines) say(line);
      } else if (miGoFled && migoHp < migoMaxHp * 0.4) {
        // 打跑但没杀死：Mi-Go 自己逃走，没来得及带走大脑
        if (migoEncounter.victoryClueId) world.discoverClue(migoEncounter.victoryClueId);
        if (migoEncounter.fledLines) {
          for (const line of migoEncounter.fledLines) say(line);
        } else {
          say("敌人发出一声不甘的嘶叫，撞破通风管道独自逃走了。");
        }
      } else {
        // 完全失败：Mi-Go 带着大脑逃走
        for (const line of migoEncounter.defeatLines) say(line);
      }
      say(`${"═".repeat(48)}`);
    }

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

    /** Run a single clue check (observation or skill) and return true if discovered */
    async function runClueCheck(clue: Clue): Promise<boolean> {
      if (world.isClueFound(clue.id)) return false;
      for (const method of clue.findMethods) {
        if (method.type === "observation" || method.type === "automatic" || method.type === "item") {
          say(await narrateClueDiscovery(clue, "regular", ""));
          world.discoverClue(clue.id);
          checkClueSanLoss(clue);
          return true;
        }
        if (method.type === "skill") {
          // Fallback: no skillName → treat as observation (module data error guard)
          if (!method.skillName) {
            say(await narrateClueDiscovery(clue, "regular", ""));
            world.discoverClue(clue.id);
            checkClueSanLoss(clue);
            return true;
          }
          // resolveCheckValue: 技能走 skillValues（含中文别名），属性（幸运/力量等）走 attributes/luck
          const pcList = [c1, c2].sort((a, b) => {
            const va = resolveCheckValue(a, method.skillName!);
            const vb = resolveCheckValue(b, method.skillName!);
            return vb - va;
          });
          const offset = stepCounter++ % 2;
          const pc = pcList[offset % pcList.length];
          const val = resolveCheckValue(pc, method.skillName!);
          if (val > 0) {
            const name = pc === c1 ? p0.shortName : p1.shortName;
            say(`\n${name}${method.description}……`);
            const r = check(val, name, method.skillName!, (method.difficulty as "regular"|"hard"|"extreme") ?? "regular");

            if (r.isSuccess) {
              say(await narrateClueDiscovery(clue, r.successLevel, name));
              world.discoverClue(clue.id);
              checkClueSanLoss(clue);
              return true;
            } else {
              // 失败 → 累计失败次数；大失败额外加重
              const failCount = world.incrementClueFail(clue.id);
              if (r.successLevel === "fumble") {
                say(`${failFlavor(true)}`);
                // 大失败负面事件：额外 SAN 损耗（叙事重量）
                const fumbleCost = "0/1d3";
                sanCheck(name, pc === c1 ? san1 : san2, fumbleCost);
              } else {
                say(`${failFlavor(false)}`);
              }
              // ── failback 兜底：连续失败达到阈值 → 改道强制发现（Gumshoe 原则） ──
              const fb = clue.failback;
              if (fb) {
                const maxFails = fb.maxFails ?? 2;
                if (failCount >= maxFails) {
                  // 作者手写 fallbackRevelation 优先（质量保证）；无则走 C档 LLM 补救叙事
                  let rescueText = "";
                  const fallbackText = fb.fallbackRevelation
                    ? `历经周折，${sanitizeRevelation(fb.fallbackRevelation)}`
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
                  say(`\n${fallbackText || rescueText ? "（屡次搜寻未果，你们决定换个方式）\n" : ""}${finalText}`);
                  if (fb.sanCost) {
                    sanCheck(p0.shortName, san1, fb.sanCost);
                    sanCheck(p1.shortName, san2, fb.sanCost);
                  }
                  world.discoverClue(clue.id);
                  world.resetClueFails(clue.id);
                  return true;
                }
              }
              // 失败 → 继续尝试下一个 findMethod（同线索可能有多个技能/属性方法）
            }
          }
          // PC 没有此技能/属性 → 尝试下一个 findMethod
        }
      }
      attemptedClueIds.add(clue.id); // 所有方法均失败 → 标记防死循环
      return false;
    }

    // Track skill-check clues that failed this visit (prevent infinite re-investigation bouncing)
    const attemptedClueIds = new Set<string>();

    // ── Auto-resolve clue investigations (original behavior — no LLM calls) ──
    for (const clue of scene.clues) {
      if (world.isClueFound(clue.id)) continue;
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
      say(`\n${(unlocked[0] as SceneConnection).condition}。`);
      return unlocked[0] as SceneConnection;
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

    // Match LLM output to a connection
    let chosenConn: SceneConnection | null = null;
    for (const c of unlocked as SceneConnection[]) {
      const core = c.condition.replace(/^(前往|进入|返回|去|到)\s*/, "").slice(0, 8);
      if (decision.action.includes(core)) { chosenConn = c; break; }
    }
    if (!chosenConn) {
      // Score-based fallback
      const scored = (unlocked as SceneConnection[]).map(c => {
        let score = 0;
        const tgt = module.scenes.find(s => s.id === c.targetSceneId);
        if (!tgt) return { conn: c, score: -5 };
        if (!world.isSceneVisited(c.targetSceneId)) score += 10; else score -= 3;
        const vc = globalVisitCount.get(c.targetSceneId!) ?? 0;
        if (vc >= 3) score -= 8;
        else if (vc >= 2) score -= 4;
        return { conn: c, score };
      });
      scored.sort((a, b) => b.score - a.score);
      chosenConn = scored[0].conn;
    }

    say(`\n${chosenConn.condition}。`);
    return chosenConn;
  }

  // ── Game loop: scene entry → exploration → analysis → advance ──
  let done = false;
  let rounds = 0;
  let stepCounter = 0; // round-robin counter for PC skill checks
  const globalVisitCount = new Map<string, number>();
  const recentSceneIds: string[] = []; // anti-bounce: track last few scene transitions

  while (!done && rounds < 40) {
    rounds++;
    const currentId = world.currentSceneId;
    recentSceneIds.push(currentId);
    if (recentSceneIds.length > 5) recentSceneIds.shift();

    // Anti-bounce: if same 2 scenes repeat 3+ times in last 6 moves, force end
    if (recentSceneIds.length >= 6) {
      const last6 = recentSceneIds.slice(-6);
      const unique = new Set(last6);
      if (unique.size <= 2) {
        done = true;
        break;
      }
    }
    // Hard limit: auto-redirect if scene visited 6+ times
    const visitCount = globalVisitCount.get(currentId) ?? 0;
    if (visitCount >= 6 && currentId !== support.finaleSceneId) {
      const currentScene = module.scenes.find(s => s.id === currentId);
      const forcedConn = currentScene?.connections.find(c => !world.isSceneVisited(c.targetSceneId));
      if (forcedConn) { globalVisitCount.set(currentId, visitCount + 1); world.moveToScene(forcedConn.targetSceneId); continue; }
      done = true;
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
        done = true;
      }
    } else {
      // Dead-end safeguard: processScene returned null (no actions),
      // but check if there are still unvisited scenes in the module
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
      done = true;
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
      say(line);
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
      for (const line of ep.lines) say(line);
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

  say(`\n模组结束。 约 ${rounds} 轮回合`);
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
