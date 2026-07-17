// AI TRPG POC — 多 Agent 游戏主循环（v2：含世界状态管理器）
// 运行: bun run src/index.ts
//
// 流程:
//   玩家输入 → 意图解析 → 律书判定 → 状态写入 → KP叙事 → NPC反应 → 快照 → 等待下轮
//                                                          ↑
//                                             LLM 上下文来自 SQLite 快照
//                                             （非原始对话历史——token 恒定）

import { readFileSync } from "fs";
import { parse as parseYaml } from "yaml";
import { createInterface } from "readline";

import { loadConfig } from "./config";
import { LLMClient } from "./llm/client";
import { parseIntent, setIntentLLM } from "./llm/intent";
import { generateNarrative, setNarratorLLM } from "./llm/narrator";
import { RuleEngine } from "./engine/rule-engine";
import { RulesEngine, type RulesetId } from "./rules/rules-engine";
import { SanityEngine } from "./rules/coc-engine";
import { NPCAgent } from "./agent/npc-agent";
import { KPAgent } from "./agent/kp-agent";
import { AgentRegistry } from "./agent/agent-registry";
import { WorldStateManager } from "./state/world-state-manager";
import { NPCCombatEngine } from "./combat/npc-combat";
import { PlayerSession, type VisibilityRule } from "./session/player-session";
import { InvestigationEngine } from "./investigation/investigation-engine";
import { WorldModelLoader } from "./world/world-model-loader";
import { WorldModelIntegrator } from "./world/world-model-integrator";
import { CharacterFactory, type GeneratedCharacter } from "./character/character-factory";
import { EXTRA_SUBCLASSES } from "./character/subclasses-extra";
import { PRESTIGE_CLASSES } from "./character/prestige-classes";
import { QIANKUN_SUBCLASSES, getAllQiankunLegendaryTemplates } from "./character/qiankun-subclasses";
import { ItemValidator } from "./validator/item-validator";
import { NPCStore } from "./db/index";

CharacterFactory.registerExtra(EXTRA_SUBCLASSES);
CharacterFactory.registerExtra(PRESTIGE_CLASSES);
CharacterFactory.registerExtra(QIANKUN_SUBCLASSES);
CharacterFactory.registerLegendaryTemplates(getAllQiankunLegendaryTemplates());

const itemValidator = new ItemValidator(worldModel);
import type { CombatResult } from "./types";
import type { NPCPersonality, AgentMessage, TurnRecord, KPDirective } from "./agent/types";
import type { GameEvent } from "./state/event-types";

// ============================================================
// 初始化
// ============================================================

const config = loadConfig();
const llm = new LLMClient(config);
setIntentLLM(llm);
setNarratorLLM(llm);

const ruleEngine = new RuleEngine(); // D&D 保留兼容
const rules = new RulesEngine();      // 统一路由
const world = new WorldStateManager();
const npcCombat = new NPCCombatEngine();
const session = new PlayerSession();
const investigation = new InvestigationEngine("./src/rules/investigation.yaml");
const sanity = new SanityEngine(55);
const worldModel = new WorldModelLoader();
worldModel.load("../世界模型/v17_output/world_model_clean.jsonl");
const wmIntegrator = new WorldModelIntegrator(worldModel);

// 当前激活的规则集
let activeRuleset = "dnd5e";

// 默认玩家（向后兼容：始终有一个"调查员"）
session.join("p1", "调查员", "player", "farm_exterior");

// NPC 持久化数据库
const npcStore = new NPCStore();

// 加载 NPC 人格卡 → 注册到热插拔容器
const npcYaml = readFileSync("./src/agent/npcs.yaml", "utf-8");
const npcData: any = parseYaml(npcYaml);
const personalities: NPCPersonality[] = npcData.npcs;
const registry = new AgentRegistry(llm, npcStore);
registry.registerAll(personalities);

// 实体死亡 → 自动注销 Agent
registry.onEvent((name, event) => {
  if (event === "unregister") {
    console.log(`  🔌 Agent 已注销: ${name}`);
  }
});

// KP 指令
const kpDirective: KPDirective = {
  scene_description:
    "普瑞米尔农场外围。夜色已深，月光透过薄云洒在谷仓的木板墙上。空气中有股淡淡的金属味——不像农场的味道。前方是谷仓正门，左侧能看到一扇破损的窗户。远处传来低沉的嗡鸣声。",
  scene_elements: [
    "谷仓正门（虚掩）",
    "破损的窗户（可攀爬进入）",
    "外围捕兽夹×3（陷阱）",
    "远处嗡鸣声的来源不明",
    "小屋透出微弱的灯光（艾德里安的住所）",
  ],
  plot_nodes: [
    { id: "meet_adrian", description: "在小屋遇到看守人艾德里安", trigger: "玩家靠近小屋", done: false },
    { id: "find_gabi", description: "在谷仓发现幸存者加比", trigger: "玩家深入谷仓", done: false },
    { id: "discover_lab", description: "发现地下实验室", trigger: "玩家发现地下室入口", done: false },
  ],
  current_phase: "arrival",
  style: "lovecraft",
};

const kp = new KPAgent(kpDirective, llm);

// ============================================================
// 初始化世界状态
// ============================================================

