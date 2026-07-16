// 游戏事件类型 — 事件日志记录

export interface GameEvent {
  round: number;
  timestamp: number;
  event_type: "combat" | "move" | "dialogue" | "discovery" | "item_use" | "scene_change" | "system";
  actor?: string;   // entity_id
  target?: string;  // entity_id
  description: string;
  result?: Record<string, unknown>;  // 结构化判定结果
}

/** 状态变更摘要——写入 event_log 的记录格式 */
export interface StateChange {
  entity_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
}

/** 快照摘要——注入 LLM 上下文的压缩格式 */
export interface SnapshotSummary {
  round: number;
  scene: string;
  entities: Array<{
    name: string;
    hp: string;           // "7/7"
    status: string[];     // active conditions
    position: string;
    faction?: string;
  }>;
  active_effects: Array<{
    target: string;
    description: string;
    duration: number;
  }>;
  recent_events: string[];  // last 5 events, text-only
}
