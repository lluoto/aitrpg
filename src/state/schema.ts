// 世界状态 SQLite schema — 律书的真相源

import type { Database } from "bun:sqlite";

export function createSchema(db: Database) {
  db.exec(`

    CREATE TABLE IF NOT EXISTS entities (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK(type IN ('pc','npc','monster','item')),
      hp          INTEGER NOT NULL DEFAULT 0,
      max_hp      INTEGER NOT NULL DEFAULT 0,
      ac          INTEGER NOT NULL DEFAULT 10,
      status      TEXT NOT NULL DEFAULT '[]',
      position    TEXT NOT NULL DEFAULT 'unknown',
      faction     TEXT DEFAULT NULL,
      attributes  TEXT NOT NULL DEFAULT '{}',
      scene_id    TEXT DEFAULT NULL,
      alive       INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS effects (
      id            TEXT PRIMARY KEY,
      source        TEXT NOT NULL,
      target        TEXT NOT NULL,
      type          TEXT NOT NULL CHECK(type IN ('advantage','disadvantage','condition','buff','debuff')),
      description   TEXT NOT NULL,
      duration      INTEGER NOT NULL DEFAULT 0,
      round_applied INTEGER NOT NULL,
      data          TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (target) REFERENCES entities(id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id   TEXT NOT NULL,
      item_name   TEXT NOT NULL,
      quantity    INTEGER NOT NULL DEFAULT 1,
      description TEXT DEFAULT '',
      properties  TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (entity_id) REFERENCES entities(id)
    );

    CREATE TABLE IF NOT EXISTS relationships (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_a    TEXT NOT NULL,
      entity_b    TEXT NOT NULL,
      relation    TEXT NOT NULL,
      attitude    INTEGER NOT NULL DEFAULT 0,
      note        TEXT DEFAULT '',
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(entity_a, entity_b)
    );

    CREATE TABLE IF NOT EXISTS scenes (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      lighting    TEXT DEFAULT 'normal',
      dangers     TEXT NOT NULL DEFAULT '[]',
      exits       TEXT NOT NULL DEFAULT '[]',
      is_active   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      round        INTEGER NOT NULL,
      timestamp    INTEGER NOT NULL DEFAULT (unixepoch()),
      state_json   TEXT NOT NULL,
      context_text TEXT NOT NULL,
      event_count  INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS event_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      round       INTEGER NOT NULL,
      timestamp   INTEGER NOT NULL DEFAULT (unixepoch()),
      event_type  TEXT NOT NULL,
      actor       TEXT DEFAULT NULL,
      target      TEXT DEFAULT NULL,
      description TEXT NOT NULL,
      result_json TEXT DEFAULT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type   ON entities(type);
    CREATE INDEX IF NOT EXISTS idx_entities_scene  ON entities(scene_id);
    CREATE INDEX IF NOT EXISTS idx_effects_target  ON effects(target);
    CREATE INDEX IF NOT EXISTS idx_events_round    ON event_log(round);
    CREATE INDEX IF NOT EXISTS idx_snapshots_round ON snapshots(round);
    CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory(entity_id);
  `);
}
