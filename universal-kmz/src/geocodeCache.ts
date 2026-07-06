import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GeocodeCacheStore, isCacheableGeocodeResult } from './geocoder';
import { EnderecoConsulta } from './types';

interface PersistentCacheOptions {
  dir?: string;
  maxItems?: number;
  flushDebounceMs?: number;
  flushBatchSize?: number;
  fileName?: string;
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

const DEFAULT_CACHE_DIR = './dados';
const DEFAULT_MAX_ITEMS = 50000;
const DEFAULT_FLUSH_DEBOUNCE_MS = 5000;
const DEFAULT_FLUSH_BATCH_SIZE = 50;
const CACHE_FILE_NAME = 'geocode-cache.json';

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveCacheDir(dir?: string): string {
  return path.resolve(process.cwd(), dir || process.env.GEOCODE_CACHE_DIR || DEFAULT_CACHE_DIR);
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

export class PersistentGeocodeCache implements GeocodeCacheStore {
  private readonly dir: string;
  private readonly filePath: string;
  private readonly maxItems: number;
  private readonly flushDebounceMs: number;
  private readonly flushBatchSize: number;
  private readonly items = new Map<string, PersistentCacheItem>();
  private flushTimer: NodeJS.Timeout | null = null;
  private dirtyCount = 0;
  private flushing: Promise<void> | null = null;

  constructor(options: PersistentCacheOptions = {}) {
    this.dir = resolveCacheDir(options.dir);
    this.filePath = path.join(this.dir, options.fileName || CACHE_FILE_NAME);
    this.maxItems = parsePositiveInt(options.maxItems ?? process.env.GEOCODE_CACHE_MAX_ITEMS, DEFAULT_MAX_ITEMS);
    this.flushDebounceMs = parsePositiveInt(options.flushDebounceMs, DEFAULT_FLUSH_DEBOUNCE_MS);
    this.flushBatchSize = parsePositiveInt(options.flushBatchSize, DEFAULT_FLUSH_BATCH_SIZE);
  }

  async load(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    let raw = '';
    try {
      raw = await readFile(this.filePath, 'utf8');
    } catch (error: any) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }

    const parsed = JSON.parse(raw) as Partial<PersistentCacheFile>;
    const entries = Array.isArray(parsed.items) ? parsed.items.filter(isPersistentCacheItem) : [];
    this.items.clear();
    for (const entry of entries) {
      if (isCacheableGeocodeResult(entry.value)) {
        this.items.set(entry.key, {
          ...entry,
          value: cloneStoredValue(entry.value)
        });
      }
    }
    this.evictOverflow();
  }

  get(lat: number, lng: number, language: string, region: string): EnderecoConsulta | null {
    const entry = this.items.get(buildGeocodeCacheKey(lat, lng, language, region));
    return entry ? cloneHit(entry.value) : null;
  }

  async set(item: EnderecoConsulta, language: string, region: string): Promise<void> {
    if (!isCacheableGeocodeResult(item)) return;

    const key = buildGeocodeCacheKey(item.latitude, item.longitude, language, region);
    this.items.set(key, {
      key,
      language,
      region,
      value: cloneStoredValue(item),
      createdAt: new Date().toISOString()
    });
    this.evictOverflow();
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.dirtyCount === 0) return this.flushing || Promise.resolve();
    if (this.flushing) return this.flushing;

    this.dirtyCount = 0;
    this.flushing = this.writeFileAtomic().finally(() => {
      this.flushing = null;
      if (this.dirtyCount > 0 && !this.flushTimer) {
        this.flushTimer = setTimeout(() => {
          void this.flush();
        }, this.flushDebounceMs);
      }
    });
    return this.flushing;
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private scheduleFlush() {
    this.dirtyCount++;
    if (this.dirtyCount >= this.flushBatchSize) {
      void this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.flushDebounceMs);
    }
  }

  private evictOverflow() {
    while (this.items.size > this.maxItems) {
      const oldestKey = this.items.keys().next().value;
      if (!oldestKey) break;
      this.items.delete(oldestKey);
    }
  }

  private async writeFileAtomic() {
    await mkdir(this.dir, { recursive: true });
    const payload: PersistentCacheFile = {
      version: 1,
      items: Array.from(this.items.values())
    };
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    await rename(tmpPath, this.filePath);
  }
}

export function createPersistentGeocodeCache(options: PersistentCacheOptions = {}): PersistentGeocodeCache {
  return new PersistentGeocodeCache(options);
}

export function registerGeocodeCacheShutdown(cache: Pick<PersistentGeocodeCache, 'close'>) {
  const shutdown = async () => {
    await cache.close();
    process.exit(0);
  };
  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}