function seedWorld() {
  // 场景
  world.getDatabase().exec(`
    INSERT OR REPLACE INTO scenes (id, name, description, lighting, dangers, exits, is_active) VALUES
    ('farm_exterior', '农场外围',
     '普瑞米尔农场外围。谷仓矗立在月光下，木板墙上爬满藤蔓。空气中有一股说不清的金属味。',
     'moonlight', '["捕兽夹×3"]',
     '[{"target":"barn_interior","desc":"谷仓正门(虚掩)","locked":false},{"target":"cabin","desc":"小屋(微弱灯光)","locked":false}]',
     1),
    ('barn_interior', '谷仓内部',
     '昏暗的谷仓内部。几排空床铺，一堆干草。角落里有什么东西在动。地板上有暗红色的痕迹。',
     'dim', '[]',
     '[{"target":"farm_exterior","desc":"谷仓正门","locked":false},{"target":"basement","desc":"地下室暗门(需要搜索)","locked":true}]',
     0),
    ('cabin', '艾德里安的小屋',
     '简陋但整洁的猎人小屋。桌上有一盏油灯和一本翻开的日记。墙上挂着一把旧猎枪。',
     'warm_light', '[]',
     '[{"target":"farm_exterior","desc":"小屋门","locked":false}]',
     0),
    ('basement', '地下室',
     '楼梯通向黑暗。金属味越来越浓。墙壁上的符号在黑暗中微微发光。',
     'dark', '["Mi-Go"]',
     '[{"target":"barn_interior","desc":"暗门","locked":false}]',
     0)
  `);

  // 实体
  world.seedEntities([
    { id: "player", name: "调查员", type: "pc", hp: 12, maxHp: 12, ac: 12, status: [], position: "farm_exterior", scene_id: "farm_exterior" },
    { id: "adrian", name: "艾德里安", type: "npc", hp: 20, maxHp: 20, ac: 14, status: [], position: "cabin", scene_id: "cabin", faction: "看守人" },
    { id: "gabi", name: "加比", type: "npc", hp: 6, maxHp: 6, ac: 10, status: ["frightened"], position: "barn_interior", scene_id: "barn_interior", faction: "幸存者" },
    { id: "migo", name: "米戈", type: "monster", hp: 45, maxHp: 45, ac: 16, status: [], position: "basement", scene_id: "basement", faction: "犹格斯访客" },
    { id: "wolf_1", name: "野狼", type: "monster", hp: 11, maxHp: 11, ac: 13, status: [], position: "farm_exterior", scene_id: "farm_exterior", faction: "野兽" },
    { id: "wolf_2", name: "野狼", type: "monster", hp: 9, maxHp: 11, ac: 13, status: [], position: "farm_exterior", scene_id: "farm_exterior", faction: "野兽" },
  ]);

  // 初始关系
  world.setRelation("adrian", "player", "neutral", -10); // 不信任
  world.setRelation("gabi", "player", "neutral", 20);     // 渴望被相信
  world.setRelation("adrian", "gabi", "suspicious", -30);
  world.setRelation("migo", "adrian", "neutral", 0);       // 交易关系
  world.setRelation("migo", "player", "neutral", 0);
}

seedWorld();

// ============================================================
// 辅助
// ============================================================

function addMessage(
  speaker: string, content: string,
  type: AgentMessage["type"] = "dialogue",
  visibility: VisibilityRule = "public",
  discoverer?: string
) {
  const msg: AgentMessage = { speaker, content, type };
  session.push(msg, visibility, discoverer);

  const importance = type === "narration" ? 7 : 5;
  for (const npc of registry.getAll()) {
    if (npc.name !== speaker) {
      if (type === "narration") npc.rememberEvent(content, importance);
      else npc.rememberDialogue(speaker, content, importance);
    }
  }
}

let round = 0;

const playerCharacter = {
  name: "调查员", id: "player",
  proficiency: 2,
  abilities: { strength: 12, dexterity: 14, constitution: 12, intelligence: 15, wisdom: 14, charisma: 10 },
  hasSneakAttack: false,
};

// 角色卡（可被 /create 替换）
let activeCharacter: GeneratedCharacter | null = null;

function divider(char = "─", len = 60) {
  return char.repeat(len);
}

/** 获取当前世界状态上下文（注入 LLM） */
function getPlayerHistory(): AgentMessage[] {
  return session.getActiveHistory();
}

function getActiveScene(): string {
  return kp.getDirective().current_phase;
}

function getPlayerAttributes(): { name: string; id: string; proficiency: number; abilities: Record<string, number>; hasSneakAttack: boolean } {
  if (activeCharacter) {
    return {
      name: activeCharacter.name, id: "player",
      proficiency: 2,
      abilities: activeCharacter.attributes,
      hasSneakAttack: activeCharacter.archetype.id === "scout",
    };
  }
  return playerCharacter;
}

function getActiveSceneKeywords(): string[] {
  const directive = kp.getDirective();
  const words = [directive.current_phase, ...directive.scene_elements];
  const state = world.getCurrentState();
  for (const e of Object.values(state.entities)) {
    if (e.hp > 0) words.push(e.name);
  }
  return words;
}

function buildSceneContext() {
  const state = world.getCurrentState();
  const directive = kp.getDirective();
  return {
    sceneId: state.scene,
    sceneName: directive.scene_description.slice(0, 40),
    keywords: getActiveSceneKeywords(),
    presentNPCs: Object.values(state.entities)
      .filter(e => e.type === "npc" && e.hp > 0)
      .map(e => e.name),
    discoveredClues: investigation.getDiscoveredBy(session.getActive()?.name ?? "p1"),
    round,
  };
}

// ============================================================
// 玩家输入处理
// ============================================================

