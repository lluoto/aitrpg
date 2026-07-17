import { readFileSync, rmSync } from "fs";
import { parse as parseYaml } from "yaml";
import { loadConfig, type LLMConfig } from "../config";
import { LLMClient } from "../llm/client";
import { MockLLMClient } from "../llm/mock-client";
import { parseIntent } from "../llm/intent";
import { generateNarrative, setNarratorLLM } from "../llm/narrator";
import { RuleEngine } from "../engine/rule-engine";
import { RulesEngine, type RulesetId } from "../rules/rules-engine";
import { SanityEngine, CoCEngine, calcDamageBonus, rollDamageBonus, getHitLocationEffect, checkMajorWound, opposedCheck } from "../rules/coc-engine";
import { NPCAgent } from "../agent/npc-agent";
import { KPAgent } from "../agent/kp-agent";
import { AgentRegistry } from "../agent/agent-registry";
import { WorldStateManager } from "../state/world-state-manager";
import { NPCCombatEngine } from "../combat/npc-combat";
import { CompanionManager } from "../combat/companion-manager";
import { PlayerSession, type VisibilityRule } from "../session/player-session";
import { InvestigationEngine } from "../investigation/investigation-engine";
import { SpellEngine } from "../spell/spell-engine";
import { WorldModelLoader } from "../world/world-model-loader";
import { WorldModelIntegrator } from "../world/world-model-integrator";
import { NPCStore } from "../db/index";
import { assessModuleDifficulty } from "../rules/module-difficulty";
import type { DifficultyProfile } from "../rules/module-difficulty";
import { CharacterFactory, type GeneratedCharacter } from "../character/character-factory";
import { StoryGenerator } from "../rules/story-generator";
import { CareerFileStore } from "../character/career-file";
import { createGameTime, advanceTime, formatGameTime, periodAtmosphere, type GameTime } from "../rules/game-time";
import { listTables, rollTable } from "../rules/random-tables";
import { listStatusDefs, getStatusDef, createStatus, formatStatus, type StatusEffect } from "../rules/status-effects";
import { MythosModuleLoader } from "../rules/mythos-module";
import { PREMIERS_BARN_MODULE, ARKHAM_LIBRARY_MODULE, INNSMOUTH_MODULE } from "../rules/mythos-module";
import { getModule as getCustomModule } from "../rules/custom-modules/index";
import { cocWeaponsRef, cocChaseRef, cocInsanityRef, cocReferenceHelp } from "../rules/coc-reference";
import { saveSessionMeta, deleteSessionFile } from "./session-store";
import type { CombatResult, WorldEntity, ActionIntent, CoCWeaponDef } from "../types";
import type { NPCPersonality, AgentMessage, TurnRecord } from "../agent/types";

