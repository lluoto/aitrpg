// ============================================================
// 模组编辑器 — CRUD 模组 JSON 文件
// ============================================================

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { MythosModule } from "../rules/mythos-module";

const MODULES_DIR = join(process.cwd(), "data", "modules");

function ensureDir() {
  if (!existsSync(MODULES_DIR)) mkdirSync(MODULES_DIR, { recursive: true });
}

/** 列出所有已保存的模组 */
export function listSavedModules(): { id: string; name: string; description: string; difficulty: string }[] {
  ensureDir();
  return readdirSync(MODULES_DIR)
    .filter(f => f.endsWith(".json"))
    .map(f => {
      try {
        const mod = JSON.parse(readFileSync(join(MODULES_DIR, f), "utf-8")) as MythosModule;
        return { id: mod.id, name: mod.name, description: mod.description, difficulty: mod.difficulty };
      } catch { return null; }
    })
    .filter(Boolean) as { id: string; name: string; description: string; difficulty: string }[];
}

/** 按 ID 加载模组 */
export function loadModuleFile(id: string): MythosModule | null {
  ensureDir();
  const fp = join(MODULES_DIR, `${id}.json`);
  if (!existsSync(fp)) return null;
  return JSON.parse(readFileSync(fp, "utf-8"));
}

/** 保存模组（新建或更新） */
export function saveModuleFile(module: MythosModule): void {
  ensureDir();
  writeFileSync(join(MODULES_DIR, `${module.id}.json`), JSON.stringify(module, null, 2), "utf-8");
}

/** 删除模组 */
export function deleteModuleFile(id: string): void {
  const fp = join(MODULES_DIR, `${id}.json`);
  if (existsSync(fp)) unlinkSync(fp);
}

/** 创建空白模组骨架 */
export function createBlankModule(id: string, name: string): MythosModule {
  return {
    id,
    name,
    version: "1.0",
    description: "",
    difficulty: "medium",
    activation: { type: "manual", condition: "" },
    scenes: [],
    characters: [],
    clues: [],
    items: [],
    spells: [],
    creatures: [],
  };
}