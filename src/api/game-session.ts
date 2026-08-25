import { readFileSync, rmSync } from "fs";
import { parse as parseYaml } from "yaml";
import { loadConfig, type LLMConfig } from "../config";
import { LLMClient, type LLMLike } from "../llm/client";
import { MockLLMClient } from "../llm/mock-client";
import { parseIntent, setIntentLLM, intentLLMConfigured } from "../llm/intent";
import { generateNarrative, setNarratorLLM, narratorLLMConfigured } from "../llm/narrator";
// llmEnabled 是「该不该打网络」的**唯一**判据，别在别处重写一份 ——
// play-module.ts:101 记着上次抄第二份的代价。
import { llmEnabled } from "../play-module";

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
import { SpellEngine } from "../spell/spell-engine";
import { WorldModelLoader, sharedWorldModel, DEFAULT_CTHULHU_PATH } from "../world/world-model-loader";
import { WorldModelIntegrator, type SceneContext, type NPCPresentProfile } from "../world/world-model-integrator";
import { NPCStore } from "../db/index";
import { getDifficultyProfile } from "../rules/module-difficulty";
import type { DifficultyProfile } from "../rules/module-difficulty";
import { applyAction, type GateState, type RejectReason, type Result, type StateDelta } from "../rules/apply-action";
import { boundedIntegerGateState, boundedIntegerScenario, buildDifficultyGateState, COC_SESSION_SCENARIO, isDifficultyLabel } from "../rules/coc-session-scenario";
import { CharacterFactory, getArchetype, type LegendaryAction } from "../character/character-factory";
import { buildCoCCharacter, SKILL_NAME_MAP } from "../character/coc-character";
import { StoryGenerator } from "../rules/story-generator";
import { CareerFileStore } from "../character/career-file";
import { createGameTime, advanceTime, formatGameTime, periodAtmosphere, type GameTime } from "../rules/game-time";
import { listTables, rollTable } from "../rules/random-tables";

import { MythosModuleLoader, type MythosModuleHost } from "../rules/mythos-module";
import { PoliticoEconomyEngine } from "../economy/politic-economy-engine";
import { PREMIERS_BARN_MODULE, ARKHAM_LIBRARY_MODULE, INNSMOUTH_MODULE } from "../rules/mythos-module";
import { getModule as getCustomModule } from "../rules/custom-modules/index";
import { resolveSceneTarget, type SceneRow } from "../play/scene-resolve";

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
  };
  dead?: boolean;
  sanity?: { currentSAN: number; maxSAN: number; temporaryInsanity: boolean; indefiniteInsanity: boolean; phobias: string[] };
  rolls?: { skill: string; roll: number; target: number; success: boolean }[];
  dice?: { expr: string; total: number; detail?: string; bonus?: number }[];
}

export interface SessionSummary {
  id: string; round: number; ruleset: string; scene: string; playerName: string;
  archetype: string | null; messageCount: number; npcCount: number; createdAt: number;
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

  private characters: Map<string, any> = new Map();
  /**
   * SAN 引擎是带行为的对象（检定、疯狂判定），这里只作进程内缓存；
   * 其 state 的真相源是 WorldStateManager，落库点见 persistSanity()。
   * 背包 / 武器 / 护甲没有进程内副本，一律直读直写真相源。
   */
  private sanityEngines: Map<string, SanityEngine> = new Map();
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

