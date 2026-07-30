import { mkdir, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

import { GeocodeCacheStore, isCacheableGeocodeResult } from './geocoder';
import { EnderecoConsulta } from './types';

interface PersistentCacheOptions {
  dir?: string;
  maxItems?: number;
  flushDebounceMs?: number;
  flushBatchSize?: number;
  fileName?: string;
  dbFileName?: string;
  successTtlMs?: number;
  zeroResultTtlMs?: number;
  now?: () => number;
}

interface PersistentCacheItem {
  key: string;
  language: string;
  region: string;
  value: EnderecoConsulta;
  createdAt: string;
}

interface PersistentCacheFile {
  version: 1;
  items: PersistentCacheItem[];
}

interface CacheRow {
  cache_key: string;
  payload: string;
  created_at: string;
}

const DEFAULT_CACHE_DIR = './dados';
const DEFAULT_MAX_ITEMS = 50000;
const CACHE_FILE_NAME = 'geocode-cache.json';
const CACHE_DB_FILE_NAME = 'geocode-cache.sqlite';
const SUCCESS_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const ZERO_RESULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LEGACY_MIGRATION_KEY = 'legacy-json-v1-migrated';

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCacheDir(dir?: string): string {
  return path.resolve(process.cwd(), dir || process.env.GEOCODE_CACHE_DIR || DEFAULT_CACHE_DIR);
}

function resolveDatabaseFileName(options: PersistentCacheOptions): string {
  if (options.dbFileName) return options.dbFileName;
  if (!options.fileName) return CACHE_DB_FILE_NAME;
  return options.fileName.replace(/\.json$/i, '.sqlite');
}

export function buildGeocodeCacheKey(lat: number, lng: number, language = 'pt-BR', region = 'BR'): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)},${language},${region}`;
}

function cloneHit(item: EnderecoConsulta): EnderecoConsulta {
  return {
    ...item,
    cache_hit: true
  };
}

function cloneStoredValue(item: EnderecoConsulta): EnderecoConsulta {
  return {
    ...item,
    cache_hit: false
  };
}

function isPersistentCacheItem(item: unknown): item is PersistentCacheItem {
  const candidate = item as PersistentCacheItem;
  return Boolean(
    candidate &&
    typeof candidate.key === 'string' &&
    typeof candidate.language === 'string' &&
    typeof candidate.region === 'string' &&
    candidate.value &&
    typeof candidate.value === 'object' &&
    typeof candidate.value.status_api === 'string'
  );
}

function isZeroResult(item: EnderecoConsulta): boolean {
  return item.status_api === 'ZERO_RESULTS' || item.status_api === 'ZERO_RESULTADOS';
}

export class PersistentGeocodeCache implements GeocodeCacheStore {
  private readonly dir: string;
  private readonly legacyFilePath: string;
  private readonly databasePath: string;
  private readonly maxItems: number;
  private readonly successTtlMs: number;
  private readonly zeroResultTtlMs: number;
  private readonly now: () => number;
  private database: DatabaseSync | null = null;
  private loaded = false;

  constructor(options: PersistentCacheOptions = {}) {
    this.dir = resolveCacheDir(options.dir);
    this.legacyFilePath = path.join(this.dir, options.fileName || CACHE_FILE_NAME);
    this.databasePath = path.join(this.dir, resolveDatabaseFileName(options));
    this.maxItems = parsePositiveInt(options.maxItems ?? process.env.GEOCODE_CACHE_MAX_ITEMS, DEFAULT_MAX_ITEMS);
    this.successTtlMs = parsePositiveInt(options.successTtlMs, SUCCESS_TTL_MS);
    this.zeroResultTtlMs = parsePositiveInt(options.zeroResultTtlMs, ZERO_RESULT_TTL_MS);
    this.now = options.now || Date.now;
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    await mkdir(this.dir, { recursive: true });
    this.openDatabase();
    await this.migrateLegacyJson();
    this.evictExpired();
    this.evictOverflow();
    this.loaded = true;
  }

  get(lat: number, lng: number, language: string, region: string): EnderecoConsulta | null {
    if (!this.loaded) return null;

    const database = this.requireDatabase();
    const key = buildGeocodeCacheKey(lat, lng, language, region);
    const row = database.prepare(
      'SELECT cache_key, payload, created_at FROM geocode_cache WHERE cache_key = ?'
    ).get(key) as unknown as CacheRow | undefined;
    if (!row) return null;

    const item = this.parseStoredValue(row.payload);
    if (!item || this.isExpired(item, row.created_at)) {
      database.prepare('DELETE FROM geocode_cache WHERE cache_key = ?').run(key);
      return null;
    }

    return cloneHit(item);
  }

  async set(item: EnderecoConsulta, language: string, region: string): Promise<void> {
    if (!isCacheableGeocodeResult(item)) return;
    if (!this.loaded) await this.load();

    const key = buildGeocodeCacheKey(item.latitude, item.longitude, language, region);
    const database = this.requireDatabase();
    database.prepare(`
      INSERT INTO geocode_cache (cache_key, language, region, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        language = excluded.language,
        region = excluded.region,
        payload = excluded.payload,
        created_at = excluded.created_at
    `).run(
      key,
      language,
      region,
      JSON.stringify(cloneStoredValue(item)),
      new Date(this.now()).toISOString()
    );
    this.evictOverflow();
  }

  async flush(): Promise<void> {
    if (!this.loaded || !this.database) return;
    this.database.exec('PRAGMA wal_checkpoint(PASSIVE);');
  }

  async close(): Promise<void> {
    await this.flush();
    this.database?.close();
    this.database = null;
    this.loaded = false;
  }

  private openDatabase() {
    if (this.database) return;

    const database = new DatabaseSync(this.databasePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        language TEXT NOT NULL,
        region TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS geocode_cache_created_at_idx ON geocode_cache (created_at);
      CREATE TABLE IF NOT EXISTS geocode_cache_meta (
        meta_key TEXT PRIMARY KEY,
        meta_value TEXT NOT NULL
      );
    `);
    this.database = database;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database) {
      throw new Error('Cache persistente de geocodificação não foi inicializado.');
    }
    return this.database;
  }

  private async migrateLegacyJson() {
    const database = this.requireDatabase();
    const migrated = database.prepare(
      'SELECT meta_value FROM geocode_cache_meta WHERE meta_key = ?'
    ).get(LEGACY_MIGRATION_KEY);
    if (migrated) return;

    let raw: string;
    try {
      raw = await readFile(this.legacyFilePath, 'utf8');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.markLegacyMigrationComplete();
        return;
      }
      throw error;
    }

    const parsed = JSON.parse(raw) as Partial<PersistentCacheFile>;
    const entries = Array.isArray(parsed.items) ? parsed.items.filter(isPersistentCacheItem) : [];
    const insert = database.prepare(`
      INSERT INTO geocode_cache (cache_key, language, region, payload, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO NOTHING
    `);

    database.exec('BEGIN IMMEDIATE;');
    try {
      for (const entry of entries) {
        const value = cloneStoredValue(entry.value);
        const createdAt = Number.isFinite(Date.parse(entry.createdAt))
          ? entry.createdAt
          : new Date(this.now()).toISOString();
        if (isCacheableGeocodeResult(value) && !this.isExpired(value, createdAt)) {
          insert.run(entry.key, entry.language, entry.region, JSON.stringify(value), createdAt);
        }
      }
      this.markLegacyMigrationComplete();
      database.exec('COMMIT;');
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }

  private markLegacyMigrationComplete() {
    this.requireDatabase().prepare(`
      INSERT INTO geocode_cache_meta (meta_key, meta_value)
      VALUES (?, ?)
      ON CONFLICT(meta_key) DO UPDATE SET meta_value = excluded.meta_value
    `).run(LEGACY_MIGRATION_KEY, new Date(this.now()).toISOString());
  }

  private parseStoredValue(payload: string): EnderecoConsulta | null {
    try {
      const parsed = JSON.parse(payload) as EnderecoConsulta;
      return isCacheableGeocodeResult(parsed) ? cloneStoredValue(parsed) : null;
    } catch {
      return null;
    }
  }

  private isExpired(item: EnderecoConsulta, createdAt: string): boolean {
    const createdAtMs = Date.parse(createdAt);
    if (!Number.isFinite(createdAtMs)) return true;
    const ttl = isZeroResult(item) ? this.zeroResultTtlMs : this.successTtlMs;
    return createdAtMs + ttl <= this.now();
  }

  private evictExpired() {
    const database = this.requireDatabase();
    const rows = database.prepare('SELECT cache_key, payload, created_at FROM geocode_cache').all() as unknown as CacheRow[];
    const remove = database.prepare('DELETE FROM geocode_cache WHERE cache_key = ?');
    for (const row of rows) {
      const item = this.parseStoredValue(row.payload);
      if (!item || this.isExpired(item, row.created_at)) {
        remove.run(row.cache_key);
      }
    }
  }

  private evictOverflow() {
    const database = this.requireDatabase();
    const row = database.prepare('SELECT COUNT(*) AS count FROM geocode_cache').get() as { count: number };
    const overflow = row.count - this.maxItems;
    if (overflow <= 0) return;
    database.prepare(`
      DELETE FROM geocode_cache
      WHERE cache_key IN (
        SELECT cache_key FROM geocode_cache
        ORDER BY created_at ASC, cache_key ASC
        LIMIT ?
      )
    `).run(overflow);
  }
}

export function createPersistentGeocodeCache(options: PersistentCacheOptions = {}): PersistentGeocodeCache {
  return new PersistentGeocodeCache(options);
}

export function registerGeocodeCacheShutdown(
  cache: Pick<PersistentGeocodeCache, 'close'>,
  ...additionalStores: Array<{ close?: () => void | Promise<void> }>
) {
  const shutdown = async () => {
    await cache.close();
    await Promise.all(additionalStores.map(store => store.close?.()));
    process.exit(0);
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}
