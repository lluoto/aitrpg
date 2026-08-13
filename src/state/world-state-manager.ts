// 世界状态管理器 — Bun 原生 SQLite 真相源
// LLM 只看不写。所有状态变更走律书代码路径。

import { Database } from "bun:sqlite";
import { createSchema } from "./schema";
import type { GameEvent } from "./event-types";
import type { WorldEntity, WorldState, Effect, CombatResult, PlayerRuntimeState } from "../types";
import type { SanityState } from "../rules/coc-engine";

/** 场景出口。模组写入的是对象（目标场景 + 展示用描述），不是裸字符串。 */
export interface SceneExit {
  readonly target: string;
  readonly desc: string;
}

/** 一条场景记录。scenes 表的对外形状，getScene() 与 listScenes() 共用。 */
export interface SceneRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly exits: SceneExit[];
}

// ============================================================
// 世界状态管理器
// ============================================================

export class WorldStateManager {
  private db: Database;
  private currentRound: number = 0;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    createSchema(this.db);
  }

  // ==========================================================
  // 实体操作
  // ==========================================================

  getEntity(id: string): WorldEntity | null {
    const row: any = this.db
      .query("SELECT * FROM entities WHERE id = ?")
      .get(id);
    if (!row) return null;
    return this.rowToEntity(row);
  }

  getEntityByName(name: string): WorldEntity | null {
    // 先精确匹配
    let row: any = this.db
      .query("SELECT * FROM entities WHERE name = ? AND alive = 1 LIMIT 1")
      .get(name);
    if (row) return this.rowToEntity(row);

    // 模糊匹配：name 包含输入词，或输入词包含 name
    const rows: any[] = this.db
      .query("SELECT * FROM entities WHERE alive = 1 AND (name LIKE ? OR ? LIKE ('%' || name || '%'))")
      .all(`%${name}%`, name);
    if (rows.length > 0) return this.rowToEntity(rows[0]);

    return null;
  }

  upsertEntity(entity: Partial<WorldEntity> & { id: string; name: string; type: WorldEntity["type"] }) {
    const existing = this.getEntity(entity.id);
    if (existing) {
      this.db.run(
        `UPDATE entities SET
          name=?2, type=?3, hp=?4, max_hp=?5, ac=?6, status=?7, position=?8,
          faction=?9, attributes=?10, scene_id=?11, alive=?12, updated_at=unixepoch()
         WHERE id=?1`,
        [
          entity.id,
          entity.name,
          entity.type,
          entity.hp ?? existing.hp,
          entity.maxHp ?? existing.maxHp,
          entity.ac ?? existing.ac,
          JSON.stringify(entity.status ?? existing.status),
          entity.position ?? existing.position,
          (entity as any).faction ?? (existing as any).faction,
          JSON.stringify((entity as any).attributes ?? {}),
          (entity as any).scene_id ?? (existing as any).scene_id,
          1,
        ]
      );
    } else {
      this.db.run(
        `INSERT INTO entities (id,name,type,hp,max_hp,ac,status,position,faction,attributes,scene_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`,
        [
          entity.id,
          entity.name,
          entity.type,
          entity.hp ?? 0,
          entity.maxHp ?? entity.hp ?? 1,
          entity.ac ?? 10,
          JSON.stringify(entity.status ?? []),
          entity.position ?? "unknown",
          (entity as any).faction ?? null,
          JSON.stringify((entity as any).attributes ?? {}),
          (entity as any).scene_id ?? null,
        ]
      );
    }
  }

  applyDamage(entityId: string, damage: number): { killed: boolean; remainingHp: number } {
    const entity = this.getEntity(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);

    const newHp = Math.max(0, entity.hp - damage);
    this.db.run("UPDATE entities SET hp=?1, updated_at=unixepoch() WHERE id=?2", [newHp, entityId]);

    if (newHp <= 0) {
      this.db.run("UPDATE entities SET alive=0, status='[\"dead\"]' WHERE id=?", [entityId]);
    }

    return { killed: newHp <= 0, remainingHp: newHp };
  }

  killEntity(entityId: string) {
    this.db.run(
      "UPDATE entities SET hp=0, alive=0, status='[\"dead\"]', updated_at=unixepoch() WHERE id=?",
      [entityId]
    );
  }

  getEntitiesInScene(sceneId: string): WorldEntity[] {
    const rows: any[] = this.db
      .query("SELECT * FROM entities WHERE scene_id = ? AND alive = 1")
      .all(sceneId);
    return rows.map((r) => this.rowToEntity(r));
  }

  getAllAliveEntities(): WorldEntity[] {
    const rows: any[] = this.db.query("SELECT * FROM entities WHERE alive = 1").all();
    return rows.map((r) => this.rowToEntity(r));
  }

  seedEntities(entities: Array<Partial<WorldEntity> & { id: string; name: string; type: WorldEntity["type"] }>) {
    const insertStmt = this.db.query(
      `INSERT OR REPLACE INTO entities (id,name,type,hp,max_hp,ac,status,position,faction,scene_id)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`
    );
    this.db.transaction((entities) => {
      for (const e of entities) {
        insertStmt.run(
          e.id, e.name, e.type,
          e.hp ?? 1, e.maxHp ?? e.hp ?? 1, e.ac ?? 10,
          JSON.stringify(e.status ?? []),
          e.position ?? "unknown",
          (e as any).faction ?? null,
          (e as any).scene_id ?? null
        );
      }
    })(entities);
  }

  // ==========================================================
  // 玩家运行时状态 — SAN / 背包 / 已装备武器 / 已装备护甲
  //
  // 这四类此前是 GameSession 的进程内 Map。放在这里之后，写入即落库，
  // getCurrentState() 才拿得到完整快照。读取每次都从库里重新解析，
  // 因此调用方拿到的数组是副本，改它不会穿透到真相源。
  // ==========================================================

  /** 确保玩家在真相源中有一行。已存在则保持原值。 */
  registerPlayer(playerId: string) {
    this.db.run("INSERT OR IGNORE INTO player_state (entity_id) VALUES (?)", [playerId]);
  }

  getPlayerIds(): string[] {
    const rows: any[] = this.db
      .query("SELECT entity_id FROM player_state ORDER BY entity_id")
      .all();
    return rows.map((r) => r.entity_id as string);
  }

  getPlayerState(playerId: string): PlayerRuntimeState | null {
    const row: any = this.db
      .query("SELECT sanity, inventory, weapons, armor FROM player_state WHERE entity_id = ?")
      .get(playerId);
    if (!row) return null;
    return {
      sanity: this.parseJsonColumn<SanityState | null>(row.sanity, null),
      inventory: this.parseJsonColumn<string[]>(row.inventory, []),
      weapons: this.parseJsonColumn<string[]>(row.weapons, []),
      armor: this.parseJsonColumn<string[]>(row.armor, []),
    };
  }

  getPlayerSanity(playerId: string): SanityState | null {
    return this.getPlayerState(playerId)?.sanity ?? null;
  }

  setPlayerSanity(playerId: string, sanity: SanityState) {
    this.writePlayerColumn(playerId, "sanity", JSON.stringify(sanity));
  }

  getPlayerInventory(playerId: string): string[] {
    return this.getPlayerState(playerId)?.inventory ?? [];
  }

  setPlayerInventory(playerId: string, items: string[]) {
    this.writePlayerColumn(playerId, "inventory", JSON.stringify(items));
  }

  getPlayerWeapons(playerId: string): string[] {
    return this.getPlayerState(playerId)?.weapons ?? [];
  }

  setPlayerWeapons(playerId: string, weapons: string[]) {
    this.writePlayerColumn(playerId, "weapons", JSON.stringify(weapons));
  }

  getPlayerArmor(playerId: string): string[] {
    return this.getPlayerState(playerId)?.armor ?? [];
  }

  setPlayerArmor(playerId: string, armor: string[]) {
    this.writePlayerColumn(playerId, "armor", JSON.stringify(armor));
  }

  // ==========================================================
  // 效果 / buff
  // ==========================================================

  addEffect(effect: Effect & { round_applied?: number }) {
    this.db.run(
      `INSERT OR REPLACE INTO effects (id,source,target,type,description,duration,round_applied,data)
       VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`,
      [
        effect.id, effect.source, effect.target, effect.type,
        effect.description, effect.duration,
        effect.round_applied ?? this.currentRound, "{}",
      ]
    );
  }

  tickEffects(): Effect[] {
    this.db.run("UPDATE effects SET duration = duration - 1 WHERE duration > 0");
    const expired: any[] = this.db.query("SELECT * FROM effects WHERE duration = 0").all();
    this.db.run("DELETE FROM effects WHERE duration = 0");
    return expired.map((r: any) => this.rowToEffect(r));
  }

  getActiveEffects(targetId?: string): Effect[] {
    const rows: any[] = targetId
      ? this.db.query("SELECT * FROM effects WHERE target = ?1 AND duration > 0").all(targetId)
      : this.db.query("SELECT * FROM effects WHERE duration > 0").all();
    return rows.map((r: any) => this.rowToEffect(r));
  }

  // ==========================================================
  // 快照系统
  // ==========================================================

  createSnapshot(round: number): string {
    this.currentRound = round;

    const state = this.getCurrentState();
    const recentEvents = this.getRecentEvents(5);
    const contextText = this.buildContextPrompt(state, recentEvents);

    this.db.run(
      `INSERT INTO snapshots (round, state_json, context_text, event_count)
       VALUES (?1, ?2, ?3, ?4)`,
      [round, JSON.stringify(state), contextText, recentEvents.length]
    );

    return contextText;
  }

  getLatestContext(): string {
    const row: any = this.db
      .query("SELECT context_text FROM snapshots ORDER BY round DESC LIMIT 1")
      .get();
    return row?.context_text ?? "[无快照]";
  }

  getCurrentState(): WorldState {
    const entities = this.getAllAliveEntities();
    const effects = this.getActiveEffects();

    const entityMap: Record<string, WorldEntity> = {};
    for (const e of entities) entityMap[e.id] = e;

    const sceneRow: any = this.db
      .query("SELECT id FROM scenes WHERE is_active = 1 LIMIT 1")
      .get();

    const players: Record<string, PlayerRuntimeState> = {};
    for (const pid of this.getPlayerIds()) {
      const ps = this.getPlayerState(pid);
      if (ps) players[pid] = ps;
    }

    return {
      entities: entityMap,
      active_effects: effects,
      scene: sceneRow?.id ?? "unknown",
      time: `round_${this.currentRound}`,
      players,
    };
  }

  buildContextPrompt(state: WorldState, recentEvents: GameEvent[]): string {
    const lines: string[] = [];
    lines.push(`[世界状态 · 第 ${this.currentRound} 轮 · 场景: ${state.scene}]`);
    lines.push("");

    // 只列当前场景的实体（position === 当前场景 ID）
    const alive = Object.values(state.entities)
      .filter((e) => !e.status.includes("dead") && e.position === state.scene);
    if (alive.length > 0) {
      lines.push("## 在场角色");
      for (const e of alive) {
        const statusStr = e.status.filter((s) => s !== "alive").length > 0
          ? ` [${e.status.filter((s) => s !== "alive").join(", ")}]` : "";
        lines.push(`- ${e.name}(${e.type}) HP:${e.hp}/${e.maxHp} AC:${e.ac} 位置:${e.position}${statusStr}`);
      }
      lines.push("");
    }

    if (state.active_effects.length > 0) {
      lines.push("## 活跃效果");
      for (const eff of state.active_effects) {
        const targetName = state.entities[eff.target]?.name ?? eff.target;
        lines.push(`- ${targetName}: ${eff.description}（剩余 ${eff.duration} 回合）`);
      }
      lines.push("");
    }

    if (recentEvents.length > 0) {
      lines.push("## 最近事件");
      for (const evt of recentEvents.slice(-5)) {
        const actorName = evt.actor ? (state.entities[evt.actor]?.name ?? evt.actor) : "";
        const targetName = evt.target ? (state.entities[evt.target]?.name ?? evt.target) : "";
        const desc = actorName
          ? (targetName ? `${actorName} → ${targetName}: ${evt.description}` : `${actorName}: ${evt.description}`)
          : evt.description;
        lines.push(`- [${evt.event_type}] ${desc}`);
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  // ==========================================================
  // 事件日志
  // ==========================================================

  logEvent(event: GameEvent) {
    this.db.run(
      `INSERT INTO event_log (round, event_type, actor, target, description, result_json)
       VALUES (?1,?2,?3,?4,?5,?6)`,
      [event.round, event.event_type, event.actor ?? null, event.target ?? null,
       event.description, event.result ? JSON.stringify(event.result) : null]
    );
  }

  logCombatEvent(round: number, attackerId: string, targetId: string, description: string, result: CombatResult) {
    this.logEvent({
      round, timestamp: Date.now(), event_type: "combat",
      actor: attackerId, target: targetId, description,
      result: result as unknown as Record<string, unknown>,
    });
  }

  getRecentEvents(n: number = 5): GameEvent[] {
    const rows: any[] = this.db
      .query("SELECT * FROM event_log ORDER BY id DESC LIMIT ?")
      .all(n);
    return rows.map((r: any) => ({
      round: r.round, timestamp: r.timestamp, event_type: r.event_type,
      actor: r.actor, target: r.target, description: r.description,
      result: r.result_json ? JSON.parse(r.result_json) : undefined,
    })).reverse();
  }

  // ==========================================================
  // 场景 / 关系
  // ==========================================================

  setActiveScene(sceneId: string) {
    this.db.run("UPDATE scenes SET is_active = 0");
    this.db.run("UPDATE scenes SET is_active = 1 WHERE id = ?", [sceneId]);
  }

  /** 读取场景（含模组原文描写与出口）。不存在返回 null。 */
  getScene(sceneId: string): SceneRecord | null {
    const row: any = this.db
      .query("SELECT id, name, description, exits FROM scenes WHERE id = ?")
      .get(sceneId);
    if (!row) return null;
    return this.toSceneRecord(row);
  }

  /**
   * 列出全部已注册场景。
   *
   * 存在的意义是让调用方不必为了「列举场景」去 getDatabase() 手写 SQL：
   * 那样查出来的行是 any，列名拼错、少读一列、description 为 null
   * 都要等到运行时才发现。收到这里之后，表结构只有本文件知道。
   */
  listScenes(): SceneRecord[] {
    const rows = this.db
      .query("SELECT id, name, description, exits FROM scenes")
      .all() as any[];
    return rows.map((r) => this.toSceneRecord(r));
  }

  // name 在 schema 里是 NOT NULL，所以不做 `?? id` 回落——那是在防一个
  // 数据库已经禁止的状态。空串是允许的，由调用方自己判 falsy。
  /**
   * 覆写场景出口。
   *
   * 与 registerScene() 分开而不是给它加第四个参数：出口往往在场景注册之后才
   * 确定（模组导入分三个阶段补出口，故事生成器先选模板再连边），硬塞进注册
   * 签名会逼调用方在还不知道出口时先传一个占位值。
   */
  setSceneExits(sceneId: string, exits: readonly SceneExit[]) {
    this.db.run("UPDATE scenes SET exits = ? WHERE id = ?", [
      JSON.stringify(exits.map((e) => ({ target: e.target, desc: e.desc }))),
      sceneId,
    ]);
  }

  private toSceneRecord(row: any): SceneRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      exits: this.parseExits(row.exits),
    };
  }

  /**
   * 注册场景（模组原文导入用）。
   *
   * 不能用 INSERT OR REPLACE：它是先删后插，未在 VALUES 里列出的列
   * （exits / dangers / lighting）会静默回落到 schema 默认值。模组导入时
   * exits 已经写好，再注册一次就会被整段清空；顺带 is_active 也会被抹成 0，
   * 重新注册当前活动场景等于把它取消激活。改为「存在则 UPDATE 指定列」。
   */
  registerScene(sceneId: string, displayName: string, description?: string) {
    const existing = this.getScene(sceneId);
    if (existing) {
      this.db.run("UPDATE scenes SET name = ?, description = ? WHERE id = ?", [
        displayName ?? sceneId,
        description ?? existing.description,
        sceneId,
      ]);
      return;
    }
    this.db.run(
      "INSERT INTO scenes (id, name, description, is_active) VALUES (?, ?, ?, 0)",
      [sceneId, displayName ?? sceneId, description ?? ""]
    );
  }

  /**
   * exits 列的真实内容是 `{target, desc}[]` —— mythos-module 的三处写入点
   * （L465 / L480 / L492）都 JSON.stringify 对象数组。此前 getScene() 把返回类型
   * 声明成 `string[]`，而 JSON.parse 返回 any，类型检查因此全程沉默；
   * 第一个真正消费 exits 的调用方会拿到对象却以为是字符串。
   *
   * 这里归一成单一形状，并容忍历史上可能存在的纯字符串写法与损坏数据。
   */
  private parseExits(raw: unknown): SceneExit[] {
    if (typeof raw !== "string" || raw.length === 0) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const exits: SceneExit[] = [];
    for (const item of parsed) {
      if (typeof item === "string") {
        exits.push({ target: item, desc: item });
        continue;
      }
      if (item && typeof item === "object" && typeof (item as { target?: unknown }).target === "string") {
        const target = (item as { target: string }).target;
        const desc = (item as { desc?: unknown }).desc;
        exits.push({ target, desc: typeof desc === "string" ? desc : target });
      }
    }
    return exits;
  }

  setRelation(a: string, b: string, relation: string, attitude: number = 0) {
    this.db.run(
      `INSERT OR REPLACE INTO relationships (entity_a, entity_b, relation, attitude, updated_at)
       VALUES (?1,?2,?3,?4,unixepoch())`,
      [a, b, relation, attitude]
    );
  }

  getAttitude(a: string, b: string): number {
    const row: any = this.db
      .query("SELECT attitude FROM relationships WHERE (entity_a=?1 AND entity_b=?2) OR (entity_a=?2 AND entity_b=?1)")
      .get(a, b);
    return row?.attitude ?? 0;
  }

  modifyAttitude(a: string, b: string, delta: number) {
    const current = this.getAttitude(a, b);
    this.setRelation(a, b, current > 0 ? "ally" : current < 0 ? "hostile" : "neutral", current + delta);
  }

  // ==========================================================
  // 辅助
  // ==========================================================

  /**
   * 列名来自本类内部的封闭字面量联合，不接受外部输入，故可安全插值。
   * 值一律以 JSON 文本参数化绑定。
   */
  private writePlayerColumn(
    playerId: string,
    column: "sanity" | "inventory" | "weapons" | "armor",
    value: string,
  ) {
    this.registerPlayer(playerId);
    this.db.run(
      `UPDATE player_state SET ${column}=?1, updated_at=unixepoch() WHERE entity_id=?2`,
      [value, playerId]
    );
  }

  private parseJsonColumn<T>(raw: unknown, fallback: T): T {
    if (typeof raw !== "string" || raw.length === 0) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  private rowToEntity(row: any): WorldEntity {
    return {
      id: row.id, name: row.name, type: row.type,
      hp: row.hp, maxHp: row.max_hp, ac: row.ac,
      status: JSON.parse(row.status || "[]"),
      position: row.position,
      faction: row.faction ?? undefined,
    };
  }

  private rowToEffect(row: any): Effect {
    return {
      id: row.id, source: row.source, target: row.target,
      type: row.type, description: row.description, duration: row.duration,
    };
  }

  close() { this.db.close(); }

  getDatabase(): Database { return this.db; }
}