async function handlePlayerInput(input: string) {
  round++;
  const turnMessages: AgentMessage[] = [];
  const activePlayer = session.getActive();
  const playerName = activePlayer?.characterName ?? "调查员";
  const playerId = activePlayer?.characterId ?? "player";

  // 世界状态写入当前回合
  world.logEvent({
    round, timestamp: Date.now(),
    event_type: "system",
    description: `玩家输入: ${input}`,
  });

  // Step 1: 意图解析
  const intent = await parseIntent(input);
  const worldCtx = getWorldContext();

  if (intent.action === "attack" && intent.target) {
    await handleCombat(intent, turnMessages, worldCtx);
  } else if (intent.action === "move") {
    await handleMovement(intent, turnMessages, worldCtx);
  } else if (intent.action === "skill_check") {
    await handleInvestigation(input, intent, turnMessages, worldCtx);
  } else {
    await handleFreeNarration(input, turnMessages, worldCtx);
  }

  // ── NPC 战斗阶段 ──
  // 所有在场的敌对 NPC 各自行动一次
  const state = world.getCurrentState();
  const playerEntity = state.entities["player"];
  if (playerEntity) {
    const hostileNPCs = Object.values(state.entities).filter(
      (e) => npcCombat.shouldEngage(e, playerEntity)
    );
    for (const npc of hostileNPCs) {
      const npcIntent = npcCombat.decide(npc, world, activeRuleset);
      if (!npcIntent) {
        // NPC 逃跑或无法行动
        if (npc.hp / npc.maxHp <= 0.3) {
          const fleeMsg = `${npc.name} 转身逃跑！`;
          console.log(`  🏃 ${fleeMsg}`);
          addMessage("系统", fleeMsg, "system");
          turnMessages.push({ speaker: "系统", content: fleeMsg, type: "system" });
        }
        continue;
      }
      await resolveNPCAction(npc, npcIntent, turnMessages);
    }
  }

  // 回合收尾：世界模型集成注入
  if (worldModel.isLoaded() && round % 4 === 0) {
    const ctx = buildSceneContext();
    const injection = wmIntegrator.buildKPContext(ctx);
    if (injection.length > 30) {
      const narration = await kp.narrateOutcome(
        "世界模型上下文",
        injection,
        getPlayerHistory()
      );
      console.log(`  🌐 ${narration.slice(0, 80)}...`);
      addMessage("KP", narration, "narration", "public");
      turnMessages.push({ speaker: "KP", content: narration, type: "narration" });
    }
  }

  // 回合收尾：效果 tick + 快照
  const expired = world.tickEffects();
  if (expired.length > 0) {
    for (const e of expired) {
      const msg = `[效果过期] ${e.description}`;
      addMessage("系统", msg, "system");
      turnMessages.push({ speaker: "系统", content: msg, type: "system" });
    }
  }

  const snapshotCtx = world.createSnapshot(round);

  const turn: TurnRecord = {
    round, timestamp: Date.now(),
    player_input: input,
    messages: turnMessages,
    world_snapshot: world.getCurrentState(),
  };
  kp.recordTurn(turn);

  // 调试：显示快照 token 估算
  const estTokens = Math.ceil(snapshotCtx.length / 2.5);
  console.log(`  🔖 快照已保存 (${snapshotCtx.length} 字符 ≈ ${estTokens} tokens)`);
}

// ============================================================
// 战斗处理
// ============================================================

async function handleCombat(
  intent: any, turnMessages: AgentMessage[], worldCtx: string
) {
  const target = world.getEntityByName(intent.target);
  if (!target) {
    const msg = `没有找到目标: ${intent.target}`;
    console.log(`  ⚠ ${msg}`);
    addMessage("系统", msg, "system");
    turnMessages.push({ speaker: "系统", content: msg, type: "system" });
    return;
  }

  const attacker = getPlayerAttributes();
  const weapon = intent.weapon || "shortsword";
  const hasAdvantage = intent.method === "stealth";
  const hasDisadvantage = false;

  // 律书判定
  const result = rules.adjudicateAttack(
    intent, attacker,
    { id: target.id, name: target.name, hp: target.hp, ac: target.ac, type: target.type, maxHp: target.maxHp, status: target.status, position: target.position },
    activeRuleset as RulesetId,
    hasAdvantage, hasDisadvantage, weapon
  );

  console.log(`  🎲 [${activeRuleset}] ${result.details} | ${result.hit ? `命中! ${result.damage}伤害 → ${result.result}` : "未命中"}`);

  // 世界状态更新：伤害应用
  if (result.hit) {
    const { killed } = world.applyDamage(target.id, result.damage);
    world.logCombatEvent(round, playerCharacter.id, target.id,
      `${attacker.name} 用 ${weapon} 攻击 ${target.name}，${result.hit ? `造成 ${result.damage} 点伤害` : "未命中"}`,
      result
    );
    if (killed) {
      world.logEvent({ round, timestamp: Date.now(), event_type: "system", description: `${target.name} 已死亡` });
      // 热插拔：实体死亡 → 自动注销 Agent
      if (registry.has(target.name)) {
        registry.unregister(target.name);
        console.log(`  🔌 ${target.name} Agent 已自动注销`);
      }
    }
  }

  // 叙事生成
  const narrative = await generateNarrative(playerCharacter.name, target.name, weapon, result);
  console.log(`  📖 ${narrative}`);
  addMessage("旁白", narrative, "narration");
  turnMessages.push({ speaker: "旁白", content: narrative, type: "narration" });

  // KP 跟进（使用世界状态上下文）
  const kpNarration = await kp.narrateOutcome(
    `攻击${target.name}`,
    result.hit
      ? (result.result === "kill" ? `${target.name}被击杀` : `${target.name}受伤`)
      : "攻击未命中",
    getPlayerHistory()
  );
  console.log(`  🎭 ${kpNarration}`);
  addMessage("KP", kpNarration, "narration");
  turnMessages.push({ speaker: "KP", content: kpNarration, type: "narration" });
}

