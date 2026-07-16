// ============================================================
// WebSocket 推送 — 实时广播给前端（多PC/KP）
// ============================================================

import type { ServerWebSocket } from "bun";

/** 连接角色 */
type WsRole = "kp" | "player" | "observer";

interface WsClient {
  ws: ServerWebSocket<WsClient>;
  sessionId: string;
  role: WsRole;
  playerId?: string;
  label: string;
}

const clients = new Map<number, WsClient>();

let nextId = 1;

export function createWsClient(
  ws: ServerWebSocket<WsClient>,
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

export function removeWsClient(ws: ServerWebSocket<WsClient>): void {
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

/** 发送给 session 中的 KP */
export function sendToKp(sessionId: string, event: string, data: unknown): void {
  const msg = JSON.stringify({ event, data, timestamp: Date.now() });
  for (const [, c] of clients) {
    if (c.sessionId === sessionId && c.role === "kp") {
      try { c.ws.send(msg); } catch { /* ignore */ }
    }
  }
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