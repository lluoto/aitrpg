// 世界状态加载器 — 将 ModuleData 数据加载到 WorldStateManager 的 SQLite 数据库中
// 替代 index.ts 中硬编码的 seedWorld() 函数，使 index.ts 与具体模组解耦
//
// 用法：
//   import { populateWorldFromModule } from "./world/module-loader";
//   populateWorldFromModule(world, moduleData, npcStats);

import type { WorldStateManager } from "../state/world-state-manager";
import type { ModuleData } from "../module/types";

/**
 * 将 ModuleData 中的场景/NPC 数据批量写入 WorldStateManager。
 *
 * 转换规则：
 * - scenes → scenes 表（description, lighting=normal, dangers=[], exits=[]）
 * - npcs → entities 表（type=npc, hp/ac 来自 NPC_STATS）
 * - 非 NPC 实体（怪物等）也注册为 entity
 */
export function populateWorldFromModule(
  world: WorldStateManager,
  moduleData: ModuleData,
  npcStats: Record<string, Record<string, number | string>>,
): void {
  const db = world.getDatabase();

  // ── 1. 注册场景 ──
  const insertScene = db.prepare(`
    INSERT OR REPLACE INTO scenes (id, name, description, lighting, dangers, exits, is_active)
    VALUES (?, ?, ?, 'normal', '[]', ?, ?)
  `);
  // 叙事实体（ModuleData.narrative.entities）按 id 建索引，供下面的出口标注取用
  const entitiesById = new Map(
    (moduleData.narrative?.entities ?? []).map((e) => [e.id, e]),
  );

  for (let i = 0; i < moduleData.scenes.length; i++) {
    const scene = moduleData.scenes[i];
    // 站在这个场景能望见的叙事实体，按它指向的场景归拢
    const sightedByTarget = new Map(
      (scene.visibleEntities ?? [])
        .map((id) => entitiesById.get(id))
        .filter((e): e is NonNullable<typeof e> => !!e && !!e.sceneId)
        .map((e) => [e.sceneId as string, e]),
    );

    // 将 SceneConnection[] 转换为 scenes 表 exits 列的 JSON 数组
    // locked = 存在 requiredClueId（线索门禁）；requiredClueId/checkRequired 原样保留
    const exitsJson = JSON.stringify(
      scene.connections.map((conn) => {
        // 望得见的出口额外带上识别信息。
        //
        // 没有单独建实体行：entities 表的 type 上有 CHECK(type IN ('pc','npc','monster','item'))，
        // 而本仓库的建表是 CREATE TABLE IF NOT EXISTS 且没有迁移机制 —— 往约束里加新类型
        // 对已经存在的库文件不会生效，只会在运行时插入失败。挂在既有的 exits JSON 上
        // 语义也更准：从这儿望得见它，也正好能走过去。
        const sighted = sightedByTarget.get(conn.targetSceneId);
        return {
          target: conn.targetSceneId,
          desc: conn.condition,
          locked: !!conn.requiredClueId,
          requiredClueId: conn.requiredClueId,
          checkRequired: conn.checkRequired,
          ...(sighted
            ? {
                sighted: {
                  entityId: sighted.id,
                  name: sighted.name,
                  mentionKeywords: sighted.mentionKeywords,
                  noticedBy: sighted.noticedBy ?? [],
                  recognition: sighted.recognition,
                },
              }
            : {}),
        };
      }),
    );
    insertScene.run(scene.id, scene.name, scene.description, exitsJson, i === 0 ? 1 : 0);
  }

  // ── 2. 注册 NPC 为实体 ──
  // position 语义 = 所在场景 ID（与 scene_id 一致，符合 buildContextPrompt/getEntitiesInScene 的过滤约定）
  const insertEntity = db.prepare(`
    INSERT OR REPLACE INTO entities (id, name, type, hp, max_hp, ac, status, position, faction, attributes, scene_id, alive)
    VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, '{}', ?, 1)
  `);
  for (const npc of moduleData.npcs) {
    const stats = npcStats[npc.id];
    const hp = (typeof stats?.hp === "number" ? stats.hp : 8) as number;
    const ac = (typeof stats?.ac === "number" ? stats.ac : 10) as number;
    const faction = npc.role || "unknown";
    insertEntity.run(npc.id, npc.name, "npc", hp, hp, ac, npc.sceneId, faction, npc.sceneId);
  }

  // ── 3. 注册可拾取物品为实体 ──
  const insertItem = db.prepare(`
    INSERT OR REPLACE INTO entities (id, name, type, hp, max_hp, ac, status, position, faction, attributes, scene_id, alive)
    VALUES (?, ?, 'item', 0, 0, 0, '[]', ?, 'world', ?, ?, 1)
  `);
  for (const item of moduleData.items) {
    if (item.type === "trap") continue; // 环境陷阱不作为实体
    const attrs = JSON.stringify({ itemType: item.type, description: item.description, revelation: item.revelation ?? "" });
    insertItem.run(item.id, item.name, item.sceneId, attrs, item.sceneId);
  }

  // ── 4. 注册玩家实体（默认置于第一个场景，position = 场景 ID） ──
  const firstScene = moduleData.scenes[0];
  if (firstScene) {
    insertEntity.run("player", "调查员", "pc", 12, 12, 12, firstScene.id, "调查员", firstScene.id);
    insertEntity.run("player2", "同行者", "pc", 12, 12, 12, firstScene.id, "调查员", firstScene.id);
  }
}
