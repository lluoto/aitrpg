// 多玩家会话管理器 — per-receiver 架构
// 同一世界状态，不同玩家看到不同的旁白/线索/NPC对话
//
// 设计原则：
//   律书是共享的（战斗结果所有人可见）
//   叙事是分发的（KP 为每个玩家生成不同的旁白）
//   秘密是隔离的（发现线索的玩家 ≠ 知道线索的所有玩家）

import type { AgentMessage, VisibilityRule } from "../agent/types";
// 重新导出：VisibilityRule 的真身现在挂在 agent/types.ts（AgentMessage 需要
// 它，反过来在这里定义会成环），但既有 import 点（index.ts、game-session.ts）
// 都写的是 `from "../session/player-session"`，保持这条路可用，不强改调用方。
export type { VisibilityRule };

// ============================================================
// 玩家槽位
// ============================================================

interface PlayerSlot {
  name: string;           // 玩家名（用于 CLI 切换）
  characterName: string;   // 角色名（用于叙事中的称呼）
  characterId: string;     // 对应 WorldStateManager 中的 entity_id
  joinedAt: number;        // 加入时间
  /** 此玩家的消息历史——只包含他可见的消息 */
  messageHistory: AgentMessage[];
  /** 此玩家当前已知的线索/秘密 */
  knownSecrets: Set<string>;
}

// ============================================================
// 玩家会话管理器
// ============================================================

export class PlayerSession {
  private players: Map<string, PlayerSlot> = new Map();
  private activePlayerName: string | null = null;
  /** 全局消息日志（所有消息，未过滤） */
  private globalMessages: AgentMessage[] = [];

  /**
   * 权威场景来源——按 `characterId`（对应 WorldStateManager 的 entity id）
   * 查"这个人现在在哪"。
   *
   * 开发·多人可见性 N6，todo-24：此前这里自己存一份 `PlayerSlot.currentScene`，
   * 只在 `join()` 时写一次，之后唯一能更新它的 `setPlayerScene` 全仓零调用方——
   * 玩家实际移动后这份拷贝再也不会跟着变，`scene_restricted` 可见性判定与
   * `getPlayersInScene()` 因此永远读到入场时的旧场景。真正权威、且真的会
   * 随移动更新的场景数据本来就存在（`WorldEntity.position`，GameSession.
   * movePlayerToScene() 等每次玩家移动都会 `world.upsertEntity` 写回这里），
   * 与其在 PlayerSession 里再存一份必然漂移的拷贝，不如直接问权威来源——
   * 两个构造方（GameSession/index.ts）在创建 PlayerSession 时都已经有自己
   * 的 WorldStateManager，能把查询闭包过来。
   */
  constructor(private readonly sceneOf: (characterId: string) => string | undefined) {}

  // ==========================================================
  // 玩家管理
  // ==========================================================

  /** 加入游戏 */
  join(name: string, characterName: string, characterId: string): PlayerSlot {
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
        // 简化：所有同场景的玩家可见——场景本身按 characterId 问权威来源
        // （this.sceneOf），不再读一份自己存的、不会跟着移动更新的拷贝。
        const active = this.getActive();
        const activeScene = (active && this.sceneOf(active.characterId)) ?? "";
        for (const player of this.players.values()) {
          if (this.sceneOf(player.characterId) === activeScene) {
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

  /** 玩家当前所在场景——问权威来源（this.sceneOf），不存自己的拷贝。 */
  getPlayerScene(playerName: string): string | undefined {
    const player = this.players.get(playerName);
    return player ? this.sceneOf(player.characterId) : undefined;
  }

  /** 获取同场景的其他玩家 */
  getPlayersInScene(sceneId: string): PlayerSlot[] {
    return this.getAll().filter((p) => this.sceneOf(p.characterId) === sceneId);
  }
}
