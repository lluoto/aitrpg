// ============================================================
// WebSocket 推送 — 实时广播给前端（多PC/KP）
// ============================================================

import type { ServerWebSocket } from "bun";

/** 连接角色 */
export type WsRole = "kp" | "player" | "observer";

const WS_ROLES: readonly WsRole[] = ["kp", "player", "observer"];

export function isWsRole(value: string | null): value is WsRole {
  return value !== null && (WS_ROLES as readonly string[]).includes(value);
}

/**
 * upgrade 时挂到 socket 上的数据。
 * 与 WsClient 分开：WsClient 是服务端的连接记录（含 ws 自身与 label），
 * 而这里只是握手时从查询串取到的三个字段。
 */
export interface WsConnectionData {
  sessionId: string;
  role: WsRole;
  playerId?: string;
}

interface WsClient {
  ws: ServerWebSocket<WsConnectionData>;
  sessionId: string;
  role: WsRole;
  playerId?: string;
  label: string;
}

const clients = new Map<number, WsClient>();

let nextId = 1;

export function createWsClient(
  ws: ServerWebSocket<WsConnectionData>,
  sessionId: string,
  role: WsRole = "observer",
  playerId?: string,
): WsClient {
  const client: WsClient = {
    ws,
    sessionId,
    role,
    playerId,
    label: role === "kp" ? "KP" : playerId ?? "玩家",
  };
  clients.set(nextId++, client);
  return client;
}

export function removeWsClient(ws: ServerWebSocket<WsConnectionData>): void {
  for (const [id, c] of clients) {
    if (c.ws === ws) { clients.delete(id); break; }
  }
}

/** 广播给某个 session 的所有连接 */
export function broadcastToSession(sessionId: string, event: string, data: unknown): void {
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const [, c] of clients) {
    if (c.sessionId === sessionId) {
      try { c.ws.send(msg); } catch { /* ignore dead conn */ }
    }
  }
}

/**
 * 按连接分发——每个连接可能收到不同的 payload（或收不到）。
 *
 * 开发·多人可见性：`broadcastToSession` 对同一 session 的所有连接发
 * 同一份 msg，而线索揭示这类内容按玩家分发（discoverer_only 等，见
 * `PlayerSession.push`）——存储层过滤、推送层不过滤，两条路口径不
 * 一致，是信息泄漏（todo-25）。
 *
 * `resolve` 拿到的只是「这个连接是谁」（角色 + playerId，ws-handler
 * 握手时就已经知道），不碰任何游戏状态——**是否可见**这件事仍然由
 * 调用方复用既有的可见性判定去算（PlayerSession 存储层的过滤结果），
 * 这里只负责「按连接分别发」这个机制本身，不重新实现一套判定。
 * `resolve` 返回 `undefined` 时这个连接本轮不发——不是发一个空
 * payload，是压根不送这条消息，客户端看不出"这里有内容被过滤掉了"。
 */
export function broadcastPerConnection(
  sessionId: string,
  event: string,
  resolve: (client: { role: WsRole; playerId?: string }) => unknown,
): void {
  const timestamp = Date.now();
  for (const [, c] of clients) {
    if (c.sessionId !== sessionId) continue;
    const data = resolve({ role: c.role, playerId: c.playerId });
    if (data === undefined) continue;
    try { c.ws.send(JSON.stringify({ event, data, timestamp })); } catch { /* ignore dead conn */ }
  }
}

/**
 * 某个 session 当前连着的、带 playerId 的玩家连接（去重）。
 *
 * 用于广播前"先量一次现在有谁连着"——不是问 GameSession 有哪些 party
 * 成员（那是权威名单，但没连 WS 的成员不需要算它的 diff）。
 */
export function listSessionPlayerIds(sessionId: string): string[] {
  const ids = new Set<string>();
  for (const [, c] of clients) {
    if (c.sessionId === sessionId && c.role === "player" && c.playerId) ids.add(c.playerId);
  }
  return [...ids];
}

/** 统计连接数 */
export function wsStats(): { total: number; sessions: Record<string, { kp: number; players: number }> } {
  const sessions: Record<string, { kp: number; players: number }> = {};
  for (const [, c] of clients) {
    if (!sessions[c.sessionId]) sessions[c.sessionId] = { kp: 0, players: 0 };
    if (c.role === "kp") sessions[c.sessionId].kp++;
    else sessions[c.sessionId].players++;
  }
  return { total: clients.size, sessions };
}