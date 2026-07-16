// game-session.ts — GameSession 类（重建存根 + 旧代码残留）
// 完整实现在 server.ts 中内联维护

export class GameSession {
  readonly id: string;
  readonly createdAt: number;
  lastActiveAt: number;
  activePlayerId: string = "p1";
  activeRuleset: string = "coc7e";
  round: number = 0;
  dead: boolean = false;
  combatActive: boolean = false;
  activeCharacter: any = null;

  constructor(id: string) {
    this.id = id;
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
  }

  getSummary(): any {
    return { id: this.id, round: this.round, ruleset: this.activeRuleset, scene: "unknown", playerName: "调查员", archetype: null, messageCount: 0, npcCount: 0, createdAt: this.createdAt };
  }
  getCharacterSummary(): any { return null; }
  getSanity(): any { return {}; }
  getState(): any { return {}; }
  getHistory(limit?: number) { return { messages: [], total: 0 }; }
  getOpeningScene(): Promise<string> { return Promise.resolve(""); }
  getSuggestions(): string[] { return []; }
  getKPState(): any { return {}; }
  act(input: string): Promise<any> { return Promise.resolve({}); }
  sendMessage(speaker: string, content: string, type: string) {}
  setPlayerSan(pid: string, val: number) {}
  setPlayerHp(pid: string, val: number) {}
  applyDamage(eid: string, dmg: number) {}
  setScene(sid: string) {}
  setDifficulty(d: string) {}
  addMessage(s: string, c: string, t: string) {}
}

export interface ActionResponse {
  narrative: string;
  events: any[];
  state: any;
  dead?: boolean;
  sanity?: any;
  dice?: any[];
}

export interface SessionSummary {
  id: string; round: number; ruleset: string; scene: string; playerName: string;
  archetype: string | null; messageCount: number; npcCount: number; createdAt: number;
}