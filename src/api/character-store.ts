// ============================================================
// 角色卡持久化存储
// ============================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";

const CHAR_DIR = join(process.cwd(), "data", "characters");

function ensureDir() {
  if (!existsSync(CHAR_DIR)) mkdirSync(CHAR_DIR, { recursive: true });
}

export interface StoredCharacter {
  name: string;
  ruleset: string;
  archetype: string;
  archetypeLabel?: string;
  hp: number;
  maxHp: number;
  san: number;
  maxSan: number;
  skills: Record<string, number>;
  inventory: string[];
  createdAt: number;
}

export function saveCharacter(name: string, data: StoredCharacter): void {
  ensureDir();
  const safe = name.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, "_");
  writeFileSync(join(CHAR_DIR, `${safe}.json`), JSON.stringify(data, null, 2), "utf-8");
}

export function listCharacters(): { name: string; ruleset: string; archetype: string; createdAt: number }[] {
  ensureDir();
  return readdirSync(CHAR_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      const st = JSON.parse(readFileSync(join(CHAR_DIR, f), "utf-8")) as StoredCharacter;
      return { name: st.name, ruleset: st.ruleset, archetype: st.archetype, createdAt: st.createdAt };
    }).sort((a, b) => b.createdAt - a.createdAt);
}