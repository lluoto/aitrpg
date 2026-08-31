import { readFileSync, rmSync } from "fs";
import { parse as parseYaml } from "yaml";
import { loadConfig, type LLMConfig } from "../config";
import { LLMClient, type LLMLike } from "../llm/client";
import { MockLLMClient } from "../llm/mock-client";
import { parseIntent, setIntentLLM, intentLLMConfigured, declareIntentPath } from "../llm/intent";
import { generateNarrative, setNarratorLLM, narratorLLMConfigured } from "../llm/narrator";
// llmEnabled 是「该不该打网络」的**唯一**判据，别在别处重写一份 ——
// play-module.ts:101 记着上次抄第二份的代价。
import { llmEnabled } from "../play-module";
import { setPlayerLLM, playerLLMConfigured } from "../agent/player-agent";
import { resolvePlayerMetaSync, type PlayerMeta } from "../character/player-metadata";

import { RuleEngine } from "../engine/rule-engine";
// 状态定义库 + 时限口径。存储仍是 `status: string[]`，这里只提供定义与推进规则。
import { newStatus, tickStatuses } from "../rules/status-effects";
import { RulesEngine, type RulesetId } from "../rules/rules-engine";
import { SanityEngine, calcDamageBonus, checkMajorWound, sanOutcomeLabel } from "../rules/coc-engine";

import { KPAgent } from "../agent/kp-agent";
import { AgentRegistry } from "../agent/agent-registry";
import { WorldStateManager } from "../state/world-state-manager";
import { NPCCombatEngine, NPC_UNARMED_SKILL } from "../combat/npc-combat";
import { CompanionManager } from "../combat/companion-manager";
import { PlayerSession, type VisibilityRule } from "../session/player-session";
import { InvestigationEngine } from "../investigation/investigation-engine";
import { decideClueMatch, extractLocationHint } from "../investigation/clue-match";
import { SpellEngine } from "../spell/spell-engine";
import { WorldModelLoader, sharedWorldModel, DEFAULT_CTHULHU_PATH } from "../world/world-model-loader";
import { WorldModelIntegrator, type SceneContext, type NPCPresentProfile } from "../world/world-model-integrator";
import { NPCStore } from "../db/index";
import { getDifficultyProfile } from "../rules/module-difficulty";
import type { DifficultyProfile } from "../rules/module-difficulty";
import { applyAction, type GateState, type RejectReason, type Result, type StateDelta } from "../rules/apply-action";
import { boundedIntegerGateState, boundedIntegerScenario, buildDifficultyGateState, COC_SESSION_SCENARIO, isDifficultyLabel } from "../rules/coc-session-scenario";
import { CharacterFactory, getArchetype, type LegendaryAction } from "../character/character-factory";
import { buildCoCCharacter, SKILL_NAME_MAP, getCoCArchetypes, resolveCheckValue } from "../character/coc-character";
import { StoryGenerator } from "../rules/story-generator";
import { CareerFileStore } from "../character/career-file";
import { createGameTime, advanceTime, formatGameTime, periodAtmosphere, type GameTime } from "../rules/game-time";
import { listTables, rollTable } from "../rules/random-tables";

import { MythosModuleLoader, type MythosModuleHost } from "../rules/mythos-module";
import { PoliticoEconomyEngine } from "../economy/politic-economy-engine";
import { PREMIERS_BARN_MODULE, ARKHAM_LIBRARY_MODULE, INNSMOUTH_MODULE } from "../rules/mythos-module";
import { getModule as getCustomModule } from "../rules/custom-modules/index";
import { BARN_OF_PREMIER } from "../module/barn-of-premier";
import { resolveSceneTarget, mentionedSceneNames, hasMovementSignalNearMention, type SceneRow } from "../play/scene-resolve";
import { buildSceneGraph, shortestHops } from "../play/move-graph";
import { isExplicitLeaveIntent, isConfirmReply, MODULE_ENDING_SUPPORT, GENERIC_DEPARTURE_LINES } from "../play/module-departure";

import type { WorldEntity, ActionIntent, CombatPersonalityTraits } from "../types";
import type { NPCPersonality, AgentMessage, MessageType, NPCMood } from "../agent/types";
import { asNPCMood } from "../agent/types";
import { voiceKeyFor } from "../voice/speech-plan";
import { log } from "../log";

export interface ActionResponse {
  narrative: string;
  events: {
    speaker: string;
    content: string;
    type: MessageType;
    verbatim?: boolean;
    /**
     * 预制音频的文件名（不含扩展名）。只有可离线预合成的消息才有 ——
     * 前端凭它取 /voice/{voiceKey}.wav，取不到就静默跳过。
     */
    voiceKey?: string;
  }[];
  state: {
    scene: string;
    /** 当前场景的配乐标识（模组静态数据）。无映射时缺省，前端静默不放。 */
    bgm?: string;
    round: number;
    player: { name: string; hp: number; maxHp: number; ac: number; status: string[] };
    npcs: { name: string; hp: number; maxHp: number; status: string[]; attitude?: string }[];
    monsters: { name: string; hp: number; maxHp: number; status: string[] }[];
    companions: {
      id: string; name: string; hp: number; maxHp: number; ac: number;
      morale: number; behavior: string; control: string; position: string;
      inventory: string[]; motivation?: string;
      traits: CombatPersonalityTraits | null; skills: Record<string, number> | null;
      resolveState: string;
    }[];
    /**
     * 队伍列表（能在 POST /action 用 pcId 指定"以谁身份行动"的候选）。
     * 让"谁能行动"对客户端可见——此前 getState 只暴露 companions（NPC 队友），
     * 玩家自己（party 成员）无从得知有哪些 pcId 可选，路由能力拿到也用不上。
     * control 只读不写：本轮不加设置入口（那是 L4 接管/交还的事）。
     *
     * hp/maxHp/status/san/maxSan：实跑三个 PC 轮流行动 30 回合，party 里
     * 始终看不到任何人的状态——state.player 只反映当前 active PC，「谁受伤
     * 了」在多 PC 局里无从判断。hp/maxHp/status 取 world.getEntity(pcId)（与
     * `player` 单数字段同一份数据源，不另建一条真相）；san/maxSan 取
     * PartyMember.san（与 sanityEngines 同一引用）。
     */
    party: {
      pcId: string; name: string; control: "auto" | `player:${string}`;
      hp: number; maxHp: number; status: string[]; san: number; maxSan: number;
    }[];
    /**
     * 游戏内时间——与 getKPState():1257 同一口径（{day, period, label}），
     * 不新造一种表示。此前移动计时（弱版邻接+按跳数付时间）功能做了、
     * LLM 提示词里有、KP 视图里有，唯独玩家侧（这里）没有——而"移动要付
     * 时间"的全部意义就是玩家能感知到代价，见 docs/todo.json。
     */
    gameTime: { day: number; period: string; label: string };
  };
  dead?: boolean;
  sanity?: { currentSAN: number; maxSAN: number; temporaryInsanity: boolean; indefiniteInsanity: boolean; phobias: string[] };
  rolls?: { skill: string; roll: number; target: number; success: boolean }[];
  dice?: { expr: string; total: number; detail?: string; bonus?: number }[];
  /**
   * 结构化拒绝信号（本轮为「未知 pcId」的 action 路由加入）。取不到目标时
   * 置位，客户端/传输层据此返回结构化错误（参照 setPlayerSan 的
   * `{ code: "unknown_target", targetId }` 形状），**不**把它折成一条
   * 可读系统消息塞进 events 了事——那是「报告了一件没发生的事」。正常路径
   * 该字段恒 undefined，既有调用方无需感知。
   */
  error?: { code: string; targetId?: string };
}

export interface SessionSummary {
  id: string; round: number; ruleset: string; scene: string; playerName: string;
  archetype: string | null; messageCount: number; npcCount: number; createdAt: number;
}

/**
 * 复合句回问的待确认状态。触发回问时的原始输入与解析出的意图——回答的
 * 不是地点时，照它在原地执行，不卡住（见 resolveCompoundMoveReply）。
 */
interface PendingCompoundMove {
  originalInput: string;
  originalIntent: ActionIntent;
}

/**
 * 建一个 PC 需要同时诞生的八件事的登记项，供 createPartyMember() 统一填。
 *
 * ⚠ 不是要取代 `characters`/`sanityEngines` 两张 Map——`sheet`/`san` 与那两张
 * Map 里存的是**同一个对象引用**，不是拷贝。`party` 是额外的第三张索引，
 * 补上前两张不管的东西（`control`），不是重新造一份角色状态的真相源。
 * 单一入口保证的是"建号时这八件事一次做齐"，不是"数据只能有一处"。
 */
export interface PartyMember {
  pcId: string;
  /** 与 characters.get(pcId) 同一个对象引用 */
  sheet: any;
  /** 与 sanityEngines.get(pcId) 同一个对象引用 */
  san: SanityEngine;
  /** "auto" = AI 自主行动，"player:userId" = 指定玩家手操。字段原样搬自 CompanionState（types.ts:229）。 */
  control: "auto" | `player:${string}`;
  /**
   * PlayerAgent 的扮演字段（personality/backstory/currentGoal），经 resolvePlayerMeta
   * 的兜底链（HTTP→模组→backgroundProfile 推导→LLM）解析后落在这里。
   * 本轮只落值不消费——GameSession 尚未创建 PlayerAgent，是给 L2b 后续把
   * PlayerAgent 接进 web 会话时读的。
   */
  meta?: PlayerMeta;
  /**
   * 保留字段，本轮**不消费**——没有任何代码读它。按人数缩放难度是另一整轮
   * 的活（本轮明确排除），这里先把字段占位占出来，免得以后又是"字段在、
   * 没人接"的老毛病一次性发作。真要用时先写清楚谁读、怎么用再填值。
   */
  difficulty?: DifficultyProfile | null;
}

/** 队伍硬上限：超过直接拒绝，不放行。 */
export const PARTY_HARD_LIMIT = 10;

/**
 * 解析模组 meta.playerCount（"2~3"/"2-3"/"3" 这类字符串）成 {min,max}。
 * 解析不出来就返回 null——不强行猜一个范围出来，没有推荐人数就不警告，
 * 不是"猜错了也要给条警告"。
 */
export function parsePlayerCountRange(s: string | null | undefined): { min: number; max: number } | null {
  if (!s) return null;
  const range = s.match(/(\d+)\s*[~～\-至到]\s*(\d+)/);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    return min <= max ? { min, max } : { min: max, max: min };
  }
  const single = s.match(/^\s*(\d+)\s*$/);
  if (single) {
    const n = Number(single[1]);
    return { min: n, max: n };
  }
  return null;
}

// ============================================================
// 辅助函数
// ============================================================

// 原先这里有个 `generateId()`（`sess_` + 时间戳 + 随机后缀），没有任何调用方 ——
// 会话 id 是构造时由外部传进来的。留着会让人以为 id 是这里生成的。

/** 技能英文键 → 中文显示名（成长消息、传承记录共用） */
const SKILL_DISPLAY_NAMES: Record<string, string> = {
  stealth: "潜行", perception: "侦查", investigation: "调查", persuasion: "说服",
  medicine: "医学", history: "历史", occult: "神秘", library_use: "图书馆使用",
  listen: "聆听", psychology: "心理学", library: "图书馆", fight: "格斗",
  // "idea" 不是 CoC 技能键，是 failback 阶梯（开发·线索闸门 任务4）里
  // 灵感检定用的合成 skillId——见 resolveSceneClue 的阶梯分支。
  idea: "灵感",
};

/**
 * intent 词汇 → CoC 技能键，仅用于中文显示名翻不过去的几个。
 *
 * 多数技能能靠"中文显示名"这座桥转换（SKILL_DISPLAY_NAMES 给中文，SKILL_NAME_MAP
 * 把中文翻成 CoC 键），下面两个不行：
 * - investigation：CoC 没有"调查"这个技能，搜索现场按规则书就是侦查。它还是
 *   handleSkillCheck 的默认技能，不映射的话最常走的那条路照旧落兜底值。
 * - fight：显示名"格斗"在 SKILL_NAME_MAP 里只有带武器类别的形式（"格斗(肉搏)"）。
 */
const COC_SKILL_ALIASES: Record<string, string> = {
  investigation: "spot_hidden",
  fight: "fighting",
};

/** 克苏鲁神话世界模型路径。共享 loader 按路径分桶，因此这里必须是同一个常量。 */
const CTHULHU_MODEL_PATH = DEFAULT_CTHULHU_PATH;

/**
 * 剥掉字符串首尾的中英文标点（不动中间）。
 *
 * 自然语言输入抽 target 时经常带着标点尾巴——「附近店铺，」「维森酒吧。」——
 * `.trim()` 只管空白，标点会原样进 key，回显因此打出「这里没有「附近店铺，」」
 * 这种一眼看出是解析层没收干净的输出。
 */
