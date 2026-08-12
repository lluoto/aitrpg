// Agent 类型定义 — NPC Agent / KP Agent

import type { WorldState } from "../types";

// ============================================================
// NPC 结构化性格特质（影响战斗/社交/事件反应）
// ============================================================

export interface NPCTraits {
  /** 勇气 1-10（低=怯懦爱逃，高=悍不畏死） */
  courage: number;
  /** 友善 1-10（低=冷漠敌对，高=热情助人） */
  friendliness: number;
  /** 怀疑 1-10（低=轻信，高=多疑，影响说服难度） */
  suspicion: number;
  /** 好奇心 1-10（低=墨守成规，高=主动探索） */
  curiosity: number;
  /** 情绪稳定性 1-10（低=易恐慌/暴怒，高=处变不惊） */
  stability: number;
}

/** 默认 NPC 特质（普通路人） */
export const DEFAULT_NPC_TRAITS: NPCTraits = {
  courage: 5,
  friendliness: 5,
  suspicion: 5,
  curiosity: 5,
  stability: 5,
};

// ============================================================
// NPC 阵营/势力
// ============================================================

export interface NPCFaction {
  /** 阵营名 */
  name: string;
  /** 对该阵营的忠诚度 1-10（决定背叛/出卖的阈值） */
  loyalty: number;
}

/** NPC 情绪状态 */
export type NPCMood = "neutral" | "friendly" | "angry" | "fearful" | "suspicious" | "excited" | "sad" | "calm";

// ============================================================
// NPC 人格卡
// ============================================================

export interface NPCPersonality {
  name: string;
  role: string; // "半精灵游荡者" | "酒馆老板" | "邪教徒"
  personality: string; // 性格描述
  background: string; // 背景故事
  goals: string[]; // 当前目标
  speech_style: string; // 说话风格
  knowledge: string[]; // 角色知道的信息
  secrets: string[]; // 秘密（不主动透露）
  /** 对其他角色的态度 */
  attitudes?: Record<string, string>; // character_name → attitude_description
  /** 适用的规则集（留空表示适用于所有规则集） */
  ruleset?: "cosmic-horror" | "dnd5e" | "grail";
  /** 结构化性格特质（缺省时使用 DEFAULT_NPC_TRAITS） */
  traits?: NPCTraits;
  /** 所属阵营 */
  factions?: NPCFaction[];
  /** 初始情绪 */
  initialMood?: NPCMood;
}

// ============================================================
// NPC 记忆条目
// ============================================================

export interface MemoryEntry {
  timestamp: number;
  type: "observation" | "dialogue" | "event" | "decision";
  content: string;
  importance: number; // 1-10, 越高越不遗忘
}

// ============================================================
// Agent 消息
// ============================================================

export interface AgentMessage {
  speaker: string; // NPC 名字 或 "KP" 或 "玩家"
  content: string;
  type: "dialogue" | "narration" | "system" | "action";
  /**
   * 内容是否为模组原文逐字输出（而非 LLM 生成）。
   *
   * 用可选标记而不是新增 type 分支：`type === "narration"` 已有 4 处消费者
   * （NPC 记忆、旁白前缀、导出标签、前端叙事筛选），新增联合分支会让模组原文
   * 静默掉出这些路径。标记是纯增量的，老消费者行为不变。
   */
  verbatim?: boolean;
  /**
   * 说这句话时 NPC 的情绪。
   *
   * 必须在生成时刻捕获：mood 是状态机（8 种触发驱动转移），播放或回放时
   * 回查 `NPCAgent.getMood()` 拿到的是当时的情绪而非说这句话时的情绪。
   * 取值与主流情感 TTS 的 style 参数基本对应，是未来语音层的音色输入。
   */
  mood?: NPCMood;
  /** 谁可见（per-receiver 预留） */
  visible_to?: string[];
  /**
   * 入会话时间（epoch ms），由 PlayerSession.push 统一打上。
   * 可选：早先存档里的历史消息没有这个字段。
   */
  timestamp?: number;
}

/**
 * 消息类型 — API 响应、CLI、模组宿主接口共用同一套取值。
 * 单独导出，避免各层各自写 `string` 而丢失联合类型约束。
 */
export type MessageType = AgentMessage["type"];

// ============================================================
// 游戏轮次记录
// ============================================================

export interface TurnRecord {
  round: number;
  timestamp: number;
  player_input: string;
  messages: AgentMessage[];
  world_snapshot: WorldState | null;
}

// ============================================================
// KP 指令
// ============================================================

export interface KPDirective {
  /** 当前场景描述 */
  scene_description: string;
  /** 场景中的关键元素（NPC、物品、线索等） */
  scene_elements: string[];
  /** 剧情节点列表 */
  plot_nodes: { id: string; description: string; trigger: string; done: boolean }[];
  /** 当前剧情阶段 */
  current_phase: string;
  /** KP 风格 */
  style: "standard" | "lovecraft" | "heroic" | "mystery";
}
