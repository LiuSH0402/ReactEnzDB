import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type VisitorSummary = {
  totalVisitors: number;
  todayVisitors: number;
  since: string;
};

type AnalyticsGlobal = typeof globalThis & {
  __reactEnzDBAnalytics?: {
    databasePath: string;
    database: DatabaseSync;
  };
};

const analyticsGlobal = globalThis as AnalyticsGlobal;

function analyticsPath() {
  const configured = process.env.REACTENZDB_ANALYTICS_DB?.trim();
  return path.resolve(configured || path.join(process.cwd(), "runtime", "reactenzdb_analytics.sqlite"));
}

function database() {
  const databasePath = analyticsPath();
  const cached = analyticsGlobal.__reactEnzDBAnalytics;
  if (cached?.databasePath === databasePath) return cached.database;

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS analytics_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS anonymous_visitors (
      visitor_hash TEXT PRIMARY KEY,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      registration_count INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS daily_visitors (
      visit_date TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      PRIMARY KEY (visit_date, visitor_hash)
    );
  `);

  db.prepare("INSERT OR IGNORE INTO analytics_meta (key, value) VALUES ('started_on', ?)")
    .run(new Date().toISOString().slice(0, 10));

  analyticsGlobal.__reactEnzDBAnalytics = { databasePath, database: db };
  return db;
}

function visitorHash(visitorId: string) {
  const salt = process.env.REACTENZDB_ANALYTICS_SALT
    ?? process.env.NEXTAUTH_SECRET
    ?? "ReactEnzDB-anonymous-visitor-v1";
  return crypto.createHash("sha256").update(`${salt}:${visitorId}`).digest("hex");
}

export function getVisitorSummary(): VisitorSummary {
  const db = database();
  const today = new Date().toISOString().slice(0, 10);
  const totalRow = db.prepare("SELECT COUNT(*) AS count FROM anonymous_visitors").get() as { count: number };
  const todayRow = db.prepare("SELECT COUNT(*) AS count FROM daily_visitors WHERE visit_date = ?").get(today) as { count: number };
  const sinceRow = db.prepare("SELECT value FROM analytics_meta WHERE key = 'started_on'").get() as { value: string } | undefined;

  return {
    totalVisitors: Number(totalRow.count ?? 0),
    todayVisitors: Number(todayRow.count ?? 0),
    since: sinceRow?.value ?? today,
  };
}

export function registerAnonymousVisitor(visitorId: string): VisitorSummary {
  const db = database();
  const hash = visitorHash(visitorId);
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO anonymous_visitors (visitor_hash, first_seen_at, last_seen_at, registration_count)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(visitor_hash) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        registration_count = anonymous_visitors.registration_count + 1
    `).run(hash, now, now);
    db.prepare(`
      INSERT OR IGNORE INTO daily_visitors (visit_date, visitor_hash, first_seen_at)
      VALUES (?, ?, ?)
    `).run(today, hash, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return getVisitorSummary();
}