const EDGE_PUNCTUATION = /^[，。！？；：、,.!?;:"'“”‘’()（）《》「」【】\s]+|[，。！？；：、,.!?;:"'“”‘’()（）《》「」【】\s]+$/g;
function stripEdgePunctuation(s: string): string {
  return s.replace(EDGE_PUNCTUATION, "");
}

/**
 * 按规则集建卡。
 *
 * cosmic-horror 走 CoC 7e 建卡器，其余仍走通用工厂。此前所有规则集都走通用工厂，
 * 而它只会写 D&D 六属性固定 10（缺 size/power/appearance/education）、按 D&D 公式
 * 算 HP、且从不填 skillValues——于是每个调查员都一模一样，职业和技能分配对判定
 * 毫无影响，技能检定只能落到各调用点自己的兜底常量。
 *
 * 点数与 play-module 的建卡保持一致（point_buy 480），避免两条路径给出不同强度的角色。
 */
function buildCharacterForRuleset(name: string, archetypeId: string, ruleset: string): any {
  if (ruleset === "cosmic-horror") {
    const archetype = getArchetype(archetypeId);
    // 找不到职业时回落通用工厂，让原有的"未知职业"报错路径保持不变
    if (archetype) {
      return buildCoCCharacter(
        { name, archetypeId, method: "point_buy", pointBudget: 480 },
        archetype,
      );
    }
  }
  return CharacterFactory.generate(name, archetypeId, ruleset);
}

export class GameSession {
  readonly id: string;
  readonly createdAt: number;
  lastActiveAt: number;
  readonly config: LLMConfig;
  // 无可用 API key 时装配 MockLLMClient，两者调用面一致但没有共同基类，
  // 因此字段类型必须是联合，而不是只写 LLMClient。
  readonly llm: LLMLike;
  readonly ruleEngine: RuleEngine;
  readonly rules: RulesEngine;
  readonly world: WorldStateManager;
  readonly npcCombat: NPCCombatEngine;
  readonly session: PlayerSession;
  readonly investigation: InvestigationEngine;
  sanity: SanityEngine;
  readonly spellEngine: SpellEngine;
  readonly registry: AgentRegistry;
  readonly kp: KPAgent;
  readonly worldModel: WorldModelLoader;
  readonly wmIntegrator: WorldModelIntegrator;
  /** 克苏鲁神话世界模型（独立第二 loader，懒加载，失败静默降级） */
  readonly cthulhuLoader: WorldModelLoader;
  readonly npcStore: NPCStore;
  readonly companionManager: CompanionManager;
  readonly politicoEconomy: PoliticoEconomyEngine;

  activeRuleset: RulesetId = "cosmic-horror";
  activePlayerId: string = "p1";
  activeCharacter: any = null;
  round: number = 0;
  dead: boolean = false;
  combatActive: boolean = false;
  /**
   * 两种"待确认"门，改回两个独立字段——不再是上一轮统一进的单个
   * `pendingConfirm` 联合类型。原因（跨 PC 泄漏，2026-08-30 实测
   * lcmj2joi）：单字段只记"有没有待确认"，不记"是谁提的"，导致 p1
   * 的复合句回问被 p2 完全无关的一句话答掉。上一轮把两种 pending 统一
   * 成一个字段是为了让"两个 pending 同时开互相打架"在结构上不可能——
   * 这个理由只在单 PC 模型下成立；多 PC 场景下，`compound-move` 与
   * `leave` 本来就是两种不同范围的决定（见各自字段的注释），会同时
   * 存在是正常状态，不是要避免的"打架"。
   */
  /**
   * 复合句回问——**认人**：只有触发它的那个 PC 的下一次输入才算回答。
   * key 是 pcId，值是触发时的原始输入与意图（回答不是地点时用来在
   * 原地执行，见 resolveCompoundMoveReply）。
   *
   * 用 Map 而不是单个 `{pcId, ...}` 字段：不同 PC 各自可能有一个尚未
   * 回答的回问——p1 问完还没答，p2 自己又触发一次，两者互不干扰、
   * 各自等自己的人回答，不会互相覆盖。
   *
   * ⚠ 已知且接受的缺口：如果触发回问的那个 PC 后续再也不行动了
   * （或者被移出队伍——本轮无删除入口，见 todo.json 建号相关记录），
   * 这条 Map 里的项会一直留着、系统消息会一直提醒"XX 还有问题没答"。
   * 没有做自动过期/超时清理——那是需要先决定"多久算过期"的另一个设计
   * 决定，本轮不做，如实记录风险而不是假装它不存在。
   */
  private pendingCompoundMove: Map<string, PendingCompoundMove> = new Map();
  /**
   * 离开确认——**不认人**，party 级的决定：谁确认/取消都算数。
   * 用一个 boolean 就够，因为语义上不需要记"是谁提的"——"要不要结束
   * 这次调查"影响的是整个队伍，不是某个 PC 自己的行动，任何一个 PC
   * 出面确认或取消都是队伍做出的决定，不存在"只有提问的那个人能回答"
   * 这回事（对照 compound-move：那是某个 PC 自己的动作要不要先移动，
   * 天然只该问那个 PC）。
   */
  private pendingLeaveConfirm: boolean = false;

  private characters: Map<string, any> = new Map();
  /**
   * SAN 引擎是带行为的对象（检定、疯狂判定），这里只作进程内缓存；
   * 其 state 的真相源是 WorldStateManager，落库点见 persistSanity()。
   * 背包 / 武器 / 护甲没有进程内副本，一律直读直写真相源。
   */
  private sanityEngines: Map<string, SanityEngine> = new Map();
  /**
   * 第三张索引，补 `characters`/`sanityEngines` 都不管的东西（`control`）。
   * 键与那两张 Map 共用 pcId；`sheet`/`san` 字段与它们里的对象是同一份引用。
   * 见 PartyMember 接口注释与 createPartyMember()。
   */
  private party: Map<string, PartyMember> = new Map();
  private sceneItems: Map<string, string[]> = new Map();
  private sceneDisplayNames: Record<string, string> = {};
  private sceneAliases: Record<string, string[]> = {};
  /**
   * 场景 → 配乐标识。模组静态数据，与显示名/别名同层，**不属于世界状态**，
   * 因此留在进程内而不进真相源：它不会被玩法改变，重载模组即可重建。
   */
  private sceneBgm: Record<string, string> = {};
  private registeredModules: any[] = [];
  private lastNarrative: string = "";
  private lastDiceRoll: { expr: string; total: number; detail?: string; bonus?: number } | null = null;
  private lastRolls: Array<{skill: string; roll: number; target: number; success: boolean}> = [];
  private gameTime: GameTime = createGameTime();
  private activeDifficulty: DifficultyProfile | null = null;
  // 原先有个 `monstersSeen: Set<string>`：从没被读也没被写。
  // CoC 里它该用来做「首次目击才掉 SAN」的去重，但这条路径上
  // **根本没有对怪物的 SAN 检定**（唯一的 sanityCheck 是玩家显式命令触发的），
  // 所以它是一个没建成的功能留下的空字段，不是漏接的去重表。
  public careerStore: CareerFileStore | null = null;
  private storyGenerator = new StoryGenerator();
  public skillGrowthMarks: string[] = [];
  public skillMarks: Record<string, number> = {};
  private _woundsTreated: boolean = false;
  private _moduleStartByPC: Map<string, { san: number; cm: number }> = new Map();
  /** 各 PC 在休息时已结算的成长（skill → 新值），模组结算时并入传承记录 */
  private _growthChangesByPC: Map<string, string[]> = new Map();
  private mythosSpells: Map<string, { sanCost: string; mpCost: number; description: string; effect?: string }> = new Map();
  public knownMythosSpells: string[] = [];
  private _lastPushedRoll: { skill: string; roll: number; target: number } | null = null;
  private _moduleLoader?: MythosModuleLoader;
  private _loadedModules: Map<string, boolean> = new Map();
  /**
   * 建会话时 HTTP 传的 p1 扮演字段（personality/backstory/currentGoal）。
   *
   * 没传 archetypeId 时 p1 建的是空壳槽位，真正的角色卡要等"创建角色"命令
   * 才诞生（见该命令处理函数）——这份字段那时候才用得上，所以先存住，不能
   * 在构造函数里因为走了空壳分支就把它默默丢掉（HTTP 给的值消失且没有任何
   * 报错，调用方毫无察觉）。
   */
  private p1Persona?: PlayerMeta;

  constructor(
    id: string,
    ruleset: RulesetId = "cosmic-horror",
    llmConfig?: LLMConfig,
    archetypeId?: string,
    characterName?: string,
    persona?: PlayerMeta,
  ) {
    this.id = id;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.activeRuleset = ruleset;
    this.p1Persona = persona;

    const config = llmConfig ?? loadConfig();
    this.config = config;

    const apiKey = config.apiKey;
    this.llm = (apiKey && !apiKey.startsWith("sk-placeholder"))
      ? new LLMClient(config)
      : new MockLLMClient();

    // ⚠ 意图解析的 LLM 原先**只有 CLI 会设**（`index.ts:54` 的 `setIntentLLM(llm)`），
    //   GameSession 从不设，于是走服务器/网页的这条路 `_llmClient` 恒为 null，
    //   **LLM 语义理解在这条路上从没启用过**，全靠 regex。
    //   量过一次：24 条常见 CoC 动作，认对 10、认错 3、不认识 11。
    //
    //   三个刻意的选择：
    //   1. **只在还没设过时设**。`_llmClient` 是模块级单例，多个会话共享一份；
    //      每建一个会话就覆盖一次会让并发会话互相踩，也会让 CLI 显式设的那份被顶掉。
    //   2. **走 `llmEnabled()` 这个唯一判据**，不在这里重写一份。
    //      play-module.ts:101 记着为什么：曾经有两份判据，于是开发机上
    //      只要 key 在环境里，`LLM_DISABLED=true` 拦不住打网络。
    //   3. **MockLLMClient 不设**。它不是真客户端，设进去只会让每次解析
    //      多绕一圈再回落 regex。
    if (this.llm instanceof LLMClient && llmEnabled() && !intentLLMConfigured()) {
      setIntentLLM(this.llm);
    }
    // 起手声明一次：这一局的意图解析最终走的是 LLM 还是 regex，日志上要能
    // 唯一反推出来（见 declareIntentPath 的注释——"零条 warn"曾经同时符合
    // "接上了且全对"和"根本没接"两种状态）。一局一次，不是每回合都打。
    declareIntentPath();
    // 战斗叙述同理：`llm/narrator.ts` 的 `_narratorLLM` 也是模块级单例，
    // 原先只有 CLI 会设（`index.ts:55`），网页端战斗只印
    // 「造成 N 点伤害」，没有画面。守卫逻辑与上面 intent 那份一致。
    if (this.llm instanceof LLMClient && llmEnabled() && !narratorLLMConfigured()) {
      setNarratorLLM(this.llm);
    }
    // 玩家 Agent 的决策 LLM 同理（decideViaLLM）：原先直接在 player-agent 里裸
    // fetch、绕开 llmEnabled()。走 LLMClient 后这里只在还没设过时设一次。
    if (this.llm instanceof LLMClient && llmEnabled() && !playerLLMConfigured()) {
      setPlayerLLM(this.llm);
    }

    this.ruleEngine = new RuleEngine();
    this.rules = new RulesEngine();
    this.session = new PlayerSession();
    this.world = new WorldStateManager(`:memory:`);
    this.npcCombat = new NPCCombatEngine();
    this.companionManager = new CompanionManager();
    this.politicoEconomy = new PoliticoEconomyEngine();
    // 挂 this.world：线索发现从此写真相源，不是引擎自己的进程内 Map——
    // 见 InvestigationEngine 构造函数与 markDiscovered 的注释。
    this.investigation = new InvestigationEngine(undefined, this.world);
    this.spellEngine = new SpellEngine();
    this.npcStore = new NPCStore();
    this.registry = new AgentRegistry(this.llm, this.npcStore);
    this.kp = new KPAgent({ scene_description: "", scene_elements: [], current_phase: "exploration", style: "standard", plot_nodes: [] }, this.llm);
    // 进程内共享：这两份是只读参考数据，不是会话状态。每会话各建一个会让
    // 383688 条的 v18 主库按会话数重复加载与驻留（实测 3 会话 = 3 次加载 / 1938MB）。
    this.worldModel = sharedWorldModel();
    this.wmIntegrator = new WorldModelIntegrator(this.worldModel);
    this.cthulhuLoader = sharedWorldModel(CTHULHU_MODEL_PATH);
    // 世界模型懒加载：不在此处 load()（v18_all_master.jsonl ~240MB，会拖慢所有 GameSession 实例化，
    // 测试与无模型场景均受影响）。首次需要注入时才在 injectWorldModelForScene() 里加载。

    // CoC 7e 的初始 SAN 等于 POW。SanityEngine 的构造参数本来就叫 pow，会话却一直
    // 传死值 50——接上 CoC 建卡后角色卡上终于有了真的 POW，理智值却仍与它无关。
    // 建卡得排在建 SAN 之前，所以先建出来，下面的初始化块直接用这一份。
    let initialCharacter: any = null;
    if (archetypeId) {
      try {
        initialCharacter = buildCharacterForRuleset(
          characterName ?? "调查员",
          archetypeId,
          ruleset
        );
      } catch (e) {
        log.warn("session", "角色创建失败", e);
      }
    }

    if (initialCharacter) {
      // 有初始角色：走统一入口，八件事一次做齐（见 createPartyMember 注释）。
      try {
        const result = this.createPartyMember("p1", initialCharacter);
        if ("rejected" in result) {
          // 理论上不会发生：party 从空 Map 开始，人数检查不可能在这里触发。
          log.warn("session", `建号被拒绝（不该发生，party 应为空）：${result.rejected}`);
          this.sanity = new SanityEngine(initialCharacter?.attributes?.power ?? 50);
          this.sanityEngines.set("p1", this.sanity);
        } else {
          this.activeCharacter = result.member.sheet;
          this.sanity = result.member.san;
          // p1 的扮演元数据：HTTP 给的字段（优先）→ backgroundProfile 推导。
          // 见 resolveMeta 方法注释——三处建卡入口（这里/addPartyMember/
          // "创建角色"命令）共用它，不各自内联一份 resolvePlayerMetaSync 调用。
          result.member.meta = this.resolveMeta(persona, result.member.sheet);
        }
      } catch (e) {
        log.warn("session", "角色创建失败", e);
        this.sanity = new SanityEngine(initialCharacter?.attributes?.power ?? 50);
        this.sanityEngines.set("p1", this.sanity);
      }
    } else {
      // 没有初始角色（没传 archetypeId）：先建一个空壳槽位——SAN(50 兜底)/
      // registerPlayer/persistSanity/session 槽位都要有，历史消息记录依赖
      // 活动玩家的 messageHistory，缺失会导致 getHistory 恒空。真正的角色卡
      // /世界实体/careerStore 留到"创建角色"命令时再补（createPartyMember
      // 里"已存在则整体重建"那条语义正是为了接这里）。
      this.sanity = new SanityEngine(50);
      this.sanityEngines.set("p1", this.sanity);
      this.world.registerPlayer("p1");
      this.persistSanity("p1");
      if (!this.session.getActive()) {
        try {
          this.session.join("p1", characterName ?? "调查员", "p1", "");
        } catch { /* 已存在则忽略 */ }
      } else {
        this.session.switchActive("p1");
      }
    }
  }

  // ============================================================
  // PC 生命周期
  // ============================================================

  /**
   * 建一个 PC 的单一入口。
   *
   * ⚠ 之前有三条各不相同的路径（构造函数建 p1 / "创建角色" 重建 p1 /
   * "创建队友" 建 p2+），下面八件事没有一条路径全做齐：
   *   1. sanityEngines.set          2. SAN 取角色 POW（不是硬编码 50）
   *   3. world.registerPlayer       4. persistSanity
   *   5. session.join/switchActive  6. characters.set
   *   7. world.upsertEntity         8. careerStore 快照
   * "创建角色"不建 SanityEngine——新角色沿用旧角色的 maxSAN；"创建队友"
   * 硬编码 `new SanityEngine(50)`——不取角色真实 POW；"创建队友"不
   * upsertEntity——世界实体不存在，构造函数自己的注释写过这个后果："开局的
   * KP 伤害因为找不到实体而失败，getState() 的硬编码兜底又让面板照常显示
   * 12/12，两相抵消，谁都看不出来"。三条路径各缺各的，现在收成一条。
   *
   * @param pcId 目标 PC 的键。已存在则**整体重建**（新 SanityEngine 换掉
   *   旧的、新 sheet 换掉旧的）——不是合并更新。"创建角色"复用现有 pcId
   *   时用的就是这个语义：重建当前活跃 PC，不是"更新几个字段"。
   * @param sheet 角色卡（CoC/D&D 生成结果，不在这里挑类型）
   * @param opts.control 初始控制模式，默认 "auto"（同 CompanionState 的默认值，
   *   见 companion-manager.ts:74）——谁应该默认是 "player:xxx" 是消费方
   *   （L2/L3）的决定，这里不替它做主。
   * @returns 拒绝时给 `{ rejected }`（队伍已满，硬上限 10 人，见
   *   PARTY_HARD_LIMIT）；否则给 `{ member, warning? }`，`warning` 在人数
   *   超过模组推荐上限时给出，只播报不拦——"警告后放行，不拒绝"是本轮定的
   *   设计决策，且不实现任何按人数缩放的补偿（没有这类规则，硬造等于编）。
   */
  /**
   * 分配一个未被占用的 pcId（p1, p2, ...）。
   *
   * 根因修正：原本"创建队友"用 `this.party.size + 1` 算 pid，但 `party`
   * 不是唯一持有 pcId 的地方——构造函数在**没有角色卡时**（没传 archetype）
   * 走空壳分支，往 `sanityEngines`/`world`/`session` 里注册了 "p1" 却**不**
   * 填 `party`。于是 `party.size` 为 0，`0 + 1 = p1`，队友的卡直接顶掉玩家
   * 自己的 p1 槽位（净效果：播报"加入了队伍"，实际是静默顶替）。
   *
   * 所以"占用"必须覆盖**所有**持有 pcId 的地方，取其并集——四个持有者任何
   * 一个短暂失同步都不该让分配复用到一个已占用的 id：
   *   · this.party                （createPartyMember 建的正式成员）
   *   · this.sanityEngines       （空壳分支也建，见构造函数）
   *   · this.session             （PlayerSession 槽位，join/switchActive）
   *   · this.world.getPlayerIds()（player_state 表，两条分支都 registerPlayer）
   * 用并集而不是只拿 `world.getPlayerIds()` 一份：虽然那是最完整的（空壳分支
   * 也调 registerPlayer），但这场 bug 的本质就是"各持有者会短暂失同步"——
   * 拿并集是与这个失败模式同构的防御（correct by construction），代价只是
   * 一次 O(成员数) 的扫表，这里成员数上限是 PARTY_HARD_LIMIT=10。
   *
   * 从 1 往上找第一个空位（不是"单调递增不复用"）：pcId 语义是"固定归属"，
   * 空壳槽位 p1、被重建的同 id PC 都不该被后建的人抢走。本轮没有删除入口，
   * PlayerSession.leave()（会销毁 messageHistory）不会被触发，所以"复用"
   * 不会真发生旧历史串到新 PC 上；即便将来加了删除，leave 时连 id 一起删，
   * 这里从 1 找空位仍然正确。
   */
  private nextFreePcId(): string {
    const used = new Set<string>();
    for (const id of this.party.keys()) used.add(id);
    for (const id of this.sanityEngines.keys()) used.add(id);
    for (const id of this.session.getAllNames()) used.add(id);
    for (const id of this.world.getPlayerIds()) used.add(id);
    let n = 1;
    while (used.has(`p${n}`)) n++;
    return `p${n}`;
  }

  /**
   * 逐字段走兜底链（HTTP→模组→backgroundProfile 推导→LLM），结果落成一个
   * PlayerMeta。见 src/character/player-metadata.ts。
   *
   * web/session 这条路的客户端没接 ModulePlayerSetup（BARN_SUPPORT 无 players
   * 字段，恒空——见 module/types.ts:524 的注释），所以模组层在这条路上没有
   * 来源；真正有 ModulePlayerSetup 的是 play-module（剧本杀）那条路。LLM 步骤
   * 本路暂不注入生成器（真有 LLM 生成需求时由调用方提供），依赖 HTTP/推导层，
   * 故用同步版——三处建 PC 的地方（构造函数建 p1、addPartyMember、"创建角色"
   * 命令重建当前活跃 PC）都调这一个方法，不各自内联一份 resolvePlayerMetaSync。
   */
  private resolveMeta(http: PlayerMeta | undefined, sheet: any): PlayerMeta {
    return resolvePlayerMetaSync({
      http,
      profile: sheet?.backgroundProfile,
      module: undefined,
    });
  }

  /**
   * 把"职业"输入解析成 archetypeId —— 只在 cosmic-horror 规则集下生效。
   * `buildCharacterForRuleset` 只认英文 id（如 "journalist_coc"），中文
   * 显示名（"记者"）原样传进去会被判成未知职业——但"创建队友"这条文本命令
   * 只有中文语境，玩家没有理由知道内部 id。先按 id 精确匹配，查不到再按
   * `getCoCArchetypes()` 的 label 精确匹配；两者都查不到就原样返回，交给
   * 调用方的兜底判空处理。
   */
  private resolveOccupationId(input: string): string {
    if (this.activeRuleset !== "cosmic-horror") return input;
    if (getArchetype(input)) return input;
    const byLabel = getCoCArchetypes().find((a) => a.label === input);
    return byLabel ? byLabel.id : input;
  }

  /**
   * 为队伍新增一个 PC —— web 的 `POST /api/sessions/:id/party` 与文本命令
   * 「创建队友」共用（不掰成两套做法）。必须走到 createPartyMember（单一入口，
   * 八件事一次做齐）；meta 经 resolveMeta 兜底链解析后挂到 PartyMember.meta，
   * 供后续把 PlayerAgent 接进 web 会话时读。
   *
   * ⚠ `buildCharacterForRuleset` 对未知职业会抛。原先这里没接，异常一路
   * 冒到 runAction 的外层 catch，变成裸 500——实跑「创建队友 记者 林娜」
   * （中文职业名不认）与「创建队友 林娜 记者」（参数顺序写反）两次都中。
   * 接住它，走 `{ rejected }` 这个已有形状（server.ts 已经把它翻成 400），
   * 消息里把正确用法与写反了怎么办都说清楚，不是只丢一句"未知职业: X"。
   */
  addPartyMember(
    name: string,
    archetypeId: string,
    meta?: PlayerMeta,
  ): { member: PartyMember; warning?: string } | { rejected: string } {
    const resolvedArchetypeId = this.resolveOccupationId(archetypeId);
    let ch: any;
    try {
      ch = buildCharacterForRuleset(name, resolvedArchetypeId, this.activeRuleset);
    } catch {
      return {
        rejected: `未知职业「${archetypeId}」。用法：创建队友 <姓名> <职业>（先姓名后职业——`
          + `如果把这两个写反了就会看到这条报错）。用「职业列表」查看全部可用职业`
          + `（也可以直接用中文职业名，如"记者""侦探""医生"）。`,
      };
    }
    const pid = this.nextFreePcId();
    const result = this.createPartyMember(pid, ch, { control: "auto" });
    if ("rejected" in result) return result;
    result.member.meta = this.resolveMeta(meta, result.member.sheet);
    return result;
  }

  private createPartyMember(
    pcId: string,
    sheet: any,
    opts?: { control?: "auto" | `player:${string}` },
  ): { member: PartyMember; warning?: string } | { rejected: string } {
    if (!this.party.has(pcId) && this.party.size >= PARTY_HARD_LIMIT) {
      return { rejected: `队伍已满（上限 ${PARTY_HARD_LIMIT} 人），无法再加入新角色。` };
    }

    const san = new SanityEngine(sheet?.attributes?.power ?? 50);
    this.sanityEngines.set(pcId, san);
    this.characters.set(pcId, sheet);
    this.world.registerPlayer(pcId);
    this.persistSanity(pcId);

    // 注册/切换到会话槽位——已存在则只切换，不重复 join（PlayerSession.join
    // 撞见已存在的 key 会抛异常，join 的 key 是 pcId 不是角色名，两个角色
    // 重名不会撞这个异常，只有 pcId 撞了才会，而 pcId 在这个入口里由调用方
    // 保证唯一/或走"重建同一个 pcId"的路径，所以这里的 has 检查已经够）。
    if (!this.session.get(pcId)) {
      try {
        this.session.join(pcId, sheet?.name ?? "调查员", pcId, this.world.getCurrentState().scene ?? "unknown");
      } catch { /* 理论上不会发生：上面刚判过不存在 */ }
    } else {
      this.session.switchActive(pcId);
    }

    // 角色卡与世界实体必须同时诞生，见方法头注释引用的构造函数原话。
    this.world.upsertEntity({
      id: pcId,
      name: sheet?.name ?? "调查员",
      type: "pc",
      hp: sheet?.hp ?? 12,
      maxHp: sheet?.maxHp ?? 12,
      // CoC 规则下 getState() 本就把对外的 ac 覆盖成 0；D&D 侧按角色卡算。
      ac: this.activeRuleset === "cosmic-horror" ? 10 : CharacterFactory.computeAC(sheet),
      status: [],
      position: this.world.getCurrentState().scene ?? "unknown",
    });

    if (!this.careerStore) {
      const careerDir = `data/careers/${this.id}`;
      try { rmSync(careerDir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓 */ }
      this.careerStore = new CareerFileStore(careerDir);
    }
    this.careerStore.saveSnapshot({
      characterName: sheet?.name ?? "调查员",
      occupation: getArchetype(sheet?.archetypeId ?? sheet?.archetype)?.label ?? sheet?.archetypeId ?? sheet?.archetype ?? "investigator",
      attributes: { ...(sheet?.attributes ?? {}) },
      skills: sheet?.skillValues ? { ...sheet.skillValues } : {},
      san: san.state.currentSAN,
      maxSan: san.state.maxSAN,
      cthulhuMythos: 0,
      hp: sheet?.hp ?? 12,
      maxHp: sheet?.maxHp ?? 12,
      creditRating: sheet?.creditRating ?? 30,
      createdAt: new Date().toISOString(),
    });

    const member: PartyMember = { pcId, sheet, san, control: opts?.control ?? "auto" };
    this.party.set(pcId, member);

    const rec = this.recommendedPartySize();
    const warning = rec && this.party.size > rec.max
      ? `模组推荐 ${rec.min}~${rec.max} 人，当前 ${this.party.size} 人。`
      : undefined;
    return { member, warning };
  }

  /**
   * 当前加载的模组推荐几个玩家，解析不出来给 null（不警告，不是"猜一个"）。
   *
   * 只认 BARN_OF_PREMIER：`this.registeredModules` 装的是 MythosModule
   * （`rules/mythos-module.ts`），跟 BARN_OF_PREMIER 所属的 ModuleData
   * （`module/types.ts`）是两套类型系统，后者没有被整体接进
   * `registeredModules`——只在加载 "premiers_barn" 时才额外读它做线索桥接
   * （见 bridgeBarnOfPremierClues）。这里按同一条件（`mod.id ===
   * "premiers_barn"`）复用它的 meta.playerCount，不是给所有模组都接了推荐
   * 人数——那需要先把两套模组类型统一，不在本轮范围。
   */
  private recommendedPartySize(): { min: number; max: number } | null {
    if (this.registeredModules.some((m) => m?.id === "premiers_barn")) {
      return parsePlayerCountRange(BARN_OF_PREMIER.meta.playerCount);
    }
    return null;
  }

  // ============================================================
  // 基础 getter
  // ============================================================

  getSummary(): SessionSummary {
    const state = this.world.getCurrentState();
    const msgs = this.session.getActiveHistory();
    const npcCount = Object.values(state.entities).filter(e => e.type === "npc").length;
    return {
      id: this.id, round: this.round, ruleset: this.activeRuleset,
      scene: this.sceneDisplayNames[state.scene] ?? state.scene,
      playerName: this.activeCharacter?.name ?? "调查员",
      // 两种角色形状的职业字段名不同：CoC 是 archetypeId，D&D 是 archetype（字符串 id）。
      // 原写法统一取 .id —— 对 undefined 和对字符串取 .id 都是 undefined，
      // 因此这个字段一直恒为 null。
      archetype: this.activeCharacter?.archetypeId ?? this.activeCharacter?.archetype ?? null,
      messageCount: msgs.length, npcCount, createdAt: this.createdAt,
    };
  }

  getState(): ActionResponse["state"] {
    const state = this.world.getCurrentState();
    // KP setter 和角色卡以 activePlayerId（默认 p1）为主键写入；这里若固定
    // 读 "player"，会读到移动流程懒建的另一份实体，面板就永远显示旧 HP。
    //
    // 且不能只从 state.entities 取：getCurrentState() 走 getAllAliveEntities()，
    // 玩家 HP 归零后就从快照里消失，于是落到下面的兜底值，KP 把 PC 打死、
    // 面板反而显示满血 12/12。玩家自身的状态必须始终可读，与存活无关，
    // 所以死亡时回退到不过滤存活的 getEntity()。NPC / 怪物那边的存活过滤保持原样。
    const playerEnt = state.entities[this.activePlayerId] ?? this.world.getEntity(this.activePlayerId);
    // 在场名单必须限定在玩家当前场景，与 injectWorldModelForScene() 的事实口径一致；
    // 否则前端会把模组里所有 NPC 都显示为「在场」，与 KP 叙事互相矛盾。
    // 位置同时写在 scene_id 与 position 两个字段（setPlayerHp 只写 position），故取并集。
    const pos = state.scene;
    const present = new Map<string, WorldEntity>();
    for (const e of this.world.getEntitiesInScene(pos)) present.set(e.id, e);
    for (const e of Object.values(state.entities)) {
      if (e.position === pos) present.set(e.id, e);
    }
    const inScene = [...present.values()];
    const npcs = inScene.filter(e => e.type === "npc" && e.hp > 0);
    const monsters = inScene.filter(e => e.type === "monster" && e.hp > 0);
    // 同伴的血量/位置在世界实体上，CompanionState 只持有 entityId。
    // 此前直接读 c.hp / c.position，两者都不存在，返回给前端的一直是 undefined。
    const comps = this.companionManager.getActiveCompanions().map(c => {
      const ent = this.world.getEntity(c.entityId);
      return {
        id: c.config.id, name: c.config.name, hp: ent?.hp ?? 0, maxHp: c.config.maxHp,
        ac: c.config.ac, morale: c.morale, behavior: c.behavior, control: c.control,
        position: ent?.position ?? "", inventory: c.inventory, motivation: c.config.motivation,
        traits: c.config.traits ?? null, skills: c.config.skills ?? null,
        resolveState: c.resolveState,
      };
    });
    return {
      // 床只认同一行里发出去的 scene。读玩家 position 会在 KP 手动切场景时分叉
      // —— setScene() 只翻 is_active、不动玩家实体，界面显示教堂、耳朵里却还是
      // 码头的浪声。这里也不许回落到 position：显示的场景没有床时，正确答案是
      // 没有床（前端静默），拿别处的床顶上只是把同一个错误换个形式犯。
      scene: state.scene, bgm: this.sceneBgm[state.scene], round: this.round,
      player: playerEnt ? { name: playerEnt.name, hp: playerEnt.hp, maxHp: playerEnt.maxHp, ac: this.activeRuleset === "cosmic-horror" ? 0 : playerEnt.ac, status: playerEnt.status } : { name: "调查员", hp: 12, maxHp: 12, ac: 0, status: [] },
      npcs: npcs.map(e => ({ name: e.name, hp: e.hp, maxHp: e.maxHp, status: e.status })),
      monsters: monsters.map(e => ({ name: e.name, hp: e.hp, maxHp: e.maxHp, status: e.status })),
      companions: comps,
      party: [...this.party.entries()].map(([pcId, m]) => {
        const ent = this.world.getEntity(pcId);
        return {
          pcId,
          name: m.sheet?.name ?? "调查员",
          control: m.control,
          hp: ent?.hp ?? m.sheet?.hp ?? 12,
          maxHp: ent?.maxHp ?? m.sheet?.maxHp ?? 12,
          status: ent?.status ?? [],
          san: m.san.state.currentSAN,
          maxSan: m.san.state.maxSAN,
        };
      }),
      // 与 getKPState():1257 同一口径——不新造一种时间表示。
      gameTime: { day: this.gameTime.day, period: this.gameTime.period, label: formatGameTime(this.gameTime) },
    };
  }

  getSanity() {
    return {
      currentSAN: this.sanity.state.currentSAN,
      maxSAN: this.sanity.state.maxSAN,
      temporaryInsanity: this.sanity.state.temporaryInsanity,
      indefiniteInsanity: this.sanity.state.indefiniteInsanity,
      phobias: this.sanity.state.phobias,
    };
  }

  getCharacterSummary(): any {
    if (!this.activeCharacter) return null;
    const c = this.activeCharacter;
    return {
      name: c.name, archetype: c.archetype?.label ?? c.archetypeId ?? c.archetype,
      attributes: c.attributes, hp: c.hp, maxHp: c.maxHp,
      // computeAC 是 D&D 的 10+DEX修正；CoC 的 DEX 是百分制，套进去会得出 30 以上的
      // 荒唐护甲值。CoC 不用 AC，与 getState() 一样对外给 0。
      ac: this.activeRuleset === "cosmic-horror" ? 0 : CharacterFactory.computeAC(c),
      skills: c.skills ?? c.skillValues,
      totalLevel: c.totalLevel,
    };
  }

  getHistory(limit?: number) {
    const msgs = this.session.getActiveHistory();
    // 恢复会话时前端也要能放预制音频，所以历史这一路同样带上键。
    // 键是内容的纯函数，不进存档 —— 存了反而会在文案改动后指向旧音频。
    const slice = msgs.slice(-(limit ?? msgs.length)).map(m => {
      const key = voiceKeyFor(m);
      return key ? { ...m, voiceKey: key } : m;
    });
    return { messages: slice, total: msgs.length };
  }

  /**
   * 按 pcId 取历史——PlayerSession.getPlayerHistory(pcId) 早就有，但 HTTP
   * 只接得到 getActiveHistory()（恒返回当前活动玩家），外部永远看不到别的
   * PC 的历史。这是线索私密（discoverer_only）能被验证的前提：p1 掷出的
   * 线索只进 p1 的 messageHistory，不靠这个方法就没人能从 HTTP 侧确认。
   *
   * pcId 是否存在（join 过 PlayerSession）由调用方（server.ts）用
   * `session.get(pcId)` 先判——未知 pcId 要结构化 4xx，不能悄悄返回空数组，
   * 那和"这个人根本没有历史"从外部长得一模一样，是本仓反复吃亏的
   * "静默失效"。这里不做判断，只管取数据，判断权交给路由层（与
   * getKPState/setPlayerSan 等既有方法一样，校验发生在 API 边界）。
   */
  getPlayerHistory(pcId: string, limit?: number) {
    const msgs = this.session.getPlayerHistory(pcId);
    const slice = msgs.slice(-(limit ?? msgs.length)).map(m => {
      const key = voiceKeyFor(m);
      return key ? { ...m, voiceKey: key } : m;
    });
    return { messages: slice, total: msgs.length };
  }

  /**
   * 尾部可选项收成一个对象，而不是继续往后加位置参数。
   *
   * 之前是六个位置参数，写到 `addMessage(s, c, t, "public", undefined, true)`
   * 才能标一个 verbatim —— 中间那两个占位纯粹是为了够到最后一位。
   * 每加一种消息属性就再加一位，调用点会越来越难读，也越来越容易传错位置。
   */
  addMessage(
    speaker: string,
    content: string,
    type: MessageType = "dialogue",
    opts: {
      visibility?: VisibilityRule;
      discoverer?: string;
      /**
       * 内容为模组原文逐字输出（非 LLM 生成）时置 true。
       * 只在为真时写入字段，避免每条消息都带 `verbatim: false` 污染存档。
       */
      verbatim?: boolean;
      /**
       * 说这句话时的情绪，必须由调用方在生成时刻取。
       * mood 是状态机，事后回查 NPCAgent 拿到的是那时的情绪而非说这句话时的情绪，
       * 历史回放更是必然错位 —— 所以它只能随消息一起固定下来。
       */
      mood?: NPCMood;
    } = {}
  ) {
    this.session.push(
      {
        speaker,
        content,
        type,
        ...(opts.verbatim ? { verbatim: true } : {}),
        ...(opts.mood ? { mood: opts.mood } : {}),
      },
      opts.visibility ?? "public",
      opts.discoverer
    );
  }

  /**
   * 回合出口。这里是两条互不相交的链路唯一交汇的地方，改动时请分别对待：
   *
   * - **消息链路**（verbatim 模组原文标记）：turnMessages → events，以及
   *   addMessage → PlayerSession.messageHistory → GET /history。
   *   注意模组开场白走的是后者：MythosModuleLoader 经 host.addMessage 直接入
   *   messageHistory，不进 turnMessages，因此它只出现在 /history 里，
   *   当回合的 events 中没有 verbatim 项——这是预期，不是丢标记。
   *   前端两条路径都读（action 读 ev.verbatim，恢复会话读 m.verbatim）。
   * - **状态链路**（真相源迁移阶段 1）：persistSanity() 把本回合内 SanityEngine
   *   就地改动的 state 落到 WorldStateManager。SAN/背包/武器/护甲的权威值在库里，
   *   不在进程内 Map。
   *
   * 两者不共享数据，只共享这一个调用点：消息不承载状态，状态不进消息体。
   */
  /**
   * 正在进行的回合的消息数组，act() 期间有值，回合出口清空。
   *
   * 模组宿主适配器需要它：加载器经 host.addMessage 产出的开场白与提示，
   * 原先直接写进会话历史，不进本回合的 turnMessages，于是 events 里没有它们——
   * 前端只渲染 events，玩家在实盘里根本看不到模组开场白，要等下次恢复会话
   * 读 /history 才出现。而开场白恰恰是加载那一刻最该被读到的一段。
   */
  private _turnMessages: AgentMessage[] | null = null;

  private buildActionResponse(turnMessages: AgentMessage[]): ActionResponse {
    // 回合结束，宿主适配器不应再往这一轮投消息
    this._turnMessages = null;
    // 回合出口统一落库：本回合内 SanityEngine 就地改动的 state 在此刻进入真相源。
    this.persistSanity();

    // 回合消息入会话历史。act() 只把玩家行动、KP 叙述、系统提示攒在局部数组里，
    // 此前它们从不经过 session.push()，导致 GET /history 与 getSummary().messageCount
    // 在正常跑团后恒空——前端恢复会话拿到空日志，语音层也读不到要念的内容。
    //
    // 写在回合出口而不是每个 turnMessages.push() 处：出口是唯一汇合点，act() 的
    // 每条返回路径都经过它，逐点改 20 余处既冗余又易漏。代价是回合内顺序——
    // 经 addMessage() 直入历史的消息（模组开场白、流血提示）按各自写入时刻排，
    // 回合消息统一排在其后。彻底统一属于 docs/voice-readiness.md §六 第 2 步
    // 「addMessage 尾参收成 options 对象」那次重构的范围，不在此处提前做。
    //
    // 按每条消息自带的 visibility/discoverer 路由（见 AgentMessage 的字段
    // 注释与 resolveSceneClue 的用法），不再统一按 public 处理——线索揭示
    // 靠这一步才真正只进发现者的 messageHistory。没带这两个字段的消息
    // （绝大多数）走 push() 的默认参数，行为与改动前完全一致。
    for (const m of turnMessages) this.session.push(m, m.visibility ?? "public", m.discoverer);

    const state = this.getState();
    return {
      narrative: this.lastNarrative,
      events: turnMessages.map(m => {
        const key = voiceKeyFor(m);
        return {
          speaker: m.speaker, content: m.content, type: m.type,
          ...(m.verbatim ? { verbatim: true as const } : {}),
          ...(key ? { voiceKey: key } : {}),
        };
      }),
      state,
      dead: this.dead,
      sanity: this.getSanity(),
      dice: this.lastDiceRoll ? [this.lastDiceRoll] : undefined,
    };
  }

  getPlayerPosition(): string {
    const state = this.world.getCurrentState();
    return state.entities[this.activePlayerId]?.position ?? state.scene ?? "tavern";
  }

  /**
   * 界面正在显示的场景 —— 「现在演到哪里」的真相源。
   *
   * 与 getPlayerPosition() 分工明确：KP 切场景只翻 scenes.is_active、不移动玩家实体，
   * 两者因此会分叉，这是既定设计（scene-bgm.test.ts 专门锁住了这一点）。
   *
   * 凡是回答「此刻这里有谁、有什么可查」的地方都必须跟显示的场景。此前它们读的是
   * 玩家位置，而玩家一旦移动过，移动流程就会留下一个 "player" 实体把位置钉在原地，
   * 从此 KP 切场景再也带不动它们——面板显示教堂，站在里面的却还是码头的 NPC，
   * 调查也仍在旧房间里找线索。
   */
  getDisplayedScene(): string {
    return this.world.getCurrentState().scene;
  }

  /**
   * 结局条件用的两个谓词——队伍里**任一人**发现过 / 到过。
   *
   * 命名空间已核对：BARN_OF_PREMIER 的线索通过 bridgeBarnOfPremierClues()
   * 用 `clue.id` 原样注册进 InvestigationEngine（见该方法注释），
   * END_NARRATIONS 引用的正是同一份 `clue.id`，两边不会对不上——
   * 已用真实模组数据验过（ending-namespace-truth-source.test.ts）。
   * requiredScenes 那半边此前有个已知缺口（todo-34）：GameSession 实际
   * 注册的场景 id 与 BARN_OF_PREMIER 的场景 id 不是同一套——已修，见
   * isSceneVisited() 与 barnSceneIdMap()。
   */
  isClueFound(clueId: string): boolean {
    return this.world.isClueDiscoveredByAnyone(clueId);
  }

  /**
   * ⚠ sceneId 可能是两种命名空间之一：GameSession 自己注册的运行时 id
   * （中文展示名），或者 BARN_OF_PREMIER.scenes 用的 ASCII id（历史遗留，
   * END_NARRATIONS.requiredScenes 引用的正是这一套，见 barnSceneIdMap()）。
   * 只在加载的是 premiers_barn 时才做这层翻译——查不到映射（不是这个
   * 模组、或 id 本来就不在映射表里）就原样查，不装作对别的场景 id 也通用。
   */
  isSceneVisited(sceneId: string): boolean {
    const runtimeSceneId = this.registeredModules.some((m) => m?.id === "premiers_barn")
      ? this.barnSceneIdMap().get(sceneId) ?? sceneId
      : sceneId;
    return this.world.isSceneVisitedByAnyone(runtimeSceneId);
  }

  /**
   * 现在算不算"前期"（开发·线索闸门 任务3）——除了连续大失败以外，
   * 尽量不在前期阻止调查；前期检定失败时 resolveSceneClue() 会给指向性
   * 降级信息而不是干巴巴的"没找到"，见该方法。
   *
   * 两条判法（已裁决）：
   *   有 ModuleSupport 且声明了 earlyGameEndSceneId → 到过那个场景之前
   *   算前期（谷仓用 adrian_farm，见 BARN_SUPPORT 的注释：到农场入口就
   *   能看见红漆谷仓，是叙事上"主线目标现出真身"的分界点，isSceneVisited
   *   已经处理了 ASCII/运行时场景 id 的桥接，这里直接传 ASCII id）。
   *
   *   没有 ModuleSupport（或没声明这个字段）→ 已发现线索 / 可文本匹配的
   *   线索总数 < 1/3。分母优先数有 matchTexts 的那批（YAML 手写/
   *   registerSceneClue 合成的线索没有 matchTexts，本来就只能靠
   *   fallback 拿到，进分母没有意义）；一条 matchTexts 都没有的模组
   *   （分母会是 0）就退回数全部已注册线索类型。
   *
   * ⚠ 如实记账：阿卡姆档案检查/印斯茅斯的阴霾都没有 ModuleSupport 登记，
   * 也都没有任何一条线索带 matchTexts（各自仅有的 3 条线索都是经
   * registerSceneClue 合成的），走的是"退回数全部"这一支——3 条线索，
   * 1/3 约等于 1 条，发现第一条就结束"前期"。这条分支目前没有有意义的
   * 适用对象，本条注释与 docs/todo.json 如实记录这个事实，不假装它在
   * 正常工作——根因是这两个模组内容本身极薄（连结局数据都没有，见
   * MODULE_ENDING_SUPPORT 的注释），是 todo-19 的下游，不在本轮修。
   */
  isEarlyGame(): boolean {
    const modId: string | undefined = this.registeredModules[0]?.id;
    const support = modId ? MODULE_ENDING_SUPPORT[modId] : undefined;
    if (support?.earlyGameEndSceneId) return !this.isSceneVisited(support.earlyGameEndSceneId);

    const withMatchTexts = this.investigation.listModuleClueIds({ onlyWithMatchTexts: true });
    const denomIds = withMatchTexts.length > 0 ? withMatchTexts : this.investigation.listModuleClueIds();
    if (denomIds.length === 0) return false; // 没有任何线索可数，没有"前期"这个概念
    const discovered = denomIds.filter((id) => this.isClueFound(id)).length;
    return discovered / denomIds.length < 1 / 3;
  }

  /**
   * 为当前场景构建世界模型上下文并注入 KP（权威事实层）。
   * 世界模型未加载 / 加载失败时静默跳过，不影响叙事流程。
   */
  private injectWorldModelForScene() {
    try {
      // 懒加载：首次注入时才加载世界模型（~240MB / 1.5-2s）；失败静默降级，不影响叙事
      if (!this.worldModel.isLoaded()) {
        try {
          this.worldModel.load();
        } catch {
          this.kp.setWorldModelContext("");
          return;
        }
      }
      const pos = this.getDisplayedScene();
      const sceneName = this.sceneDisplayNames[pos] ?? pos;
      // 读取模组原文场景描写（scenes 表 description，若已注册）
      const sceneInfo = this.world.getScene(pos);
      // 读取当前场景在场实体：NPC/怪物 → presentNPCs；item → presentItems
      const presentEntities = this.world.getEntitiesInScene(pos);
      const presentNPCs = presentEntities
        .filter((e) => e.type === "npc" || e.type === "monster")
        .map((e) => e.name);
      const presentItems = presentEntities
        .filter((e) => e.type === "item")
        .map((e) => e.name);
      // 组装在场 NPC 人设卡（权威元数据，防 LLM 臆造年龄/性别/状态）：
      // 从已加载模组的 npcs 定义 + hooks 初始状态匹配
      const npcProfiles = this.buildPresentNPCProfiles(presentNPCs);
      // 读取已发现线索（调查引擎）
      const discoveredClues = this.investigation.getSceneClues(sceneName);
      const ctx: SceneContext = {
        sceneId: pos,
        sceneName,
        sceneDescription: sceneInfo?.description ?? "",
        keywords: [sceneName, pos].filter(Boolean),
        presentNPCs,
        npcProfiles,
        discoveredClues,
        presentItems,
        round: this.round,
        ruleset: this.activeRuleset,
        gameTime: formatGameTime(this.gameTime),
        periodAtmosphere: periodAtmosphere(this.gameTime.period),
      };
      let wmText = this.wmIntegrator.buildKPContext(ctx);
      // 克苏鲁神话上下文（独立 loader，独立懒加载；失败静默跳过，不影响叙事）
      const cthulhuText = this.buildCthulhuContext();
      if (cthulhuText) {
        wmText = wmText ? `${wmText}\n\n${cthulhuText}` : cthulhuText;
      }
      this.kp.setWorldModelContext(wmText);
    } catch {
      this.kp.setWorldModelContext("");
    }
  }

  /**
   * 将模组 NPC 内联人格注册进 NPC Agent 系统（供 /npc-chat 对话）。
   * 数据源：模组 npcs 数组的 personality（权威设定，优先）
   *        + npcs.yaml 通用人格（仅当模组指定 npcPersonalityId 引用时兜底）。
   * ModuleNPC.personality 字段是 ModuleNPC 风格（role/background/goals/secrets/traits...），
   * 需映射为 NPCPersonality 风格（含必填 speech_style/knowledge，缺失时给默认值）。
   */
  private registerModuleNPCPersonality(npcName: string, personality: any, npcPersonalityId?: string): void {
    if (!npcName) return;
    // 已注册则跳过（模组重复加载保护）
    if (this.registry.has(npcName)) return;
    // 内联人格为空且指定了 npcPersonalityId → 从 npcs.yaml 通用人格库兜底（按 id 或名称匹配）
    if (!personality && npcPersonalityId) {
      personality = this.loadNPCPersonalityFromYaml(npcName, npcPersonalityId);
    }
    if (!personality) return;
    const p = personality;
    const card: NPCPersonality = {
      name: npcName,
      role: p.role ?? "NPC",
      personality: p.personality ?? p.role ?? "普通镇民",
      background: p.background ?? `${npcName}，${p.role ?? "普通镇民"}`,
      goals: Array.isArray(p.goals) ? p.goals : (p.goals ? [String(p.goals)] : ["生存", "完成自己的事"]),
      speech_style: p.speech_style ?? "以角色身份自然说话，符合身份与处境",
      knowledge: Array.isArray(p.knowledge) ? p.knowledge : [],
      secrets: Array.isArray(p.secrets) ? p.secrets : [],
      attitudes: p.attitudes,
      ruleset: this.activeRuleset as any,
      traits: p.traits,
      // 人格可能来自模组内联定义，也可能来自运行时解析的 npcs.yaml（any），
      // 后者完全不受编译器约束。这里是两条来路唯一的汇合点，越界值在此丢弃，
      // 不让它冒充成合法情绪流进消息与语音层。
      initialMood: asNPCMood(p.initialMood),
    };
    try {
      this.registry.register(card);
    } catch (e: any) {
      // 已注册或注册失败不阻塞模组加载
      log.warn("session", `NPC Agent 注册跳过: ${npcName} — ${e?.message ?? e}`);
    }
  }

  /** 懒加载 npcs.yaml 通用人格库，按 id 或名称匹配返回人格（找不到返回 undefined） */
  private loadNPCPersonalityFromYaml(npcName: string, npcPersonalityId: string): any | undefined {
    try {
      const raw = readFileSync(new URL("../agent/npcs.yaml", import.meta.url), "utf8");
      const data = parseYaml(raw) as any;
      const npcs = Array.isArray(data?.npcs) ? data.npcs : (data && typeof data === "object" ? Object.values(data) : []);
      for (const item of npcs) {
        const id = String(item?.id ?? item?.name ?? "");
        const name = String(item?.name ?? "");
        if (id === npcPersonalityId || name === npcPersonalityId || name === npcName) return item;
      }
    } catch (e: any) {
      log.warn("session", `npcs.yaml 加载失败: ${e?.message ?? e}`);
    }
    return undefined;
  }

  /**
   * 组装在场 NPC 人设卡（权威元数据，供 KP 上下文注入）。
   * 数据源：已加载模组的 npcs 定义（age/gender/personality/dialogHints）
   *        + 模组 hooks 中 on_enter_scene 的初始状态描写（currentState）。
   * currentState 匹配策略（NPC 专属场景，非普通场景描写）：
   *   hook.condition 归一化后包含 NPC 全名（"菲碧_特里坎" ↔ "菲碧·特里坎"），
   *   或包含 NPC 名字部分（"与艾德里安的会面" ↔ "艾德里安·埃斯特鲁姆"）。
   *   普通场景 hook（如 "特里坎家"）不含 NPC 名/名字部分，不会被误匹配。
   * 找不到权威定义时返回空数组 → buildKPContext 回退到纯名字列表。
   */
  private buildPresentNPCProfiles(presentNPCs: string[]): NPCPresentProfile[] {
    if (!presentNPCs || presentNPCs.length === 0) return [];
    const norm = (s: string) => s.replace(/[·、_\- ]/g, "");
    const profiles: NPCPresentProfile[] = [];
    for (const mod of this.registeredModules) {
      if (!mod?.npcs || !Array.isArray(mod.npcs)) continue;
      const hooks = (mod.hooks ?? []) as any[];
      for (const npc of mod.npcs) {
        if (!presentNPCs.includes(npc.name)) continue;
        // 候选匹配键：全名 + 名字部分（"·"前，如 "艾德里安"）
        const keys = [npc.name, String(npc.name).split("·")[0] ?? ""]
          .map(norm)
          .filter((k: string) => k.length >= 2);
        // currentState：仅匹配 NPC 专属场景 hook（场景名不含 NPC 名时不会命中）
        let currentState: string | undefined;
        const npcHook = hooks.find((h: any) => {
          if (h?.type !== "on_enter_scene" || !h?.condition) return false;
          const cond = norm(String(h.condition));
          return keys.some((k: string) => cond.includes(k) || k.includes(cond));
        });
        if (npcHook?.narration) {
          currentState = String(npcHook.narration).split("。")[0]?.slice(0, 40) ?? undefined;
        }
        profiles.push({
          name: npc.name,
          age: npc.age,
          gender: npc.gender,
          role: npc.personality?.role,
          currentState,
          background: npc.personality?.background,
          dialogHints: npc.dialogHints,
        });
      }
    }
    return profiles;
  }

  /**
   * 构建克苏鲁神话世界模型上下文（权威事实层追加段）。
   * 独立懒加载 cthulhu_world_model.jsonl（145 条 / 小文件，秒级）；
   * 加载失败 / 文件缺失时静默返回空串，不影响叙事流程。
   */
  private buildCthulhuContext(): string {
    try {
      if (!this.cthulhuLoader.isLoaded()) {
        this.cthulhuLoader.load(CTHULHU_MODEL_PATH);
      }
      if (!this.cthulhuLoader.isLoaded()) return "";

      const lines: string[] = [];
      lines.push("[克苏鲁神话上下文]");

      const deities = this.cthulhuLoader.getByType("deity");
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
        ...this.cthulhuLoader.getByType("power_system"),
        ...this.cthulhuLoader.getByType("game_mechanic"),
        ...this.cthulhuLoader.getByType("crafting"),
        ...this.cthulhuLoader.getByType("cosmology"),
      ].slice(0, 8);
      if (mechanics.length > 0) {
        lines.push("神秘机制:");
        for (const m of mechanics) {
          const name = m.name || "未知";
          const mechanic = m.mechanic ? m.mechanic.slice(0, 90) : (m.description || "").slice(0, 90);
          lines.push(`  - ${name}: ${mechanic}`);
        }
      }

      const causals = this.cthulhuLoader.getByType("causal").slice(0, 3);
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

  async getOpeningScene(): Promise<string> {
    try {
      this.injectWorldModelForScene();
      const desc = await this.kp.describeScene();
      this.lastNarrative = desc;
      return desc;
    } catch {
      return "夜幕降临，故事由此开始…";
    }
  }

  // ============================================================
  // KP 面板
  // ============================================================

  getKPState(): any {
    const worldState = this.world.getCurrentState();
    const companions = this.companionManager.getActiveCompanions();
    const curModule = this.registeredModules[0] ?? null;
    const pos = this.getDisplayedScene();
    const sceneItems = this.sceneItems.get(pos) ?? [];

    const characters: any[] = [];
    for (const [pid, ch] of this.characters) {
      const sanEng = this.sanityEngines.get(pid) ?? this.sanity;
      const inv = this.world.getPlayerInventory(pid);
      const weps = this.world.getPlayerWeapons(pid);
      const armors = this.world.getPlayerArmor(pid);
      characters.push({
        playerId: pid, name: ch.name,
        archetype: ch.archetype?.label ?? ch.archetype?.id ?? "调查员",
        attributes: ch.attributes, hp: ch.hp, maxHp: ch.maxHp, ac: ch.ac ?? 0,
        san: sanEng.state.currentSAN, maxSan: sanEng.state.maxSAN,
        cthulhuMythos: sanEng.state.cthulhuMythos ?? 0,
        temporaryInsanity: sanEng.state.temporaryInsanity,
        indefiniteInsanity: sanEng.state.indefiniteInsanity,
        luck: ch.luck ?? 60, skills: ch.skillValues ?? {},
        // armor 全链路是 string[]：唯一写入方是 setPlayerArmor(armor: string[])，
        // 存进去的是 JSON.stringify(string[])，读出来经 parseJsonColumn<string[]> 还原。
        // 原写法 `armors.map((a: any) => a?.name ?? a)` 在防一个「元素是带 name 的对象」
        // 的形状，但没有任何代码路径能产生它——与 exits 那次不同，那次能找到三个
        // 真实写对象的写入点，这次一个都没有。防不可能的形状只换来一个 any。
        inventory: inv, weapons: weps, armor: armors,
      });
    }

    return {
      sessionId: this.id, round: this.round,
      ruleset: this.activeRuleset,
      scene: this.sceneDisplayNames[pos] ?? pos,
      characters, combatActive: this.combatActive,
      companions: companions.map(c => {
        const ent = this.world.getEntity(c.entityId);
        return {
          id: c.config.id, name: c.config.name, hp: ent?.hp ?? 0, maxHp: c.config.maxHp,
          ac: c.config.ac, morale: c.morale, behavior: c.behavior,
          control: c.control, position: ent?.position ?? "", inventory: c.inventory,
          skills: c.config.skills, resolveState: c.resolveState,
        };
      }),
      npcs: Object.values(worldState.entities).filter(e => (e.type === "npc" || e.type === "monster") && e.hp > 0).map(e => ({ name: e.name, type: e.type, hp: e.hp, maxHp: e.maxHp })),
      sceneItems, difficulty: this.activeDifficulty,
      module: curModule ? { id: curModule.id, name: curModule.name, difficulty: curModule.difficulty } : null,
      gameTime: { day: this.gameTime.day, period: this.gameTime.period, label: formatGameTime(this.gameTime) },
      politicoEconomy: this.politicoEconomy.getBriefState(),
    };
  }

  sendMessage(speaker: string, content: string, type: MessageType = "system") {
    this.addMessage(speaker, content, type);
  }
  /**
   * KP 设置指定玩家的当前 SAN。
   *
   * 不再懒建 SanityEngine：原写法用 `new SanityEngine(Math.max(value, 50))`
   * 给不存在的玩家现造一个引擎，上限由传入值自己推出来，于是任何值都合法——
   * 这个「域」是循环的，校验不了任何东西。引擎的存在性就是玩家的存在性
   * （构造函数建 p1，创建队友同时写 characters 与 sanityEngines），
   * 所以取不到引擎即为未知玩家。
   *
   * 也不再 `Math.max(0, Math.min(value, maxSAN))` 静默钳制：KP 设 999 会被
   * 悄悄改成 50 却返回成功，属于 §八 那类「看起来成功了、值却不是你设的那个」。
   * 越界现在是结构化拒绝，缓存与真相源都不动。
   */
  setPlayerSan(pid: string, value: number): Result<StateDelta, RejectReason> {
    const eng = this.sanityEngines.get(pid);
    if (!eng) return { ok: false, error: { code: "unknown_target", targetId: pid } };

    const variable = `san:${pid}`;
    const result = applyAction(
      boundedIntegerScenario(variable, eng.state.currentSAN, eng.state.maxSAN),
      boundedIntegerGateState(variable, eng.state.currentSAN),
      {
        kind: "freeform",
        actor: "kp",
        description: `set SAN for ${pid}`,
        effects: [{ variable, to: value }],
      },
    );
    if (!result.ok) return result;

    eng.state.currentSAN = value;
    if (pid === this.activePlayerId) this.sanity = eng;
    this.persistSanity(pid);
    return result;
  }
  setPlayerHp(pid: string, value: number): Result<StateDelta, RejectReason> {
    const ch = this.characters.get(pid);
    if (!ch) return { ok: false, error: { code: "unknown_target", targetId: pid } };

    const maxHp = ch.maxHp ?? 99;
    const variable = `hp:${pid}`;
    const result = applyAction(
      boundedIntegerScenario(variable, ch.hp, maxHp),
      boundedIntegerGateState(variable, ch.hp),
      {
        kind: "freeform",
        actor: "kp",
        description: `set HP for ${pid}`,
        effects: [{ variable, to: value }],
      },
    );
    if (!result.ok) return result;

    ch.hp = value;
    // 同步世界实体（若不存在则创建"
    let ent = this.world.getEntity(pid);
    if (!ent) {
      ent = { id: pid, name: ch.name ?? pid, type: "pc", hp: ch.hp, maxHp: ch.maxHp ?? 99, ac: ch.ac ?? 10, status: [], position: this.world.getCurrentState().scene ?? "tavern" };
    } else {
      ent.hp = ch.hp;
    }
    this.world.upsertEntity(ent);
    return result;
  }
  /** 覆盖指定玩家的背包内容（HTTP 角色卡编辑用）。 */
  setPlayerInventory(pid: string, items: string[]) {
    this.world.setPlayerInventory(pid, items);
  }
  /** 覆盖指定玩家已装备的武器（HTTP 角色卡编辑用）。 */
  setPlayerWeapons(pid: string, weapons: string[]) {
    this.world.setPlayerWeapons(pid, weapons);
  }
  /** 覆盖指定玩家已装备的护甲。 */
  setPlayerArmor(pid: string, armor: string[]) {
    this.world.setPlayerArmor(pid, armor);
  }
  /**
   * 把 SAN 引擎的当前 state 写回真相源。
   *
   * SanityEngine 在自己的方法里就地改 state（全仓 40 处），逐点拦截既脆弱又易漏，
   * 因此统一在两类边界落库：显式 setter（setPlayerSan）与每回合出口
   * （buildActionResponse）。回合内的中间态不落库，回合结束时必定一致。
   */
  private persistSanity(pid?: string) {
    if (pid !== undefined) {
      const eng = this.sanityEngines.get(pid);
      if (eng) this.world.setPlayerSanity(pid, eng.state);
      return;
    }
    for (const [id, eng] of this.sanityEngines) this.world.setPlayerSanity(id, eng.state);
  }
  /**
   * 对任意实体（PC / NPC / 怪物）施加伤害。
   *
   * 伤害是算术增量，闸门校验的是绝对状态，所以这里先把「当前 HP 减伤害」
   * 投影成目标 HP 再送闸门（见 docs/kp-tool-numeric-domain-design.md）。
   *
   * 两处旧行为被换掉：
   * - `Math.max(0, damage)` 把负伤害静默变成 0 并返回成功。负伤害不是零伤害，
   *   是调用错了方法（治疗不该走这里），现在直接拒绝。小数伤害同理——
   *   它原本会把分数 HP 写进数据库。
   * - `world.applyDamage()` 对不存在的实体抛异常，被 server 的 catch 兜成 500。
   *   目标名打错属于输入错误，现在是结构化拒绝，由 HTTP 映射成 400。
   *
   * 过量伤害落到 0 保留原样：那是正确的战斗语义，不是把非法输入伪装成成功。
   */
  applyDamage(entityId: string, damage: number): Result<StateDelta, RejectReason> {
    const variable = `hp:${entityId}`;
    if (!Number.isInteger(damage) || damage < 0) {
      return { ok: false, error: { code: "invalid_amount", variable, amount: damage } };
    }

    const ent = this.world.getEntity(entityId);
    if (!ent) return { ok: false, error: { code: "unknown_target", targetId: entityId } };

    const result = applyAction(
      boundedIntegerScenario(variable, ent.hp, ent.maxHp),
      boundedIntegerGateState(variable, ent.hp),
      {
        kind: "freeform",
        actor: "kp",
        description: `apply ${damage} damage to ${entityId}`,
        effects: [{ variable, to: Math.max(0, ent.hp - damage) }],
      },
    );
    if (!result.ok) return result;

    this.world.applyDamage(entityId, damage);
    return result;
  }
  /**
   * KP 手动切换活动场景。
   *
   * 必须走 setActiveScene()：getCurrentState() 每次都新建并返回一个对象，
   * 对它的 .scene 赋值只会落在临时对象上，数据库里的 is_active 不会变。
   *
   * 场景必须已注册；未注册时返回 false 而不是顺手建一个垃圾场景，
   * 由调用方决定如何报错。
   */
  setScene(sceneId: string): boolean {
    if (!this.world.getScene(sceneId)) return false;
    // 转发 setActiveScene 的**回读结果**，不是「我调用过了」。
    // 那两句 UPDATE 会先清空全部 is_active，目标不存在时world 里
    // 一个活动场景都不剩 —— 光靠「没抛异常」判断成功正是 §八 两次事故的形状。
    return this.world.setActiveScene(sceneId);
  }
  /** 当前会话映射到 applyAction 所需的只读状态快照。 */
  getGateState(): GateState {
    return buildDifficultyGateState(this.activeDifficulty?.label ?? "medium");
  }

  setDifficulty(diff: string): Result<StateDelta, RejectReason> {
    const result = applyAction(COC_SESSION_SCENARIO, this.getGateState(), {
      kind: "freeform",
      actor: "kp",
      description: `set difficulty to ${diff}`,
      effects: [{ variable: "difficulty", to: diff }],
    });
    if (!result.ok) return result;

    // 直接用 module-difficulty 的权威难度表。
    // 此前这里内联了一份退化副本：label 填的是中文显示名，而权威表里 label 是判别式
    // （getPushNarration 对它做 switch），clueOnFail 还用了 "generous"/"hidden" 这两个
    // 并不存在的取值，同时丢掉了 pushAllowed / pushCostMultiplier / failureGuidance。
    if (isDifficultyLabel(diff)) {
      this.activeDifficulty = getDifficultyProfile(diff);
      // ⚠ 这一句原先不存在：难度**设了但没人告诉调查引擎**。
      //   `InvestigationEngine.setDifficultyProfile()` 全仓零调用方，
      //   于是 `difficultyProfile` 恒为 null，`effectiveProfile` 一直回落到
      //   那份写死的 medium 画像。后果是 KP 把难度调成 nightmare 之后：
      //     · 惩罚骰仍然是 0（应该 +2）
      //     · 线索的 SAN 倍率仍然是 1（应该 2 倍）
      //   —— 难度按钮按下去，调查这一块**什么都没变**。
      this.investigation.setDifficultyProfile(this.activeDifficulty);
    }
    return result;
  }

  // ============================================================
  // getSuggestions (行动提示)
  // ============================================================

  /**
   * 当前场景的行动锚点。
   *
   * ⚠ 这是给前端直接点的：App.vue 会把 suggestions 里的字符串**原样**送回
   * act()，所以不能返回「这里还有没查过的东西」这种不可执行的描述句；每条
   * 都必须是合法的自由文本动作。中粒度提示靠可点击动作本身表达：有本 PC
   * 尚未发现的场景线索时说「仔细搜查这里」，全部发现后降成「环顾四周」——
   * 这确实告诉玩家“还有没有”，但不说是什么（不泄露任何线索名称），正是
   * 本轮裁定的中粒度，不是意外剧透。
   *
   * pcId 缺省时取 activePlayerId，保持 GET /suggestions 既有客户端行为；
   * 调用方传 pcId 时只用于读取该 PC 的私密线索发现状态，不切换 active PC，
   * 避免 GET 请求触发 todo 里已记录的 activePlayerId 粘性问题。未知 pcId
   * 由 server.ts 在路由层翻成 404（同 GET /history?pcId= 的口径）。
   */
  getSuggestions(pcId: string = this.activePlayerId): string[] {
    const following: string[] = [];
    if (this.combatActive) {
      // 战斗分支是已修回归（npc-fights-back.test.ts）：逐字保持，不能把
      // 场景锚点混进来，否则打起来又会提示调查/聊天。
      following.push("⚔️ 攻击敌人", "🛡️ 防御", "💊 使用物品", "🏃 撤退");
    } else {
      const pos = this.getDisplayedScene();
      // 按 pcId 查，不按整个会话：发现者私密的线索状态不能透给另一个 PC。
      // 不展示 clue id/name，只用“还有可搜内容”改变动作措辞，避免剧透。
      const undiscovered = this.investigation.getUndiscoveredSceneClues(pos, pcId);
      following.push(undiscovered.length > 0 ? "仔细搜查这里" : "环顾四周");

      // 只给真实在场、活着的 NPC 生成可点击对话动作；不编“老板”“前台”
      // 之类模组文本提到但运行时不存在的对象，也不拿 monster 当可交谈 NPC。
      for (const npc of this.world.getEntitiesInScene(pos).filter((e) => e.type === "npc")) {
        following.push(`与 ${npc.name} 交谈`);
      }

      // exits 是 SceneRecord 的权威连接数据。目标展示名可能与运行时 id 不同，
      // 统一经 sceneDisplayNames 显示；原样提交的“前往 <name>”仍由既有移动
      // 解析路径处理。没有场景/出口时安静地少给动作，不编造“其他场景”。
      const scene = this.world.getScene(pos);
      for (const exit of scene?.exits ?? []) {
        const target = this.sceneDisplayNames[exit.target] ?? exit.target;
        following.push(`前往 ${target}`);
      }
    }
    const comps = this.companionManager.getActiveCompanions();
    if (comps.length > 0) following.push(`👥 指挥同伴 (${comps.length}人)`);
    return following;
  }

  // ============================================================
  // act() — 主游戏循环
  // ============================================================

  /**
   * 让一个动作发生。`actingPcId` 指定「以哪个 PC 的身份行动」——按 **pcId**
   * 路由（不再按角色显示名）：同名 PC 各按自己的 pcId 正确落到自己头上，
   * 不会像旧的按名字 find 那样取到第一个。
   *
   * ⚠ 并发缺口：act() 无锁地改写 this.round / this.activePlayerId /
   * this._turnMessages。两个客户端同时 POST 不同 pcId 时，后写者的
   * activePlayerId 会覆盖先写者，二者回合内状态还会互相踩。**本轮不做回合
   * 锁**（那是 L3 类回合调度的范围），刻意留白——别误以为这条路由做完就能
   * 多端并发了。
   */
  async act(input: string, actingPcId?: string): Promise<ActionResponse> {
    // 未知 pcId 必须在任何状态改动前拒绝——activePlayerId 绝不能"先切过去
    // 再发现切不了"。存活过一个真 bug：切换在改动之后才判，返回给前端的是
    // "已切换"的假象。这里不折成系统消息、不兜底回 p1（那正是本仓反复修的
    // "报告了一件没发生的事"），而是结构化置 error。
    if (actingPcId !== undefined && !this.characters.has(actingPcId)) {
      return {
        narrative: "",
        events: [],
        state: this.getState(),
        error: { code: "unknown_target", targetId: actingPcId },
      };
    }
    this.lastActiveAt = Date.now();
    if (this.dead) {
      return this.buildActionResponse([{ speaker: "系统", content: "你已经死了。请重新开始", type: "system" }]);
    }
    this.round++;
    this.gameTime = advanceTime(this.gameTime);
    this.companionManager.newRound();
    // 限时状态（流血/中毒/燃烧…）在这里推进一回合。
    // 这一句原先不存在 —— 状态被写上去之后再没人碰过它们。
    this.tickStatusEffects();
    // 神话生物首次目击的 SAN 检定。原先 `getSanCost()` 零调用方，
    // 于是遭遇修格斯和遭遇一条野狗对理智的影响完全一样。
    const sightingMsgs: string[] = [];
    this.checkMythosSighting((s) => sightingMsgs.push(s));
    const economyMsgs: string[] = [];
    this.tickEconomy((s) => economyMsgs.push(s));
    const turnMessages: AgentMessage[] = [];
    for (const s of sightingMsgs) turnMessages.push({ speaker: "系统", content: s, type: "system" });
    for (const s of economyMsgs) turnMessages.push({ speaker: "系统", content: s, type: "system" });
    // 供模组宿主适配器把加载期产生的消息投进本回合，见 _turnMessages 的说明
    this._turnMessages = turnMessages;

    if (actingPcId !== undefined && actingPcId !== this.activePlayerId) {
      const ch = this.characters.get(actingPcId);
      // 上面已保证 characters.has(actingPcId)，ch 必存在；party 未必有这一项
      // （空壳槽位 p1 建号前不在 party），但这是"该 PC 有角色卡可行动"的
      // 判断依据，有卡就能以它行动。
      this.sanityEngines.set(this.activePlayerId, this.sanity);
      // 换人前先把上一位的 SAN 落库，否则本回合的改动会随缓存切换丢失
      this.persistSanity(this.activePlayerId);
      this.activePlayerId = actingPcId;
      this.activeCharacter = ch;
      this.session.switchActive(actingPcId);
      if (this.sanityEngines.has(actingPcId)) this.sanity = this.sanityEngines.get(actingPcId)!;
    }

    const activePlayer = this.session.getActive();
    const playerName = activePlayer?.characterName ?? "调查员";

    // 确认门 1/2：离开确认——party 级，不认人，谁的下一句都算数（见
    // pendingLeaveConfirm 字段注释）。代价对称——不管答的是什么，这一回合
    // 本来就会推进的那 1 tick（上面的 advanceTime）已经花掉了。
    if (this.pendingLeaveConfirm) {
      this.pendingLeaveConfirm = false;
      turnMessages.push({ speaker: playerName, content: input, type: "action" });
      if (isConfirmReply(input)) {
        this.resolveModuleDeparture(turnMessages);
      } else {
        turnMessages.push({ speaker: "系统", content: "你们决定还是先留下，继续这次调查。", type: "system" });
      }
      return this.buildActionResponse(turnMessages);
    }

    // 确认门 2/2：复合句回问——**认人**，只有触发它的那个 PC
    // （this.activePlayerId，已在上面按 actingPcId 切换过）的下一句才算
    // 回答。这正是要修的跨 PC 泄漏：p1 的回问此前会被 p2 完全无关的一句
    // 话答掉（2026-08-30 实测会话 lcmj2joi，回合 7→8）。
    const myPendingMove = this.pendingCompoundMove.get(this.activePlayerId);
    if (myPendingMove) {
      this.pendingCompoundMove.delete(this.activePlayerId);
      turnMessages.push({ speaker: playerName, content: input, type: "action" });
      await this.resolveCompoundMoveReply(myPendingMove, input, turnMessages);
      return this.buildActionResponse(turnMessages);
    }
    // 别的 PC 还有没回答的回问：不拦截这个 PC 自己的行动（照常往下走，
    // 按它自己的意图执行），但提醒一句——"可能永远挂着"是已知且接受的
    // 风险（见 pendingCompoundMove 字段注释），不做成静默等待，让玩家
    // 至少知道还有一个问题没人接。
    if (this.pendingCompoundMove.size > 0) {
      const openFor = [...this.pendingCompoundMove.keys()].join("、");
      turnMessages.push({
        speaker: "系统",
        content: `（提醒：${openFor} 还有一个"要不要先移动"的问题没有回答。）`,
        type: "system",
      });
    }

    // 脱离模组请求：只认输入本身有没有明确表达"离开/结束调查"（见
    // isExplicitLeaveIntent 的注释），**不依赖意图解析把这句话分到哪个
    // action**——"结束这次调查"这类句子会被意图解析里"调查"关键词命中
    // 判成 skill_check，如果把这条检查挂在 case "move" 下面就永远碰不到。
    // 只在有模组注册时才有意义（"超出模组写明的位置"这个概念本身要有
    // 模组才成立），且只在这个 PC 自己没有待确认请求时才触发（上面已经
    // 处理过了；不检查别的 PC 是否有未答的 compound-move——两者范围不同，
    // 见 pendingCompoundMove/pendingLeaveConfirm 字段注释）。
    if (this.registeredModules.length > 0 && isExplicitLeaveIntent(input)) {
      turnMessages.push({ speaker: playerName, content: input, type: "action" });
      this.pendingLeaveConfirm = true;
      turnMessages.push({
        speaker: "系统",
        content: "你确定要离开这里吗？这会结束这次调查。（回复「确定」继续，其它任何话都视为取消）",
        type: "system",
      });
      this.lastNarrative = "KP 在等你确认是否要离开这次调查。";
      return this.buildActionResponse(turnMessages);
    }

    // 斜杠命令
    if (input.startsWith("/")) {
      const handled = await this.handleSlashCommand(input, turnMessages);
      if (handled) return this.buildActionResponse(turnMessages);
    }

    // 队友命令
    //
    // ⚠ 此前这里自己拼了一份四步版本（characters.set / 硬编码
    // `new SanityEngine(50)` / registerPlayer / persistSanity），跟统一
    // 入口比缺四样：不取角色真实 POW、不 join 会话槽位（这个 PC 的
    // messageHistory 从此没有归属）、不 upsertEntity（世界实体不存在——
    // 构造函数注释记过这个后果的原话：「开局的 KP 伤害因为找不到实体而
    // 失败……两相抵消，谁都看不出来」，这个 bug 对 p2+ 一直活着）、不建
    // careerStore 快照。现在走统一入口。
    const recruitMatch = input.match(/^创建队友\s+(\S+)\s+(\S+)/);
    if (recruitMatch) {
      const [, name, cls] = recruitMatch;
      // 走 addPartyMember（与 web 的 POST /party 同一入口）：建卡 + 兜底链
      // 解析扮演元数据 + createPartyMember 一次做齐八件事。
      // 文本命令没有 body，故 meta 不传 —— 走兜底链（模组/推导/LLM），
      // 与 web 端点能接收 HTTP 字段的能力不同（见 addPartyMember 注释）。
      const result = await this.addPartyMember(name, cls);
      if ("rejected" in result) {
        turnMessages.push({ speaker: "系统", content: result.rejected, type: "system" });
        return this.buildActionResponse(turnMessages);
      }
      turnMessages.push({ speaker: "系统", content: `👤 ${name}(${cls}) 加入了队伍`, type: "system" });
      if (result.warning) turnMessages.push({ speaker: "系统", content: `⚠️ ${result.warning}`, type: "system" });
      return this.buildActionResponse(turnMessages);
    }

    turnMessages.push({ speaker: playerName, content: input, type: "action" });

    // NPC/同伴指令检查
    const inviteMatch = input.match(/^邀请\s+(.+)/);
    const farewellMatch = input.match(/^告别\s+(.+)/);
    const controlMatch = input.match(/^(?:控制|接管|手操)\s+(.+)/);
    const autoMatch = input.match(/^(?:自动|放手|AI)\s+(.+)/);

    // ⚠ 这四条命令原先**全是门面**：只推一句话，一个都不碰 companionManager。
    //
    //   `自动/放手/AI X` 更彻底 —— 正则匹配出来了却连 if 都没有（`autoMatch`
    //   是 tsc 的 noUnusedLocals 报的），玩家能接管同伴却交不回去。
    //
    //   而控制系统本身是**完整实现且有测试**的：`setControl` / `getControl` /
    //   `transferControl` / `getPlayerControlled`，`companion-manager.ts:589`
    //   还在按 `control !== "auto"` 决定同伴这一轮自不自己动。
    //   实测这几个方法**只有测试在调用**，生产码一次都不碰 ——
    //   跟流血、跟追逐是同一个故事：实现了、测了、没接上。
    //
    //   找不到人时要说出来。原先「接管 张三」无论张三在不在队里都回同一句，
    //   打错名字与真的接管在播报上完全一样。
    // CompanionState 身上没有 id —— id 是 Map 的键，所以按 entries 找。
    const findCompanion = (name: string): string | undefined =>
      [...this.companionManager.getAllStates().entries()]
        .find(([id, c]) => c.config.name === name || id === name)?.[0];

    /**
     * 找不到同伴时说清楚为什么。
     *
     * ⚠ 原先四条指令共用一句「队伍里没有「X」」，而这句话会和上一回合的播报
     *   **直接打架**：
     *
     *     > 创建队友 乙 investigator    👤 乙(investigator) 加入了队伍
     *     > 接管 乙                     队伍里没有「乙」。
     *
     *   因为这里有**两套并行的「队伍」**：
     *     · `创建队友` 加进 `this.characters` —— 那是第二个**玩家角色**
     *     · 邀请/告别/接管/自动 操作的是 `CompanionManager` —— NPC 同伴
     *   两者互不相通，而报错只说「没有」，不说是哪一种没有。
     *
     *   （另：`CompanionManager.recruit()` 生产代码里零调用方，
     *     实际对局中同伴名册**永远是空的**。这四条指令目前只可能走到这个分支。）
     */
    const notFoundLine = (name: string): string => {
      const isPc = [...this.characters.values()].some(
        (c) => (c as { name?: string }).name === name,
      );
      return isPc
        ? `「${name}」是你的队友（玩家角色），不是可指挥的 NPC 同伴 —— 邀请/告别/接管 这几条只对 NPC 同伴有效。`
        : `队伍里没有「${name}」。`;
    };

    if (inviteMatch) {
      const who = inviteMatch[1].trim();
      const c = findCompanion(who);
      if (!c) {
        turnMessages.push({ speaker: "系统", content: notFoundLine(who), type: "system" });
      } else {
        this.companionManager.markInvited(c);
        turnMessages.push({ speaker: "系统", content: `你向 ${who} 发出了邀请`, type: "system" });
      }
      return this.buildActionResponse(turnMessages);
    }
    if (farewellMatch) {
      const who = farewellMatch[1].trim();
      const c = findCompanion(who);
      if (!c) {
        turnMessages.push({ speaker: "系统", content: notFoundLine(who), type: "system" });
      } else {
        const line = this.companionManager.handleDeparture(c, this.world, "player-farewell");
        turnMessages.push({ speaker: "系统", content: line ?? `${who} 离开了队伍`, type: "system" });
      }
      return this.buildActionResponse(turnMessages);
    }
    if (controlMatch) {
      const who = controlMatch[1].trim();
      const c = findCompanion(who);
      if (!c) {
        turnMessages.push({ speaker: "系统", content: notFoundLine(who), type: "system" });
      } else {
        this.companionManager.setControl(c, `player:${this.activePlayerId}`);
        turnMessages.push({ speaker: "系统", content: `你接管了 ${who} 的控制权`, type: "system" });
      }
      return this.buildActionResponse(turnMessages);
    }
    if (autoMatch) {
      const who = autoMatch[1].trim();
      const c = findCompanion(who);
      if (!c) {
        turnMessages.push({ speaker: "系统", content: notFoundLine(who), type: "system" });
      } else {
        this.companionManager.setControl(c, "auto");
        turnMessages.push({ speaker: "系统", content: `${who} 恢复自主行动。`, type: "system" });
      }
      return this.buildActionResponse(turnMessages);
    }

    // ── 意图派发（意图解析 → 结构化处理器）──
    const intent = await parseIntent(input);

    // 复合句回问：先移动再做事（开发·复合意图回问，任务1）。
    //
    // 引擎是"一句话=一个意图"的模型。玩家自然会说复合句（"陆川带大家前往
    // 农场外围，沿着...寻找可疑足迹"），LLM 只能二选一，通常执行后半段、
    // 丢掉前半段的移动，scene 不变。这不纯是模型判错——引擎没有"先移动
    // 再做事"的表达方式，是设计缺口。已裁决走 B 方案（明确回问），不是
    // A（返回动作序列，那是独立一轮）：拿一个回合换掉一次静默误判，
    // 与离开确认门、线索歧义反问（resolveSceneClueMatch 的"你想找什么？"）
    // 是同一个模式。
    //
    // 检测：intent.action 命中下面这份**白名单**（不是"排除 move/look 之外
    // 全都算"）时，对原始输入跑 resolveSceneTarget 能找到一个**有把握**
    // （!forced）、且不是当前场景的地点——这多半是"提到了要去哪，但意图
    // 被判成了别的动作"。forced=true（没把握、猜的）故意不算：那种情况下
    // "到底提没提地名"本身就不确定，再叠一层回问只会让本来能通过 LLM
    // 判对的输入也开始被追问。
    //
    // ⚠ 白名单而不是"排除 move/look"：第一版就是这么写的，"加载模组
    // 普瑞米尔的谷仓"这句里"普瑞米尔"恰好也是一个真实场景名（镇子枢纽），
    // intent.action="load_module" 不是 move/look，于是被错误地问成
    // "你是要先去「普瑞米尔」吗？"——覆盖了本该正常执行的模组加载，
    // coc-spells.test.ts 的"同一个模组不应重复加载"当场变红。只在真实
    // 报告里出现过的、语义上"做一件与当前地点绑定的事"的动作里触发：
    // talk（对话，"陆川带队返回特里坎家，把拖车房里发现的情况告诉菲碧"
    // 就是这一类）、skill_check（调查/检定，"沿着通往深处的道路寻找可疑
    // 足迹"同类）、unknown（LLM 完全没判出动作，回落询问比回落 LLM 叙事
    // 更明确，且不存在"覆盖掉本该正常执行的动作"这个风险）。
    const COMPOUND_ELIGIBLE_ACTIONS = new Set(["talk", "skill_check", "unknown"]);
    if (
      this.registeredModules.length > 0 &&
      COMPOUND_ELIGIBLE_ACTIONS.has(intent.action)
    ) {
      let rows: SceneRow[] = [];
      try { rows = this.world.listScenes().map((r) => ({ id: r.id, name: r.name })); } catch { /* 忽略 DB 错误 */ }
      const hit = resolveSceneTarget({
        said: input,
        displayNames: this.sceneDisplayNames,
        aliases: this.sceneAliases,
        rows,
      });
      const currentScene = this.getDisplayedScene();
      // 风险2（误报，任务3）：地名只是"提到的内容"不该触发回问——
      // "寻找能够指向维森酒吧的卡片"里，维森酒吧是线索指向的地方，不是
      // 这句话要去的地方（实跑：被误问成"你是要先去「维森酒吧」吗？"）。
      // hit 本身只回答"这句话认得出哪个场景"，不回答"这是不是目的地"，
      // 后者要另外看地名旁边有没有移动信号——见 hasMovementSignalNearMention
      // 的完整说明（紧邻移动动词，或紧跟"里/内"这类方位后缀）。用
      // hit.sceneId 对应的展示名 + 全部别名逐个检查，命中任意一个出现处
      // 即算数，因为玩家可能用别名而不是全名提这个地方。
      const hitSceneNames = hit.sceneId
        ? [this.sceneDisplayNames[hit.sceneId], ...(this.sceneAliases[hit.sceneId] ?? [])].filter(
            (n): n is string => Boolean(n) && input.includes(n),
          )
        : [];
      const hasMovementSignal = hitSceneNames.some((name) => hasMovementSignalNearMention(input, name));
      if (hit.sceneId && !hit.forced && hit.sceneId !== currentScene && hasMovementSignal) {
        // 风险1（误报）：句子里可能提到不止一个地名（目的地 + 话题内容），
        // 回问要展示真实候选而不是替玩家静默选中 resolveSceneTarget 挑的
        // 那一个——mentionedSceneNames 只认完整子串，不做部分匹配。
        const candidates = mentionedSceneNames(input, rows);
        const shown = candidates.length > 0
          ? candidates
          : [this.sceneDisplayNames[hit.sceneId] ?? hit.sceneId];
        turnMessages.push({ speaker: playerName, content: input, type: "action" });
        this.pendingCompoundMove.set(this.activePlayerId, { originalInput: input, originalIntent: intent });
        turnMessages.push({
          speaker: "系统",
          content: `你是要先去「${shown.join("」「")}」吗？（回复目的地名字继续，其它话按原意图在原地执行）`,
          type: "system",
        });
        this.lastNarrative = "KP 在等你确认要不要先移动过去。";
        return this.buildActionResponse(turnMessages);
      }
    }

    if (intent.action !== "unknown") {
      const handled = await this.handleIntent(intent, input, turnMessages);
      if (handled) return this.buildActionResponse(turnMessages);
    }

    // 战斗检测：只有输入本身看起来像"攻击"才会走这条自动检定分支——
    // `combatActive` 单独为真不再是进这个分支的理由。
    //
    // ⚠ 此前是 `this.combatActive || 攻击词`：只要还在打，随便说什么、
    //   移动去哪、想跟谁说话，只要没被上面的 handleIntent 接住，一律被判成
    //   打人。实跑抓到过两种触发方式：
    //   · 「去特里坎家」（移动，但 case "move" 在模块模式下无视
    //     tryResolveModuleScene() 的返回值、一律回 false，见 handleIntent
    //     的 case "move"/"look" 修复）落进这里，打中了艾德里安。
    //   · 「我点燃酒吧，夺走所有登记簿，宣布整个小镇现在归我统治」这类纯
    //     叙述、intent.action 解析不出来（"unknown"），combatActive 为真时
    //     照样被判成攻击酒吧保镖。
    //
    //   combatActive 本身不在这里被清掉——不是攻击判定不等于战斗结束，
    //   敌人仍在场上，下一回合玩家还能打；「说一句话就完全脱战」同样不对。
    //   落点仍是下面的 LLM 叙事分支，战斗状态原样保留，只是这一回合没有
    //   产生攻击判定。
    if (/^(攻击|射击|挥砍|向.+攻击|对.+使用)/.test(input)) {
      // 场景内、hp>0 的敌人——复用 aliveEnemies()，不再自己单开一份不按
      // 场景过滤的 filter（那是「人在拖车房，酒吧保镖还在扑过来」的根因：
      // 换了场景，旧场景里的敌人还留在这份名单里）。
      const enemies = this.aliveEnemies();
      if (enemies.length > 0) {
        this.combatActive = true;
        // 打 intent.target 指定的目标，不再从全场景随机挑——随机挑会打中
        // 无关 NPC（实跑里出现过打「爱莉·埃斯特鲁姆」这种旁观者）。
        const target = this.pickTarget(intent, enemies)!;

        // 检定（简化版"
        const skill = 50;
        const roll = Math.floor(Math.random() * 100) + 1;
        const success = roll <= skill;
        const isCrit = roll <= skill * 0.05;
        const isFumble = roll > 95;

        let dmg = 0;
        if (success) {
          dmg = isCrit ? Math.floor(Math.random() * 12) + 6 : Math.floor(Math.random() * 6) + 1;
          // 重伤/流血/昏迷的结算与 `handleAttack` 共用一份 —— 见 `resolveHit`。
          // 这两条路各写一份的时候，功能全的是这一条，可它跑不到。
          this.resolveHit(target, dmg, (s) => turnMessages.push({ speaker: "系统", content: s, type: "system" }));
        }

        const hitMsg = isFumble ? "大失败！" : isCrit ? "暴击" : success ? "命中" : "未命";
        turnMessages.push({
          speaker: "系统",
          content: `🎲 检查d100=${roll} (目标=${skill}) ${hitMsg}${success ? `，对 ${target.name} 造成 ${dmg} 点伤害` : ""}`,
          type: "system",
        });
        turnMessages.push({
          speaker: "系统",
          content: `${target.name} 剩余 HP: ${target.hp}/${target.maxHp}`,
          type: "system",
        });

        // 同伴协作攻击
        const comps = this.companionManager.getActiveCompanions();
        for (const c of comps) {
          // 同伴血量在世界实体上；此前读 c.hp 恒为 undefined，
          // 条件永远为假，同伴协助攻击从未真正发生过。
          const cEnt = this.world.getEntity(c.entityId);
          if ((cEnt?.hp ?? 0) > 0 && c.behavior !== "defensive") {
            const cRoll = Math.floor(Math.random() * 100) + 1;
            const cSkill = c.config.skills?.fight ?? 30;
            if (cRoll <= cSkill && enemies.length > 0) {
              const remaining = this.aliveEnemies();
              if (remaining.length > 0) {
                const cTarget = remaining[Math.floor(Math.random() * remaining.length)];
                const cDmg = Math.floor(Math.random() * 4) + 1;
                cTarget.hp = Math.max(0, cTarget.hp - cDmg);
                this.world.upsertEntity(cTarget);
                turnMessages.push({ speaker: "系统", content: `👤 ${c.config.name} 协助攻击 ${cTarget.name}，造成 ${cDmg} 点伤害`, type: "system" });
              }
            }
          }
        }

        // 检查战斗结"
        if (this.aliveEnemies().length === 0) {
          this.combatActive = false;
          turnMessages.push({ speaker: "系统", content: "✋ 所有敌人已被击败，战斗结束", type: "system" });
        }

        return this.buildActionResponse(turnMessages);
      }
    }

    // LLM 叙事（含传奇模板上下文注入 + 世界模型权威事实注入）
    this.injectWorldModelForScene();
    const epicContext = this.buildEpicContext();
    try {
      // 将最近的 NPC 对话并入 recentMessages，让 KP 感知玩家与 NPC 的交流。
      // 只筛选 dialogue 类型（而非全部历史），避免被 KP 内部 slice(-8) 截断。
      const recentDialogues = this.session
        .getRecentGlobal(50)
        .filter((m) => m.type === "dialogue")
        .slice(-6);
      const narration = await this.kp.narrateOutcome(
        input,
        `玩家行动: ${input}${epicContext}`,
        [...recentDialogues, ...turnMessages]
      );
      this.lastNarrative = narration;
      turnMessages.push({ speaker: "守秘人", content: narration, type: "narration" });
    } catch {
      this.lastNarrative = `${playerName} 行动了：${input}`;
      turnMessages.push({ speaker: "守秘人", content: `${playerName} 行动了：${input}`, type: "narration" });
    }
    return this.buildActionResponse(turnMessages);
  }

  // ============================================================
  // 斜杠命令
  // ============================================================

  private async handleSlashCommand(input: string, messages: AgentMessage[]): Promise<boolean> {
    const raw = input.slice(1).trim();
    if (!raw) return false;
    const parts = raw.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const msg = (s: string) => messages.push({ speaker: "系统", content: s, type: "system" });

    try {
      switch (cmd) {
        case "roll": case "r": {
          const expr = args.join("") || "1d100";
          const result = this.execDiceExpr(expr);
          msg(`🎲 ${expr} = ${result.total}${result.detail ? ` (${result.detail})` : ""}`);
          break;
        }
        case "time": {
          const tp = args[0]?.toLowerCase();
          if (tp && ["dawn","morning","noon","afternoon","dusk","evening","night","late_night"].includes(tp)) {
            this.gameTime = { day: this.gameTime.day, period: tp as any, ticks: 0 };
            msg(`⏰ 时间设为: ${formatGameTime(this.gameTime)}`);
          } else {
            msg(`⏰ 当前: ${formatGameTime(this.gameTime)}\n${periodAtmosphere(this.gameTime.period)}`);
          }
          break;
        }
        case "diff": case "difficulty": {
          const d = args[0]?.toLowerCase();
          if (d && ["easy","medium","hard","nightmare"].includes(d)) this.setDifficulty(d as any);
          else msg("用法: /diff <easy|medium|hard|nightmare>");
          break;
        }
        case "table": case "t": {
          const tblName = args[0];
          const count = parseInt(args[1]) || 1;
          if (!tblName) {
            const tbls = listTables().map(t => `  ${t.name}`).join("\n");
            msg(`📖 可用随机表:\n${tbls}`);
          } else {
            try { msg(`🎲 ${tblName} (x${count}):\n  ${rollTable(tblName, count).join("\n  ")}`); }
            catch { msg("未找到该表"); }
          }
          break;
        }
        case "help": case "?": {
          msg("📋 命令: /roll, /time, /diff, /table, /ref, /status, /help");
          break;
        }
        default:
          return false;
      }
    } catch (err: any) {
      msg(`⚠️ 错误: ${err.message}`);
    }
    return true;
  }

  // ============================================================
  // 意图路由
  // ============================================================

  private async handleIntent(
    intent: ActionIntent,
    input: string,
    messages: AgentMessage[],
  ): Promise<boolean> {
    const msg = (s: string) => messages.push({ speaker: "系统", content: s, type: "system" });
    switch (intent.action) {
      case "help": return this.handleHelp(msg);
      case "status": return this.handleStatus(messages);
      case "move":
        // 模块模式：先解析目标场景名（匹配模组已注册场景并更新玩家位置），
        // 解析不出来才回落 LLM 叙事。
        //
        // ⚠ 这里原先不管 tryResolveModuleScene() 的返回值，一律 `return false`
        //   ——那句 docstring 自己写着"返回值在两个调用点都被丢掉"，写是写了
        //   但两个调用点从没真的改过来。后果：移动**成功**了也被 handleIntent
        //   报成"没处理"，act() 里 `if (handled) return ...` 落空，继续往下
        //   走到战斗检测/LLM 叙事——combatActive 为真时，移动直接变成一次
        //   攻击判定（实跑：「去特里坎家」打中了艾德里安）。
        if (this.registeredModules.length > 0) {
          return this.tryResolveModuleScene(intent.target ?? input, msg);
        }
        return this.handleMove(intent, msg);
      case "look":
        // 同上：只有解析失败（返回 false）才回落 LLM 叙事。
        if (this.registeredModules.length > 0) {
          return this.tryResolveModuleScene(intent.target ?? input, msg);
        }
        msg("你环顾四周，观察着周围的环境…"); this.lastNarrative = "你仔细观察了周围的环境"; return true;
      case "inventory": return this.handleInventory(msg);
      case "flee": return this.handleFlee(msg);
      case "rest": return this.handleRest(messages, msg);
      case "san_check": return this.handleSanCheck(intent, msg);
      case "skill_check": return this.handleSkillCheck(intent, input, msg);
      case "saving_throw": return this.handleSavingThrow(intent, msg);
      case "attack": return this.handleAttack(intent, msg);
      case "create_character": return this.handleCreateCharacter(input, msg);
      case "list_occupations": return this.handleListOccupations(msg);
      case "buy": return this.handleBuy(intent, msg);
      case "sell": return this.handleSell(intent, msg);
      case "legacy": return this.handleLegacy(input, msg);
      case "generate_story": return this.handleGenerateStory(msg);
      case "load_module": return this.handleLoadModule(input, msg);
      case "skill_advancement": return this.handleSkillAdvancement(messages, msg);
      case "cast": case "occult_cast": return this.handleCast(intent, msg);
      case "read": return this.handleRead(input, msg);
      case "first_aid": return this.handleFirstAid(msg);
      case "reload": return this.handleReload(intent, msg);
      case "push": return this.handlePush(msg);
      case "chase": return this.handleChase(msg);
      case "use_item": case "pickup": msg(`你尝试${intent.action === "pickup" ? "捡起" : "使用"}物品。`); this.lastNarrative = `你${intent.action === "pickup" ? "捡起" : "使用"}物品。`; return true;
      case "talk": return this.handleTalk(intent, input, messages, msg);
      case "spell_list": msg("当前可用法术：暂无已知法术"); this.lastNarrative = "你回忆了一下已知的法术"; return true;
      case "shop": msg("商店功能尚未开放"); this.lastNarrative = "商店功能尚未开放"; return true;
      case "view_module": msg("模组详情功能"); this.lastNarrative = "模组详情"; return true;
      // ⚠ 这里原先是一句写死的套话：「疯狂指引：当SAN大幅下降时，角色可能出现
      //   各种精神障碍…」——结尾那个省略号说明它本来就是个占位。
      //   问「疯狂指引」的人想知道的是**自己现在什么样**，不是疯狂这个概念。
      //   CLI 一直调 `sanity.getFullGuidance()`（index.ts:1136），
      //   把临时疯狂表现、不定疯狂等级与惩罚、恐惧症、狂躁症逐条拼出来。
      //   这条路却停在占位上 —— 又一处两个前端两套行为。
      //   不再加「空了就回落到一句话」的兜底 —— `getFullGuidance()` 自己
      //   已经处理了清醒这一支（`lines.length === 0` 时给「你的神智目前清醒。」），
      //   再包一层就是够不到的死代码。
      case "insanity_guidance": {
        msg(this.sanity.getFullGuidance());
        this.lastNarrative = "疯狂指引";
        return true;
      }
      case "allocate_skills": msg("技能分配功能"); this.lastNarrative = "技能分配"; return true;
      case "equip": case "unequip": msg(`执行${intent.action === "equip" ? "装备" : "卸下"}操作。`); this.lastNarrative = `${intent.action === "equip" ? "装备" : "卸下"}完成。`; return true;
      // ── 政治经济 ──
      case "factions": case "faction_status": case "diplomacy":
      case "market": case "trade":
      case "policy":
      case "finance": case "sanction": case "embargo":
      case "economy_viz": case "viz":
        return this.handlePoliticoEconomy(intent, messages, msg);
      default: return false;
    }
  }

  // ============================================================
  // 意图处理"
  // ============================================================

  // ── 帮助 ──
  private handleHelp(msg: (s: string) => number): boolean {
    const helpText = [
      "【操作指南",
      "",
      "— 基础操作 —",
      "  观察/环顾四周 → 查看当前场景",
      "  移动到<地点> → 前往指定场景",
      "  状态/角色卡 → 查看角色属性",
      "  背包/物品栏 → 查看携带物品",
      "  帮助 → 显示操作指南",
      "",
      "— 战斗操作 —",
      "  攻击<目标> → 攻击指定敌人",
      "  逃跑 → 脱离战斗",
      "  装填<武器> → 补充弹药",
      "  燃运<N> 攻击<目标> → 消耗幸运值提升命中",
      "",
      "— 角色创建 —",
      "  创建角色 → 创建新调查员",
      "  创建角色 <职业> <姓名> → 指定职业创建",
      "  职业列表 → 查看可选职业",
      "",
      "─ 技能与检查",
      "  调查<目标>/侦查<区域> — 进行技能检查",
      "  SAN检查/理智检查 — 进行理智检查",
      "  豁免检查 — 进行豁免检查",
      "  推动 — 重试失败的检查",
      "",
      "─ 物品与商店",
      "  购买 <物品> — 购买物品",
      "  出售 <物品> — 出售物品",
      "",
      "─ 传承系统",
      "  传承 — 查看传承说明",
      "  保存角色 — 保存当前角色",
      "  传承列表 — 查看已保存角色",
      "  读档 <角色名> — 加载已保存角色",
      "",
      "─ 模组与故事",
      "  生成故事 — 随机生成冒险故事",
      "  加载模组 <模组名> — 加载剧本杀模组",
      "  模组结算 — 结算模组成长",
      "",
      "─ 其他",
      "  休息 — 休整恢复",
      "  急救/包扎 — 处理伤口",
      "  阅读<典籍> — 阅读神话典籍",
      "  施法<法术名> — 施展法术",
    ].join("\n");
    this.lastNarrative = helpText;
    msg(helpText);
    return true;
  }

  // ── 状态显示 ──
  private handleStatus(messages: AgentMessage[]): boolean {
    if (!this.activeCharacter) {
      this.lastNarrative = "你还没有创建角色。使用「创建角色<职业> <姓名>」来创建调查员";
      messages.push({ speaker: "系统", content: "尚未创建角色。使用「创建角色<职业> <姓名>」来创建调查员", type: "system" });
      return true;
    }
    const c = this.activeCharacter;
    const san = this.getSanity();
    const lines: string[] = [];
    lines.push(`━━━ ${c.name} ━━━`);
    if (this.activeRuleset === "cosmic-horror") {
      const attrs = c.attributes ?? {};
      const str = attrs.strength ?? attrs.STR ?? 50;
      const con = attrs.constitution ?? attrs.CON ?? 50;
      const siz = attrs.size ?? attrs.SIZ ?? 50;
      const dex = attrs.dexterity ?? attrs.DEX ?? 50;
      const app = attrs.appearance ?? attrs.APP ?? 50;
      const edu = attrs.education ?? attrs.EDU ?? 50;
      const intel = attrs.intelligence ?? attrs.INT ?? 50;
      const pow = attrs.power ?? attrs.POW ?? 50;
      const luck = c.luck ?? 60;
      const mp = Math.floor(pow / 5);
      // ⚠ `calcDamageBonus` 返回的是 `{ db, build }` **对象**，原先直接插进
      //   下面的模板串，玩家看到的是 `DB:[object Object]`。
      //   而 build 又在这里按 STR+SIZ 手算了一遍 —— 同一件事两套算法，
      //   一套还是没人看的（对象那份自带 build）。用返回值里的。
      const { db, build } = calcDamageBonus(str, siz);
      const move = dex < siz && str < siz ? 7 : siz <= str && siz <= dex ? 9 : 8;
      lines.push(`职业: ${c.archetype?.label ?? c.archetype ?? "调查员"}`);
      lines.push(`HP: ${c.hp ?? 12}/${c.maxHp ?? 12}  SAN: ${san.currentSAN}/${san.maxSAN}`);
      lines.push(`STR:${str} CON:${con} SIZ:${siz} DEX:${dex} APP:${app}`);
      lines.push(`EDU:${edu} INT:${intel} POW:${pow} 幸运:${luck}`);
      lines.push(`DB:${db}  Build:${build}  Move:${move}  MP:${mp}`);
      lines.push(`CR:${c.creditRating ?? 30}  燃运:${luck}`);
      // ⚠ 疯狂状态原先**在角色卡上完全看不到**。实测：SAN 从 50 掉到 26
      //   （48%，已经是中度不定疯狂），角色卡还是只印一行 `SAN: 26/50` ——
      //   临时疯狂、不定疯狂等级、恐惧症、狂躁症一个都不显示。
      //   玩家不知道自己已经跨过那条线，也就不知道该怎么演。
      //
      //   `SanityEngine.getSummary()` 拼的正是这些，但它**只有测试在调**。
      //   两端都写好了，中间那根线没接 —— 又一处。
      const sanSummary = this.sanity.getSummary();
      // getSummary 开头就是 `SAN: x/y`，上面已经印过，这里只取后面的疯狂部分
      const madness = sanSummary.replace(/^SAN:\s*\d+\/\d+/, "").trim();
      if (madness) lines.push(`精神: ${madness}`);
      if (c.skills ?? c.skillValues) {
        const skills = c.skills ?? c.skillValues ?? {};
        const skillEntries = Object.entries(skills).slice(0, 10);
        if (skillEntries.length > 0) {
          lines.push("技能: " + skillEntries.map(([k, v]) => `${k}:${v}%`).join(", "));
        }
      }
    } else {
      const ac = CharacterFactory.computeAC(c);
      lines.push(`职业: ${c.archetype?.label ?? c.archetype ?? "冒险"}`);
      lines.push(`HP: ${c.hp ?? 12}/${c.maxHp ?? 12}  AC:${ac}  等级:${c.totalLevel ?? 1}`);
      if (c.attributes) {
        const attrs = c.attributes;
        lines.push(`力量:${attrs.strength ?? "?"} 敏捷:${attrs.dexterity ?? "?"} 体质:${attrs.constitution ?? "?"}`);
        lines.push(`智力:${attrs.intelligence ?? "?"} 感知:${attrs.wisdom ?? "?"} 魅力:${attrs.charisma ?? "?"}`);
      }
    }
    const statusText = lines.join("\n");
    this.lastNarrative = statusText;
    messages.push({ speaker: "系统", content: statusText, type: "system" });
    return true;
  }

  // ── 移动 ──

  /**
   * 模块模式：将移动/查看目标解析为已注册的模组场景并更新玩家位置。
   * 匹配不到时不创建垃圾场景，返回 false（由调用方回落 LLM 叙事）。
   *
   * `msg` 用来在**没认准**时明说。原先没有这一路：认准了静默移动、
   * 没认准也静默移动，玩家一个字都看不到 ——「比菜单更糟」说的就是这个。
   */
  private tryResolveModuleScene(targetOrInput: string, msg?: (s: string) => void): boolean {
    // 解析逻辑抽到了 `play/scene-resolve.ts`。
    //
    // ⚠ 这条 docstring 曾经写着"返回值在两个调用点都被丢掉"——诊断是对的，
    //   但两个调用点（handleIntent 的 case "move"/"look"）当时没有真的改
    //   过来，一律 `return false`。诊断写了不代表修了：实跑因此出现过
    //   「移动成功了，却因为 combatActive 为真被顺手判成一次攻击」。
    //   两个调用点现在改成如实转发这个方法的返回值。
    let rows: SceneRow[] = [];
    try {
      rows = this.world.listScenes().map((r) => ({ id: r.id, name: r.name }));
    } catch { /* 忽略 DB 错误 */ }

    const hit = resolveSceneTarget({
      said: targetOrInput ?? "",
      displayNames: this.sceneDisplayNames,
      aliases: this.sceneAliases,
      rows,
    });
    if (!hit.sceneId) return false;

    // 弱版邻接 + 按跳数计时（开发 A · 任务 3）：目标在场景表内就能去，
    // 不要求与当前场景有出口直连，但按最短跳数付时间，不是瞬移。
    // 图上量不出到达方式（孤立场景/不连通）时拒绝移动并说明，不编代价。
    const fromSceneId = this.getDisplayedScene();
    const graph = buildSceneGraph(this.world.listScenes());
    const hops = shortestHops(graph, fromSceneId, hit.sceneId);
    if (hops === null) {
      const name = this.sceneDisplayNames[hit.sceneId] ?? hit.sceneId;
      msg?.(`「${name}」目前没有已知路线可达，去不了。`);
      return true; // 已经明说了原因，不是"没处理"，别再落到 LLM 叙事兜底
    }

    const moved = this.movePlayerToScene(hit.sceneId);
    // 1 跳 = act() 每回合本来就会推进的那 1 tick；跳数更多才额外加时间，
    // 所以相邻移动（hops<=1）与改动前逐字一致。访问历史的记录在
    // movePlayerToScene() 内部（任务1已加），这里不用再记一次。
    if (moved && hops > 1) this.gameTime = advanceTime(this.gameTime, hops - 1);
    // 没认准就说出来。玩家有权知道「这一步是我选的，还是引擎猜的」——
    // 剧本杀那条路早有这句（「没听清要去哪……」），真人这条路一直没有。
    if (moved && hit.forced) {
      const name = this.sceneDisplayNames[hit.sceneId] ?? hit.sceneId;
      msg?.(`（没太确定你要去哪，先按最接近的理解带你到了「${name}」。说个更完整的地名可以纠正。）`);
    }
    // 移动成功却不设 lastNarrative，响应就沿用上一轮内容 —— 实跑：输入
    // 「周明回特里坎家」，narrative 写的是特里坎家，但 state.scene 却仍是
    // 移动前的场景（这个方法早不早于 handleMove 那条"你移动到了场景:X"的
    // 老路径），下一回合还在提移动前场景里的 NPC。移动成功时如实设一句。
    if (moved) {
      const name = this.sceneDisplayNames[hit.sceneId] ?? hit.sceneId;
      this.lastNarrative = `你来到了「${name}」。`;
    }
    return moved;
  }

  /**
   * 将玩家移动到场景并设为活动场景（不创建垃圾场景）。
   *
   * 经 setScene() 而不是直接 setActiveScene()：后者是
   * `UPDATE scenes SET is_active=1 WHERE id=?`，场景未注册时匹配不到行，
   * 整条切换静默失效——与 §八 记录的两次事故同类。setScene() 会先校验注册。
   * 未注册时返回 false 并保持原场景，由调用方决定如何提示。
   */
  private movePlayerToScene(sceneId: string): boolean {
    if (!this.setScene(sceneId)) return false;
    const state = this.world.getCurrentState();
    const player = state.entities[this.activePlayerId];
    if (player) {
      player.position = sceneId;
      this.world.upsertEntity(player);
    } else {
      this.world.upsertEntity({ id: this.activePlayerId, name: this.activeCharacter?.name ?? "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: sceneId });
    }
    // 玩家位置真的落到这个场景了——记一笔访问历史（真相源，按玩家累计，
    // 从不清空）。放在这一处而不是各调用方各记一次：这是"玩家位置改变"
    // 这件事唯一的落点，调用方多（tryResolveModuleScene / 模组入场等），
    // 分散记录容易漏，且 INSERT OR IGNORE 本就幂等，不怕这里多调一次。
    this.world.recordSceneVisit(this.activePlayerId, sceneId);
    return true;
  }

  private handleMove(intent: ActionIntent, msg: (s: string) => number): boolean {
    const target = intent.target ?? "";
    // ⚠ 空/空白目标一律拒绝，不注册、不谎报成功。
    //
    // 此前这道防线在自动注册**之后**：intent.target 为空字符串时，
    // sceneMap[""] ?? "" 仍是空串，`registerScene("", "", "的场景")`
    // 把空字符串注册成一个真场景，setScene("") 因此必然通过，最后打出
    // 「你移动到了场景: 」且 state.scene = ""（实跑抓到过，见
    // analysis/sim/2026-08-28-barn-long-input-abort.md）。防线必须移到
    // 自动注册之前，判据也不能只查 undefined——空字符串 trim 后同样要拦。
    if (target.trim().length === 0) {
      msg("你要去哪？没听清具体的地方。");
      return false; // 交回上层，走 LLM 叙事兜底，别谎报成功
    }
    // 场景名称解析映射
    const sceneMap: Record<string, string> = {
      "谷仓": "barn_interior", "谷仓内部": "barn_interior",
      "农场": "farm_exterior", "农场外围": "farm_exterior",
      "小屋": "cabin", "地下室": "basement",
      "酒馆": "tavern", "旅店": "tavern",
    };
    const sceneId = sceneMap[target] ?? target;
    // 玩家自由移动可以落到尚未注册的场景，这里按需注册后再经 setScene() 激活。
    //
    // 原写法是 `(this.world as any).getDatabase()` 裸写 INSERT OR IGNORE。
    // 问题不在于取不到 db（getDatabase() 本就是 WorldStateManager 的公开方法），
    // 而在于那个 `as any` 把整条链的类型检查关掉了：列名拼错、少写一列、
    // is_active 默认值给错，全都要等运行时才发现——registerScene() 先删后插
    // 清空 exits 那个 bug 就是这么漏过去的。改走具名方法后表结构只有
    // world-state-manager 知道，这里写错会在编译期断掉。
    if (!this.world.getScene(sceneId)) {
      this.world.registerScene(sceneId, target, `${target}的场景`);
    }
    // ⚠ 这里原先是 `this.setScene(sceneId);` —— **返回值丢掉**，
    // 然后不管成没成都往下走，最后照样 `msg("你移动到了场景: X")` 并 `return true`。
    // 注册若因任何原因没生效，玩家会被告知「你移动到了 X」而实际没动，
    // 后端还回 success —— 与 §八 记的两次事故同一形状（「后端却仍返回 success: true」）。
    if (!this.setScene(sceneId)) {
      msg(`那地方现在去不了（场景「${target}」没能激活）。`);
      return false; // 交回上层，走 LLM 叙事兜底，别谎报成功
    }
    // 更新玩家位置
    const state = this.world.getCurrentState();
    const player = state.entities[this.activePlayerId];
    if (player) {
      player.position = sceneId;
      this.world.upsertEntity(player);
    } else {
      this.world.upsertEntity({ id: this.activePlayerId, name: this.activeCharacter?.name ?? "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: sceneId });
    }
    this.world.recordSceneVisit(this.activePlayerId, sceneId);
    msg(`你移动到了场景: ${this.sceneDisplayNames[sceneId] ?? sceneId}`);
    this.lastNarrative = `你走向了${target}。`;
    return true;
  }

  /**
   * 复合句回问的答复处理（开发·复合意图回问，任务1）。
   *
   * 两条分支收敛成一段代码，不是两个 if：
   *   回答目的地名（"去农场外围"）→ tryResolveModuleScene 认得出来，
   *     移动过去（含既有的弱版邻接+按跳数计时），然后继续按原意图执行
   *     ——"先移动再做事"的"做事"那半句不该被回问吃掉。
   *   回答别的（"我们再等等"/一句新的话）→ tryResolveModuleScene 认不出
   *     任何场景，没有移动发生，直接按原意图在原地执行——不阻塞、不卡住。
   * 两条分支最终都会执行 originalIntent，区别只在于执行前有没有先移动，
   * 所以不需要分叉成两段几乎相同的代码。
   */
  private async resolveCompoundMoveReply(
    pending: PendingCompoundMove,
    input: string,
    turnMessages: AgentMessage[],
  ): Promise<void> {
    const msg = (s: string) => turnMessages.push({ speaker: "系统", content: s, type: "system" });
    // 移动成功、不可达的说明、认不出地点，三种情况 tryResolveModuleScene
    // 都已经处理并按需 msg() 了，这里显式弃用返回值——不管有没有移动，
    // 下面都要接着执行原意图，语义上是同一件事："先移动（如果能）再做事"。
    void this.tryResolveModuleScene(input, msg);
    await this.handleIntent(pending.originalIntent, pending.originalInput, turnMessages);
  }

  /**
   * 确认离开后：判定结局、播报、置终态（开发 A · 任务 5）。
   *
   * 终态复用现有 `dead`——不造第三种终态。结局记录复用
   * `careerStore.addEntry` 与 `endingId`/`endingName` 这两个既有字段
   * （原先只在 handleSkillAdvancement 里硬写 "completed"/"模组完成"，
   * 这里填的是 evaluateEnding 真正判出来的那一个）。
   *
   * 早退落到 Normal End 是自然结果，不是特判：END_NARRATIONS 里 Normal
   * 的 priority 最低、requiredClues 为空，任何状态下都会兜底命中——它的
   * 文案本来就是"未受干涉的结果"，不用另写。
   */
  private resolveModuleDeparture(turnMessages: AgentMessage[]): void {
    const msg = (s: string) => turnMessages.push({ speaker: "系统", content: s, type: "system" });
    const modId: string | undefined = this.registeredModules[0]?.id;
    const support = modId ? MODULE_ENDING_SUPPORT[modId] : undefined;

    let lines: readonly string[];
    let endingId: string;
    let endingName: string;

    if (support) {
      const ending = support.evaluateEnding(
        (id) => this.isClueFound(id),
        (id) => this.isSceneVisited(id),
      );
      if (ending) {
        lines = ending.lines;
        endingId = ending.id;
        endingName = support.endLabels[ending.id] ?? ending.id;
      } else {
        // 理论上不会发生（Normal End 兜底一切非全员倒下的状态），
        // 真出现时也别空播——通用收场保底。
        lines = GENERIC_DEPARTURE_LINES;
        endingId = "left_early";
        endingName = "提前离开";
      }
    } else {
      // 该模组结局数据为空（阿卡姆/印斯茅斯目前如此）——不是"按设计没有
      // 结局"，是待补（见 docs/todo.json）。不报错、不空播，走通用收场。
      lines = GENERIC_DEPARTURE_LINES;
      endingId = "left_early";
      endingName = "提前离开";
    }

    for (const line of lines) msg(line);
    this.lastNarrative = lines.join("\n");
    this.dead = true;

    if (this.careerStore) {
      const targets: Array<{ pid: string; char: any }> = [];
      for (const [pid, char] of this.characters) if (char) targets.push({ pid, char });
      if (targets.length === 0 && this.activeCharacter) {
        targets.push({ pid: this.activePlayerId, char: this.activeCharacter });
      }
      for (const { pid, char } of targets) {
        try {
          this.careerStore.addEntry({
            id: `ce_${Date.now().toString(36)}_${pid}`,
            characterName: char.name,
            moduleId: modId ?? "unknown",
            moduleName: this.registeredModules[0]?.name ?? "未知模组",
            completedAt: new Date().toISOString(),
            endingId,
            endingName,
            sanChange: 0,
            cmChange: 0,
            reputationChange: 0,
            skillChanges: [],
            rewardIds: [],
            narrative: lines[0] ?? "提前离开模组",
          });
        } catch (e) {
          // 同 handleSkillAdvancement 的既有先例：写不进去要说出来，
          // 静默丢数据比报错糟得多。
          const why = e instanceof Error ? e.message : String(e);
          msg(`⚠️ ${char.name} 的离场记录没能写进履历（${why}）。`);
        }
      }
    }
  }

  // ── 背包 ──
  private handleInventory(msg: (s: string) => number): boolean {
    const inv = this.world.getPlayerInventory(this.activePlayerId);
    if (inv.length === 0) {
      msg("你的背包是空的");
      this.lastNarrative = "你的背包里空空如也";
    } else {
      msg(`你的背包: ${inv.join(", ")}`);
      this.lastNarrative = `你的背包里有: ${inv.join(", ")}。`;
    }
    return true;
  }

  // ── 逃跑 ──
  private handleFlee(msg: (s: string) => number): boolean {
    this.combatActive = false;
    this.lastNarrative = "你转身逃跑，迅速脱离了战斗";
    msg("你成功逃离了战斗！");
    return true;
  }

  // ── 休息 ──
  private handleRest(messages: AgentMessage[], msg: (s: string) => number): boolean {
    // 获取角色 HP（优先从世界实体读取，回退到 activeCharacter）
    const state = this.world.getCurrentState();
    const playerEnt = state.entities[this.activePlayerId];
    let currentHp = playerEnt?.hp ?? this.activeCharacter?.hp ?? 12;
    let maxHp = playerEnt?.maxHp ?? this.activeCharacter?.maxHp ?? 12;

    if (!this.activeCharacter) {
      this.lastNarrative = "你在篝火旁坐下，稍作休整…";
      msg("你在篝火旁坐下，稍作休整");
      return true;
    }
    const c = this.activeCharacter;

    // 过夜休息：若已入夜（黄昏后），休息推进到次日清晨
    const NIGHT_PERIODS = ["dusk", "evening", "night", "late_night"];
    if (NIGHT_PERIODS.includes(this.gameTime.period)) {
      this.gameTime = { day: this.gameTime.day + 1, period: "dawn", ticks: 0 };
      msg(`🌙 你在休息中度过一夜，时间来到 ${formatGameTime(this.gameTime)}`);
    }

    // 技能成长检定（有标记时"
    if (this.skillGrowthMarks && this.skillGrowthMarks.length > 0) {
      const marks = [...new Set(this.skillGrowthMarks)];
      const pid = this.activePlayerId;
      for (const skill of marks) {
        const roll = Math.floor(Math.random() * 100) + 1;
        const currentSkill = (c.skillValues?.[skill] ?? c.skills?.[skill] ?? 50);
        const display = SKILL_DISPLAY_NAMES[skill] ?? skill;
        if (roll > currentSkill) {
          const increase = Math.floor(Math.random() * 10) + 1;
          if (c.skillValues) c.skillValues[skill] = Math.min(99, currentSkill + increase);
          else if (c.skills) c.skills[skill] = Math.min(99, currentSkill + increase);
          // 记录休息成长，模组结算时并入该 PC 的传承记录
          const prev = this._growthChangesByPC.get(pid) ?? [];
          prev.push(`${display}→${Math.min(99, currentSkill + increase)}`);
          this._growthChangesByPC.set(pid, prev);
          messages.push({ speaker: "系统", content: `🎲 技能成长检查d100=${roll} (当前=${currentSkill}%) → 成功！${display} +${increase}%`, type: "system" });
        } else {
          messages.push({ speaker: "系统", content: `🎲 技能成长检查d100=${roll} (当前=${currentSkill}%) → 失败，${display} 无成长`, type: "system" });
        }
      }
      this.skillGrowthMarks = [];
    }

    if (currentHp >= maxHp) {
      this.lastNarrative = "经过短暂休整，你的身体状况良好，精力充沛";
      msg("经过短暂休整，你的身体状况良好");
      return true;
    }

    if (this._woundsTreated) {
      const con = c.attributes?.constitution ?? c.attributes?.CON ?? 50;
      const recovery = Math.max(1, Math.floor(con / 10));
      const newHp = Math.min(maxHp, currentHp + recovery);
      c.hp = newHp;
      this._woundsTreated = false;
      // 同步世界实体和角色
      if (playerEnt) { playerEnt.hp = newHp; this.world.upsertEntity(playerEnt); }
      this.lastNarrative = `伤口在休养后逐渐愈合，恢复了 ${recovery} .?HP。`;
      msg(`💊 伤口愈合: HP +${recovery} (当前: ${newHp}/${maxHp})`);
    } else {
      this.lastNarrative = "伤口没有得到专业处理，休养效果有限";
      msg("伤口没有得到专业处理，需要先接受急救");
    }
    return true;
  }

  // ── SAN 检查──
  private handleSanCheck(intent: ActionIntent, msg: (s: string) => number): boolean {
    const sanCost = intent.sanCost ?? "1/1d6";
    const reason = intent.reason ?? "未知恐惧";
    const result = this.sanity.sanityCheck(sanCost);
    const passed = result.passed;
    const loss = result.sanLoss;
    const roll = result.roll;
    msg(`🧠 SAN 检查(${reason}): d100=${roll} (目标=${this.sanity.state.currentSAN}) → ${sanOutcomeLabel(passed)}！SAN -${loss} (剩余: ${this.sanity.state.currentSAN})`);
    // 字段名是 temporaryInsanityTriggered；此前写成 temporaryInsanity，
    // 取值恒为 undefined，Web 路径的临时疯狂提示从未出现过。
    if (result.temporaryInsanityTriggered) {
      msg(`⚠️ 临时疯狂触发！${result.boutOfMadness ?? ""}`);
    }
    // 不定性疯狂原先**从不播报** —— 引擎算出来了、状态也置了，
    // 玩家却看不到自己已经跨过那条线。
    if (result.indefiniteInsanityTriggered) {
      msg(`⚠️ 不定性疯狂（${result.indefiniteLevel ?? ""}）——你已经不是进来时的那个人了。`);
    }
    this.lastNarrative = `SAN 检定结果: ${sanOutcomeLabel(passed)}, SAN -${loss}`;
    return true;
  }

  // ── 技能检查──
  /**
   * 会去解析场景线索的技能。潜行、说服等不属于调查，不该触发线索判定。
   *
   * investigation/perception 是通用兜底；其余键是 BARN_OF_PREMIER 32 条线索
   * findMethods 里实际用到的技能（侦查/取悦/社交/图书馆/信誉/精神分析/医学/
   * 急救/母语，译名见 SKILL_NAME_MAP），加上 luck/strength 两个属性代理
   * （幸运/力量——见 bridgeBarnOfPremierClues 的注释）。不在这个集合里的技能
   * 即使 ClueDef 已经注册好，也不会走到 investigateCoC，线索还是查不到。
   */
  private static readonly INVESTIGATIVE_SKILLS = new Set([
    "investigation", "perception",
    "spot_hidden", "charm", "fast_talk", "library_use", "credit_rating",
    "psychoanalysis", "medicine", "first_aid", "language_own",
    "luck", "strength",
  ]);

  /**
   * 取技能值。
   *
   * intent 用的是通用词汇（perception / investigation / persuasion），CoC 角色卡的键却是
   * CoC 技能名（spot_hidden / persuade）。两套词汇对不上时，即便角色卡上白纸黑字写着
   * spot_hidden: 75，查 perception 也是空，检定照旧落到兜底值——技能分配等于没有。
   */
  private resolveSkillValue(skill: string, skillDisplay: string): number {
    const values = this.activeCharacter?.skillValues;
    if (values) {
      const cocKey = COC_SKILL_ALIASES[skill] ?? SKILL_NAME_MAP[skillDisplay];
      const value = values[skill] ?? (cocKey ? values[cocKey] : undefined);
      if (typeof value === "number") return value;
    }
    // 角色卡上没有这项技能：未受训。CoC 的未受训基础值远低于 50，但这里是
    // 跨规则集的通用兜底，改动会波及 D&D 侧，留待技能表补全后再收。
    return this.activeCharacter?.skills?.[skill] ?? 50;
  }

  private handleSkillCheck(intent: ActionIntent, input: string, msg: (s: string) => number): boolean {
    const skill = intent.skill ?? "investigation";

    // 调查类检定优先交给 InvestigationEngine 解析场景线索。
    //
    // 此前这里只掷一个裸 d100 就结束：不看场景线索、不出揭示文本、不扣 SAN。
    // 模组导入时注册进去的线索因此永远不会被「调查」这个动作解析，
    // CoC 的核心循环（调查 → 线索 → 掉 SAN）实际不成立。
    // 规则本身早就写好并被 investigation-coc.test.ts 覆盖，缺的只是这一次调用。
    //
    // 场景没有未发现线索时回落到原来的裸检定，保持既有行为。
    if (GameSession.INVESTIGATIVE_SKILLS.has(skill)) {
      // 按场景 ID 查，不是显示名：线索是模组用 `scene: "premiers_barn"` 这样的
      // 场景 ID 注册进来的。（同文件另一处用 sceneDisplayNames[pos] 去查同一份
      // 数据，对模组场景恒查不到，见下方 getSceneClues 的调用点。）
      const pos = this.getDisplayedScene();
      // 只解析有完整定义的线索。模组通过 registerSceneClue 注册的线索只带一句
      // 描述，没有 ClueDef（技能、成功层级文本、san_cost 都没有），送进
      // investigateCoC 只会拿到「你没有找到有用的线索」这个兜底失败——
      // 比原来的裸检定更糟。这类线索继续走下面的通用检定。
      const candidates = this.investigation
        .getUndiscoveredSceneClues(pos, this.activePlayerId)
        .filter((c) => this.investigation.hasClueType(c));
      if (candidates.length > 0) {
        const decision = this.resolveSceneClueMatch(input, candidates);
        if (decision.kind === "resolve") return this.resolveSceneClue(decision.clueId, msg);
        if (decision.kind === "fallback") return this.resolveSceneClue(candidates[0]!, msg);
        if (decision.kind === "ask") {
          msg(`你想找什么？这里可能有：${decision.options.map((o) => `「${o}」`).join("、")}——说清楚一点。`);
          this.lastNarrative = "需要说清楚具体想搜哪里/什么";
          return true;
        }
        // kind === "deny"：玩家给了具体提示，但对不上场景里任何一条未发现
        // 线索——如实说找不到，不能不看输入直接给下一条线索。那正是本仓
        // 反复修的一类病：报告了一件玩家没做的事，比拒绝更糟。
        msg("你仔细找了找，这里没什么特别的。");
        this.lastNarrative = "这里没什么特别的";
        return true;
      }
    }

    const skillDisplay = SKILL_DISPLAY_NAMES[skill] ?? skill;
    const skillValue = this.resolveSkillValue(skill, skillDisplay);
    const roll = Math.floor(Math.random() * 100) + 1;
    const success = roll <= skillValue;
    const isCrit = roll <= skillValue * 0.05;
    const isFumble = roll > 95;
    const resultText = isFumble ? "大失败！" : isCrit ? "暴击成功" : success ? "成功" : "失败";

    // 记录技能标记（用于后续成长）—— 仅失败时标记（CoC 7e 规则：失败才成长）
    this.lastRolls.push({ skill, roll, target: skillValue, success });
    if (!success && this.skillGrowthMarks && !this.skillGrowthMarks.includes(skill)) {
      this.skillGrowthMarks.push(skill);
    }

    msg(`🎲 ${skillDisplay}检查 d100=${roll} (目标=${skillValue}%) → ${resultText}`);
    this.lastNarrative = `${skillDisplay}检查 ${resultText}。`;
    return true;
  }

  /**
   * 场景内一句"侦查XX"该解析成哪条线索。
   *
   * ⚠ 此前场景里不管有几条未发现线索，一律给**第一条**——玩家的话从没被
   * 读取过，「侦查卫生间」拿到休息区的手枪，「侦查餐厅」拿到卫生间的毒品。
   * 不是偏移一位，是输入从未被读取。
   *
   * 三种结果对应三种处理，别替玩家决定该找哪个：
   *   命中唯一 → 解析那一条
   *   命中多条 → 问清楚，不猜
   *   一条不中 → 如实说"没什么特别的"（不能不看输入直接给下一条——
   *              那会报告一件玩家没做的事，比拒绝更糟）
   *   没给提示（去掉动词后不剩什么）→ 回落旧行为：唯一/首条候选直接给。
   *   这不是"匹配失败"，是玩家压根没说要找什么，跟"目标不存在"是两回事。
   *
   * 决策本身（入口短路 + matchSceneClues 派发）在 decideClueMatch()
   * （clue-match.ts）——纯函数，diag-clue-phrasing.ts 的判据用例共用同一份，
   * 不再各自维护一份短路正则。这里只做两件本方法独有的事：① 按 matchTexts
   * 是否存在筛出真正能参与匹配的候选（YAML 手写/旧版 registerSceneClue
   * 合成的线索没有这份数据）；② 把 ask 的候选 id 翻成显示名给玩家看。
   */
  private resolveSceneClueMatch(
    input: string,
    candidates: string[],
  ): { kind: "resolve"; clueId: string } | { kind: "ask"; options: string[] } | { kind: "deny" } | { kind: "fallback" } {
    // 只有带 matchTexts 的线索参与按文本匹配——YAML 手写线索/
    // registerSceneClue 合成的旧线索没有这份数据，不是"匹配失败"，是这条
    // 线索压根没参与匹配这件事。全场景候选都没有 matchTexts 时整体回落。
    const matchable = candidates
      .map((id) => ({ id, info: this.investigation.getClueMatchInfo(id) }))
      .filter((c): c is { id: string; info: { matchTexts: string[]; displayName: string } } => c.info !== null);
    if (matchable.length === 0) return { kind: "fallback" };

    const decision = decideClueMatch(input, matchable.map((c) => ({ id: c.id, texts: c.info.matchTexts })));
    if (decision.kind === "ask") {
      const options = decision.clueIds.map((id) => matchable.find((c) => c.id === id)!.info.displayName);
      return { kind: "ask", options };
    }
    return decision;
  }

  /**
   * 解析一条场景线索：掷检定、给出揭示文本、扣掉它要求的 SAN。
   *
   * 判定规则全在 InvestigationEngine 里（含"已发现则不重复扣 SAN"与成功后
   * markDiscovered），这里只负责把结果落到会话状态上。
   *
   * SAN 经 setPlayerSan 扣减，因此和 KP 手动改 SAN 走同一个 applyAction 闸门，
   * 也同样会落到真相源。目标值恒在 [0, 当前值] 内，落在闸门的整数域中，
   * 不存在被拒绝的取值。
   *
   * 线索揭示只对发现者可见（discoverer_only）——发现者=做出这次检定的
   * pcId，与 investigateCoC 自己的 markDiscovered/isDiscoveredBy 口径一致
   * （同一个 this.activePlayerId）。不改 msg() 的调用方式（29 处调用方共用
   * 同一个签名，牵一发动全身，且已有直接调 resolveSceneClue 的测试按位置参数
   * 传 (clueType, msgFn)，改签名会破坏它们）：msg() 的返回值就是
   * messages.push(...) 的新长度，用它定位刚推入的那条消息，原地补上
   * visibility/discoverer——act() 期间 msg() 背后的数组与 this._turnMessages
   * 是同一个引用（见该字段的说明），直接调用（测试里那样，不经过 act()）时
   * this._turnMessages 为 null，补丁自然跳过，不影响任何既有测试。
   *
   * ⚠ 已知缺口：这只对**存储的历史**（GET /history）生效。live 的 WS 广播
   * （ws-handler.ts 的 broadcastToSession）不按玩家过滤，server.ts 把完整
   * narrative 广播给该 session 全部连接——线索私密目前只在"回看历史"这个
   * 维度成立，不是"实时全程保密"。这是 L6/L7b 的正题，本轮不碰。
   *
   * 检定失败时补一条骰子播报（🎲 …d100=…→失败），格式与通用检定路
   * （handleSkillCheck 的裸检定分支）一致——此前线索路 resolve/fallback/
   * ask/deny 四个分支全部提前 return，够不到通用路那句骰子播报，玩家看到
   * 的只有一句"没找到"，分不清是掷骰子输了还是这里压根没东西（实跑报告
   * 抄了两句不同措辞的失败文案，仍然判"不知道是场景无物还是检定失败"——
   * 单测断言"两个字符串不同"通过了，读者的疑问没通过，以读者为准）。
   * 骰子播报把"检定结果"这件事摆到明面上，不依赖玩家记住两句话哪句代表
   * 哪种含义。只在失败时加这一条——成功路径的输出一个字不变。
   *
   * 开发·线索闸门 任务3：前期（isEarlyGame()）检定失败时，把千篇一律的
   * "没能看出什么名堂"换成指向性降级信息（"XX 那边似乎还有东西"）——
   * 从这条线索自己的 findMethods 描述里抽位置名词（extractLocationHint），
   * 只给"往哪查"，不给"能查到什么"。抽不出干净的位置词（没有 matchTexts、
   * 或候选长度都不落在 2-6 字区间）时静默保留原始 revelation，不硬凑。
   * 非前期时这一段完全不执行，成功路径同样不受影响。
   *
   * 开发·线索闸门 任务4：failback 阶梯（N=2），只对 core 线索生效——与
   * 剧本杀路径 play/clue-check.ts 的同名机制对齐，此前自由跑团这条路
   * 完全没有（InvestigationEngine 只有 DifficultyProfile，是"两个运行时
   * 各持一半"的第三次，见 docs/todo.json todo-03）。失败计数进真相源
   * （WorldStateManager.incrementClueFail，见该方法注释），不在 GameSession
   * 再开一个内存 Map：
   *   failCount 0/1 → 正常检定（本方法原有的那条路，不变）
   *   failCount 2   → 灵感检定（智力）代替这条线索自己声明的技能
   *   failCount 3   → "无副作用重试"：技能与正常检定完全相同——
   *                   investigateCoC 本来就不烧运气、不传 pushed 时
   *                   CoCEngine 默认就是 false，机制上字面等同一次正常
   *                   检定，这里只是明确标注这次尝试的性质（叙述 + 断言
   *                   用），不是另开一套判定
   *   failCount >=4 → 直接给（overrideSkill.forceSuccess，见 investigateCoC
   *                   注释）：不再掷骰，roll 恒为 0
   * 时间照常推进——这四档全部走同一个 act() 回合，advanceTime 在 act()
   * 顶部统一处理，这里不做任何例外。
   */
  private resolveSceneClue(clueType: string, msg: (s: string) => number): boolean {
    const skills = this.activeCharacter?.skillValues ?? this.activeCharacter?.skills ?? {};
    const isCore = this.investigation.isCoreClue(clueType);
    const failCount = isCore ? this.world.getClueFailCount(clueType) : 0;

    let overrideSkill: { id: string; value: number; pushed?: boolean; forceSuccess?: boolean } | undefined;
    let ladderNote = "";
    if (isCore && failCount >= 4) {
      overrideSkill = { id: "grant", value: 0, forceSuccess: true };
      ladderNote = "（屡次尝试后，你们终于想通了关键——）\n";
    } else if (isCore && failCount === 3) {
      ladderNote = "（你们决定换个思路，再试一次——）\n";
    } else if (isCore && failCount === 2) {
      const ideaPc = this.activeCharacter ?? { attributes: {}, luck: 0, skillValues: {} };
      overrideSkill = { id: "idea", value: resolveCheckValue(ideaPc, "灵感") };
      ladderNote = "（反复搜寻无果，你们停下来仔细想了想——）\n";
    }

    const result = this.investigation.investigateCoC(clueType, skills, this.activePlayerId, overrideSkill);

    let diceLine = "";
    let revelation = result.revelation;
    if (!result.success) {
      if (isCore) this.world.incrementClueFail(clueType);
      const skillDisplay = SKILL_DISPLAY_NAMES[result.skillId] ?? result.skillId ?? "调查";
      diceLine = `🎲 ${skillDisplay}检定 d100=${result.roll} (目标=${result.skillValue}%) → 失败`;
      msg(diceLine);

      if (this.isEarlyGame()) {
        const info = this.investigation.getClueMatchInfo(clueType);
        const hint = info ? extractLocationHint(info.matchTexts.slice(1)) : null;
        if (hint) revelation = `你仔细搜查了一番，但这次没能看出什么名堂——不过${hint}那边似乎还有些什么，或许该再仔细找找。`;
      }
    } else if (isCore) {
      this.world.resetClueFails(clueType);
    }
    revelation = ladderNote + revelation;
    const newLength = msg(revelation);
    const idx = newLength - 1;
    if (this._turnMessages && this._turnMessages[idx]) {
      this._turnMessages[idx].visibility = "discoverer_only";
      this._turnMessages[idx].discoverer = this.activePlayerId;
    }
    // lastNarrative 是很多客户端唯一读的字段（不逐条看 events）——失败时把
    // 骰子播报也折进去，不能只靠 events 里的另一条消息才看得到"掷过骰子"。
    this.lastNarrative = diceLine ? `${diceLine}\n${revelation}` : revelation;

    if (result.sanLost > 0) this.inflictSanLoss(result.sanLost, msg);
    return true;
  }

  /**
   * 处理"和 XX 说话/交谈"。
   *
   * ⚠ 此前这里是纯桩：不管玩家说什么、跟谁说，永远回一句
   *   「你试图与周围的人交流…」——`MythosModuleLoader` 早就把模组 NPC
   *   的内联人格通过 `registerNPCPersonality` 注册进了 NPC Agent 系统
   *   （`this.registry`，见 registerModuleNPCPersonality 的注释），
   *   `/npc-chat` 端点（server.ts:470）也已经在消费它——只是这条从自由跑团
   *   进来的路从来没有接上同一个消费者。
   *
   *   不新造对话生成：直接复用 `/npc-chat` 的消费逻辑
   *   （`registry.findAgentByName` → `npcAgent.respond` → 记一条 dialogue
   *   消息，情绪在生成时刻固定）。
   *
   *   找不到人时分清楚三种情况（参照 notFoundLine() 的分辨方式，不用万金油）：
   *   没指定对象 / 这里没这个人 / 这个人在场但没有可用人格数据。
   */
  /**
   * 泛指整个队伍的说法，不是 NPC 专名——"陈岳起身准备动身出发，但先等待
   * 同伴确认具体要前往的地点"这类句子里，"同伴"指的是其他 PC，用它去
   * NPC 名单里找必然找不到，报"这里没有「同伴」"是把泛指词当成了专名。
   */
  private static readonly GENERIC_PARTY_WORDS = new Set(["同伴", "队友", "大家", "伙伴", "他们", "众人"]);

  private async handleTalk(
    intent: ActionIntent,
    input: string,
    messages: AgentMessage[],
    msg: (s: string) => number,
  ): Promise<boolean> {
    const pos = this.getDisplayedScene();
    const presentNpcEntities = this.world
      .getEntitiesInScene(pos)
      .filter((e) => e.type === "npc" || e.type === "monster");
    const presentNames = presentNpcEntities.map((e) => e.name);
    // .trim() 只剥空白，不剥标点——实跑「顺便问问附近店铺，有没有见过这人」
    // 一类输入，intent.target 抽出来的是「附近店铺，」，尾随的逗号原样进了
    // key，回显打出「这里没有「附近店铺，」」。剥掉首尾中英文标点，不动中间。
    const want = stripEdgePunctuation((intent.target ?? "").trim());

    if (!want) {
      msg(
        presentNames.length > 0
          ? `要跟谁说话？在场的有：${presentNames.join("、")}。`
          : "这里没有人可以交谈。",
      );
      this.lastNarrative = "要跟谁说话？";
      return true;
    }

    // 「同伴/队友/大家/伙伴/他们/众人」是泛指，不是专名——不该走下面的
    // NPC 专名查找然后报"这里没有「同伴」"。队伍成员是已知的（this.party），
    // 照上面空目标分支的思路给个符合处境的回应，不是专名查找失败。
    // ⚠ 只改这一类词的处理，不放宽下面 `.includes` 的模糊匹配——那条已经
    // 够松，再松会把"同伴"这类词也模糊配进某个真实 NPC 名里去。
    if (GameSession.GENERIC_PARTY_WORDS.has(want)) {
      const partyNames = [...this.party.values()]
        .map((m) => m.sheet?.name)
        .filter((n): n is string => typeof n === "string" && n.length > 0);
      msg(
        partyNames.length > 0
          ? `队伍里目前有：${partyNames.join("、")}。想问点什么，或者是想商量接下来怎么走？`
          : "现在只有你自己一个人，没有其他队友。",
      );
      this.lastNarrative = "确认队伍情况";
      return true;
    }

    const target = presentNpcEntities.find((e) => e.name === want)
      ?? presentNpcEntities.find((e) => e.name.includes(want) || want.includes(e.name));

    if (!target) {
      msg(
        presentNames.length > 0
          ? `这里没有「${want}」。在场的有：${presentNames.join("、")}。`
          : `这里没有「${want}」，这里也没有别人。`,
      );
      this.lastNarrative = `这里没有「${want}」`;
      return true;
    }

    const npcAgent = this.registry.findAgentByName(target.name);
    if (!npcAgent) {
      // NPC 在场、但没有注册人格（模组没写内联人格、也没能从 npcs.yaml 兜底）——
      // 明说缺的是什么，不要用一句放之四海而皆准的套话糊弄过去。
      msg(`${target.name}没有可用的人格数据，暂时无法对话。`);
      this.lastNarrative = `${target.name}没有可用的人格数据`;
      return true;
    }

    try {
      const history = this.getHistory(10);
      const reply = await npcAgent.respond(input, history.messages);
      const mood = npcAgent.getMood();
      messages.push({
        speaker: target.name,
        content: reply,
        type: "dialogue",
        ...(mood ? { mood } : {}),
      });
      this.lastNarrative = reply;
    } catch (e: any) {
      log.warn("session", `NPC 对话失败: ${target.name} — ${e?.message ?? e}`);
      msg(`${target.name}欲言又止，一时没能回应。`);
      this.lastNarrative = `${target.name}没有回应`;
    }
    return true;
  }

  /** 已经为之掷过目击 SAN 的生物种类。CoC 7e：同一种生物只在首次目击时掷。 */
  private readonly sightedMythos = new Set<string>();

  /**
   * 神话生物首次目击 → SAN 检定。
   *
   * ⚠ `NPCCombatEngine.getSanCost()` 在此之前**零调用方**。
   *   `coc-npc.yaml` 给每种生物都写了 `san_cost`（修格斯 `1d6/1d20`、
   *   深潜者 `0/1d6`、米戈 `0/1d6`…），一条都没生效过 ——
   *   遭遇修格斯和遭遇一条野狗，对理智的影响完全一样。
   *
   *   接线要定两件事，都按 CoC 7e：
   *     · **在哪触发**：目击即掷，不必等到战斗。所以放在 `act()` 顶端
   *       扫当前场景，而不是挂在攻击流程上 —— 看见就已经晚了。
   *     · **重复遭遇扣不扣**：不扣。同一种生物只在首次目击时掷
   *       （`sightedMythos` 按种类记，不按个体 —— 一群食尸鬼只掷一次）。
   */
  private checkMythosSighting(msg: (s: string) => void): void {
    if (this.activeRuleset !== "cosmic-horror") return;
    const state = this.world.getCurrentState();
    for (const ent of Object.values(state.entities)) {
      if (ent.type !== "monster" && ent.type !== "npc") continue;
      if ((ent.hp ?? 0) <= 0) continue;              // 尸体不掷目击
      if (ent.position && ent.position !== state.scene) continue; // 不在同一场景
      const cost = this.npcCombat.getSanCost(ent.name, this.activeRuleset);
      if (!cost) continue;                            // 不是神话生物
      if (this.sightedMythos.has(cost + ":" + ent.name)) continue;
      this.sightedMythos.add(cost + ":" + ent.name);
      const r = this.sanity.sanityCheck(cost);
      this.persistSanity(this.activePlayerId);
      msg(`🧠 目击【${ent.name}】：d100=${r.roll} → ${r.passed ? "通过" : "失败"}！SAN -${r.sanLoss}（剩余 ${this.sanity.state.currentSAN}）`);
      if (r.temporaryInsanityTriggered) msg(`⚠️ 临时疯狂触发！${r.boutOfMadness ?? ""}`);
      if (r.indefiniteInsanityTriggered) {
        msg(`⚠️ 不定性疯狂（${r.indefiniteLevel ?? ""}）——你已经不是进来时的那个人了。`);
      }
    }
  }

  /** 经济回合每 N 个玩家回合推进一次，太密会把纯对话/纯观察也变成经济事件洪流。 */
  private static readonly ECONOMY_TICK_INTERVAL = 10;

  /**
   * 政经引擎的时钟。`PoliticoEconomyEngine.advanceRound()` 本身早就是对的
   * 形状（四个子系统各自推进、汇总成 `EconomyEvent[]`），**缺的只是没人调它**
   * ——生产代码零调用方，世界装好了但不会自己往前走。
   *
   * ⚠ 时钟挂在哪、为什么：三个候选里选了「回合推进」，具体是这个类自己的
   *   `this.round`（`act()` 顶部 `this.round++`），不是 `world/state.ts` 那个
   *   同名不同物的 `WorldState.advanceRound()`（那个在 `play/scene-pipeline.ts`
   *   里，服务的是完全不同的一条入口——剧本杀，不是这个类所在的网页/API 路）。
   *
   *   - **选它的理由**：`this.round` 已经在驱动其它周期性子系统
   *     （`tickStatusEffects()`、`companionManager.newRound()`、
   *     `advanceTime()`），确定性、每回合必然触发一次，不需要新造一个触发器；
   *     经济时钟接进同一个位置是复用既有模式，不是另开一条平行的路。
   *     驱动它的是 `act()` 的调度本身，不是 LLM——LLM 就算参与了意图解析，
   *     那一步在这之前已经跑完了。
   *   - **否掉「场景切换」**：太不规律。一场战斗、一串对话、一次纯调查
   *     可能整场都不换场景，经济会停摆；反过来场景来回跳又会短时间内
   *     连续触发。世界演化的节奏不该被玩家在场景图上走了几步决定。
   *   - **否掉「显式 KP 动作」**：需要人记得去点，大多数会话里根本不会有人
   *     触发，「会自己演化的世界」这句设计初衷就落空了——那是被动挂件，
   *     不是时钟。
   *
   *   节流到每 `ECONOMY_TICK_INTERVAL` 回合一次：势力/市场/政策这层模拟的
   *   时间尺度是天/周级别，每个玩家动作都推进会把没有剧情实质进展的纯
   *   对话/观察也算成经济时间，事件噪音与格局漂移速度都会不像话。
   */
  private tickEconomy(msg: (s: string) => void): void {
    if (this.round % GameSession.ECONOMY_TICK_INTERVAL !== 0) return;

    // 经济回合号本身先过闸门——「派生事件必须经规则执行器结算」落在
    // "要不要推进这一次"这一层：单调递增的整数域，正常情况下闸门总会
    // 批准，但让经济时钟和 HP/SAN/难度用同一套结算纪律（同一个 applyAction
    // 入口、同一种 Result<StateDelta, RejectReason> 形状），而不是自己
    // 另开一条直写的口子——这正是 apply-action.ts 头注释说的「未过闸门的
    // 域比没有域更糟：它看起来在校验」反过来的那一半：**能过闸门的域，
    // 就不该绕过闸门直写**。
    const variable = "economy:round";
    const currentRound = this.politicoEconomy.round;
    const nextRound = currentRound + 1;
    const gateResult = applyAction(
      boundedIntegerScenario(variable, currentRound, Number.MAX_SAFE_INTEGER),
      boundedIntegerGateState(variable, currentRound),
      {
        kind: "freeform",
        actor: "system",
        description: "advance economy round",
        effects: [{ variable, to: nextRound }],
      },
    );
    if (!gateResult.ok) return; // 结构上不该发生（单调整数域），闸门说不行就不推进

    // causationId 绑定「这一次 GameSession 回合」，不是「这一次经济回合」——
    // 与 this.round 一一对应，天然防止同一个玩家回合被重复推进两次经济时钟
    // （例如某处误把 tickEconomy 调用了两遍）：第二次传同一个 causationId，
    // `advanceRound()` 直接返回空数组，不产生第二批事件。
    const causationId = `eco:${this.id}:round:${this.round}`;
    const events = this.politicoEconomy.advanceRound(causationId);

    // 只读已提交状态、只写具名方法——不碰 getCurrentState() 的返回值，
    // 那是新对象，赋值会静默丢弃（kp-tool-surface-assessment.md §八 记录过
    // 两次这类事故）。这里全程只调用 world.logEvent()，不做任何赋值。
    for (const e of events) {
      this.world.logEvent({
        round: this.round,
        timestamp: Date.now(),
        event_type: "system",
        description: `[经济] ${e.description}`,
      });
    }
    // 叙述：只把已结算的事件原文报出来，不经过 LLM——这里没有生成、
    // 没有裁决，纯粹是把 EconomyEvent.description（子系统算好的确定性文本）
    // 转成一条系统消息。LLM 要参与只能是"把这些事件写得更好看"，不能是
    // "决定发生了什么"——本轮没有接那一层，就没有这个风险。
    if (events.length > 0) {
      msg(`🌍 世界继续运转（经济回合第 ${this.politicoEconomy.round} 轮）：${events.length} 件大事发生了。`);
    }
  }

  /**
   * 施加一次**剧情造成的** SAN 损失：扣血 + 疯狂判定 + 播报。
   *
   * ⚠ 原先这里走的是 `setPlayerSan(pid, current - sanLost)`。
   *   那是 KP 的管理操作 —— 设一个绝对值，**不跑疯狂判定**（合理：
   *   KP 在改数字，不是角色见了恐怖）。于是调查线索掉的 SAN
   *   永远不会让人发疯。
   *
   *   而临时疯狂（单次 ≥5）在这条路上是**够得着**的：
   *   `investigation.yaml` 的 `1/1d6` 失败时有 1/3 概率掷出 5 或 6。
   *   疯狂是 CoC 最标志性的机制，却从调查里一次都没触发过。
   *
   *   现在走 `applyLoss()`，和玩家主动 SAN 检定同一套判定。
   */
  private inflictSanLoss(amount: number, msg: (s: string) => number): void {
    const r = this.sanity.applyLoss(amount);
    this.persistSanity(this.activePlayerId);
    if (r.temporaryInsanityTriggered) {
      msg(`⚠️ 临时疯狂触发！${r.boutOfMadness ?? ""}`);
    }
    if (r.indefiniteInsanityTriggered) {
      msg(`⚠️ 不定性疯狂（${r.indefiniteLevel ?? ""}）——你已经不是进来时的那个人了。`);
    }
  }

  // ── 豁免检查──
  private handleSavingThrow(intent: ActionIntent, msg: (s: string) => number): boolean {
    const ability = intent.ability ?? "constitution";
    const dc = intent.dc ?? 12;
    const reason = intent.reason ?? "豁免检查";
    const abilityMod = this.activeCharacter?.attributes?.[ability] ? Math.floor(((this.activeCharacter!.attributes[ability] ?? 10) - 10) / 2) : 0;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + abilityMod;
    const success = total >= dc;
    const abilityNames: Record<string, string> = { strength: "力量", dexterity: "敏捷", constitution: "体质", intelligence: "智力", wisdom: "感知", charisma: "魅力" };
    msg(`🎲 ${abilityNames[ability] ?? ability}豁免 (${reason}): d20=${roll}+${abilityMod}=${total} (DC=${dc}) → ${success ? "通过" : "失败"}`);
    this.lastNarrative = `豁免检查 ${success ? "成功通过" : "失败"}。`;
    return true;
  }

  // ── 攻击 ──
  /**
   * 一次攻击命中之后的结算：扣血 → 重伤判定 → 挂状态 → 写回世界。
   *
   * ⚠ 抽出来是因为**本来有两份**，而功能全的那份跑不到。
   *
   *   `act()` 里有一段带 `checkMajorWound` 的战斗结算（重伤、部位、
   *   流血、昏迷都有），但意图派发在它**前面** —— `handleAttack` 一旦
   *   认出「攻击」就 `return true`，`act()` 直接返回，那一段永远到不了。
   *   而 `handleAttack` 自己只会扣血。
   *
   *   后果：**重伤/流血/昏迷在真实对局里一次都没生效过**。
   *   我上一轮按 CoC 口径修的流血条件（只在打昏时才流血），
   *   改的正是那段跑不到的代码 —— 等于没改。
   *
   *   这类「写了没接上」这轮已经是第三处了（前两处是致残描写、
   *   载具类型），所以这次不是把逻辑再抄一遍，而是**只留一份**。
   */
  private resolveHit(
    target: WorldEntity,
    dmg: number,
    msg: (s: string) => number,
  ): void {
    target.hp = Math.max(0, target.hp - dmg);
    const mw = checkMajorWound(dmg, target.maxHp ?? 10, target.hp);
    if (mw.isMajorWound) {
      target.status = target.status || [];
      target.status.push("重伤:" + mw.location);
      // 带时限的状态，由 `tickStatusEffects()` 每回合推进。
      // 跟着 `checkMajorWound` 走：CoC 7e 里重伤只掷 CON，
      // 持续掉血属于濒死，所以只在这一击把人打昏时才流血。
      if (mw.bleeding) target.status.push(newStatus("bleeding"));
      if (mw.unconscious) target.status.push(newStatus("stunned"));
      msg("💀 " + mw.description);
    }
    this.world.upsertEntity(target);
  }

  /**
   * 攻击要打**指定的**目标。
   *
   * ⚠ 原先这里是 `enemies[Math.floor(Math.random() * enemies.length)]` ——
   *   完全无视 `intent.target`。场上两个敌人时，「攻击哥布林」有一半概率
   *   砍在另一个身上，而播报还写着你打的是哥布林。
   */
  private pickTarget(intent: ActionIntent, enemies: WorldEntity[]): WorldEntity | undefined {
    if (enemies.length === 0) return undefined;
    const want = intent.target?.trim();
    if (want) {
      const hit = enemies.find((e) => e.id === want || e.name === want)
        ?? enemies.find((e) => e.name.includes(want) || want.includes(e.name));
      if (hit) return hit;
    }
    return enemies[0];
  }

  /**
   * 敌人还手。
   *
   * ⚠ 接这个之前，**这条路上的战斗是单向的**：实测打十回合，
   *   玩家 9/9 一滴血没掉，怪物只挨打。
   *   也就是说这一轮修好的重伤判定、流血、致残描写，**全都只对怪物生效** ——
   *   玩家永远不会受伤，战斗没有风险。
   *
   *   CLI 那边一直有 `resolveNPCAction()`（index.ts:750），走的是共用的
   *   律书 `rules.adjudicateAttack`。这里不另写一份判定，调同一个入口 ——
   *   这个仓库反复在修的病就是「两份实现各自漂移」。
   *
   *   技能推定沿用 CLI 的口径（有武器 40%、徒手 30%）。这两个数字原先
   *   只写在 index.ts 里，现在两处都要用，所以提成常量放在这里，
   *   并在 CLI 侧注明出处，免得哪天一边改了另一边不知道。
   */
  /**
   * 当前场景里还活着的敌人。战斗旗、还手、退出战斗、自由行动战斗判定
   * 四处共用一份判断。
   *
   * ⚠ 此前不按场景过滤，只看 hp>0——玩家换了场景，上一个场景的敌人还会
   *   继续应战/被选为攻击目标。实跑症状：人已经在「加比的拖车房」，还在
   *   连续播报「酒吧保镖 向你扑来」。
   *
   *   场景归属的权威字段是 `scene_id`（见 types.ts 对 WorldEntity.position
   *   的注释：position 语义不唯一，同伴系统会往里写战斗距离而不是场景），
   *   但历史数据和部分测试夹具的实体只设置了 `position`、没设置
   *   `scene_id`。`scene_id ?? position` 兜底，不让这批老数据整批从
   *   "当前敌人"里消失——两个字段在正常写入路径下取值一致
   *   （mythos-module.ts 的 NPC/生物放置两个字段一起写）。
   *
   *   `pos === "unknown"` 时不过滤：没加载模组、没显式切过场景的会话，
   *   `getDisplayedScene()` 恒为 "unknown"（`scenes` 表里没有 `is_active=1`
   *   的行），而大量既有测试夹具把敌人放在约定俗成的占位场景名（如
   *   "tavern"）却从没真的注册/激活那个场景——如果这里强制按场景比对，
   *   这批实体会在"场景系统压根没启动"的情况下被误判成"不在当前场景"，
   *   整批从敌人名单里消失。场景系统真正在用（模组加载、显式移动过）时，
   *   `pos` 不会是 "unknown"，过滤照常生效。
   */
  private aliveEnemies(): WorldEntity[] {
    const state = this.world.getCurrentState();
    const pos = this.getDisplayedScene();
    return Object.values(state.entities).filter((e) => {
      if (!((e.type === "monster" || e.type === "npc") && (e.hp ?? 0) > 0)) return false;
      if (pos === "unknown") return true;
      return (e.scene_id ?? e.position) === pos;
    });
  }

  private async npcCounterAttack(intent: ActionIntent, msg: (s: string) => number): Promise<void> {
    if (!this.combatActive) return;
    const state = this.world.getCurrentState();
    const enemies = this.aliveEnemies();
    if (enemies.length === 0) return;
    const attacker = this.pickTarget(intent, enemies); // 谁被打就谁还手
    if (!attacker) return;

    const player = state.entities[this.activePlayerId];
    if (!player || player.hp <= 0) return;            // 已经倒下的人不再挨打

    const result = this.rules.adjudicateAttack(
      { action: "attack", target: player.id },
      {
        name: attacker.name, id: attacker.id, proficiency: 2,
        abilities: { strength: 14, dexterity: 12, constitution: 14, intelligence: 8, wisdom: 10, charisma: 6 },
        hasSneakAttack: false,
      },
      player,
      this.activeRuleset,
      false, false, undefined,
      NPC_UNARMED_SKILL,                               // 徒手 30%
      Math.floor((this.activeCharacter?.attributes?.dexterity ?? 50) / 2), // 闪避 = DEX/2
    );

    // 武器写死"拳头"：下面这次 adjudicateAttack 传的是 NPC_UNARMED_SKILL，
    // 判定口径本身就是徒手，叙述不该暗示对方拿着武器。
    if (!result.hit) {
      const narrative = await generateNarrative(
        attacker.name, "你", "拳头",
        { hit: false, damage: 0, result: "miss" },
        player.maxHp,
      );
      msg(`${attacker.name} 向你扑来，被你躲开了。📖 ${narrative}`);
      return;
    }
    // result 恒为 "wound"：CoC 里 HP 归零是昏迷/濒死，不是死亡（还能被急救
    // 拉回来），LETHAL 文案池写的是"倒下"场景，不该用在这里让玩家误以为角色死了。
    const narrative = await generateNarrative(
      attacker.name, "你", "拳头",
      { hit: true, crit: false, damage: result.damage, result: "wound" },
      player.maxHp,
    );
    msg(`📖 ${narrative}`);
    this.resolveHit(player, result.damage, msg);       // 玩家也吃重伤/流血/致残
    if (this.activeCharacter) this.activeCharacter.hp = player.hp;
    msg(`${attacker.name} 击中了你，造成 ${result.damage} 点伤害（你剩余 ${player.hp}/${player.maxHp}）`);
    if (player.hp <= 0) {
      this.dead = true;
      msg("你倒下了。");
    }
  }

  private async handleAttack(intent: ActionIntent, msg: (s: string) => number): Promise<boolean> {
    const skill = 50;
    let effectiveRoll = Math.floor(Math.random() * 100) + 1;
    let luckSpendMsg = "";

    // 燃运处理
    if (intent.luckSpend !== undefined && intent.luckSpend > 0) {
      const luckSpend = intent.luckSpend;
      if (this.activeCharacter && this.activeCharacter.luck !== undefined) {
        if (luckSpend > this.activeCharacter.luck) {
          msg(`💫 幸运不足！当前幸运: ${this.activeCharacter.luck}，尝试消耗: ${luckSpend}`);
          return true;
        }
        this.activeCharacter.luck -= luckSpend;
        effectiveRoll = Math.max(1, effectiveRoll - luckSpend);
        luckSpendMsg = ` (燃运${luckSpend})`;
        msg(`💫 消耗 ${luckSpend} 点幸运！当前: ${this.activeCharacter.luck}`);
      }
    }

    const success = effectiveRoll <= skill;
    const isCrit = effectiveRoll <= skill * 0.05;
    const isFumble = effectiveRoll > 95;
    const dmg = success ? (isCrit ? Math.floor(Math.random() * 12) + 6 : Math.floor(Math.random() * 6) + 1) : 0;
    const hitMsg = isFumble ? "大失败！" : isCrit ? "暴击" : success ? "命中" : "未命";

    msg(`⚔️ 攻击检查d100=${effectiveRoll} (目标=${skill}%)${luckSpendMsg} → ${hitMsg}${dmg > 0 ? `，造成 ${dmg} 点伤害` : ""}`);
    // 复用 aliveEnemies()（场景内、hp>0）而不是自己单开一份不按场景过滤的
    // filter——否则玩家在拖车房，"攻击"命令还能打中酒吧那边的保镖。
    const enemies = this.aliveEnemies();
    const target = this.pickTarget(intent, enemies);
    if (target) {
      const weapon = intent.weapon || "拳头";
      if (dmg > 0) {
        const narrative = await generateNarrative(
          "你", target.name, weapon,
          { hit: true, crit: isCrit, damage: dmg, result: target.hp - dmg <= 0 ? "kill" : "wound" },
          target.maxHp,
        );
        msg(`📖 ${narrative}`);
        this.resolveHit(target, dmg, msg);
        msg(`${target.name} 剩余 HP: ${target.hp}/${target.maxHp}`);
      } else {
        const narrative = await generateNarrative(
          "你", target.name, weapon,
          { hit: false, damage: 0, result: "miss" },
          target.maxHp,
          { fumble: isFumble },
        );
        msg(`📖 ${narrative}`);
      }
    }
    // ⚠ `combatActive = true` 原先**只写在 `act()` 里那段被遮死的代码**（L1199），
    //   而意图派发抢在它前面 return —— 于是这面旗在真实路径上**永远是 false**。
    //   看得见的症状：`getSuggestions()` 打起来了还在提示「调查四周 / 与 NPC 交流」。
    this.combatActive = this.aliveEnemies().length > 0;
    await this.npcCounterAttack(intent, msg);
    // 打完最后一个敌人就退出战斗，否则这面旗立起来就再也放不下
    if (this.aliveEnemies().length === 0) this.combatActive = false;
    this.lastDiceRoll = { expr: `d100${luckSpendMsg}`, total: effectiveRoll };
    this.lastNarrative = `你向敌人发起了攻击！${hitMsg}`;
    return true;
  }

  // ── 创建角色 ──
  private handleCreateCharacter(input: string, msg: (s: string) => number): boolean {
    // 解析 "创建角色 [archetype] [name]"
    const parts = input.replace(/^创建角色\s*/, "").trim().split(/\s+/);
    if (parts.length === 0 || parts[0] === "") {
      msg("请指定职业和姓名。用法：创建角色 <职业ID> <姓名>\n可用职业请查看「职业列表」");
      this.lastNarrative = "请指定职业";
      return true;
    }
    const archetypeId = parts[0];
    const charName = parts.slice(1).join(" ") || "调查员";
    try {
      const ch = buildCharacterForRuleset(charName, archetypeId, this.activeRuleset);
      // "创建角色"没有指定要建哪个 pcId——语义是"重建**当前活跃**的 PC"，
      // 不是"总是重建 p1"。activePlayerId 默认就是 "p1"，单人局行为不变；
      // 多人局里如果切换到了 p2 再执行这条命令，重建的是 p2，不会误伤 p1。
      // 走统一入口：八件事一次做齐，包含此前这里完全没做的
      // SanityEngine 重建——这正是本轮要修的活 bug（新角色沿用旧角色的
      // maxSAN，因为这里从没调用过 sanityEngines.set）。
      const result = this.createPartyMember(this.activePlayerId, ch);
      if ("rejected" in result) {
        // 只有硬上限（10 人）才会走到这里；"重建现有 pcId" 不受人数检查
        // 影响（createPartyMember 内部对已存在的 pcId 直接放行），所以这
        // 分支理论上不会在"创建角色"命令上触发，防御性处理，不静默吞掉。
        msg(`创建失败：${result.rejected}`);
        this.lastNarrative = "角色创建失败";
        return true;
      }
      this.activeCharacter = result.member.sheet;
      this.sanity = result.member.san;
      // 扮演元数据：只有 p1 可能带着建会话时的 HTTP persona（见 p1Persona
      // 字段注释）；其余 PC（多人局切到 p2 再"创建角色"重建）没有这层，
      // 直接落 backgroundProfile 推导。走同一个 resolveMeta，不因为这里是
      // 文本命令就另起一份内联调用（构造函数/addPartyMember 同理）。
      result.member.meta = this.resolveMeta(
        this.activePlayerId === "p1" ? this.p1Persona : undefined,
        result.member.sheet,
      );
      if (result.warning) msg(`⚠️ ${result.warning}`);
      msg(`角色创建完成！${charName}（${archetypeId}）已就绪。HP:${ch.hp}, SAN:${this.sanity.state.currentSAN}`);
      this.lastNarrative = `角色创建完成: ${charName}。`;
    } catch (e) {
      msg(`创建失败: ${(e as Error).message}。请检查职业名称是否正确。`);
      this.lastNarrative = "角色创建失败";
    }
    return true;
  }

  // ── 职业列表 ──
  private handleListOccupations(msg: (s: string) => number): boolean {
    if (this.activeRuleset !== "cosmic-horror") {
      msg("当前不是宇宙恐怖模式");
      this.lastNarrative = "当前不是宇宙恐怖模式";
      return true;
    }
    try {
      const archetypes = CharacterFactory.listArchetypes(this.activeRuleset);
      const occupations = archetypes.filter(a => !a.isPrestige).slice(0, 20);
      const lines = ["【调查员职业列表", ""];
      for (const a of occupations) {
        lines.push(`  ${a.id.padEnd(20)} — ${a.label ?? a.id}`);
      }
      const text = lines.join("\n");
      msg(text);
      this.lastNarrative = text;
    } catch {
      msg("职业列表: 考古学家, 医生, 记者, 侦探, 教授, 士兵, 艺术家, 流浪者, 工程师, 律师, 警察, 牧师");
      this.lastNarrative = "调查员职业: 考古学家, 医生, 记者, 侦探...";
    }
    return true;
  }

  // ── 购买 ──
  private handleBuy(intent: ActionIntent, msg: (s: string) => number): boolean {
    const item = intent.item;
    if (!item || item.trim() === "") {
      msg("你想买什么？请指定物品名称");
      this.lastNarrative = "你想买什么？";
    } else {
      // 「当前商店可能没有此物品」把「没做商店」说成了「这家店碰巧没货」，
      // 玩家会去别处找一家 —— 而哪儿都没有。直说。
      msg(`这里没有可以交易的地方。（商店尚未实现）`);
      this.lastNarrative = `附近没有能买到「${item}」的地方。`;
    }
    return true;
  }

  // ── 出售 ──
  /**
   * ⚠ 原先这里**从不查背包**，一律回「你的背包中没有「X」」——
   *   哪怕你正拿着它。而 `world.getPlayerInventory()` 就在手边，
   *   `handleInventory` 用的就是它。
   *
   *   「没做商店」和「骗玩家说他没有这东西」是两回事：
   *   前者玩家能理解，后者会让他以为自己记错了、或者以为背包丢了东西。
   *   没有商店就直说没有商店。
   */
  private handleSell(intent: ActionIntent, msg: (s: string) => number): boolean {
    const item = intent.item?.trim();
    if (!item) {
      msg("你想卖什么？请指定物品名称");
      this.lastNarrative = "你想卖什么？";
      return true;
    }
    const inv = this.world.getPlayerInventory(this.activePlayerId);
    const idx = inv.findIndex((i) => i === item || i.includes(item));
    if (idx < 0) {
      msg(`你的背包中没有「${item}」。当前背包：${inv.length ? inv.join("、") : "空"}`);
      this.lastNarrative = `没有「${item}」可出售。`;
      return true;
    }
    // 东西确实在背包里。这里**还没有商店**（没有商人、没有价格、没有钱袋），
    // 所以不能假装卖掉 —— 但也绝不能说「你没有」。
    msg(`你有「${inv[idx]}」，但这里没有人收货。`);
    this.lastNarrative = `附近没有能出售「${item}」的地方。`;
    return true;
  }

  // ── 传承 ──
  private handleLegacy(input: string, msg: (s: string) => number): boolean {
    if (input.includes("保存角色")) {
      if (!this.activeCharacter) {
        msg("没有活跃角色可保存");
        this.lastNarrative = "没有活跃角色";
        return true;
      }
      if (!this.careerStore) {
        const careerDir = `data/careers/${this.id}`;
        try { rmSync(careerDir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
        this.careerStore = new CareerFileStore(careerDir);
      }
      const c = this.activeCharacter;
      this.careerStore.saveSnapshot({
        characterName: c.name, occupation: c.archetype?.label ?? c.archetype ?? "调查员",
        attributes: { ...(c.attributes ?? {}) },
        skills: c.skillValues ? { ...c.skillValues } : {},
        san: this.sanity.state.currentSAN, maxSan: this.sanity.state.maxSAN,
        cthulhuMythos: 0, hp: c.hp, maxHp: c.maxHp,
        creditRating: c.creditRating ?? 30,
        createdAt: new Date().toISOString(),
      });
      msg(`角色「${c.name}」已保存。`);
      this.lastNarrative = `角色「${c.name}」已保存。`;
      return true;
    }
    if (input.includes("传承列表") || input.includes("读档")) {
      if (!this.careerStore) {
        const dir = `data/careers/${this.id}`;
        try { rmSync(dir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
        this.careerStore = new CareerFileStore(dir);
      }
      if (input.includes("读档")) {
        const charName = input.replace(/^读档\s*/, "").trim();
        if (!charName) {
          msg("请指定要加载的角色名");
          this.lastNarrative = "请指定角色名";
          return true;
        }
        const snap = this.careerStore.getSnapshot(charName);
        if (!snap) {
          msg(`未找到角色「${charName}」。`);
          this.lastNarrative = `未找到角色「${charName}」。`;
          return true;
        }
        msg(`角色「${charName}」已加载。(HP:${snap.hp}, SAN:${snap.san})`);
        this.lastNarrative = `角色「${charName}」已加载。`;
        return true;
      }
      const chars = this.careerStore.listCharacters();
      if (chars.length === 0) {
        msg("暂无已保存的角色");
        this.lastNarrative = "暂无已保存的角色";
      } else {
        msg("已保存的角色: " + chars.join(", "));
        this.lastNarrative = `已保存的角色: ${chars.join(", ")}。`;
      }
      return true;
    }
    // 默认传承说明
    const helpText = [
      "【传承系统",
      "跨模组角色成长追踪系统",
      "",
      "命令:",
      "  保存角色 — 保存当前角色快照",
      "  传承列表 — 查看已保存的角色",
      "  读档 <角色名> — 加载已保存的角色",
    ].join("\n");
    msg(helpText);
    this.lastNarrative = helpText;
    return true;
  }

  // ── 生成故事 ──
  private handleGenerateStory(msg: (s: string) => number): boolean {
    const story = this.storyGenerator.generate();
    // 清空旧场景数"
    this.sceneDisplayNames = {};
    this.sceneAliases = {};

    // 更新场景
    for (const scene of story.scenes) {
      this.sceneDisplayNames[scene.id] = scene.name;
      this.sceneAliases[scene.id] = [scene.name];
      // 必须落到 scenes 表：setActiveScene() 是 UPDATE，行不存在就静默失配。
      this.world.registerScene(scene.id, scene.name, scene.description);
      // 连通关系也要落库。StoryGenerator 把它整套算好了——SceneTemplate.exits
      // 声明哪些场景相连，生成时展开成 {target, desc, locked}，末尾还兜底保证
      // 每个场景至少一个出口——但 registerScene() 没有 exits 参数，此前这份
      // 数据在落库那一刻被整体丢弃，scenes.exits 一直停在 schema 默认的 '[]'。
      //
      // locked 不落库：目前没有任何消费方，存一个没人读的字段只是另一种死数据。
      // 真要做上锁的门时再连同它的消费方一起加。
      this.world.setSceneExits(scene.id, scene.exits);
    }
    // 从 displayNames 和 aliases 合并场景名
    for (const [id, name] of Object.entries(story.displayNames ?? {})) {
      this.sceneDisplayNames[id] = name;
    }
    for (const [id, alias] of Object.entries(story.aliases ?? {})) {
      this.sceneAliases[id] = [alias];
    }

    // 更新实体
    for (const entity of story.entities ?? []) {
      this.world.upsertEntity(entity as any);
    }

    // 设置当前场景为第一个场"
    if (story.scenes.length > 0) {
      // 上面的循环刚 registerScene 过全部场景，这里统一经 setScene() 收口，
      // 保持「场景激活只有一条写入路径」这个不变量可被 grep 验证。
      //
      // 返回值必须看：激活失败时 `setActiveScene` 会让世界**没有任何活动场景**，
      // 而这里是新故事的入口 —— 静默失败等于开局就没有当前场景，
      // 后面每一次「你在哪」都会答错，却没有任何一处会报错。
      if (!this.setScene(story.scenes[0].id)) {
        msg(`⚠ 新故事的首个场景「${story.scenes[0].name}」没能激活，当前场景可能为空。`);
      }
    }

    const sceneNames = story.scenes.map(s => s.name).join(", ");
    this.lastNarrative = `新故事已生成: ${story.title}。\n场景: ${sceneNames}`;
    msg(`📖 新故事已生成: ${story.title}\n场景: ${sceneNames}\n${story.hook ?? ""}`);
    return true;
  }

  // ── 加载模组 ──
  private handleLoadModule(input: string, msg: (s: string) => number): boolean {
    const moduleName = input.replace(/^(?:加载|装载|载入|启用|使用)\s*(?:模组|剧本|模块)\s*/, "").trim();

    if (!this._moduleLoader) {
      const worldAdapter: MythosModuleHost["world"] = {
        upsertEntity: (entity) => this.world.upsertEntity(entity),
        // 模组要靠它连接场景出口；不转发的话出口构建会整段失败。
        getDatabase: () => this.world.getDatabase(),
      };
      const host: MythosModuleHost = {
        mythosSpells: this.mythosSpells,
        knownMythosSpells: this.knownMythosSpells,
        sceneItems: this.sceneItems,
        itemDescriptions: new Map<string, string>(),
        world: worldAdapter,
        // 优先投进本回合：回合出口会统一把 turnMessages 写入历史，
        // 这里再直接写一次历史就会重复。不在回合内时（理论上不会发生）
        // 退回直接写历史，至少不丢消息。
        addMessage: (speaker, content, type, opts) => {
          const turn = this._turnMessages;
          if (!turn) { this.addMessage(speaker, content, type, opts); return; }
          turn.push({
            speaker, content, type,
            ...(opts?.verbatim ? { verbatim: true as const } : {}),
            ...(opts?.mood ? { mood: opts.mood } : {}),
          });
        },
        activeRuleset: this.activeRuleset,
        currentRound: this.round,
        // 读取模块：将模组原文场景描写写入 scenes 表（保留原文，供 KP 上下文注入）
        registerScene: (sceneId: string, displayName: string, description?: string) => {
          this.world.registerScene(sceneId, displayName, description);
        },
        // 读取模块：将模组线索注册进调查引擎（供场景线索注入）
      registerSceneClue: (sceneName: string, clueType: string, description?: string, sanCost?: string) => {
        this.investigation.registerSceneClue(sceneName, clueType, description, sanCost);
      },
        // 读取模块：将模组 NPC 内联人格注册进 NPC Agent 系统（供 /npc-chat 对话）
        registerNPCPersonality: (npcName: string, personality: any, npcPersonalityId?: string) => {
          this.registerModuleNPCPersonality(npcName, personality, npcPersonalityId);
        },
      };
      this._moduleLoader = new MythosModuleLoader(host);
    }

    // 优先从自定义模组库查"
    let mod: any = null;
    if (moduleName) {
      const customMod = getCustomModule("premiers_barn");
      if (customMod && (customMod.name === moduleName || customMod.module.name === moduleName || moduleName.includes("谷仓"))) {
        mod = customMod.module;
      }
    }
    // 回退到内置模"
    if (!mod && moduleName) {
      const builtinModules: Record<string, any> = {
        "普瑞米尔的谷仓": PREMIERS_BARN_MODULE,
        "阿卡姆档案检查": ARKHAM_LIBRARY_MODULE,
        "印斯茅斯的阴影": INNSMOUTH_MODULE,
      };
      mod = builtinModules[moduleName];
    }
    // 列出所有可用模"
    const allModules: Record<string, any> = {
"普瑞米尔的谷仓": moduleName?.includes("谷仓") ? mod : PREMIERS_BARN_MODULE,
        "阿卡姆档案检查": ARKHAM_LIBRARY_MODULE,
        "印斯茅斯的阴影": INNSMOUTH_MODULE,
    };
    if (!mod && moduleName) {
      const available = Object.keys(allModules).join(", ");
      msg(`未找到模组「${moduleName}」。可用模组: ${available}`);
      this.lastNarrative = `未找到模组「${moduleName}」。`;
      return true;
    }
    if (!mod) {
      const available = Object.keys(allModules).join(", ");
      msg(`可用模组: ${available}`);
      this.lastNarrative = `可用模组: ${available}`;
      return true;
    }

    try {
      if (!this._moduleLoader) {
        throw new Error("Module loader not initialized");
      }
      const loader = this._moduleLoader;
      const loaded = this._loadedModules;
      if (loaded.has(mod.id)) {
        msg(`模组「${mod.name}」已导入。`);
        this.lastNarrative = `模组「${mod.name}」已导入。`;
        return true;
      }
      const lines = loader.import(mod);
      loaded.set(mod.id, true);
      this.registeredModules.push(mod);
      // premiers_barn.ts 自带的 10 条线索有 2 条 scene 字段填的是 NPC 名，
      // 且合成的 ClueDef 没有技能/难度梯度——见 bridgeBarnOfPremierClues 注释。
      if (mod.id === "premiers_barn") this.bridgeBarnOfPremierClues();
      if (mod.sceneBgm) Object.assign(this.sceneBgm, mod.sceneBgm);
      // 填充模组场景显示名/别名（scenes 表已由 registerScene 写入，含模组原文描写）
      try {
        for (const r of this.world.listScenes()) {
          if (!r.name || r.name === "unknown") continue;
          this.sceneDisplayNames[r.id] = r.name;
          if (r.description.length > 0) this.sceneAliases[r.id] = [r.name];
        }
      } catch { /* 忽略 DB 错误 */ }
      // 玩家初始位置 → 模组入口场景（优先 sceneDescriptions 第一个 key，兜底 scenes 表第一行），确保场景描写可注入
      const pos = this.getPlayerPosition();
      if (!pos || pos === "unknown" || pos === "tavern") {
        const entryScene = mod.sceneDescriptions
          ? Object.keys(mod.sceneDescriptions).find(k => k !== "unknown")
          : Object.keys(this.sceneDisplayNames)[0];
        if (entryScene) this.movePlayerToScene(entryScene);
      }
      const resultText = lines.join("\n");
      msg(resultText);
      this.lastNarrative = `已加载模组: ${mod.name}`;
    } catch (e) {
      msg(`模组加载失败: ${(e as Error).message}`);
      this.lastNarrative = `模组加载失败。`;
    }
    return true;
  }

  /**
   * 去掉展示名尾部的「（备注）」后缀——BARN_OF_PREMIER.scenes 里 3 个场景名
   * 带这种后缀（"农场外围（陷阱区）"），而运行时（premiers_barn.ts 经
   * MythosModuleLoader）注册的是不带后缀的短名（"农场外围"）。
   * bridgeBarnOfPremierClues() 与 barnSceneIdMap() 共用这一份，不各写一份
   * （"同一段各存一份"是 llm/json.ts 那轮刚收敛掉的形状）。
   */
  private static stripBracketSuffix(name: string): string {
    return name.replace(/（[^）]*）$/, "");
  }

  /**
   * ASCII 场景 id（BARN_OF_PREMIER.scenes[].id，如 "maintenance_room"）→
   * 运行时场景 id（去括号后缀的中文展示名，如"维修间"）的映射（todo-34）。
   *
   * ⚠ 只对 premiers_barn 成立——和线索桥接（bridgeBarnOfPremierClues）
   * 同样是硬编码特例：BARN_OF_PREMIER 是 ModuleData 类型、运行时场景来自
   * premiers_barn.ts 这份 MythosModule，两套模组类型系统没统一之前
   * （todo-19），这层映射也没法对别的模组通用，别把它写成看起来通用的样子。
   *
   * 实测核对过（2026-08-30）：运行时注册 26 个场景，BARN_OF_PREMIER.scenes
   * 20 个——id 直接对上 0 个（一套 ASCII 一套中文），靠展示名对上 17 个，
   * 完全对不上 3 个，全部是带括号后缀的那几个（farm_periphery/农场外围
   * （陷阱区）、barn_interior/建筑内（谷仓大厅）、maintenance_room/维修间
   * （终局场景）——去括号后 20 个全部对上，与线索桥接的结论一致
   * （bridgeBarnOfPremierClues 的 docstring 早就写过这句话，只是结局条件
   * 没用上）。
   *
   * 懒建 + 缓存：这是从静态数据（BARN_OF_PREMIER.scenes）算出来的纯映射，
   * 不随会话状态变化，没必要每次调用 isSceneVisited 都重算一遍。
   */
  private barnSceneIdMapCache: Map<string, string> | null = null;

  private barnSceneIdMap(): Map<string, string> {
    if (!this.barnSceneIdMapCache) {
      const map = new Map<string, string>();
      for (const scene of BARN_OF_PREMIER.scenes) {
        map.set(scene.id, GameSession.stripBracketSuffix(scene.name));
      }
      this.barnSceneIdMapCache = map;
    }
    return this.barnSceneIdMapCache;
  }

  /**
   * 幸运/力量是 CoC 属性，不在 skillValues 里（见 coc-character.ts 的
   * ATTRIBUTE_NAME_MAP）。BARN_OF_PREMIER 里两条线索的唯一 findMethod 恰好是
   * 这两个属性；investigateCoC 按 skillValues[key] ?? 20 处理，查不到时退回
   * 20% 默认值——不精确，但两条都是 bonus/非核心线索，好过完全查不到。
   */
  private static readonly BARN_CLUE_ATTRIBUTE_SKILLS: Record<string, string> = {
    "幸运": "luck",
    "力量": "strength",
  };

  /**
   * 把 BARN_OF_PREMIER（32 条完整线索，带 findMethods/revelation/importance）
   * 桥接进 InvestigationEngine，只在加载"普瑞米尔的谷仓"时调用一次。
   *
   * 背景：premiers_barn.ts 自带的 10 条线索走 host.registerSceneClue（见
   * mythos-module.ts:634），其中 clue_0/clue_1 的 scene 字段填的是 NPC 名
   * "菲碧_特里坎"、clue_8/clue_9 填的是事件名"与艾德里安的会面"——都不是玩家
   * 能走到的场景 id，这两条线索永远进不了 sceneClues 索引。而且
   * registerSceneClue 四参版合成的 ClueDef 全走 spot_hidden + 单一描述文本，
   * 没有技能/难度梯度。
   *
   * BARN_OF_PREMIER 是同一模组更完整的数据源（32 条，带 findMethods/
   * revelation/importance），与原有 10 条 id 命名空间不重叠
   * （clue_0.. vs clue_pistol_in_bag..），按场景名并存注册，不覆盖、不删除
   * 原有 10 条。
   *
   * 场景名桥接：BARN_OF_PREMIER 的 Scene.name 是原始 PDF 提取的展示名，3 个
   * 带「（备注）」后缀（如"农场外围（陷阱区）"）；而 mythos-module.ts:461
   * 的 registerScene(sid, sid, ...) 用不带后缀的短名（"农场外围"）——
   * state.scene 运行时存的正是这个短名。去掉尾部「（…）」即可对齐，
   * 20 个场景全部核对过能对上。同一个去括号函数（stripBracketSuffix）
   * 也被 barnSceneIdMap() 用来建 ASCII→运行时场景 id 的映射（见该方法），
   * 两处共用一份，不各写一份。
   */
  private bridgeBarnOfPremierClues(): void {
    for (const scene of BARN_OF_PREMIER.scenes) {
      const sceneName = GameSession.stripBracketSuffix(scene.name);
      for (const clue of scene.clues) {
        // 优先挑一条真正的技能路径；只有属性（幸运/力量）可用时才退回属性名。
        const skillMethods = clue.findMethods.filter((f) => f.type === "skill" && f.skillName);
        const nonAttribute = skillMethods.find((f) => SKILL_NAME_MAP[f.skillName!]);
        const chosen = nonAttribute ?? skillMethods[0];
        const skillKey = chosen
          ? (SKILL_NAME_MAP[chosen.skillName!] ?? GameSession.BARN_CLUE_ATTRIBUTE_SKILLS[chosen.skillName!] ?? "spot_hidden")
          : "spot_hidden";
        // ModuleData 只给一句 revelation，没有分层文本——四档共用同一句是
        // 如实反映数据颗粒度，不是偷懒（registerSceneClue 的合成版也是这么做的）。
        //
        // ⚠ 这里此前把 findMethods[].description 整个丢了，只取 skillName
        // 映射了技能。而这些描述里恰恰是位置/动作提示（"侦查休息区/仔细检查
        // 床底""侦查卫生间/仔细检查洗漱用具"）——同一个场景三条线索都靠
        // spot_hidden 一个技能触发时，选取层（resolveSceneClueMatch）只能
        // 靠这份文本区分玩家具体想搜哪儿，不然「侦查卫生间」和「侦查餐厅」
        // 拿到的都是场景里第一条未发现线索。存进 matchTexts，不在这一层做
        // 匹配（匹配逻辑见 clue-match.ts + resolveSceneClueMatch）。
        this.investigation.addClueType(clue.id, {
          description: clue.description,
          scene: sceneName,
          matchTexts: [clue.name, ...clue.findMethods.map((f) => f.description)],
          displayName: clue.name,
          importance: clue.importance,
          coc_primary: {
            skill: skillKey,
            regular: clue.revelation,
            hard: clue.revelation,
            extreme: clue.revelation,
            critical: clue.revelation,
            // 只改措辞，不改判定：与 :2282 附近「这里没什么特别的」（措辞对不上，
            // 没进检定）是两种不同的"没找到"，这里是真掷过骰子没过。
            fail: "你仔细搜查了一番，但这次没能看出什么名堂。",
          },
        });
      }
    }
  }

  // ── 模组结算/技能成长 ──
  private handleSkillAdvancement(messages: AgentMessage[], msg: (s: string) => number): boolean {
    const marks = this.skillGrowthMarks ? [...new Set(this.skillGrowthMarks)] : [];
    const restGrowth = new Map(this._growthChangesByPC);

    if (marks.length === 0 && restGrowth.size === 0) {
      msg("没有可结算的成长记录。在冒险中使用技能后，失败时自动记录成长标记");
      this.lastNarrative = "没有可结算的成长";
      return true;
    }

    const growthResults: string[] = [];

    // 收集要结算的角色（characters 为空时回退到当前活跃角色）
    const targets: Array<{ pid: string; char: any }> = [];
    for (const [pid, char] of this.characters) {
      if (char) targets.push({ pid, char });
    }
    if (targets.length === 0 && this.activeCharacter) {
      targets.push({ pid: this.activePlayerId, char: this.activeCharacter });
    }

    for (const { pid, char } of targets) {
      const skillChanges: string[] = [...(restGrowth.get(pid) ?? [])];
      const pcGrowth: string[] = [];

      for (const skill of marks) {
        const roll = Math.floor(Math.random() * 100) + 1;
        const currentSkill = char?.skillValues?.[skill] ?? char?.skills?.[skill] ?? 50;
        const display = SKILL_DISPLAY_NAMES[skill] ?? skill;
        if (roll > currentSkill) {
          const increase = Math.floor(Math.random() * 10) + 1;
          if (char?.skillValues) char.skillValues[skill] = Math.min(99, currentSkill + increase);
          else if (char?.skills) char.skills[skill] = Math.min(99, currentSkill + increase);
          pcGrowth.push(`${char.name}·${display}: d100=${roll} > ${currentSkill}% → 成长 +${increase}%`);
          skillChanges.push(`${display}→${Math.min(99, currentSkill + increase)}`);
        } else {
          pcGrowth.push(`${char.name}·${display}: d100=${roll} <= ${currentSkill}% → 无成长`);
        }
      }

      growthResults.push(...pcGrowth);

      // 记录模组结算到 careerStore（每个角色各一条）
      if (this.careerStore && char) {
        const sanEngine = this.sanityEngines.get(pid) ?? this.sanity;
        const startStats = this._moduleStartByPC.get(pid);
        const sanBefore = startStats?.san ?? sanEngine.state.maxSAN;
        const cmBefore = startStats?.cm ?? 0;
        try {
          this.careerStore.addEntry({
            id: `ce_${Date.now().toString(36)}_${pid}`,
            characterName: char.name,
            moduleId: this.registeredModules[0]?.id ?? "unknown",
            moduleName: this.registeredModules[0]?.name ?? "未知模组",
            completedAt: new Date().toISOString(),
            endingId: "completed",
            endingName: "模组完成",
            sanChange: sanEngine.state.currentSAN - sanBefore,
            cmChange: (sanEngine.state.cthulhuMythos ?? 0) - cmBefore,
            reputationChange: 0,
            skillChanges,
            rewardIds: [],
            narrative: "模组结算完成",
          });
        } catch (e) {
          // 原先是 `catch {}`。这一条写的是**跑完一整个模组**的结算记录：
          // SAN 变化、技能成长、结局。写不进去就等于这局白跑了，
          // 而玩家会以为已经记上 —— 静默丢数据比报错糟得多。
          const why = e instanceof Error ? e.message : String(e);
          growthResults.push(`⚠️ ${char.name} 的模组结算没能写进履历（${why}），这次的成长记录可能丢失。`);
          log.warn("career", `addEntry 失败（${char.name} / ${this.registeredModules[0]?.id ?? "unknown"}）：${why}`);
        }
      }
    }

    this.skillGrowthMarks = [];
    this._growthChangesByPC.clear();

    const resultText = ["【技能成长结算", ...growthResults].join("\n");
    msg(resultText);
    // 模组完成消息
    messages.push({ speaker: "系统", content: "模组完成", type: "system" });
    this.lastNarrative = resultText;
    return true;
  }

  // ── 施法 ──
  private handleCast(intent: ActionIntent, msg: (s: string) => number): boolean {
    if (intent.action === "occult_cast" && this.activeRuleset !== "cosmic-horror") {
      msg("神话法术仅支持宇宙恐怖模式");
      this.lastNarrative = "神话法术仅支持宇宙恐怖模式";
      return true;
    }
    if (!this.activeCharacter) {
      msg("你还没有创建角色");
      this.lastNarrative = "你还没有创建角色";
      return true;
    }
    // 检查是否有已知神话法术
    if (this.knownMythosSpells.length > 0 && intent.action === "occult_cast") {
      const spellName = intent.spell ?? intent.target ?? "未知法术";
      msg(`你尝试施展「${spellName}」……`);
      this.lastNarrative = `你尝试施展「${spellName}」。`;
      return true;
    }
    if (intent.action === "occult_cast") {
      msg("你尚未学会任何神话法术。阅读神话典籍可以领悟法术");
      this.lastNarrative = "你尚未学会神话法术";
      return true;
    }
    // D&D cast
    const spellName = intent.spell ?? intent.target ?? "法术";
    msg(`你施展了${spellName}！」`);
    this.lastNarrative = `你施展了${spellName}」。`;
    return true;
  }

  // ── 阅读典籍 ──
  private handleRead(input: string, msg: (s: string) => number): boolean {
    const tomeName = input.replace(/^(?:阅读|读|翻阅)\s*/, "").trim();
    // 典籍定义
    const tomes: Record<string, { sanCost: string; cmGain: number; spellCount: number; spells: string[] }> = {
      "死灵之书": { sanCost: "1d10/1d100", cmGain: 10, spellCount: 7, spells: ["呼唤米戈", "放逐术", "克苏鲁之", "肉傀儡创", "亡者苏", "时空", "旧日支配者之印记"] },
      "无名祭祀书": { sanCost: "1d6/1d20", cmGain: 6, spellCount: 4, spells: ["召唤暗影", "灵魂转移", "死灵沟", "诅咒"] },
      "黄衣之王": { sanCost: "1d8/1d20", cmGain: 8, spellCount: 4, spells: ["黄衣之印", "疯狂低语", "幻象编织", "哈斯塔之"] },
      "塞拉伊诺断章": { sanCost: "1d6/1d20", cmGain: 5, spellCount: 3, spells: ["时空感知", "星之投射", "塞拉伊诺之眼"] },
      "阿卡姆特集": { sanCost: "1d4/1d10", cmGain: 4, spellCount: 0, spells: [] },
    };

    const tome = tomes[tomeName];
    if (!tome) {
      // 非典籍
      msg(`你翻阅了${tomeName}。」`);
      this.lastNarrative = `你翻阅了${tomeName}。」`;
      return true;
    }

    // SAN 检查
    const result = this.sanity.sanityCheck(tome.sanCost);
    const passed = result.passed;
    const sanLoss = result.sanLoss;
    const roll = result.roll;
    msg(`🧠 阅读${tomeName}」SAN 检查 d100=${roll} (目标=${this.sanity.state.currentSAN}) ${passed ? "通过" : "失败"}！SAN -${sanLoss} (剩余: ${this.sanity.state.currentSAN})`);

    // CM 成长
    if (this.sanity.state.cthulhuMythos !== undefined) {
      this.sanity.state.cthulhuMythos += tome.cmGain;
    }
    msg(`📖 克苏鲁神话技能提升+${tome.cmGain}%`);

    // 法术学习
    const learnedSpells: string[] = [];
    for (const spell of tome.spells) {
      const learnRoll = Math.floor(Math.random() * 100) + 1;
      const learnTarget = Math.min(99, this.sanity.state.cthulhuMythos ?? 10);
      if (learnRoll <= learnTarget && !this.knownMythosSpells.includes(spell)) {
        this.knownMythosSpells.push(spell);
        // 注册到 mythosSpells
        this.mythosSpells.set(spell, { sanCost: "1d4", mpCost: Math.floor(Math.random() * 4) + 1, description: `神话法术: ${spell}`, effect: `施展${spell}的效果` });
        learnedSpells.push(spell);
      }
    }

    if (learnedSpells.length > 0) {
      msg(`🎉 你领悟了新法术: ${learnedSpells.join(", ")}`);
    } else if (tome.spellCount > 0) {
      msg("你未能领悟任何法术，也许下次会有不同的领悟");
    }

    this.lastNarrative = `你阅读了${tomeName}」，SAN -${sanLoss}，克苏鲁神话技能+${tome.cmGain}%。`;
    return true;
  }

  // ── 急救 ──
  private handleFirstAid(msg: (s: string) => number): boolean {
    if (!this.activeCharacter) {
      msg("你还没有创建角色");
      this.lastNarrative = "你还没有创建角色";
      return true;
    }
    const c = this.activeCharacter;
    const medicineSkill = c.skillValues?.medicine ?? c.skills?.medicine ?? c.skillValues?.急救 ?? c.skills?.急救 ?? 30;
    const roll = Math.floor(Math.random() * 100) + 1;
    const success = roll <= medicineSkill;
    const isFumble = roll > 95;
    const resultText = isFumble ? "大失败！伤势可能加重" : success ? "成功！伤口得到了处理" : "失败，急救未能止血";

    msg(`💊 急救检查d100=${roll} (医学/急救=${medicineSkill}%) → ${resultText}`);
    if (success) {
      const healAmount = Math.floor(Math.random() * 3) + 1;
      c.hp = Math.min(c.maxHp ?? 12, (c.hp ?? 12) + healAmount);
      this._woundsTreated = true;
      msg(`恢复了 ${healAmount} 点 HP (当前: ${c.hp}/${c.maxHp ?? 12})`);
    }
    this.lastNarrative = `急救结果: ${resultText}。`;
    return true;
  }

  // ── 装填 ──
  /**
   * ⚠ 原先这句是「弹药已补满」——**而这一侧根本没有弹药状态**。
   *
   *   弹药系统只存在于 CLI（`src/index.ts` 的 `cocAmmo`：开火递减、
   *   打空拦截、`/reload` 补满）。走服务器/网页的这条路一格弹药都不记，
   *   开枪不消耗、装填也无从补起。两个前端两套规则。
   *
   *   在把弹药搬过来之前，这里**不能报告一件没发生的事**：
   *   玩家会据此决定要不要省子弹，而那个数字是假的。
   */
  private handleReload(intent: ActionIntent, msg: (s: string) => number): boolean {
    const weaponName = intent.weapon ?? intent.target ?? "武器";
    msg(`你检查并重新装填了「${weaponName}」。（注：本模式暂不追踪弹药消耗）`);
    this.lastNarrative = `你装填了${weaponName}。`;
    return true;
  }

  // ── 推动检查──
  private handlePush(msg: (s: string) => number): boolean {
    if (!this._lastPushedRoll) {
      msg("没有待推动的检定。先进行一次技能检定，失败后再使用推动");
      this.lastNarrative = "没有待推动的检定";
      return true;
    }
    // 原先还取了 `roll: prevRoll`（推动前那一掷）却没用上 —— 播报里只报新骰。
    // 「原本 73，推动后 41」比单报一个数字有信息量，但那是文案决定；
    // 先把死绑定去掉，别让它看着像忘了拼进去。
    const { skill, target } = this._lastPushedRoll;
    const newRoll = Math.floor(Math.random() * 100) + 1;
    const success = newRoll <= target;
    const isFumble = newRoll > 95;
    const resultText = isFumble ? "大失败！后果严重" : success ? "推动成功" : "再次失败，情况恶";
    msg(`🔄 推动检查(${skill}): d100=${newRoll} (目标=${target}%) → ${resultText}`);
    this._lastPushedRoll = null;
    this.lastNarrative = `推动检查 ${resultText}。`;
    return true;
  }

  // ── 追逐 ──
  private handleChase(msg: (s: string) => number): boolean {
    const roll = Math.floor(Math.random() * 100) + 1;
    const dex = this.activeCharacter?.attributes?.dexterity ?? this.activeCharacter?.attributes?.DEX ?? 50;
    const success = roll <= dex;
    const resultText = success ? "你成功拉开了距离！" : "追逐仍在继续…";
    msg(`🏃 追逐检查d100=${roll} (DEX=${dex}) → ${resultText}`);
    this.lastNarrative = `追逐: ${resultText}`;
    return true;
  }

  // ============================================================
  // 骰子引擎
  // ============================================================

  // ============================================================
  // 传奇模板辅助
  // ============================================================

  /** 构建 LLM 传奇上下文注入 */
  private buildEpicContext(): string {
    const template = this.activeCharacter?.legendaryTemplate;
    if (!template) return "";
    const ep = template.epicNarrative ?? "";
    const showTime = template.showTime;
    const st = showTime ? `\n表演时间「${showTime.name}」：${showTime.description}（持续${showTime.duration}）` : "";
    const actions = template.legendaryActions?.map((a: LegendaryAction) =>
      `【${a.name}】${a.description}（消耗 ${a.cost} 传奇点）`
    ).join("\n") ?? "";
    return `\n\n=== 传奇角色上下文 ===\n${ep}${st}\n${actions}\n当前角色已超越凡人极限。请以匹配的史诗级别描绘其行动与叙事。`;
  }

  private execDiceExpr(expr: string): { total: number; detail: string; bonus?: number } {
    let total = 0; const rolls: string[] = [];
    let remaining = expr.replace(/\s+/g, "");
    let bonus = 0;
    const bm = remaining.match(/^(.*?)([+-]\d+)?$/);
    if (bm) { remaining = bm[1] || remaining; bonus = parseInt(bm[2] || "0") || 0; }
    const re = /(\d+)?d(\d+)/gi; let m;
    while ((m = re.exec(remaining)) !== null) {
      const cnt = parseInt(m[1] || "1"), sides = parseInt(m[2]);
      for (let i = 0; i < cnt; i++) { const r = Math.floor(Math.random() * sides) + 1; total += r; rolls.push(String(r)); }
    }
    return { total: total + bonus, detail: rolls.join("+"), bonus: bonus || undefined };
  }

  // ── 政治经济 ──
  private handlePoliticoEconomy(
    intent: ActionIntent,
    messages: AgentMessage[],
    msg: (s: string) => number,
  ): boolean {
    if (intent.action === "economy_viz" || intent.action === "viz") {
      const html = this.politicoEconomy.renderEconomyHtml();
      // 把 HTML 存入 lastNarrative + 加个简短系统消息
      const summary = this.politicoEconomy.getBriefState();
      msg(`📊 经济仪表盘已生成 — ${summary.factions.length} 势力, ${summary.markets.length} 市场, ${summary.crisisCount} 危机`);
      this.lastNarrative = `[经济仪表盘]\n${summary.factions.map(f => `${f.name}: 国库${f.treasury}G 稳定${f.stability}`).join("\n")}`;
      // HTML 通过 messages 传出，前端可拦截
      messages.push({ speaker: "系统", content: `__ECONOMY_HTML__${html}__END_HTML__`, type: "system" });
      return true;
    }
    const result = this.politicoEconomy.handleAction(intent.action, {
      target: intent.target,
      from: intent.target,
      amount: intent.dc ?? undefined,
      item: intent.item,
      skill: intent.skill,
    });
    msg(result.systemMsg ?? result.narrative);
    this.lastNarrative = result.narrative;
    return true;
  }

  /**
   * 把所有实体身上的限时状态推进一回合。
   *
   * ⚠ 这个方法原名 `processBleeding`，**从来没有被调用过**（tsc 的
   *   noUnusedLocals 报出来的）。后果是：`checkMajorWound` 的描述写着
   *   「正在流血，每回合失去 1 HP 直到止血」，`act()` 里也确实往
   *   `status` 里推了「流血」—— 但那个标签**永远不掉血、也永远不消失**。
   *   一句纯装饰。
   *
   *   同时 `src/rules/status-effects.ts`（中毒/流血/燃烧…的定义库，带 duration）
   *   在依赖图上是死模块：唯一 import 它的地方五个符号一个没用。
   *   规则在、缺陷在，两者从没接上 —— 和追逐系统是同一个故事。
   *
   *   现在接上：状态定义与时限口径由 status-effects 说了算，
   *   这里只负责「扣血、播报、写回实体」这些游戏层的事。
   *
   * 存储形态**没有变**，还是 `status: string[]`。不给实体加第二个
   * 结构化字段 —— 一份数据两套解析是这个仓库反复在修的病。
   */
  private tickStatusEffects(): void {
    const state = this.world.getCurrentState();
    for (const ent of Object.values(state.entities)) {
      const e = ent as { name: string; hp: number; maxHp?: number; status?: string[] };
      if (!Array.isArray(e.status) || e.status.length === 0) continue;
      if (e.hp <= 0) continue; // 人已经倒下，流血不再是这一轮要决定的事

      const { next, expired, active } = tickStatuses(e.status);

      // 每回合掉血的那几种。伤害口径放在这里而不是定义库里：
      // 定义库是**规则数据**，扣多少血要看实体的 maxHp，那是游戏层的信息。
      // ⚠ 原先按最大 HP 的百分比扣（流血 10%、中毒 5%、燃烧 15%），
      //   而 `checkMajorWound` 印给玩家的描述写的是
      //   **「正在流血，每回合失去 1 HP 直到止血」** —— 文案与实现对不上：
      //   20 点体力的人实际每轮掉 2，玩家照着那句话根本算不出自己的血。
      //
      //   CoC 7e 的濒死规则就是每轮 1 点，与那句文案一致。按文案改，
      //   而不是改文案 —— 一句已经印出去的规则说明比一个拍脑袋的百分比更该被当真。
      //   燃烧稍重一点（2 点），中毒与流血同为 1 点。
      const PER_TURN_DAMAGE: Record<string, number> = {
        bleeding: 1,
        poisoned: 1,
        burning: 2,
      };
      for (const s of active) {
        const dmg = PER_TURN_DAMAGE[s.id];
        if (dmg === undefined) continue;
        e.hp = Math.max(0, e.hp - dmg * s.stacks);
        this.addMessage("系统", `[${s.name}] ${e.name} 失去 ${dmg * s.stacks} HP (剩余 ${e.hp}/${e.maxHp})`, "system");
        if (e.hp <= 0) break;
      }
      for (const s of expired) {
        this.addMessage("系统", `[状态] ${e.name} 的「${s.name}」结束了。`, "system");
      }

      const before = e.status;
      if (next.length !== before.length || next.some((x: string, i: number) => x !== before[i]) || active.length > 0) {
        e.status = next;
        this.world.upsertEntity(e as never);
      }
    }
  }
}