  constructor(
    id: string,
    ruleset: RulesetId = "cosmic-horror",
    llmConfig?: LLMConfig,
    archetypeId?: string,
    characterName?: string,
  ) {
    this.id = id;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
    this.activeRuleset = ruleset;

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
    // 战斗叙述同理：`llm/narrator.ts` 的 `_narratorLLM` 也是模块级单例，
    // 原先只有 CLI 会设（`index.ts:55`），网页端战斗只印
    // 「造成 N 点伤害」，没有画面。守卫逻辑与上面 intent 那份一致。
    if (this.llm instanceof LLMClient && llmEnabled() && !narratorLLMConfigured()) {
      setNarratorLLM(this.llm);
    }

    this.ruleEngine = new RuleEngine();
    this.rules = new RulesEngine();
    this.session = new PlayerSession();
    this.world = new WorldStateManager(`:memory:`);
    this.npcCombat = new NPCCombatEngine();
    this.companionManager = new CompanionManager();
    this.politicoEconomy = new PoliticoEconomyEngine();
    this.investigation = new InvestigationEngine();
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

    // D&D 侧的属性表没有 power，回落到原来的 50，行为不变
    this.sanity = new SanityEngine(initialCharacter?.attributes?.power ?? 50);
    this.sanityEngines.set("p1", this.sanity);
    this.world.registerPlayer("p1");
    this.persistSanity("p1");

    // 注册玩家到会话（始终执行：无玩家时 join 设为活动玩家，已存在则切换）
    // 历史消息记录依赖活动玩家的 messageHistory，缺失会导致 getHistory 恒空
    if (!this.session.getActive()) {
      try {
        this.session.join("p1", characterName ?? "调查员", "p1", "");
      } catch { /* 已存在则忽略 */ }
    } else {
      this.session.switchActive("p1");
    }

    // 创建初始角色（上面已建好，这里只做落地：世界实体、角色卡档案）
    if (initialCharacter) {
      try {
        const char = initialCharacter;
        this.activeCharacter = char;
        this.characters.set("p1", char);
        // 角色卡与世界实体必须同时诞生。此前实体要等 setPlayerHp 或移动流程
        // 顺手 upsert 才出现，于是开局的 KP 伤害因为找不到实体而失败
        // （改造前抛异常兜成 500），而 getState() 的硬编码兜底又让面板照常
        // 显示 12/12，两相抵消，谁都看不出来。
        this.world.upsertEntity({
          id: "p1",
          name: char.name,
          type: "pc",
          hp: char.hp,
          maxHp: char.maxHp,
          // GeneratedCharacter 没有 ac 字段；与另外两处懒建点取同一个常量。
          // CoC 规则下 getState() 本就把对外的 ac 覆盖成 0。
          ac: 10,
          status: [],
          position: this.world.getCurrentState().scene ?? "unknown",
        });
        // 创建角色卡档案（独立目录"
        const careerDir = `data/careers/${this.id}`;
        try { rmSync(careerDir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
        this.careerStore = new CareerFileStore(careerDir);
        this.careerStore.saveSnapshot({
          characterName: char.name,
          // archetype 存的是 id 字符串，取显示名要过 getArchetype；
          // 此前写 char.archetype?.label 恒为 undefined，职业栏一直落成英文 id。
          // CoC 角色把职业存在 archetypeId，通用角色存在 archetype，两边都要认
          occupation: getArchetype(char.archetypeId ?? char.archetype)?.label ?? char.archetypeId ?? char.archetype ?? archetypeId ?? "investigator",
          attributes: { ...(char.attributes ?? {}) },
          skills: char.skillValues ? { ...char.skillValues } : {},
          san: this.sanity.state.currentSAN,
          maxSan: this.sanity.state.maxSAN,
          cthulhuMythos: 0,
          hp: char.hp,
          maxHp: char.maxHp,
          creditRating: char.creditRating ?? 30,
          createdAt: new Date().toISOString(),
        });
      } catch (e) {
        log.warn("session", "角色创建失败", e);
      }
    }
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
    for (const m of turnMessages) this.session.push(m);

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
    return state.entities["player"]?.position ?? state.scene ?? "tavern";
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

  getSuggestions(): string[] {
    const following: string[] = [];
    if (this.combatActive) {
      following.push("⚔️ 攻击敌人", "🛡️ 防御", "💊 使用物品", "🏃 撤退");
    } else {
      following.push("🔍 调查四周", "💬 与 NPC 交流", "🚶 前往其他场景");
    }
    const comps = this.companionManager.getActiveCompanions();
    if (comps.length > 0) following.push(`👥 指挥同伴 (${comps.length}人)`);
    return following;
  }

  // ============================================================
  // act() — 主游戏循环
  // ============================================================

  async act(input: string, actingCharacterName?: string): Promise<ActionResponse> {
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
    const turnMessages: AgentMessage[] = [];
    for (const s of sightingMsgs) turnMessages.push({ speaker: "系统", content: s, type: "system" });
    // 供模组宿主适配器把加载期产生的消息投进本回合，见 _turnMessages 的说明
    this._turnMessages = turnMessages;

    if (actingCharacterName && actingCharacterName !== this.session.getActive()?.characterName) {
      for (const [pid, ch] of this.characters) {
        if (ch.name === actingCharacterName && pid !== this.activePlayerId) {
          this.sanityEngines.set(this.activePlayerId, this.sanity);
          // 换人前先把上一位的 SAN 落库，否则本回合的改动会随缓存切换丢失
          this.persistSanity(this.activePlayerId);
          this.activePlayerId = pid;
          this.activeCharacter = ch;
          this.session.switchActive(pid);
          if (this.sanityEngines.has(pid)) this.sanity = this.sanityEngines.get(pid)!;
          break;
        }
      }
    }

    const activePlayer = this.session.getActive();
    const playerName = activePlayer?.characterName ?? "调查员";

    // 斜杠命令
    if (input.startsWith("/")) {
      const handled = await this.handleSlashCommand(input, turnMessages);
      if (handled) return this.buildActionResponse(turnMessages);
    }

    // 队友命令
    const recruitMatch = input.match(/^创建队友\s+(\S+)\s+(\S+)/);
    if (recruitMatch) {
      const [, name, cls] = recruitMatch;
      const ch = buildCharacterForRuleset(name, cls, this.activeRuleset);
      const pid = `p${this.characters.size + 1}`;
      const san = new SanityEngine(50);
      this.characters.set(pid, ch);
      this.sanityEngines.set(pid, san);
      this.world.registerPlayer(pid);
      this.persistSanity(pid);
      turnMessages.push({ speaker: "系统", content: `👤 ${name}(${cls}) 加入了队伍`, type: "system" });
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
    if (intent.action !== "unknown") {
      const handled = await this.handleIntent(intent, input, turnMessages);
      if (handled) return this.buildActionResponse(turnMessages);
    }

    // 战斗检测：如果包含攻击关键词且 combatActive
    if (this.combatActive || /^(攻击|射击|挥砍|向.+攻击|对.+使用)/.test(input)) {
      const state = this.world.getCurrentState();
      const enemies = Object.values(state.entities).filter(e => (e.type === "monster" || e.type === "npc") && e.hp > 0);
      if (enemies.length > 0) {
        this.combatActive = true;
        const target = enemies[Math.floor(Math.random() * enemies.length)];

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
              const aliveEnemies = Object.values(state.entities).filter(e => (e.type === "monster" || e.type === "npc") && e.hp > 0);
              if (aliveEnemies.length > 0) {
                const cTarget = aliveEnemies[Math.floor(Math.random() * aliveEnemies.length)];
                const cDmg = Math.floor(Math.random() * 4) + 1;
                cTarget.hp = Math.max(0, cTarget.hp - cDmg);
                this.world.upsertEntity(cTarget);
                turnMessages.push({ speaker: "系统", content: `👤 ${c.config.name} 协助攻击 ${cTarget.name}，造成 ${cDmg} 点伤害`, type: "system" });
              }
            }
          }
        }

        // 检查战斗结"
        const aliveEnemies = Object.values(state.entities).filter(e => (e.type === "monster" || e.type === "npc") && e.hp > 0);
        if (aliveEnemies.length === 0) {
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
        // 模块模式：先解析目标场景名（匹配模组已注册场景并更新玩家位置），再回落 LLM 叙事
        if (this.registeredModules.length > 0) {
          this.tryResolveModuleScene(intent.target ?? input, msg);
          return false;
        }
        return this.handleMove(intent, msg);
      case "look":
        // 模块模式：同样先尝试解析目标场景名，再回落 LLM 叙事
        if (this.registeredModules.length > 0) {
          this.tryResolveModuleScene(intent.target ?? input, msg);
          return false;
        }
        msg("你环顾四周，观察着周围的环境…"); this.lastNarrative = "你仔细观察了周围的环境"; return true;
      case "inventory": return this.handleInventory(msg);
      case "flee": return this.handleFlee(msg);
      case "rest": return this.handleRest(messages, msg);
      case "san_check": return this.handleSanCheck(intent, msg);
      case "skill_check": return this.handleSkillCheck(intent, msg);
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
      case "talk": msg("你试图与周围的人交流…"); this.lastNarrative = "你试图与周围的人交流"; return true;
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
    // 解析逻辑抽到了 `play/scene-resolve.ts` —— 原先它埋在这个 private 方法里，
    // 返回值在两个调用点都被丢掉，全仓只有一条 happy-path 测试。
    // 也就是说**真人那条路的移动匹配几乎没有判据**，而剧本杀那条路的
    // 同类毛病（否定、顺序依赖、静默替选）已经查出来一串。
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
    const moved = this.movePlayerToScene(hit.sceneId);
    // 没认准就说出来。玩家有权知道「这一步是我选的，还是引擎猜的」——
    // 剧本杀那条路早有这句（「没听清要去哪……」），真人这条路一直没有。
    if (moved && hit.forced) {
      const name = this.sceneDisplayNames[hit.sceneId] ?? hit.sceneId;
      msg?.(`（没太确定你要去哪，先按最接近的理解带你到了「${name}」。说个更完整的地名可以纠正。）`);
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
    const player = state.entities["player"];
    if (player) {
      player.position = sceneId;
      this.world.upsertEntity(player);
    } else {
      this.world.upsertEntity({ id: "player", name: this.activeCharacter?.name ?? "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: sceneId });
    }
    return true;
  }

  private handleMove(intent: ActionIntent, msg: (s: string) => number): boolean {
    const target = intent.target ?? "";
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
    const player = state.entities["player"];
    if (player) {
      player.position = sceneId;
      this.world.upsertEntity(player);
    } else {
      this.world.upsertEntity({ id: "player", name: this.activeCharacter?.name ?? "调查员", type: "pc", hp: 12, maxHp: 12, ac: 10, status: [], position: sceneId });
    }
    msg(`你移动到了场景: ${this.sceneDisplayNames[sceneId] ?? sceneId}`);
    this.lastNarrative = `你走向了${target}。`;
    return true;
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
    const playerEnt = state.entities["player"];
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
  /** 会去解析场景线索的技能。潜行、说服等不属于调查，不该触发线索判定。 */
  private static readonly INVESTIGATIVE_SKILLS = new Set(["investigation", "perception"]);

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

  private handleSkillCheck(intent: ActionIntent, msg: (s: string) => number): boolean {
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
      const next = this.investigation
        .getUndiscoveredSceneClues(pos, this.activePlayerId)
        .find((c) => this.investigation.hasClueType(c));
      if (next !== undefined) return this.resolveSceneClue(next, msg);
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
   * 解析一条场景线索：掷检定、给出揭示文本、扣掉它要求的 SAN。
   *
   * 判定规则全在 InvestigationEngine 里（含"已发现则不重复扣 SAN"与成功后
   * markDiscovered），这里只负责把结果落到会话状态上。
   *
   * SAN 经 setPlayerSan 扣减，因此和 KP 手动改 SAN 走同一个 applyAction 闸门，
   * 也同样会落到真相源。目标值恒在 [0, 当前值] 内，落在闸门的整数域中，
   * 不存在被拒绝的取值。
   */
  private resolveSceneClue(clueType: string, msg: (s: string) => number): boolean {
    const skills = this.activeCharacter?.skillValues ?? this.activeCharacter?.skills ?? {};
    const result = this.investigation.investigateCoC(clueType, skills, this.activePlayerId);

    msg(result.revelation);
    this.lastNarrative = result.revelation;

    if (result.sanLost > 0) this.inflictSanLoss(result.sanLost, msg);
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
  /** 当前场上还活着的敌人。战斗旗、还手、退出战斗三处共用一份判断。 */
  private aliveEnemies(): WorldEntity[] {
    const state = this.world.getCurrentState();
    return Object.values(state.entities).filter(
      (e) => (e.type === "monster" || e.type === "npc") && (e.hp ?? 0) > 0,
    );
  }

  private async npcCounterAttack(intent: ActionIntent, msg: (s: string) => number): Promise<void> {
    if (!this.combatActive) return;
    const state = this.world.getCurrentState();
    const enemies = this.aliveEnemies();
    if (enemies.length === 0) return;
    const attacker = this.pickTarget(intent, enemies); // 谁被打就谁还手
    if (!attacker) return;

    const player = state.entities["player"];
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
    const state = this.world.getCurrentState();
    const enemies = Object.values(state.entities).filter(e => (e.type === "monster" || e.type === "npc") && e.hp > 0);
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
      this.activeCharacter = ch;
      this.characters.set("p1", ch);
      // 注册玩家到会话（无玩家时 join 会设为活动玩家；已存在则仅切换）
      if (!this.session.getActive()) {
        this.session.join("p1", charName, "p1", "");
      } else {
        this.session.switchActive("p1");
      }
      // 创建世界实体
      this.world.upsertEntity({
        id: "player", name: charName, type: "pc",
        hp: ch.hp, maxHp: ch.maxHp, ac: CharacterFactory.computeAC(ch),
        status: [], position: this.world.getCurrentState().scene ?? "tavern",
      });
      // 创建 career store（独立目录，清理旧数据）
      if (!this.careerStore) {
        const careerDir = `data/careers/${this.id}`;
        try { rmSync(careerDir, { recursive: true }); } catch { /* 清理临时目录：不存在或被占用都无所谓，失败不影响正确性 */ }
        this.careerStore = new CareerFileStore(careerDir);
      }
      this.careerStore.saveSnapshot({
        characterName: ch.name, occupation: getArchetype(ch.archetypeId ?? ch.archetype)?.label ?? ch.archetypeId ?? ch.archetype ?? archetypeId,
        attributes: { ...(ch.attributes ?? {}) },
        skills: ch.skillValues ? { ...ch.skillValues } : {},
        san: this.sanity.state.currentSAN, maxSan: this.sanity.state.maxSAN,
        cthulhuMythos: 0, hp: ch.hp, maxHp: ch.maxHp,
        creditRating: ch.creditRating ?? 30,
        createdAt: new Date().toISOString(),
      });
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