// ============================================================
// 移动 / 自由叙事
// ============================================================

async function handleMovement(
  intent: any, turnMessages: AgentMessage[], worldCtx: string
) {
  const msg = `向 ${intent.target || "前方"} 移动`;
  world.logEvent({ round, timestamp: Date.now(), event_type: "move", actor: "player", description: msg });

  const targetScene = intent.target as string | undefined;
  if (targetScene) {
    world.getDatabase().prepare("UPDATE entities SET scene_id=?, position=? WHERE id='player'").run(targetScene, targetScene);
    world.setActiveScene(targetScene);
    kp.updateDirective({ scene_description: targetScene });
  }

  const narration = await kp.narrateOutcome(msg, "玩家移动", getPlayerHistory());
  console.log(`  🚶 ${narration}`);
  addMessage("KP", narration, "narration");
  turnMessages.push({ speaker: "KP", content: narration, type: "narration" });

  // 新场景中的 NPC 可能主动说话
  const playerScene = targetScene || "farm_exterior";
  const nearby = world.getEntitiesInScene(playerScene).filter(e => e.type === "npc" && e.id !== "player");
  for (const entity of nearby) {
    const npc = registry.get(entity.name);
    if (npc && Math.random() < 0.4) {
      const speak = await npc.speakUp("有陌生人进入了你的区域", getPlayerHistory());
      console.log(`  💬 ${entity.name}: ${speak}`);
      addMessage(entity.name, speak);
      turnMessages.push({ speaker: entity.name, content: speak, type: "dialogue" });
    }
  }
}

async function handleFreeNarration(input: string, turnMessages: AgentMessage[], worldCtx: string) {
  const kpNarration = await kp.narrateOutcome(input, `玩家: ${input}`, getPlayerHistory());
  console.log(`  🎭 ${kpNarration}`);
  addMessage("KP", kpNarration, "narration");
  turnMessages.push({ speaker: "KP", content: kpNarration, type: "narration" });

  // NPC 回应
  for (const npc of registry.getAll()) {
    if (input.includes(npc.name)) {
      const response = await npc.respond(
        `调查员对我说: "${input}"。KP的旁白: "${kpNarration}"`,
        getPlayerHistory()
      );
      console.log(`  💬 ${npc.name}: ${response}`);
      addMessage(npc.name, response, "dialogue");
      turnMessages.push({ speaker: npc.name, content: response, type: "dialogue" });
      break;
    }
  }

  // NPC 主动发言
  const agents = registry.getAll();
  if (Math.random() < 0.3 && agents.length > 0) {
    const randomNpc = agents[Math.floor(Math.random() * agents.length)];
    const speakUp = await randomNpc.speakUp("KP刚描述了新进展", getPlayerHistory());
    if (speakUp && !speakUp.includes("没什么可说") && !speakUp.includes("保持沉默")) {
      console.log(`  💬 ${randomNpc.name}(主动): ${speakUp}`);
      addMessage(randomNpc.name, speakUp, "dialogue");
      turnMessages.push({ speaker: randomNpc.name, content: speakUp, type: "dialogue" });
    }
  }
}

// ============================================================
// 调查处理（多技能路径）
// ============================================================

async function handleInvestigation(
  input: string,
  intent: any,
  turnMessages: AgentMessage[],
  worldCtx: string
) {
  const activePlayer = session.getActive();
  const playerName = activePlayer?.name ?? "p1";

  let clueType = "document";
  if (input.includes("尸体") || input.includes("死") || input.includes("伤")) clueType = "corpse_clue";
  else if (input.includes("雕像") || input.includes("古董") || input.includes("文物")) clueType = "antique_object";

  const playerSkills: Record<string, number> = {
    medicine: 35, history: 25, occult: 20, spot_hidden: 45,
    psychology: 30, library_use: 35, appraise: 15, art: 10,
    chemistry: 10, education: 40, science_chemistry: 10,
  };

  const state = world.getCurrentState();
  const playerScene = state.entities["player"]?.position ?? "farm_exterior";
  const nearbyNPCs = Object.values(state.entities)
    .filter((e) => e.type === "npc" && e.position === playerScene)
    .map((e) => e.name);

  const result = investigation.investigate(
    clueType, playerSkills, nearbyNPCs, playerName, ruleEngine
  );

  console.log(`  🔍 调查: ${result.clue_description}`);
  if (result.combined_triggered) {
    console.log(`  ✨ 组合阈值触发——知识完整拼图！`);
  } else if (result.primary_result) {
    const pr = result.primary_result;
    console.log(`  🎲 ${pr.skillName}: d20=${pr.roll} vs DC${pr.dc} → ${pr.success ? "成功" : "失败"}${pr.critical ? " 暴击" : ""}`);
  }
  console.log(`  📖 ${result.final_revelation.split("\n")[0]}`);

  const visibility: VisibilityRule = result.is_critical ? "discoverer_only" : "scene_restricted";
  addMessage("KP", result.final_revelation, "narration", visibility, playerName);
  turnMessages.push({ speaker: "KP", content: result.final_revelation, type: "narration" });

  if (result.fallback_triggered) {
    const msg = "（预设 fallback：所有检定路径均失败，触发新线索浮现。）";
    addMessage("系统", msg, "system", "public");
    turnMessages.push({ speaker: "系统", content: msg, type: "system" });
  }
}

