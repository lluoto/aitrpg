// 模组数据核心类型定义
// 用于将原始模组 PDF 文本解析为结构化数据

/** 模组数据顶层结构 */
export interface ModuleData {
  id: string;
  title: string;
  version: string;
  ruleset: "coc7e";
  era: string;
  summary: string;
  scenes: Scene[];
  npcs: ModuleNPC[];
  /** 全局元信息 */
  meta: {
    author?: string;
    playerCount: string;
    expectedDuration: string;
    triggerWarnings: string[];
    /** 未来扩展：BGM 提示 */
    bgmHints?: Record<string, string>;
  };
  /** 结局定义 */
  endings: Ending[];
}

/** 场景 */
export interface Scene {
  id: string;
  name: string;
  order: number; // 建议游玩顺序
  description: string; // KP 用的场景描述
  /** 场景中的可交互线索 */
  clues: Clue[];
  /** 此场景中出现的 NPC */
  npcIds: string[];
  /** 此场景需要的技能检定 */
  skillChecks?: SkillCheckHint[];
  /** 连接到其他场景 */
  connections: SceneConnection[];
  /** 场景特有事件触发器 */
  events?: SceneEvent[];
  /** 环境描述（KP 提示） */
  atmosphere?: string;
  /** 未来发展：BGM 提示 */
  bgmHint?: string;
  /** 未来发展：图像生成提示 */
  imageHint?: string;
}

/** 线索 */
export interface Clue {
  id: string;
  name: string;
  description: string;
  /** 找到线索的方法 */
  findMethods: FindMethod[];
  /** 找到后的揭示文本 */
  revelation: string;
  /** 解锁的新线索 ID 列表 */
  unlocks: string[];
  /** 线索是否被找到 */
  found: boolean;
  /** 线索的优先级（影响 NPC 是否主动提示） */
  importance: "core" | "bonus" | "color";
  /** 叙事描述性提示（替代元信息线索列表，给玩家的隐晦提示） */
  hint?: string;
}

/** 寻找线索的方法 */
export interface FindMethod {
  type: "skill" | "observation" | "npc_dialogue" | "item" | "automatic";
  /** 技能名（如果是 skill 类型） */
  skillName?: string;
  /** 难度 */
  difficulty?: "regular" | "hard" | "extreme";
  /** 描述 */
  description: string;
}

/** 场景连接 */
export interface SceneConnection {
  targetSceneId: string;
  /** 解锁条件描述 */
  condition: string;
  /** 自动解锁的条件（如：找到某个关键线索后） */
  requiredClueId?: string;
  /** 是否需要技能检定才能发现这个连接 */
  checkRequired?: { skill: string; difficulty: "regular" | "hard" | "extreme" };
}

/** 建议的技能检定 */
export interface SkillCheckHint {
  skill: string;
  difficulty: "regular" | "hard" | "extreme";
  purpose: string;
}

/** 场景事件触发器 */
export interface SceneEvent {
  trigger: "time" | "action" | "clue_found" | "scene_entry";
  /** 触发描述 */
  description: string;
  /** 触发延迟（回合数，仅 time 类型） */
  delayRounds?: number;
  /** 触发结果 */
  outcome: string;
}

/** 模组中的 NPC 定义 */
export interface ModuleNPC {
  id: string;
  name: string;
  role: string;
  description: string;
  personality: {
    traits: string[];
    speech: string;
    attitude: string;
  };
  /** NPC 知道的信息 */
  knowledge: string[];
  /** NPC 隐藏的秘密 */
  secrets: string[];
  /** NPC 在当前场景中的位置 */
  sceneId: string;
  /** 行为触发器 */
  behaviors?: NPCBehavior[];
  /** 未来发展：NPC 立绘 prompt */
  portraitHint?: string;
  /** 未来发展：NPC 语音提示 */
  voiceHint?: string;
}

/** NPC 行为规则 */
export interface NPCBehavior {
  trigger: "player_approach" | "clue_found" | "combat_start" | "time" | "specific_action";
  /** 触发详情 */
  detail?: string;
  /** 行为描述 */
  action: string;
}

/** 结局定义 */
export interface Ending {
  id: string;
  name: string;
  description: string;
  conditions: string[];
  sanReward?: string;
  cmReward?: number;
}

/** 模块状态快照（运行时） */
export interface ModuleState {
  currentSceneId: string;
  discoveredClues: Set<string>;
  triggeredEvents: Set<string>;
  npcStates: Map<string, NPCInstanceState>;
  sceneHistory: string[];
  currentRound: number;
}

/** NPC 运行时状态 */
export interface NPCInstanceState {
  locationSceneId: string;
  mood: string;
  relationship: number; // -5 to +5
  isAlive: boolean;
  isConscious: boolean;
  knownByPlayers: boolean;
}
