import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface GameState {
  version: number;
  timestamp: number;
  sessionId: string;
  round: number;
  scene: string;
  playerName: string;
  archetype: string;
  ruleset: string;
  hp: number;
  maxHp: number;
  san: number;
  maxSan: number;
  tempInsanity: boolean;
  indefInsanity: boolean;
  dead: boolean;
  narrative: string[];
  companions: any[];
  npcs: any[];
  combatActive: boolean;
  difficulty: string;
  metadata: Record<string, any>;
}

const SAVE_DIR = join(process.cwd(), 'data', 'saves');

function ensureDir(): void {
  if (!existsSync(SAVE_DIR)) {
    mkdirSync(SAVE_DIR, { recursive: true });
  }
}

export function saveGameState(sessionId: string, state: GameState): void {
  ensureDir();
  state.timestamp = Date.now();
  const filePath = join(SAVE_DIR, `${sessionId}.json`);
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8');
}

export function loadGameState(sessionId: string): GameState | null {
  const filePath = join(SAVE_DIR, `${sessionId}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GameState;
  } catch {
    return null;
  }
}

export function listSavedSessions(): string[] {
  // ensureDir() 已保证目录存在，这里不再吞异常：
  // 之前的空 catch 把「readdirSync 未导入」的 ReferenceError 咽掉了，
  // 结果这个函数永远返回空数组，存档列表看起来只是「没有存档」。
  ensureDir();
  return readdirSync(SAVE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}