// ============================================================
// NPC 行动裁决（与玩家同一律书管线）
// ============================================================

async function resolveNPCAction(
  npc: WorldEntity,
  intent: any,
  turnMessages: AgentMessage[]
) {
  const target = world.getEntity(intent.target);
  if (!target) return;

  const npcAttacker = {
    name: npc.name,
    id: npc.id,
    proficiency: 2,
    abilities: { strength: 14, dexterity: 12, constitution: 14, intelligence: 8, wisdom: 10, charisma: 6 },
    hasSneakAttack: false,
  };

  const weapon = intent.weapon || "shortsword";

  // 律书判定——NPC 与玩家共用路由引擎
  const result = rules.adjudicateAttack(
    intent, npcAttacker,
    { id: target.id, name: target.name, hp: target.hp, ac: target.ac, type: target.type, maxHp: target.maxHp, status: target.status, position: target.position },
    activeRuleset as RulesetId
  );

  if (result.hit) {
    const { killed } = world.applyDamage(target.id, result.damage);
    world.logCombatEvent(round, npc.id, target.id,
      `${npc.name} 攻击 ${target.name}，造成 ${result.damage} 点伤害`,
      result
    );
    if (killed) {
      world.logEvent({ round, timestamp: Date.now(), event_type: "system", description: `${target.name} 被 ${npc.name} 击杀` });
      if (registry.has(target.name)) {
        registry.unregister(target.name);
        console.log(`  🔌 ${target.name} Agent 已自动注销`);
      }
    }
  }

  // 叙事
  const narrative = await generateNarrative(npc.name, target.name, weapon, result);
  console.log(`  ⚔ ${narrative}`);
  addMessage("旁白", narrative, "narration");
  turnMessages.push({ speaker: "旁白", content: narrative, type: "narration" });
}

// ============================================================
// 热插拔 CLI 命令
// ============================================================

function handleNPCCommand(input: string, rl: any) {
  const parts = input.slice(5).trim().split(/\s+/);
  const sub = parts[0];

  if (sub === "list") {
    const names = registry.getAllNames();
    if (names.length === 0) {
      console.log("  ℹ 无已注册 Agent");
    } else {
      console.log(`  📋 已注册 Agent (${registry.count}):`);
      for (const name of names) {
        const a = registry.get(name)!;
        console.log(`    ${name} [${a.personality.role}] — ${a.personality.personality.slice(0, 40)}...`);
      }
    }
  } else if (sub === "remove" && parts[1]) {
    const name = parts[1];
    if (registry.unregister(name)) {
      console.log(`  ✅ Agent "${name}" 已注销`);
    } else {
      console.log(`  ⚠ 未找到 Agent: ${name}`);
    }
  } else if (sub === "add" && parts.length >= 3) {
    const name = parts[1];
    const role = parts[2];
    const personality = parts.slice(3).join(" ") || "普通路人";
    try {
      const agent = registry.registerQuick(name, role, personality);
      console.log(`  ✅ Agent "${name}" [${role}] 已注册并激活`);
    } catch (err: any) {
      console.log(`  ❌ 注册失败: ${err.message}`);
    }
  } else {
    console.log("  用法:");
    console.log("    /npc add <名> <身份> <性格>  — 快速注册 NPC");
    console.log("    /npc remove <名>              — 注销 NPC");
    console.log("    /npc list                     — 列出所有 Agent");
  }
  rl.prompt();
}

// ============================================================
// 主循环
// ============================================================