export interface ActionResponse {
  narrative: string;
  events: { speaker: string; content: string; type: string }[];
  state: {
    scene: string;
    round: number;
    player: { name: string; hp: number; maxHp: number; ac: number; status: string[] };
    npcs: { name: string; hp: number; maxHp: number; status: string[]; attitude?: string }[];
    monsters: { name: string; hp: number; maxHp: number; status: string[] }[];
    companions: {
      id: string; name: string; hp: number; maxHp: number; ac: number;
      morale: number; behavior: string; control: string; position: string;
      inventory: string[]; motivation?: string;
      traits: Record<string, number> | null; skills: Record<string, number> | null;
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

function generateId(): string {
  return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export class GameSession {
  readonly id: string;
  readonly createdAt: number;
  lastActiveAt: number;
  readonly config: LLMConfig;
  readonly llm: LLMClient;
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
  readonly npcStore: NPCStore;
  readonly companionManager: CompanionManager;

  activeRuleset: RulesetId = "coc7e";
  activePlayerId: string = "p1";
  activeCharacter: any = null;
  round: number = 0;
  dead: boolean = false;
  combatActive: boolean = false;

  private characters: Map<string, any> = new Map();
  private sanityEngines: Map<string, SanityEngine> = new Map();
  private inventoryMap: Map<string, string[]> = new Map();
  private equippedWeaponsMap: Map<string, string[]> = new Map();
  private equippedArmorMap: Map<string, string[]> = new Map();
  private sceneItems: Map<string, string[]> = new Map();
  private sceneDisplayNames: Record<string, string> = {};
  private sceneAliases: Record<string, string[]> = {};
  private registeredModules: any[] = [];
  private lastNarrative: string = "";
  private lastDiceRoll: { expr: string; total: number; detail?: string; bonus?: number } | null = null;
  private gameTime: GameTime = createGameTime();
  private activeDifficulty: DifficultyProfile | null = null;
  private monstersSeen: Set<string> = new Set();
  public careerStore: CareerFileStore | null = null;
  private storyGenerator = new StoryGenerator();
  public skillGrowthMarks: string[] = [];
  public skillMarks: Record<string, number> = {};
  private _woundsTreated: boolean = false;
  private _moduleStartByPC: Map<string, { san: number; cm: number }> = new Map();
  private mythosSpells: Map<string, { sanCost: string; mpCost: number; description: string; effect?: string }> = new Map();
  public knownMythosSpells: string[] = [];
  private _lastPushedRoll: { skill: string; roll: number; target: number } | null = null;

  constructor(
    id: string,
    ruleset: RulesetId = "coc7e",
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

    this.ruleEngine = new RuleEngine();
    this.rules = new RulesEngine(ruleset);
    this.session = new PlayerSession();
    this.world = new WorldStateManager(`:memory:`);
    this.npcCombat = new NPCCombatEngine();
    this.companionManager = new CompanionManager();
    this.investigation = new InvestigationEngine();
    this.spellEngine = new SpellEngine();
    this.registry = new AgentRegistry();
    this.kp = new KPAgent({ scene_description: "", scene_elements: [], current_phase: "exploration", style: "standard", plot_nodes: [] }, this.llm);
    this.worldModel = new WorldModelLoader();
    this.wmIntegrator = new WorldModelIntegrator();
    this.npcStore = new NPCStore();

    this.sanity = new SanityEngine(50, 50);
    this.sanityEngines.set("p1", this.sanity);

    this.inventoryMap.set("p1", []);
    this.equippedWeaponsMap.set("p1", []);
    this.equippedArmorMap.set("p1", []);

    // 创建初始角色
    if (archetypeId) {
      try {
        const char = CharacterFactory.generate(
          characterName ?? "调查员",
          archetypeId ?? "investigator",
          ruleset
        );
        this.activeCharacter = char;
        this.characters.set("p1", char);
        this.session.switchActive("p1");
        // 创建角色卡档案（独立目录）
        const careerDir = `data/careers/${this.id}`;
        try { rmSync(careerDir, { recursive: true }); } catch {}
        this.careerStore = new CareerFileStore(careerDir);
        this.careerStore.saveSnapshot({
          characterName: char.name,
          occupation: char.archetype?.label ?? char.archetype ?? (archetypeId ?? "investigator"),
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
        console.warn("角色创建失败", e);
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
      archetype: this.activeCharacter?.archetype?.id ?? null,
      messageCount: msgs.length, npcCount, createdAt: this.createdAt,
    };
  }

  getState(): ActionResponse["state"] {
    const state = this.world.getCurrentState();
    const playerEnt = state.entities["player"];
    const npcs = Object.values(state.entities).filter(e => e.type === "npc" && e.hp > 0);
    const monsters = Object.values(state.entities).filter(e => e.type === "monster" && e.hp > 0);
    const comps = this.companionManager.getActiveCompanions().map(c => ({
      id: c.config.id, name: c.config.name, hp: c.hp, maxHp: c.config.maxHp,
      ac: c.config.ac, morale: c.morale, behavior: c.behavior, control: c.control,
      position: c.position, inventory: c.inventory, motivation: c.config.motivation,
      traits: c.config.traits ?? null, skills: c.config.skills ?? null,
      resolveState: c.resolveState,
    }));
    return {
      scene: state.scene, round: this.round,
      player: playerEnt ? { name: playerEnt.name, hp: playerEnt.hp, maxHp: playerEnt.maxHp, ac: this.activeRuleset === "coc7e" ? 0 : playerEnt.ac, status: playerEnt.status } : { name: "调查员", hp: 12, maxHp: 12, ac: 0, status: [] },
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
      name: c.name, archetype: c.archetype?.label ?? c.archetype,
      attributes: c.attributes, hp: c.hp, maxHp: c.maxHp,
      ac: CharacterFactory.computeAC(c), skills: c.skills ?? c.skillValues,
      totalLevel: c.totalLevel,
    };
  }

  getHistory(limit?: number) {
    const msgs = this.session.getActiveHistory();
    return { messages: msgs.slice(-(limit ?? msgs.length)), total: msgs.length };
  }

  addMessage(speaker: string, content: string, type: string = "dialogue", visibility: VisibilityRule = "public", discoverer?: string) {
    this.session.push({ speaker, content, type: type as any }, visibility, discoverer);
  }

  private buildActionResponse(turnMessages: AgentMessage[]): ActionResponse {
    const state = this.getState();
    return {
      narrative: this.lastNarrative,
      events: turnMessages.map(m => ({ speaker: m.speaker, content: m.content, type: m.type })),
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

  async getOpeningScene(): Promise<string> {
    try {
      const desc = await this.kp.describeScene();
      this.lastNarrative = desc;
      return desc;
    } catch {
      return "夜幕降临，故事由此开始……";
    }
  }

  // ============================================================
  // KP 面板
  // ============================================================

  getKPState(): any {
    const worldState = this.world.getCurrentState();
    const companions = this.companionManager.getActiveCompanions();
    const curModule = this.registeredModules[0] ?? null;
    const pos = this.getPlayerPosition();
    const sceneItems = this.sceneItems.get(pos) ?? [];

    const characters: any[] = [];
    for (const [pid, ch] of this.characters) {
      const sanEng = this.sanityEngines.get(pid) ?? this.sanity;
      const inv = this.inventoryMap.get(pid) ?? [];
      const weps = this.equippedWeaponsMap.get(pid) ?? [];
      const armors = this.equippedArmorMap.get(pid) ?? [];
      characters.push({
        playerId: pid, name: ch.name,
        archetype: ch.archetype?.label ?? ch.archetype?.id ?? "调查员",
        attributes: ch.attributes, hp: ch.hp, maxHp: ch.maxHp, ac: ch.ac ?? 0,
        san: sanEng.state.currentSAN, maxSan: sanEng.state.maxSAN,
        cthulhuMythos: sanEng.state.cthulhuMythos ?? 0,
        temporaryInsanity: sanEng.state.temporaryInsanity,
        indefiniteInsanity: sanEng.state.indefiniteInsanity,
        luck: ch.luck ?? 60, skills: ch.skillValues ?? {},
        inventory: inv, weapons: weps, armor: armors.map((a: any) => a?.name ?? a),
      });
    }

    return {
      sessionId: this.id, round: this.round,
      ruleset: this.activeRuleset,
      scene: this.sceneDisplayNames[pos] ?? pos,
      characters, combatActive: this.combatActive,
      companions: companions.map(c => ({
        id: c.config.id, name: c.config.name, hp: c.hp, maxHp: c.config.maxHp,
        ac: c.config.ac, morale: c.morale, behavior: c.behavior,
        control: c.control, position: c.position, inventory: c.inventory,
        skills: c.config.skills, resolveState: c.resolveState,
      })),
      npcs: Object.values(worldState.entities).filter(e => (e.type === "npc" || e.type === "monster") && e.hp > 0).map(e => ({ name: e.name, type: e.type, hp: e.hp, maxHp: e.maxHp })),
      sceneItems, difficulty: this.activeDifficulty,
      module: curModule ? { id: curModule.id, name: curModule.name, difficulty: curModule.difficulty } : null,
      gameTime: { day: this.gameTime.day, period: this.gameTime.period, label: formatGameTime(this.gameTime) },
    };
  }

  sendMessage(speaker: string, content: string, type: string = "system") {
    this.addMessage(speaker, content, type);
  }
  setPlayerSan(pid: string, value: number) {
    let eng = this.sanityEngines.get(pid);
    if (!eng) {
      eng = new SanityEngine(value, Math.max(value, 50));
      this.sanityEngines.set(pid, eng);
    }
    eng.state.currentSAN = Math.max(0, Math.min(value, eng.state.maxSAN));
    if (pid === this.activePlayerId) this.sanity = eng;
  }
  setPlayerHp(pid: string, value: number) {
    const ch = this.characters.get(pid);
    if (!ch) return;
    ch.hp = Math.max(0, Math.min(value, ch.maxHp ?? 99));
    // 同步世界实体（若不存在则创建）
    let ent = this.world.getEntity(pid);
    if (!ent) {
      ent = { id: pid, name: ch.name ?? pid, type: "pc", hp: ch.hp, maxHp: ch.maxHp ?? 99, ac: ch.ac ?? 10, status: [], position: this.world.getCurrentState().scene ?? "tavern" };
    } else {
      ent.hp = ch.hp;
    }
    this.world.upsertEntity(ent);
  }
  applyDamage(entityId: string, damage: number) {
    this.world.applyDamage(entityId, Math.max(0, damage));
  }
  setScene(sceneId: string) {
    this.world.getCurrentState().scene = sceneId;
  }
  setDifficulty(diff: "easy" | "medium" | "hard" | "nightmare") {
    const profiles: Record<string, DifficultyProfile> = {
      easy: { label: "简单", description: "线索充裕，敌人较弱", penaltyDice: -1, sanMultiplier: 0.8, clueOnFail: "generous" },
      medium: { label: "标准", description: "平衡的挑战", penaltyDice: 0, sanMultiplier: 1.0, clueOnFail: "partial" },
      hard: { label: "困难", description: "线索稀缺，敌人凶悍", penaltyDice: 1, sanMultiplier: 1.2, clueOnFail: "minimal" },
      nightmare: { label: "噩梦", description: "九死一生", penaltyDice: 2, sanMultiplier: 1.5, clueOnFail: "hidden" },
    };
    this.activeDifficulty = profiles[diff];
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
      return this.buildActionResponse([{ speaker: "系统", content: "你已经死了。请重新开始。", type: "system" }]);
    }
    this.round++;
    this.gameTime = advanceTime(this.gameTime);
    this.companionManager.newRound();
    const turnMessages: AgentMessage[] = [];

    if (actingCharacterName && actingCharacterName !== this.session.getActive()?.characterName) {
      for (const [pid, ch] of this.characters) {
        if (ch.name === actingCharacterName && pid !== this.activePlayerId) {
          this.sanityEngines.set(this.activePlayerId, this.sanity);
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
      const ch = CharacterFactory.generate(name, cls, this.activeRuleset);
      const pid = `p${this.characters.size + 1}`;
      const san = new SanityEngine(50, 50);
      this.characters.set(pid, ch);
      this.sanityEngines.set(pid, san);
      this.inventoryMap.set(pid, []);
      this.equippedWeaponsMap.set(pid, []);
      this.equippedArmorMap.set(pid, []);
      turnMessages.push({ speaker: "系统", content: `👤 ${name}(${cls}) 加入了队伍`, type: "system" });
      return this.buildActionResponse(turnMessages);
    }

    turnMessages.push({ speaker: playerName, content: input, type: "action" });

    // NPC/同伴指令检测
    const inviteMatch = input.match(/^邀请\s+(.+)/);
    const farewellMatch = input.match(/^告别\s+(.+)/);
    const controlMatch = input.match(/^(?:控制|接管|手操)\s+(.+)/);
    const autoMatch = input.match(/^(?:自动|放手|AI)\s+(.+)/);

    if (inviteMatch) {
      turnMessages.push({ speaker: "系统", content: `你向 ${inviteMatch[1].trim()} 发出了邀请`, type: "system" });
      return this.buildActionResponse(turnMessages);
    }
    if (farewellMatch) {
      turnMessages.push({ speaker: "系统", content: `${farewellMatch[1].trim()} 离开了队伍`, type: "system" });
      return this.buildActionResponse(turnMessages);
    }
    if (controlMatch) {
      turnMessages.push({ speaker: "系统", content: `你接管了 ${controlMatch[1].trim()} 的控制权`, type: "system" });
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

        // 检定（简化版）
        const skill = 50;
        const roll = Math.floor(Math.random() * 100) + 1;
        const success = roll <= skill;
        const isCrit = roll <= skill * 0.05;
        const isFumble = roll > 95;

        let dmg = 0;
        if (success) {
          dmg = isCrit ? Math.floor(Math.random() * 12) + 6 : Math.floor(Math.random() * 6) + 1;
          target.hp = Math.max(0, target.hp - dmg);
          this.world.upsertEntity(target);
        }

        const hitMsg = isFumble ? "大失败！" : isCrit ? "暴击！" : success ? "命中" : "未命中";
        turnMessages.push({
          speaker: "系统",
          content: `🎲 检定 d100=${roll} (目标=${skill}) ${hitMsg}${success ? `，对 ${target.name} 造成 ${dmg} 点伤害` : ""}`,
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
          if (c.hp > 0 && c.behavior !== "defensive") {
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

        // 检查战斗结束
        const aliveEnemies = Object.values(state.entities).filter(e => (e.type === "monster" || e.type === "npc") && e.hp > 0);
        if (aliveEnemies.length === 0) {
          this.combatActive = false;
          turnMessages.push({ speaker: "系统", content: "✋ 所有敌人已被击败，战斗结束", type: "system" });
        }

        return this.buildActionResponse(turnMessages);
      }
    }

    // LLM 叙事
    try {
      const narration = await this.kp.narrateOutcome(input, `玩家行动: ${input}`, turnMessages);
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
      case "move": return this.handleMove(intent, msg);
      case "look": msg("你环顾四周，观察着周围的环境……"); this.lastNarrative = "你仔细观察了周围的环境。"; return true;
      case "inventory": return this.handleInventory(msg);
      case "flee": return this.handleFlee(messages, msg);
      case "rest": return this.handleRest(messages, msg);
      case "san_check": return this.handleSanCheck(intent, messages, msg);
      case "skill_check": return this.handleSkillCheck(intent, messages, msg);
      case "saving_throw": return this.handleSavingThrow(intent, messages, msg);
      case "attack": return this.handleAttack(intent, messages, msg);
      case "create_character": return this.handleCreateCharacter(intent, input, messages, msg);
      case "list_occupations": return this.handleListOccupations(messages, msg);
      case "buy": return this.handleBuy(intent, messages, msg);
      case "sell": return this.handleSell(intent, messages, msg);
      case "legacy": return this.handleLegacy(intent, input, messages, msg);
      case "generate_story": return this.handleGenerateStory(messages, msg);
      case "load_module": return this.handleLoadModule(intent, input, messages, msg);
      case "skill_advancement": return this.handleSkillAdvancement(messages, msg);
      case "cast": case "occult_cast": return this.handleCast(intent, input, messages, msg);
      case "read": return this.handleRead(intent, input, messages, msg);
      case "first_aid": return this.handleFirstAid(messages, msg);
      case "reload": return this.handleReload(intent, messages, msg);
      case "push": return this.handlePush(messages, msg);
      case "chase": return this.handleChase(messages, msg);
      case "use_item": case "pickup": msg(`你尝试${intent.action === "pickup" ? "捡起" : "使用"}物品。`); this.lastNarrative = `你${intent.action === "pickup" ? "捡起了" : "使用了"}物品。`; return true;
      case "talk": msg("你试图与周围的人交流……"); this.lastNarrative = "你试图与周围的人交流。"; return true;
      case "spell_list": msg("当前可用法术：暂无已知法术。"); this.lastNarrative = "你回忆了一下已知的法术。"; return true;
      case "shop": msg("商店功能尚未开放。"); this.lastNarrative = "商店功能尚未开放。"; return true;
      case "view_module": msg("模组详情功能。"); this.lastNarrative = "模组详情。"; return true;
      case "insanity_guidance": msg("疯狂指引：当SAN大幅下降时，角色可能出现各种精神障碍……"); this.lastNarrative = "疯狂指引。"; return true;
      case "allocate_skills": msg("技能分配功能。"); this.lastNarrative = "技能分配。"; return true;
      case "equip": case "unequip": msg(`执行${intent.action === "equip" ? "装备" : "卸下"}操作。`); this.lastNarrative = `${intent.action === "equip" ? "装备" : "卸下"}完成。`; return true;
      default: return false;
    }
  }

  // ============================================================
  // 意图处理器
  // ============================================================

  // ── 帮助 ──
  private handleHelp(msg: (s: string) => number): boolean {
    const helpText = [
      "【操作指南】",
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
      "— 技能与检定 —",
      "  调查<目标>/侦查<区域> → 进行技能检定",
      "  SAN检定/理智检定 → 进行理智检定",
      "  豁免检定 → 进行豁免检定",
      "  推动 → 重试失败的检定",
      "",
      "— 物品与商店 —",
      "  购买 <物品> → 购买物品",
      "  出售 <物品> → 出售物品",
      "",
      "— 传承系统 —",
      "  传承 → 查看传承说明",
      "  保存角色 → 保存当前角色",
      "  传承列表 → 查看已保存角色",
      "  读档 <角色名> → 加载已保存角色",
      "",
      "— 模组与故事 —",
      "  生成故事 → 随机生成冒险故事",
      "  加载模组 <模组名> → 加载剧本杀模组",
      "  模组结算 → 结算模组成长",
      "",
      "— 其他 —",
      "  休息 → 休整恢复",
      "  急救/包扎 → 处理伤口",
      "  阅读<典籍> → 阅读神话典籍",
      "  施法<法术名> → 施展法术",
      "",
      cocReferenceHelp(),
    ].join("\n");
    this.lastNarrative = helpText;
    msg(helpText);
    return true;
  }

  // ── 状态显示 ──
  private handleStatus(messages: AgentMessage[]): boolean {
    if (!this.activeCharacter) {
      this.lastNarrative = "你还没有创建角色。使用「创建角色 <职业> <姓名>」来创建调查员。";
      messages.push({ speaker: "系统", content: "尚未创建角色。使用「创建角色 <职业> <姓名>」来创建调查员。", type: "system" });
      return true;
    }
    const c = this.activeCharacter;
    const san = this.getSanity();
    const lines: string[] = [];
    lines.push(`━━━ ${c.name} ━━━`);
    if (this.activeRuleset === "coc7e") {
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
      const db = calcDamageBonus(str, siz);
      const build = (str + siz <= 64 ? -2 : str + siz <= 84 ? -1 : str + siz <= 124 ? 0 : str + siz <= 164 ? 1 : 2);
      const move = dex < siz && str < siz ? 7 : siz <= str && siz <= dex ? 9 : 8;
      lines.push(`职业: ${c.archetype?.label ?? c.archetype ?? "调查员"}`);
      lines.push(`HP: ${c.hp ?? 12}/${c.maxHp ?? 12}  SAN: ${san.currentSAN}/${san.maxSAN}`);
      lines.push(`STR:${str} CON:${con} SIZ:${siz} DEX:${dex} APP:${app}`);
      lines.push(`EDU:${edu} INT:${intel} POW:${pow} 幸运:${luck}`);
      lines.push(`DB:${db}  Build:${build}  Move:${move}  MP:${mp}`);
      lines.push(`CR:${c.creditRating ?? 30}  燃运:${luck}`);
      if (c.skills ?? c.skillValues) {
        const skills = c.skills ?? c.skillValues ?? {};
        const skillEntries = Object.entries(skills).slice(0, 10);
        if (skillEntries.length > 0) {
          lines.push("技能: " + skillEntries.map(([k, v]) => `${k}:${v}%`).join(", "));
        }
      }
    } else {
      const ac = CharacterFactory.computeAC(c);
      lines.push(`职业: ${c.archetype?.label ?? c.archetype ?? "冒险者"}`);
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
    // 确保场景在 DB 中存在并设为活动
    const db = (this.world as any).getDatabase() as any;
    db.run("INSERT OR IGNORE INTO scenes (id, name, description, is_active) VALUES (?, ?, ?, 0)", [sceneId, target, `${target}的场景`]);
    this.world.setActiveScene(sceneId);
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
    const inv = this.inventoryMap.get(this.activePlayerId) ?? [];
    if (inv.length === 0) {
      msg("你的背包是空的。");
      this.lastNarrative = "你的背包里空空如也。";
    } else {
      msg(`你的背包: ${inv.join(", ")}`);
      this.lastNarrative = `你的背包里有: ${inv.join(", ")}。`;
    }
    return true;
  }

  // ── 逃跑 ──
  private handleFlee(messages: AgentMessage[], msg: (s: string) => number): boolean {
    this.combatActive = false;
    this.lastNarrative = "你转身逃跑，迅速脱离了战斗！";
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
      this.lastNarrative = "你在篝火旁坐下，稍作休整……";
      msg("你在篝火旁坐下，稍作休整。");
      return true;
    }
    const c = this.activeCharacter;

    // 技能成长检定（有标记时）
    if (this.skillGrowthMarks && this.skillGrowthMarks.length > 0) {
      const marks = [...new Set(this.skillGrowthMarks)];
      for (const skill of marks) {
        const roll = Math.floor(Math.random() * 100) + 1;
        const currentSkill = (c.skillValues?.[skill] ?? c.skills?.[skill] ?? 50);
        if (roll > currentSkill) {
          const increase = Math.floor(Math.random() * 10) + 1;
          if (c.skillValues) c.skillValues[skill] = Math.min(99, currentSkill + increase);
          else if (c.skills) c.skills[skill] = Math.min(99, currentSkill + increase);
          messages.push({ speaker: "系统", content: `🎲 技能成长检定 d100=${roll} (当前=${currentSkill}%) → 成功！${skill} +${increase}%`, type: "system" });
        } else {
          messages.push({ speaker: "系统", content: `🎲 技能成长检定 d100=${roll} (当前=${currentSkill}%) → 失败，${skill} 无成长`, type: "system" });
        }
      }
      this.skillGrowthMarks = [];
    }

    if (currentHp >= maxHp) {
      this.lastNarrative = "经过短暂休整，你的身体状况良好，精力充沛。";
      msg("经过短暂休整，你的身体状况良好。");
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
      this.lastNarrative = `伤口在休养后逐渐愈合，恢复了 ${recovery} 点 HP。`;
      msg(`💊 伤口愈合: HP +${recovery} (当前: ${newHp}/${maxHp})`);
    } else {
      this.lastNarrative = "伤口没有得到专业处理，休养效果有限。";
      msg("伤口没有得到专业处理，需要先接受急救。");
    }
    return true;
  }

  // ── SAN 检定 ──
  private handleSanCheck(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const sanCost = intent.sanCost ?? "1/1d6";
    const reason = intent.reason ?? "未知恐惧";
    const result = this.sanity.sanityCheck(sanCost);
    const passed = result.passed;
    const loss = result.sanLoss;
    const roll = result.roll;
    msg(`🧠 SAN 检定 (${reason}): d100=${roll} (目标=${this.sanity.state.currentSAN}) → ${passed ? "通过" : "失败"}！SAN -${loss} (剩余: ${this.sanity.state.currentSAN})`);
    if (result.temporaryInsanity) {
      msg(`⚠️ 临时疯狂触发！${result.boutOfMadness ?? ""}`);
    }
    this.lastNarrative = `SAN 检定结果: ${passed ? "通过" : "失败"}, SAN -${loss}`;
    return true;
  }

  // ── 技能检定 ──
  private handleSkillCheck(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const skill = intent.skill ?? "investigation";
    const skillDisplay = { stealth: "潜行", perception: "侦查", investigation: "调查", persuasion: "说服", medicine: "医学", history: "历史", occult: "神秘学", library_use: "图书馆使用" }[skill] ?? skill;
    const skillValue = this.activeCharacter?.skillValues?.[skill] ?? this.activeCharacter?.skills?.[skill] ?? 50;
    const roll = Math.floor(Math.random() * 100) + 1;
    const success = roll <= skillValue;
    const isCrit = roll <= skillValue * 0.05;
    const isFumble = roll > 95;
    const resultText = isFumble ? "大失败！" : isCrit ? "暴击成功！" : success ? "成功" : "失败";

    // 记录技能标记（用于后续成长）
    if (this.skillGrowthMarks && !this.skillGrowthMarks.includes(skill)) {
      this.skillGrowthMarks.push(skill);
    }

    msg(`🎲 ${skillDisplay}检定 d100=${roll} (目标=${skillValue}%) → ${resultText}`);
    this.lastNarrative = `${skillDisplay}检定: ${resultText}。`;
    return true;
  }

  // ── 豁免检定 ──
  private handleSavingThrow(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const ability = intent.ability ?? "constitution";
    const dc = intent.dc ?? 12;
    const reason = intent.reason ?? "豁免检定";
    const abilityMod = this.activeCharacter?.attributes?.[ability] ? Math.floor(((this.activeCharacter!.attributes[ability] ?? 10) - 10) / 2) : 0;
    const roll = Math.floor(Math.random() * 20) + 1;
    const total = roll + abilityMod;
    const success = total >= dc;
    const abilityNames: Record<string, string> = { strength: "力量", dexterity: "敏捷", constitution: "体质", intelligence: "智力", wisdom: "感知", charisma: "魅力" };
    msg(`🎲 ${abilityNames[ability] ?? ability}豁免 (${reason}): d20=${roll}+${abilityMod}=${total} (DC=${dc}) → ${success ? "通过" : "失败"}`);
    this.lastNarrative = `豁免检定: ${success ? "成功通过" : "失败"}。`;
    return true;
  }

  // ── 攻击 ──
  private handleAttack(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
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
    const hitMsg = isFumble ? "大失败！" : isCrit ? "暴击！" : success ? "命中" : "未命中";

    msg(`⚔️ 攻击检定 d100=${effectiveRoll} (目标=${skill}%)${luckSpendMsg} → ${hitMsg}${dmg > 0 ? `，造成 ${dmg} 点伤害` : ""}`);
    if (dmg > 0) {
      const state = this.world.getCurrentState();
      const enemies = Object.values(state.entities).filter(e => (e.type === "monster" || e.type === "npc") && e.hp > 0);
      if (enemies.length > 0) {
        const target = enemies[Math.floor(Math.random() * enemies.length)];
        target.hp = Math.max(0, target.hp - dmg);
        this.world.upsertEntity(target);
        msg(`${target.name} 剩余 HP: ${target.hp}/${target.maxHp}`);
      }
    }
    this.lastDiceRoll = { expr: `d100${luckSpendMsg}`, total: effectiveRoll };
    this.lastNarrative = `你向敌人发起了攻击！${hitMsg}`;
    return true;
  }

  // ── 创建角色 ──
  private handleCreateCharacter(intent: ActionIntent, input: string, messages: AgentMessage[], msg: (s: string) => number): boolean {
    // 解析 "创建角色 [archetype] [name]"
    const parts = input.replace(/^创建角色\s*/, "").trim().split(/\s+/);
    if (parts.length === 0 || parts[0] === "") {
      msg("请指定职业和姓名。用法：创建角色 <职业ID> <姓名>\n可用职业请查看「职业列表」。");
      this.lastNarrative = "请指定职业。";
      return true;
    }
    const archetypeId = parts[0];
    const charName = parts.slice(1).join(" ") || "调查员";
    try {
      const ch = CharacterFactory.generate(charName, archetypeId, this.activeRuleset);
      this.activeCharacter = ch;
      this.characters.set("p1", ch);
      this.session.switchActive("p1");
      // 创建世界实体
      this.world.upsertEntity({
        id: "player", name: charName, type: "pc",
        hp: ch.hp, maxHp: ch.maxHp, ac: CharacterFactory.computeAC(ch),
        status: [], position: this.world.getCurrentState().scene ?? "tavern",
      });
      // 创建 career store（独立目录，清理旧数据）
      if (!this.careerStore) {
        const careerDir = `data/careers/${this.id}`;
        try { rmSync(careerDir, { recursive: true }); } catch {}
        this.careerStore = new CareerFileStore(careerDir);
      }
      this.careerStore.saveSnapshot({
        characterName: ch.name, occupation: ch.archetype?.label ?? ch.archetype ?? archetypeId,
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
      this.lastNarrative = "角色创建失败。";
    }
    return true;
  }

  // ── 职业列表 ──
  private handleListOccupations(messages: AgentMessage[], msg: (s: string) => number): boolean {
    if (this.activeRuleset !== "coc7e") {
      msg("当前不是克苏鲁的呼唤模式。");
      this.lastNarrative = "当前不是克苏鲁的呼唤模式。";
      return true;
    }
    try {
      const archetypes = CharacterFactory.listArchetypes(this.activeRuleset);
      const occupations = archetypes.filter(a => !a.isPrestige).slice(0, 20);
      const lines = ["【调查员职业列表】", ""];
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
  private handleBuy(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const item = intent.item;
    if (!item || item.trim() === "") {
      msg("你想买什么？请指定物品名称。");
      this.lastNarrative = "你想买什么？";
    } else {
      msg(`「${item}」没有找到。当前商店可能没有此物品。`);
      this.lastNarrative = `没有找到「${item}」。`;
    }
    return true;
  }

  // ── 出售 ──
  private handleSell(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const item = intent.item;
    if (!item || item.trim() === "") {
      msg("你想卖什么？请指定物品名称。");
      this.lastNarrative = "你想卖什么？";
    } else {
      msg(`你的背包中没有「${item}」。`);
      this.lastNarrative = `没有「${item}」可出售。`;
    }
    return true;
  }

  // ── 传承 ──
  private handleLegacy(intent: ActionIntent, input: string, messages: AgentMessage[], msg: (s: string) => number): boolean {
    if (input.includes("保存角色")) {
      if (!this.activeCharacter) {
        msg("没有活跃角色可保存。");
        this.lastNarrative = "没有活跃角色。";
        return true;
      }
      if (!this.careerStore) {
        const careerDir = `data/careers/${this.id}`;
        try { rmSync(careerDir, { recursive: true }); } catch {}
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
        try { rmSync(dir, { recursive: true }); } catch {}
        this.careerStore = new CareerFileStore(dir);
      }
      if (input.includes("读档")) {
        const charName = input.replace(/^读档\s*/, "").trim();
        if (!charName) {
          msg("请指定要加载的角色名。");
          this.lastNarrative = "请指定角色名。";
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
        msg("暂无已保存的角色。");
        this.lastNarrative = "暂无已保存的角色。";
      } else {
        msg("已保存的角色: " + chars.join(", "));
        this.lastNarrative = `已保存的角色: ${chars.join(", ")}。`;
      }
      return true;
    }
    // 默认传承说明
    const helpText = [
      "【传承系统】",
      "跨模组角色成长追踪系统。",
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
  private handleGenerateStory(messages: AgentMessage[], msg: (s: string) => number): boolean {
    const story = this.storyGenerator.generate();
    // 清空旧场景数据
    this.sceneDisplayNames = {};
    this.sceneAliases = {};

    // 更新场景
    for (const scene of story.scenes) {
      this.sceneDisplayNames[scene.id] = scene.name;
      this.sceneAliases[scene.id] = [scene.name];
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

    // 设置当前场景为第一个场景
    if (story.scenes.length > 0) {
      this.world.getCurrentState().scene = story.scenes[0].id;
    }

    const sceneNames = story.scenes.map(s => s.name).join(", ");
    this.lastNarrative = `新故事已生成: ${story.title}。\n场景: ${sceneNames}`;
    msg(`📖 新故事已生成: ${story.title}\n场景: ${sceneNames}\n${story.hook ?? ""}`);
    return true;
  }

  // ── 加载模组 ──
  private handleLoadModule(intent: ActionIntent, input: string, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const moduleName = input.replace(/^(?:加载|装载|载入|启用|使用)\s*(?:模组|剧本|模块)\s*/, "").trim();

    if (!this["_moduleLoader"]) {
      const host = {
        mythosSpells: this.mythosSpells,
        knownMythosSpells: this.knownMythosSpells,
        sceneItems: this.sceneItems,
        itemDescriptions: new Map<string, string>(),
        world: this.world,
        addMessage: (speaker: string, content: string, type: string) => this.addMessage(speaker, content, type),
        activeRuleset: this.activeRuleset,
        currentRound: this.round,
      };
      (this as any)["_moduleLoader"] = new MythosModuleLoader(host);
      (this as any)["_loadedModules"] = new Map<string, boolean>();
    }

    // 优先从自定义模组库查找
    let mod: any = null;
    if (moduleName) {
      const customMod = getCustomModule("premiers_barn");
      if (customMod && (customMod.name === moduleName || customMod.module.name === moduleName || moduleName.includes("谷仓"))) {
        mod = customMod.module;
      }
    }
    // 回退到内置模组
    if (!mod && moduleName) {
      const builtinModules: Record<string, any> = {
        "普瑞米尔的谷仓": PREMIERS_BARN_MODULE,
        "阿卡姆档案检索": ARKHAM_LIBRARY_MODULE,
        "印斯茅斯的阴霾": INNSMOUTH_MODULE,
      };
      mod = builtinModules[moduleName];
    }
    // 列出所有可用模组
    const allModules: Record<string, any> = {
      "普瑞米尔的谷仓": moduleName?.includes("谷仓") ? mod : PREMIERS_BARN_MODULE,
      "阿卡姆档案检索": ARKHAM_LIBRARY_MODULE,
      "印斯茅斯的阴霾": INNSMOUTH_MODULE,
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
      const loader = (this as any)["_moduleLoader"] as any;
      const loaded = (this as any)["_loadedModules"] as Map<string, boolean>;
      if (loaded.has(mod.id)) {
        msg(`模组「${mod.name}」已导入。`);
        this.lastNarrative = `模组「${mod.name}」已导入。`;
        return true;
      }
      const lines = loader.import(mod);
      loaded.set(mod.id, true);
      this.registeredModules.push(mod);
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
    if (!this.skillGrowthMarks || this.skillGrowthMarks.length === 0) {
      msg("没有可结算的成长记录。在冒险中使用技能后，失败时自动记录成长标记。");
      this.lastNarrative = "没有可结算的成长。";
      return true;
    }

    const c = this.activeCharacter;
    const marks = [...new Set(this.skillGrowthMarks)];
    const growthResults: string[] = [];
    const skillChanges: string[] = [];

    for (const skill of marks) {
      const roll = Math.floor(Math.random() * 100) + 1;
      const currentSkill = c?.skillValues?.[skill] ?? c?.skills?.[skill] ?? 50;
      if (roll > currentSkill) {
        const increase = Math.floor(Math.random() * 10) + 1;
        if (c?.skillValues) c.skillValues[skill] = Math.min(99, currentSkill + increase);
        else if (c?.skills) c.skills[skill] = Math.min(99, currentSkill + increase);
        growthResults.push(`${skill}: d100=${roll} > ${currentSkill}% → 成长 +${increase}%`);
        skillChanges.push(`${skill}→${Math.min(99, currentSkill + increase)}`);
      } else {
        growthResults.push(`${skill}: d100=${roll} <= ${currentSkill}% → 无成长`);
      }
    }

    this.skillGrowthMarks = [];

    // 记录模组结算到 careerStore
    if (this.careerStore && c) {
      const startStats = (this as any)._moduleStartByPC?.get(this.activePlayerId);
      const sanBefore = startStats?.san ?? this.sanity.state.maxSAN;
      const cmBefore = startStats?.cm ?? 0;
      try {
        this.careerStore.addEntry({
          id: `ce_${Date.now().toString(36)}`,
          characterName: c.name,
          moduleId: this.registeredModules[0]?.id ?? "unknown",
          moduleName: this.registeredModules[0]?.name ?? "未知模组",
          completedAt: new Date().toISOString(),
          endingId: "completed",
          endingName: "模组完成",
          sanChange: this.sanity.state.currentSAN - sanBefore,
          cmChange: (this.sanity.state.cthulhuMythos ?? 0) - cmBefore,
          reputationChange: 0,
          skillChanges,
          rewardIds: [],
          narrative: "模组结算完成",
        });
      } catch {}
    }

    const resultText = ["【技能成长结算】", ...growthResults].join("\n");
    msg(resultText);
    // 模组完成消息
    messages.push({ speaker: "系统", content: "模组完成！", type: "system" });
    this.lastNarrative = resultText;
    return true;
  }

  // ── 施法 ──
  private handleCast(intent: ActionIntent, input: string, messages: AgentMessage[], msg: (s: string) => number): boolean {
    if (intent.action === "occult_cast" && this.activeRuleset !== "coc7e") {
      msg("神话法术仅支持克苏鲁的呼唤模式。");
      this.lastNarrative = "神话法术仅支持克苏鲁的呼唤模式。";
      return true;
    }
    if (!this.activeCharacter) {
      msg("你还没有创建角色。");
      this.lastNarrative = "你还没有创建角色。";
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
      msg("你尚未学会任何神话法术。阅读神话典籍可以领悟法术。");
      this.lastNarrative = "你尚未学会神话法术。";
      return true;
    }
    // D&D cast
    const spellName = intent.spell ?? intent.target ?? "法术";
    msg(`你施展了「${spellName}」！`);
    this.lastNarrative = `你施展了「${spellName}」。`;
    return true;
  }

  // ── 阅读典籍 ──
  private handleRead(intent: ActionIntent, input: string, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const tomeName = input.replace(/^(?:阅读|读|翻阅)\s*/, "").trim();
    // 典籍定义
    const tomes: Record<string, { sanCost: string; cmGain: number; spellCount: number; spells: string[] }> = {
      "死灵之书": { sanCost: "1d10/1d100", cmGain: 10, spellCount: 7, spells: ["呼唤米戈", "放逐术", "克苏鲁之眼", "肉傀儡创造", "亡者苏生", "时空门", "旧日支配者之印记"] },
      "无名祭祀书": { sanCost: "1d6/1d20", cmGain: 6, spellCount: 4, spells: ["召唤暗影", "灵魂转移", "死灵沟通", "诅咒"] },
      "黄衣之王": { sanCost: "1d8/1d20", cmGain: 8, spellCount: 4, spells: ["黄衣之印", "疯狂低语", "幻象编织", "哈斯塔之触"] },
      "塞拉伊诺断章": { sanCost: "1d6/1d20", cmGain: 5, spellCount: 3, spells: ["时空感知", "星之投射", "塞拉伊诺之眼"] },
      "阿卡姆特集": { sanCost: "1d4/1d10", cmGain: 4, spellCount: 0, spells: [] },
    };

    const tome = tomes[tomeName];
    if (!tome) {
      // 非典籍物品
      msg(`你翻阅了「${tomeName}」。`);
      this.lastNarrative = `你翻阅了「${tomeName}」。`;
      return true;
    }

    // SAN 检定
    const result = this.sanity.sanityCheck(tome.sanCost);
    const passed = result.passed;
    const sanLoss = result.sanLoss;
    const roll = result.roll;
    msg(`🧠 阅读「${tomeName}」SAN 检定: d100=${roll} (目标=${this.sanity.state.currentSAN}) → ${passed ? "通过" : "失败"}！SAN -${sanLoss} (剩余: ${this.sanity.state.currentSAN})`);

    // CM 成长
    if (this.sanity.state.cthulhuMythos !== undefined) {
      this.sanity.state.cthulhuMythos += tome.cmGain;
    }
    msg(`📖 克苏鲁神话技能提升 +${tome.cmGain}%`);

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
      msg(`✨ 你领悟了新法术: ${learnedSpells.join(", ")}`);
    } else if (tome.spellCount > 0) {
      msg("你未能领悟任何法术，也许下次会有不同的领悟。");
    }

    this.lastNarrative = `你阅读了「${tomeName}」，SAN -${sanLoss}，克苏鲁神话技能 +${tome.cmGain}%。`;
    return true;
  }

  // ── 急救 ──
  private handleFirstAid(messages: AgentMessage[], msg: (s: string) => number): boolean {
    if (!this.activeCharacter) {
      msg("你还没有创建角色。");
      this.lastNarrative = "你还没有创建角色。";
      return true;
    }
    const c = this.activeCharacter;
    const medicineSkill = c.skillValues?.medicine ?? c.skills?.medicine ?? c.skillValues?.急救 ?? c.skills?.急救 ?? 30;
    const roll = Math.floor(Math.random() * 100) + 1;
    const success = roll <= medicineSkill;
    const isFumble = roll > 95;
    const resultText = isFumble ? "大失败！伤势可能加重" : success ? "成功！伤口得到了处理" : "失败，急救未能止血";

    msg(`💊 急救检定 d100=${roll} (医学/急救=${medicineSkill}%) → ${resultText}`);
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
  private handleReload(intent: ActionIntent, messages: AgentMessage[], msg: (s: string) => number): boolean {
    const weaponName = intent.weapon ?? intent.target ?? "武器";
    msg(`你重新装填了「${weaponName}」。弹药已补满。`);
    this.lastNarrative = `你装填了${weaponName}。`;
    return true;
  }

  // ── 推动检定 ──
  private handlePush(messages: AgentMessage[], msg: (s: string) => number): boolean {
    if (!this._lastPushedRoll) {
      msg("没有待推动的检定。先进行一次技能检定，失败后再使用推动。");
      this.lastNarrative = "没有待推动的检定。";
      return true;
    }
    const { skill, roll: prevRoll, target } = this._lastPushedRoll;
    const newRoll = Math.floor(Math.random() * 100) + 1;
    const success = newRoll <= target;
    const isFumble = newRoll > 95;
    const resultText = isFumble ? "大失败！后果严重" : success ? "推动成功！" : "再次失败，情况恶化";
    msg(`🔄 推动检定 (${skill}): d100=${newRoll} (目标=${target}%) → ${resultText}`);
    this._lastPushedRoll = null;
    this.lastNarrative = `推动检定: ${resultText}。`;
    return true;
  }

  // ── 追逐 ──
  private handleChase(messages: AgentMessage[], msg: (s: string) => number): boolean {
    const roll = Math.floor(Math.random() * 100) + 1;
    const dex = this.activeCharacter?.attributes?.dexterity ?? this.activeCharacter?.attributes?.DEX ?? 50;
    const success = roll <= dex;
    const resultText = success ? "你成功拉开了距离！" : "追逐仍在继续……";
    msg(`🏃 追逐检定 d100=${roll} (DEX=${dex}) → ${resultText}`);
    this.lastNarrative = `追逐: ${resultText}`;
    return true;
  }

  // ============================================================
  // 骰子引擎
  // ============================================================

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
}