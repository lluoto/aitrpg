import { describe, expect, it } from "bun:test";
import { cleanupExpiredSessions } from "../api/server";
import { mergeSessionMetadata } from "../api/session-store";

describe("server session cleanup", () => {
  it("removes durable metadata and memory through one last-active policy", () => {
    const sessions = new Map<string, { lastActiveAt: number }>([["old", { lastActiveAt: 1 }], ["active", { lastActiveAt: 95 }]]);
    const deleted: string[] = [];
    expect(cleanupExpiredSessions(sessions, { now: 101, timeoutMs: 10, deleteMetadata: (id) => deleted.push(id) })).toEqual(["old"]);
    expect(deleted).toEqual(["old"]);
    expect([...sessions.keys()]).toEqual(["active"]);
  });

  it("keeps a session registered when metadata deletion fails", () => {
    const sessions = new Map<string, { lastActiveAt: number }>([["old", { lastActiveAt: 1 }]]);
    const errors: unknown[] = [];
    expect(cleanupExpiredSessions(sessions, { now: 101, timeoutMs: 10, deleteMetadata: () => { throw new Error("locked"); }, logError: (error) => errors.push(error) })).toEqual([]);
    expect([...sessions.keys()]).toEqual(["old"]);
    expect(errors).toHaveLength(1);
  });

  it("preserves session creation and compiled identity when action metadata is patched", () => {
    expect(mergeSessionMetadata(
      { createdAt: 1, ruleset: "cosmic-horror", playerName: "Ada", bundleId: "bundle", compiledArtifactHash: "artifact" },
      { lastActiveAt: 2, round: 3, scene: "archive" },
    )).toEqual({ createdAt: 1, ruleset: "cosmic-horror", playerName: "Ada", bundleId: "bundle", compiledArtifactHash: "artifact", lastActiveAt: 2, round: 3, scene: "archive" });
  });
});
