// 多玩家会话管理器 — per-receiver 架构
// 同一世界状态，不同玩家看到不同的旁白/线索/NPC对话
//
// 设计原则：
//   律书是共享的（战斗结果所有人可见）
//   叙事是分发的（KP 为每个玩家生成不同的旁白）
//   秘密是隔离的（发现线索的玩家 ≠ 知道线索的所有玩家）

import type { AgentMessage } from "../agent/types";

// ============================================================
// 玩家槽位
// ============================================================

export interface PlayerSlot {
  name: string;           // 玩家名（用于 CLI 切换）
  characterName: string;   // 角色名（用于叙事中的称呼）
  characterId: string;     // 对应 WorldStateManager 中的 entity_id
  joinedAt: number;        // 加入时间
  /** 此玩家的消息历史——只包含他可见的消息 */
  messageHistory: AgentMessage[];
  /** 此玩家当前已知的线索/秘密 */
  knownSecrets: Set<string>;
  /** 此玩家当前所在场景 */
  currentScene: string;
}

// ============================================================
// 可见性规则
// ============================================================

export type VisibilityRule =
  | "public"              // 所有人可见（战斗结果、场景切换）
  | "scene_restricted"    // 同场景可见（NPC 对话、环境变化）
  | "discoverer_only"     // 仅发现者可见（**线索发现、秘密揭露**）
  | "targeted"            // 仅指定玩家可见（私密 DM 旁白、个人 SAN 检定结果）
  | "private";            // 仅当前玩家 + KP 可见

// ============================================================
// 玩家会话管理器
// ============================================================

export class PlayerSession {
  private players: Map<string, PlayerSlot> = new Map();
  private activePlayerName: string | null = null;
  /** 全局消息日志（所有消息，未过滤） */
  private globalMessages: AgentMessage[] = [];

  // ==========================================================
  // 玩家管理
  // ==========================================================

  /** 加入游戏 */
  join(name: string, characterName: string, characterId: string, startingScene: string): PlayerSlot {
    if (this.players.has(name)) {
      throw new Error(`玩家 "${name}" 已存在`);
    }
    const slot: PlayerSlot = {
      name,
      characterName,
      characterId,
      joinedAt: Date.now(),
      messageHistory: [],
      knownSecrets: new Set(),
      currentScene: startingScene,
    };
    this.players.set(name, slot);
    if (!this.activePlayerName) this.activePlayerName = name;
    return slot;
  }

  /** 离开游戏 */
  leave(name: string): boolean {
    const removed = this.players.delete(name);
    if (this.activePlayerName === name) {
      this.activePlayerName = this.players.keys().next().value ?? null;
    }
    return removed;
  }

  /** 切换当前活动的玩家（谁在 CLI 中输入） */
  switchActive(name: string): boolean {
    if (!this.players.has(name)) return false;
    this.activePlayerName = name;
    return true;
  }

  /** 获取当前活动玩家 */
  getActive(): PlayerSlot | null {
    if (!this.activePlayerName) return null;
    return this.players.get(this.activePlayerName) ?? null;
  }

  /** 获取指定玩家 */
  get(name: string): PlayerSlot | undefined {
    return this.players.get(name);
  }

  /** 获取所有玩家 */
  getAll(): PlayerSlot[] {
    return [...this.players.values()];
  }

  /** 获取所有玩家名 */
  getAllNames(): string[] {
    return [...this.players.keys()];
  }

  /** 玩家数量 */
  get count(): number { return this.players.size; }

  // ==========================================================
  // 消息分发（per-receiver 核心）
  // ==========================================================

  /**
   * 推送一条消息，根据可见性规则分发到不同玩家的历史
   * @param message 消息
   * @param visibility 可见性规则
   * @param discoverer 如果是 discoverer_only，指定发现者
   * @param targets 如果是 targeted，指定目标玩家名列表
   */
  push(
    message: AgentMessage,
    visibility: VisibilityRule = "public",
    discoverer?: string,
    targets?: string[]
  ) {
    // 入会话即打时间戳：Markdown 导出依赖它显示时间，此前该字段从未被写入，
    // 导出的时间列因此一直是空的。已有 timestamp 的消息（回放/存档）保持原值。
    const stamped: AgentMessage =
      message.timestamp === undefined ? { ...message, timestamp: Date.now() } : message;

    // 全局日志记录完整消息
    this.globalMessages.push(stamped);

    // 根据可见性规则分发
    switch (visibility) {
      case "public":
        for (const player of this.players.values()) {
          player.messageHistory.push(stamped);
        }
        break;

      case "scene_restricted": {
        // 简化：所有同场景的玩家可见
        const activeScene = this.getActive()?.currentScene ?? "";
        for (const player of this.players.values()) {
          if (player.currentScene === activeScene) {
            player.messageHistory.push(stamped);
          }
        }
        break;
      }

      case "discoverer_only":
        if (discoverer) {
          const player = this.players.get(discoverer);
          if (player) {
            player.messageHistory.push(stamped);
            // KP 也记录（DM 总是知道一切）
          }
        }
        break;

      case "targeted":
        if (targets) {
          for (const t of targets) {
            const player = this.players.get(t);
            if (player) player.messageHistory.push(stamped);
          }
        }
        break;

      case "private": {
        const active = this.getActive();
        if (active) {
          active.messageHistory.push(stamped);
          // KP 在全局日志中可见此消息
        }
        break;
      }
    }
  }

  /**
   * 对每个玩家推送不同的消息（同一事件，每人不同旁白）
   * @param messages Map<玩家名, 消息内容>
   */
  pushPerPlayer(
    messages: Map<string, string>,
    type: AgentMessage["type"] = "narration"
  ) {
    for (const [playerName, content] of messages) {
      const player = this.players.get(playerName);
      if (player) {
        const msg: AgentMessage = {
          speaker: "KP",
          content,
          type,
          visible_to: [playerName],
        };
        player.messageHistory.push(msg);
        this.globalMessages.push(msg);
      }
    }
  }

  /** 获取指定玩家的消息历史 */
  getPlayerHistory(playerName: string): AgentMessage[] {
    return this.players.get(playerName)?.messageHistory ?? [];
  }

  /** 获取当前活动玩家的消息历史（用于 CLI 输出） */
  getActiveHistory(): AgentMessage[] {
    return this.getActive()?.messageHistory ?? [];
  }

  /** 获取最近 N 条全局消息 */
  getRecentGlobal(n: number = 10): AgentMessage[] {
    return this.globalMessages.slice(-n);
  }

  // ==========================================================
  // 秘密/线索管理
  // ==========================================================

  /** 玩家发现了一个秘密/线索 */
  discover(playerName: string, secretId: string) {
    const player = this.players.get(playerName);
    if (player) player.knownSecrets.add(secretId);
  }

  /** 玩家是否知道某秘密 */
  knowsSecret(playerName: string, secretId: string): boolean {
    return this.players.get(playerName)?.knownSecrets.has(secretId) ?? false;
  }

  // ==========================================================
  // 场景同步
  // ==========================================================

  /** 玩家切换场景 */
  setPlayerScene(playerName: string, sceneId: string) {
    const player = this.players.get(playerName);
    if (player) player.currentScene = sceneId;
  }

  /** 获取同场景的其他玩家 */
  getPlayersInScene(sceneId: string): PlayerSlot[] {
    return this.getAll().filter((p) => p.currentScene === sceneId);
  }
}
