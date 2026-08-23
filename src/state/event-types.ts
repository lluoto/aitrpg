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
