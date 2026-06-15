'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

/**
 * SQLite 连接管理（better-sqlite3，同步 API）。
 * - 默认持久化到 data/app.db；
 * - 设置环境变量 DB_FILE=':memory:' 可用内存库（测试用）。
 * SQLite 文本以 UTF-8 存储，天然支持中文。
 */

const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'app.db');

let db = null;

function getDb() {
  if (db) return db;
  if (DB_FILE !== ':memory:') {
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  }
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  initSchema(db);
  return db;
}

function initSchema(conn) {
  conn.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'viewer',
      active        INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 蜂场
    CREATE TABLE IF NOT EXISTS apiaries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      code        TEXT NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      location    TEXT NOT NULL,
      district    TEXT NOT NULL,
      keeper      TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 蜂箱/蜂群
    CREATE TABLE IF NOT EXISTS hives (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      code         TEXT NOT NULL UNIQUE,
      apiary_id    INTEGER NOT NULL REFERENCES apiaries(id) ON DELETE CASCADE,
      queen_year   INTEGER,
      frame_count  INTEGER NOT NULL DEFAULT 0,
      strength     TEXT NOT NULL DEFAULT 'medium',
      status       TEXT NOT NULL DEFAULT 'active',
      installed_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 检查记录
    CREATE TABLE IF NOT EXISTS inspections (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      hive_id      INTEGER NOT NULL REFERENCES hives(id) ON DELETE CASCADE,
      inspector_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      inspect_date TEXT NOT NULL,
      has_queen    INTEGER NOT NULL DEFAULT 1,
      brood_frames REAL NOT NULL DEFAULT 0,
      honey_frames REAL NOT NULL DEFAULT 0,
      disease      TEXT NOT NULL DEFAULT 'none',
      note         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 采收批次
    CREATE TABLE IF NOT EXISTS harvests (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_no     TEXT NOT NULL UNIQUE,
      apiary_id    INTEGER NOT NULL REFERENCES apiaries(id) ON DELETE CASCADE,
      harvest_date TEXT NOT NULL,
      product      TEXT NOT NULL DEFAULT 'honey',
      quantity_kg  REAL NOT NULL DEFAULT 0,
      note         TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_hives_apiary       ON hives(apiary_id);
    CREATE INDEX IF NOT EXISTS idx_inspections_hive   ON inspections(hive_id);
    CREATE INDEX IF NOT EXISTS idx_harvests_apiary    ON harvests(apiary_id);
    CREATE INDEX IF NOT EXISTS idx_apiaries_district  ON apiaries(district);
  `);
}

/** 清空所有业务数据（测试用）。 */
function resetAll() {
  const conn = getDb();
  conn.exec('DELETE FROM harvests; DELETE FROM inspections; DELETE FROM hives; DELETE FROM apiaries; DELETE FROM users;');
  conn.exec("DELETE FROM sqlite_sequence WHERE name IN ('harvests','inspections','hives','apiaries','users');");
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, resetAll, close, DB_FILE };
