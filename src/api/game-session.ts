import { readFileSync } from "fs";
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
  private careerStore: CareerFileStore | null = null;
  private storyGenerator = new StoryGenerator();

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
    this.world = new WorldStateManager(ruleset);
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
    const eng = this.sanityEngines.get(pid) ?? this.sanity;
    eng.state.currentSAN = Math.max(0, Math.min(value, eng.state.maxSAN));
  }
  setPlayerHp(pid: string, value: number) {
    const ch = this.characters.get(pid);
    if (!ch) return;
    ch.hp = Math.max(0, Math.min(value, ch.maxHp ?? 99));
    const ent = this.world.getEntity(pid);
    if (ent) { ent.hp = ch.hp; this.world.upsertEntity(ent); }
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
      const ch = CharacterFactory.create({ name, archetype: cls } as any, this.activeRuleset);
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
    // 简单叙事
    this.lastNarrative = `${playerName}：${input}`;
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