async function main() {
  console.clear();
  console.log("═".repeat(60));
  console.log("  AI TRPG — 多 Agent 引擎（含世界状态管理器）");
  console.log("═".repeat(60));
  console.log(`  LLM: ${config.model}`);
  console.log(`  NPC: ${registry.getAllNames().join("、")}`);
  console.log(`  世界: ${world.getAllAliveEntities().length} 实体已就绪`);
  console.log(`  玩家: ${session.getAllNames().join("、")} | 当前: ${session.getActive()?.name ?? "无"}`);
  console.log(`  DB: SQLite (WAL mode, :memory:)`);
  console.log("═".repeat(60));

  // 初始快照
  world.logEvent({ round: 0, timestamp: Date.now(), event_type: "system", description: "游戏开始" });
  const initCtx = world.createSnapshot(0);
  const initTokens = Math.ceil(initCtx.length / 2.5);
  console.log(`  📸 初始快照: ${initCtx.length} 字符 ≈ ${initTokens} tokens`);

  // 开场场景
  console.log("\n  📖 开场:");
  const opening = await kp.describeScene();
  console.log(`  ${opening}`);
  addMessage("KP", opening, "narration");

  // 互动
  const rl = createInterface({
    input: process.stdin, output: process.stdout,
    prompt: `\n🎲 [${session.getActive()?.name ?? "?"}] 你要怎么做？ `,
  });
  console.log("\n  💡 /create 职业 [名] | /sheet | 调查 检查 | 快照 实体 /wm | /规则 | /npc | /join");
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) { rl.prompt(); continue; }
    if (input === "退出" || input === "exit" || input === "quit") {
      console.log("\n  🌙 游戏结束。\n");
      break;
    }
    if (input === "状态" || input === "status") {
      const active = session.getActive();
      console.log(`\n  📊 回合: ${round} | 规则: ${activeRuleset}`);
      console.log(`  场景: ${kp.getDirective().current_phase}`);
      console.log(`  当前玩家: ${active?.name ?? "无"}`);
      console.log(`  SAN: ${sanity.state.currentSAN}/${sanity.state.maxSAN}${sanity.state.temporaryInsanity ? " [临时疯狂!]" : ""}`);
      console.log(`  消息: ${getPlayerHistory().length} 条 | Agent: ${registry.count} 个`);
      for (const npc of registry.getAll()) {
        console.log(`    ${npc.name}: ${npc.getRecentMemories(2).length} 条记忆`);
      }
      rl.prompt(); continue;
    }
    if (input === "快照" || input === "snap") {
      const ctx = world.getLatestContext();
      console.log(`\n  📸 最新快照上下文:\n${divider()}\n${ctx}\n${divider()}`);
      console.log(`  ${ctx.length} 字符 ≈ ${Math.ceil(ctx.length / 2.5)} tokens`);
      rl.prompt(); continue;
    }
    if (input === "实体" || input === "entities") {
      const entities = world.getAllAliveEntities();
      console.log(`\n  📋 存活实体 (${entities.length}):`);
      for (const e of entities) {
        const hasAgent = registry.has(e.name) ? " [Agent]" : "";
        console.log(`  - ${e.name} [${e.type}] HP:${e.hp}/${e.maxHp} AC:${e.ac} 位置:${e.position}${hasAgent}`);
      }
      rl.prompt(); continue;
    }
    if (input === "/wm" || input === "世界模型") {
      const stats = worldModel.getStats();
       console.log(`\n  🌐 世界模型 v14:`);
      console.log(`  总模式: ${stats.total} | 已消费因果: ${stats.consumed}`);
      console.log(`  causal: ${stats.causal} | behavior: ${stats.behavior}`);
      console.log(`  faction: ${stats.faction_relation} | resource: ${stats.resource}`);
      console.log(`  strategy: ${stats.strategy} | combat: ${stats.combat}`);
      rl.prompt(); continue;
    }
    // ── /create 创角 ──
    if (input.startsWith("/create ")) {
      const parts = input.slice(8).trim().split(/\s+/);
      if (parts.length < 1) {
        console.log(`  可用: ${CharacterFactory.listArchetypes(activeRuleset).map(a=>`${a.id}(${a.label})`).join(", ")}`);
        rl.prompt(); continue;
      }
      const archetypeId = parts[0];
      const charName = parts.slice(1).join(" ") || archetypeId;
      try {
        activeCharacter = CharacterFactory.generate(charName, archetypeId, activeRuleset);
        const acCreate = CharacterFactory.computeAC(activeCharacter);
        console.log(`\n  📜 ${activeCharacter.name} [${activeCharacter.archetype.label}]`);
        console.log(`  HP:${activeCharacter.hp} AC:${acCreate}`);
        console.log(`  属性: ${Object.entries(activeCharacter.attributes).map(([k,v])=>`${k}=${v}`).join(" ")}`);
        if (activeCharacter.warnings.length > 0) console.log(`  ⚠ ${activeCharacter.warnings.join("; ")}`);
      } catch (err: any) { console.log(`  ❌ ${err.message}`); }
      rl.prompt(); continue;
    }
    if (input === "/sheet" || input === "角色卡") {
      if (activeCharacter) {
        const acSheet = CharacterFactory.computeAC(activeCharacter);
        console.log(`\n  📜 ${activeCharacter.name} [${activeCharacter.archetype.label}]`);
        console.log(`  HP:${activeCharacter.hp}/${activeCharacter.maxHp} AC:${acSheet} Lv:${activeCharacter.totalLevel} BAB:${activeCharacter.baseAttackBonus}`);
        const baseAc = activeCharacter.ac;
        if (acSheet !== baseAc) console.log(`  (基础 AC ${baseAc} + 特性 ${acSheet - baseAc})`);
        console.log(`  属性: ${Object.entries(activeCharacter.attributes).map(([k,v])=>`${k}=${v}`).join(" ")}`);
        console.log(`  技能: ${activeCharacter.skills.join(", ")}`);
        if (activeCharacter.classLevels.size > 1) {
          console.log(`  职业等级: ${[...activeCharacter.classLevels].map(([id,lv])=>`${id} Lv${lv}`).join(", ")}`);
        }
        if (activeCharacter.activeFeatures.length > 0) {
          console.log(`  特性: ${activeCharacter.activeFeatures.map(f=>`${f.name}`).join(", ")}`);
        }
        if (activeCharacter.selectedFeats.length > 0) {
          console.log(`  专长: ${activeCharacter.selectedFeats.map(f=>f.name).join(", ")}`);
        }
        // 显示累计效果
        const effects = CharacterFactory.accumulateEffects(activeCharacter);
        const effectParts: string[] = [];
        if (effects.attackBonus) effectParts.push(`攻击+${effects.attackBonus}`);
        if (effects.damageBonus) effectParts.push(`伤害+${effects.damageBonus}`);
        if (effects.damageDice) effectParts.push(`额外${effects.damageDice}`);
        if (effects.acBonus) effectParts.push(`AC+${effects.acBonus}`);
        if (effects.saveBonus) effectParts.push(`豁免: ${Object.entries(effects.saveBonus).map(([a,b])=>`${a}+${b}`).join(" ")}`);
        if (effects.saveAdvantage?.length) effectParts.push(`豁免优势: ${effects.saveAdvantage.join(",")}`);
        if (effects.resistances?.length) effectParts.push(`抗性: ${effects.resistances.join(",")}`);
        if (effects.extraAttack) effectParts.push(`额外攻击+${effects.extraAttack}`);
        if (effectParts.length > 0) console.log(`  效果: ${effectParts.join(" | ")}`);
      } else { console.log("  ℹ 使用 /create <职业id> [角色名] 创建角色"); }
      rl.prompt(); continue;
    }
    // ── /advance 进阶职业 ──
    if (input.startsWith("/advance ")) {
      if (!activeCharacter) { console.log("  ❌ 请先创建角色: /create <职业id>"); rl.prompt(); continue; }
      const prestigeId = input.slice(9).trim();
      try {
        const { eligible, missing } = CharacterFactory.canTakePrestige(activeCharacter, prestigeId);
        if (!eligible) {
          console.log(`  ❌ 不满足先决条件: ${missing.join("; ")}`);
          rl.prompt(); continue;
        }
        activeCharacter = CharacterFactory.advance(activeCharacter, prestigeId, 1);
        console.log(`  ⬆ 进阶成功! ${activeCharacter.name} 成为 ${activeCharacter.archetype.label} Lv${activeCharacter.classLevels.get(prestigeId)}`);
        console.log(`  总等级: ${activeCharacter.totalLevel} | BAB: ${activeCharacter.baseAttackBonus}`);
        if (activeCharacter.activeFeatures.length > 0) {
          console.log(`  新特性: ${activeCharacter.activeFeatures.slice(-3).map(f=>`${f.name}(${f.description.slice(0,30)}...)`).join(", ")}`);
        }
        // 检查是否到达专长选择等级
        if (activeCharacter.archetype.featChoices) {
          for (const fc of activeCharacter.archetype.featChoices) {
            const alreadyChosen = activeCharacter.selectedFeats.some(sf => fc.options.some(o => o.name === sf.name));
            if (fc.level <= activeCharacter.totalLevel && !alreadyChosen) {
              const options = fc.options.map(o => o.name).join("、");
              console.log(`  💡 达到 Lv${fc.level}！可用 /choose-feat 从以下专长中选择: ${options}`);
            }
          }
        }
      } catch (err: any) { console.log(`  ❌ ${err.message}`); }
      rl.prompt(); continue;
    }
    // ── /level 升级当前职业 ──
    if (input.startsWith("/level ")) {
      if (!activeCharacter) { console.log("  ℹ 使用 /create <职业id> 创建角色"); rl.prompt(); continue; }
      const levels = parseInt(input.slice(7).trim()) || 1;
      activeCharacter.totalLevel += levels;
      // 更新当前子职等级
      const classId = activeCharacter.archetype.id;
      const current = activeCharacter.classLevels.get(classId) ?? 1;
      activeCharacter.classLevels.set(classId, current + levels);
      // 增加 HP
      for (let i = 0; i < levels; i++) {
        activeCharacter.maxHp += Math.floor(Math.random() * 6) + 1;
      }
      activeCharacter.hp = activeCharacter.maxHp;
      // 激活新等级的 levelFeatures
      if (activeCharacter.archetype.levelFeatures) {
        const oldCount = activeCharacter.activeFeatures.length;
        for (const lf of activeCharacter.archetype.levelFeatures) {
          if (lf.level <= activeCharacter.totalLevel && !activeCharacter.activeFeatures.some(f => f.name === lf.name)) {
            activeCharacter.activeFeatures.push(lf);
          }
        }
        if (activeCharacter.activeFeatures.length > oldCount) {
          console.log(`  ⚡ 新特性解锁！`);
        }
      }
      console.log(`  ⬆ ${activeCharacter.name} 升至 Lv${activeCharacter.totalLevel}！HP:${activeCharacter.maxHp}`);
      // 提示专长选择
      if (activeCharacter.archetype.featChoices) {
        for (const fc of activeCharacter.archetype.featChoices) {
          const alreadyChosen = activeCharacter.selectedFeats.some(sf => fc.options.some(o => o.name === sf.name));
          if (fc.level <= activeCharacter.totalLevel && !alreadyChosen) {
            const options = fc.options.map(o => o.name).join("、");
            console.log(`  💡 达到 Lv${fc.level}！可用 /choose-feat 从以下专长中选择: ${options}`);
          }
        }
      }
      rl.prompt(); continue;
    }
    // ── /prestige 列出进阶职业 ──
    if (input === "/prestige" || input === "进阶职业") {
      const prestige = CharacterFactory.listArchetypes(activeRuleset).filter(a => a.isPrestige);
      if (prestige.length === 0) { console.log("  ℹ 当前规则集无进阶职业"); rl.prompt(); continue; }
      console.log(`\n  🏰 进阶职业:`);
      for (const p of prestige) {
        const prereq = p.prerequisites
          ? `需要 Lv${p.prerequisites.minLevel ?? "?"} BAB${p.prerequisites.minBAB ?? "?"}`
          : "无条件";
        console.log(`    ${p.id}(${p.label}) — ${prereq} — ${p.description.slice(0,40)}...`);
      }
      rl.prompt(); continue;
    }
    // ── /feats 查看专长 ──
    if (input === "/feats" || input === "专长") {
      if (!activeCharacter) { console.log("  ℹ 使用 /create <职业id> 创建角色"); rl.prompt(); continue; }
      const arch = activeCharacter.archetype;
      console.log(`\n  ⚔ ${arch.label} 专长树`);
      // 已选专长
      if (activeCharacter.selectedFeats.length > 0) {
        console.log(`  ✅ 已选专长:`);
        for (const f of activeCharacter.selectedFeats) {
          console.log(`    ${f.name}: ${f.description}`);
        }
      } else {
        console.log(`  ⚪ 尚未选择任何专长`);
      }
      // 可用选择点
      if (arch.featChoices) {
        console.log(`  📋 专长选择点:`);
        for (const fc of arch.featChoices) {
          const alreadyChosen = activeCharacter.selectedFeats.some(sf => fc.options.some(o => o.name === sf.name));
          if (alreadyChosen) continue;
          const canTake = activeCharacter.totalLevel >= fc.level ? "" : ` (需 Lv${fc.level})`;
          console.log(`    Lv${fc.level} (选${fc.pick}):${canTake}`);
          for (const opt of fc.options) {
            const chosen = activeCharacter.selectedFeats.some(sf => sf.name === opt.name);
            const mark = chosen ? "✅" : (activeCharacter.totalLevel >= fc.level ? "  ·" : "  ·");
            console.log(`      ${mark} ${opt.name}: ${opt.description}`);
          }
        }
      } else {
        console.log(`  ℹ 该职业没有专长系统`);
      }
      rl.prompt(); continue;
    }
    // ── /choose-feat 选择专长 ──
    if (input.startsWith("/choose-feat ") || input.startsWith("/cf ")) {
      if (!activeCharacter) { console.log("  ℹ 使用 /create <职业id> 创建角色"); rl.prompt(); continue; }
      const featName = input.startsWith("/choose-feat ") ? input.slice(13).trim() : input.slice(4).trim();
      const result = CharacterFactory.chooseFeat(activeCharacter, featName);
      console.log(`  ${result.message}`);
      rl.prompt(); continue;
    }
    // ── 多玩家命令 ──
    if (input === "/players") {
      console.log(`\n  👥 玩家列表 (${session.count}):`);
      for (const p of session.getAll()) {
        const marker = p.name === session.getActive()?.name ? " ◀ 当前" : "";
        console.log(`    ${p.name} → ${p.characterName} [场景: ${p.currentScene}]${marker}`);
      }
      rl.prompt(); continue;
    }
    if (input.startsWith("/join ")) {
      const name = input.slice(6).trim();
      try {
        session.join(name, name, `player_${name}`, "farm_exterior");
        // 在世界状态中注册新玩家实体
        world.upsertEntity({
          id: `player_${name}`, name, type: "pc", hp: 12, maxHp: 12, ac: 12, status: [],
          position: "farm_exterior"
        } as any);
        console.log(`  ✅ 玩家 "${name}" 加入游戏`);
      } catch (err: any) { console.log(`  ❌ ${err.message}`); }
      rl.prompt(); continue;
    }
    if (input.startsWith("/switch ")) {
      const name = input.slice(8).trim();
      if (session.switchActive(name)) {
        console.log(`  🔄 切换到玩家: ${name} (${session.getActive()?.characterName})`);
      } else {
        console.log(`  ⚠ 未找到玩家: ${name}`);
      }
      rl.prompt(); continue;
    }
    if (input.startsWith("/leave ")) {
      const name = input.slice(7).trim();
      if (session.count <= 1) {
        console.log("  ⚠ 至少需要一个玩家");
      } else if (session.leave(name)) {
        console.log(`  👋 玩家 "${name}" 离开游戏`);
      } else {
        console.log(`  ⚠ 未找到玩家: ${name}`);
      }
      rl.prompt(); continue;
    }
    if (input === "线索" || input === "clues") {
      const active = session.getActive();
      const discovered = investigation.getDiscoveredBy(active?.name ?? "p1");
      console.log(`\n  🔍 已发现线索 (${discovered.length}):`);
      if (discovered.length === 0) {
        console.log("    尚无发现。试试输入「检查尸体」「调查房间」等。");
      } else {
        for (const c of discovered) {
          console.log(`    - ${c}`);
        }
      }
      console.log(`  可用线索类型: ${investigation.listClueTypes().join(", ")}`);
      rl.prompt(); continue;
    }
    // ── /规则 切换规则集 ──
    if (input.startsWith("/规则 ") || input.startsWith("/ruleset ")) {
      const ruleset = input.split(/\s+/)[1];
      if (["dnd", "coc", "grail"].includes(ruleset)) {
        const map: Record<string, string> = { dnd: "dnd5e", coc: "coc7e", grail: "grail" };
        activeRuleset = map[ruleset];
        console.log(`  ⚙ 规则集切换: ${activeRuleset}`);
      } else {
        console.log("  ⚠ 可用规则集: dnd | coc | grail");
      }
      rl.prompt(); continue;
    }
    // ── /npc 热插拔命令 ──
    if (input.startsWith("/npc ")) {
      handleNPCCommand(input, rl);
      continue;
    }

    await handlePlayerInput(input);
    rl.prompt();
  }

  world.close();
  rl.close();
}

main().catch((err) => {
  console.error("致命错误:", err);
  process.exit(1);
});
