import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { installKeggPublicProjection, keggAccessPolicy } from "@/lib/keggAccessPolicy";

type SqliteGlobal = typeof globalThis & {
  __reactenzdbSqliteConnections?: Map<string, DatabaseSync>;
  __reactenzdbSqliteQueryCache?: Map<string, { expiresAt: number; rows: Array<Record<string, unknown>> }>;
  __reactenzdbSqliteFts5?: Map<string, boolean>;
  __reactenzdbSqliteStableCache?: Map<string, Array<Record<string, unknown>>>;
};

const sqliteGlobal = globalThis as SqliteGlobal;
const connections = sqliteGlobal.__reactenzdbSqliteConnections ?? new Map<string, DatabaseSync>();
sqliteGlobal.__reactenzdbSqliteConnections = connections;
const queryCache = sqliteGlobal.__reactenzdbSqliteQueryCache ?? new Map<string, { expiresAt: number; rows: Array<Record<string, unknown>> }>();
sqliteGlobal.__reactenzdbSqliteQueryCache = queryCache;
const fts5Availability = sqliteGlobal.__reactenzdbSqliteFts5 ?? new Map<string, boolean>();
sqliteGlobal.__reactenzdbSqliteFts5 = fts5Availability;
const stableCache = sqliteGlobal.__reactenzdbSqliteStableCache ?? new Map<string, Array<Record<string, unknown>>>();
sqliteGlobal.__reactenzdbSqliteStableCache = stableCache;

const QUERY_CACHE_TTL_MS = 60_000;
const QUERY_CACHE_MAX_ENTRIES = 256;
const STABLE_CACHE_MAX_ENTRIES = 1024;

function databaseSignature(absolutePath: string): string {
  const databaseMtime = fs.statSync(absolutePath).mtimeMs;
  const walPath = `${absolutePath}-wal`;
  const walMtime = fs.existsSync(walPath) ? fs.statSync(walPath).mtimeMs : 0;
  return `${databaseMtime}:${walMtime}`;
}

function paramsKey(params: Array<string | number | bigint | Uint8Array | null>): string {
  return JSON.stringify(params, (_key, value) => {
    if (typeof value === "bigint") return `${value}n`;
    if (value instanceof Uint8Array) return Array.from(value);
    return value;
  });
}

function cachedQuery<T>(
  dbPath: string,
  sql: string,
  params: Array<string | number | bigint | Uint8Array | null>,
): T[] {
  const absolutePath = path.resolve(dbPath);
  const key = `${keggAccessPolicy.policy_version}\u0000${absolutePath}\u0000${databaseSignature(absolutePath)}\u0000${sql}\u0000${paramsKey(params)}`;
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached && cached.expiresAt > now) {
    // Refresh insertion order so the bounded map behaves as a small LRU.
    queryCache.delete(key);
    queryCache.set(key, cached);
    return cached.rows as T[];
  }
  if (cached) queryCache.delete(key);

  const rows = database(absolutePath).prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const normalized = rows.map((row) => Object.assign({}, row));
  if (normalized.length <= 500) {
    queryCache.set(key, { expiresAt: now + QUERY_CACHE_TTL_MS, rows: normalized });
    while (queryCache.size > QUERY_CACHE_MAX_ENTRIES) {
      const oldestKey = queryCache.keys().next().value as string | undefined;
      if (!oldestKey) break;
      queryCache.delete(oldestKey);
    }
  }
  return normalized as T[];
}

function database(dbPath: string): DatabaseSync {
  const absolutePath = path.resolve(dbPath);
  const connectionKey = `${keggAccessPolicy.policy_version}\u0000${absolutePath}`;
  const cached = connections.get(connectionKey);
  if (cached) return cached;
  if (!fs.existsSync(absolutePath)) throw new Error(`SQLite database not found: ${absolutePath}`);

  const db = new DatabaseSync(absolutePath, { readOnly: true });
  db.exec("PRAGMA temp_store = MEMORY; PRAGMA cache_size = -32768; PRAGMA mmap_size = 134217728;");
  installKeggPublicProjection(db);
  db.exec("PRAGMA query_only = ON;");
  connections.set(connectionKey, db);
  return db;
}

export function querySqlite<T>(dbPath: string, sql: string): T[] {
  // node:sqlite returns rows with a null prototype. Normalize them before a
  // server component passes data to a client component.
  return cachedQuery<T>(dbPath, sql, []);
}

// For release-constant aggregates: rows are kept until the database file
// signature changes, so a frozen release pays for each full scan only once.
export function querySqliteStable<T>(dbPath: string, sql: string): T[] {
  const absolutePath = path.resolve(dbPath);
  const key = `${keggAccessPolicy.policy_version}\u0000${absolutePath}\u0000${databaseSignature(absolutePath)}\u0000${sql}`;
  const cached = stableCache.get(key);
  if (cached) {
    stableCache.delete(key);
    stableCache.set(key, cached);
    return cached as T[];
  }
  const rows = (database(absolutePath).prepare(sql).all() as Array<Record<string, unknown>>).map((row) => Object.assign({}, row));
  stableCache.set(key, rows);
  while (stableCache.size > STABLE_CACHE_MAX_ENTRIES) {
    const oldestKey = stableCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    stableCache.delete(oldestKey);
  }
  return rows as T[];
}

export function sqliteFts5Available(dbPath: string): boolean {
  const absolutePath = path.resolve(dbPath);
  const cached = fts5Availability.get(absolutePath);
  if (cached !== undefined) return cached;
  let enabled = false;
  try {
    const rows = cachedQuery<{ v: number | bigint }>(absolutePath, "SELECT sqlite_compileoption_used('ENABLE_FTS5') AS v", []);
    enabled = Number(rows[0]?.v) === 1;
  } catch {
    enabled = false;
  }
  fts5Availability.set(absolutePath, enabled);
  return enabled;
}

export function querySqliteParams<T>(
  dbPath: string,
  sql: string,
  params: Array<string | number | bigint | Uint8Array | null> = [],
): T[] {
  return cachedQuery<T>(dbPath, sql, params);
}
