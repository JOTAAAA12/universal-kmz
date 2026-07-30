import { mkdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

import { getDistanceMeters } from './kmlParser';
import { buildGeocodeRecord } from './providers/types';
import { Coordinate, EnderecoConsulta } from './types';

export type GeocodeJobStatus = 'running' | 'paused' | 'done' | 'error';
export type GeocodeOperation = (coord: Coordinate) => Promise<EnderecoConsulta>;

export interface GeocodeJobSnapshot {
  id: string;
  total: number;
  feitos: number;
  falhas: number;
  status: GeocodeJobStatus;
  resultados: EnderecoConsulta[];
  results: EnderecoConsulta[];
  errors: Array<{
    consulta_id: string;
    status_api: string;
    provider_status?: string;
    provider_error_message?: string;
    retryable?: boolean;
  }>;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedGeocodeJobProgress {
  id: string;
  total: number;
  feitos: number;
  falhas: number;
  status: GeocodeJobStatus;
  errors: GeocodeJobSnapshot['errors'];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GeocodeJobStore {
  load(): Promise<void>;
  list(): PersistedGeocodeJobProgress[];
  save(progress: PersistedGeocodeJobProgress): void;
  delete(id: string): void;
  close(): void | Promise<void>;
}

export interface PersistentGeocodeJobStoreOptions {
  dir?: string;
  fileName?: string;
}

export interface GeocodeJobManagerOptions {
  store?: GeocodeJobStore;
  completedJobTtlMs?: number;
  maxCompletedJobs?: number;
  now?: () => number;
}

export interface CoordinateGroup {
  representative: Coordinate;
  members: Array<{ coord: Coordinate; index: number }>;
}

interface GeocodeJobState {
  id: string;
  groups: CoordinateGroup[];
  total: number;
  doneCount: number;
  failCount: number;
  nextGroupIndex: number;
  status: GeocodeJobStatus;
  resultados: EnderecoConsulta[];
  errors: GeocodeJobSnapshot['errors'];
  error?: string;
  createdAt: string;
  updatedAt: string;
  geocode: GeocodeOperation;
  workerActive: boolean;
  cancelled: boolean;
}

interface PersistedJobRow {
  payload: string;
}

const DEFAULT_DEDUP_METERS = 10;
const DEFAULT_JOB_DIR = './dados';
const JOB_STORE_FILE_NAME = 'geocode-jobs.sqlite';
const DEFAULT_COMPLETED_JOB_TTL_MS = 60 * 60 * 1000;
const DEFAULT_MAX_COMPLETED_JOBS = 20;
const MAX_PERSISTED_ERRORS = 100;

function createJobId(): string {
  return `geo-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function resolveJobDir(dir?: string): string {
  return path.resolve(process.cwd(), dir || process.env.GEOCODE_CACHE_DIR || DEFAULT_JOB_DIR);
}

function isFailure(item: EnderecoConsulta): boolean {
  return !['SUCESSO', 'ZERO_RESULTS', 'ZERO_RESULTADOS'].includes(item.status_api);
}

function isGeocodeJobStatus(status: unknown): status is GeocodeJobStatus {
  return status === 'running' || status === 'paused' || status === 'done' || status === 'error';
}

function isPersistedProgress(value: unknown): value is PersistedGeocodeJobProgress {
  const candidate = value as PersistedGeocodeJobProgress;
  return Boolean(
    candidate &&
    typeof candidate.id === 'string' &&
    Number.isFinite(candidate.total) &&
    Number.isFinite(candidate.feitos) &&
    Number.isFinite(candidate.falhas) &&
    isGeocodeJobStatus(candidate.status) &&
    Array.isArray(candidate.errors) &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.updatedAt === 'string'
  );
}

function consultaIdForCoordinate(coord: Coordinate): string {
  return `GEO-${coord.lat.toFixed(5)}-${coord.lng.toFixed(5)}`;
}

export function groupCoordinatesWithinMeters(
  coordinates: Coordinate[],
  maxDistanceMeters = DEFAULT_DEDUP_METERS
): CoordinateGroup[] {
  const groups: CoordinateGroup[] = [];

  coordinates.forEach((coord, index) => {
    const existing = groups.find(group => (
      getDistanceMeters(coord, group.representative) < maxDistanceMeters
    ));

    if (existing) {
      existing.members.push({ coord, index });
    } else {
      groups.push({
        representative: coord,
        members: [{ coord, index }]
      });
    }
  });

  return groups;
}

export function replicateGeocodeResult(
  source: EnderecoConsulta,
  coord: Coordinate,
  forceCacheHit: boolean
): EnderecoConsulta {
  return {
    ...source,
    consulta_id: consultaIdForCoordinate(coord),
    latitude: coord.lat,
    longitude: coord.lng,
    coordenada_normalizada: `${coord.lat.toFixed(5)},${coord.lng.toFixed(5)}`,
    cache_hit: forceCacheHit ? true : source.cache_hit
  };
}

export async function geocodeCoordinateBatch(
  coordinates: Coordinate[],
  geocode: GeocodeOperation,
  dedupMeters = DEFAULT_DEDUP_METERS
): Promise<EnderecoConsulta[]> {
  const groups = groupCoordinatesWithinMeters(coordinates, dedupMeters);
  const output: EnderecoConsulta[] = new Array(coordinates.length);

  for (const group of groups) {
    const primary = await geocode(group.representative);
    group.members.forEach((member, memberIndex) => {
      output[member.index] = replicateGeocodeResult(primary, member.coord, memberIndex > 0);
    });
  }

  return output;
}

export class PersistentGeocodeJobStore implements GeocodeJobStore {
  private readonly dir: string;
  private readonly databasePath: string;
  private database: DatabaseSync | null = null;
  private loaded = false;

  constructor(options: PersistentGeocodeJobStoreOptions = {}) {
    this.dir = resolveJobDir(options.dir);
    this.databasePath = path.join(this.dir, options.fileName || JOB_STORE_FILE_NAME);
  }

  async load(): Promise<void> {
    if (this.loaded) return;

    await mkdir(this.dir, { recursive: true });
    const database = new DatabaseSync(this.databasePath);
    database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS geocode_job_progress (
        job_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS geocode_job_progress_updated_at_idx ON geocode_job_progress (updated_at);
    `);
    this.database = database;
    this.loaded = true;
  }

  list(): PersistedGeocodeJobProgress[] {
    if (!this.loaded || !this.database) return [];

    const rows = this.database.prepare('SELECT payload FROM geocode_job_progress').all() as unknown as PersistedJobRow[];
    return rows.flatMap(row => {
      try {
        const progress = JSON.parse(row.payload) as PersistedGeocodeJobProgress;
        return isPersistedProgress(progress) ? [this.cloneProgress(progress)] : [];
      } catch {
        return [];
      }
    });
  }

  save(progress: PersistedGeocodeJobProgress): void {
    const database = this.requireDatabase();
    const safeProgress = this.cloneProgress(progress);
    database.prepare(`
      INSERT INTO geocode_job_progress (job_id, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(job_id) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run(safeProgress.id, JSON.stringify(safeProgress), safeProgress.updatedAt);
  }

  delete(id: string): void {
    if (!this.loaded || !this.database) return;
    this.database.prepare('DELETE FROM geocode_job_progress WHERE job_id = ?').run(id);
  }

  close(): void {
    if (!this.database) return;
    this.database.exec('PRAGMA wal_checkpoint(PASSIVE);');
    this.database.close();
    this.database = null;
    this.loaded = false;
  }

  private requireDatabase(): DatabaseSync {
    if (!this.database || !this.loaded) {
      throw new Error('Armazenamento de progresso de jobs não foi inicializado.');
    }
    return this.database;
  }

  private cloneProgress(progress: PersistedGeocodeJobProgress): PersistedGeocodeJobProgress {
    return {
      ...progress,
      errors: progress.errors.slice(-MAX_PERSISTED_ERRORS).map(error => ({ ...error }))
    };
  }
}

export function createPersistentGeocodeJobStore(
  options: PersistentGeocodeJobStoreOptions = {}
): PersistentGeocodeJobStore {
  return new PersistentGeocodeJobStore(options);
}

export class GeocodeJobManager {
  private readonly jobs = new Map<string, GeocodeJobState>();
  private readonly store?: GeocodeJobStore;
  private readonly completedJobTtlMs: number;
  private readonly maxCompletedJobs: number;
  private readonly now: () => number;

  constructor(
    private readonly defaultGeocode?: GeocodeOperation,
    private readonly dedupMeters = DEFAULT_DEDUP_METERS,
    options: GeocodeJobManagerOptions = {}
  ) {
    this.store = options.store;
    this.completedJobTtlMs = parsePositiveInt(options.completedJobTtlMs, DEFAULT_COMPLETED_JOB_TTL_MS);
    this.maxCompletedJobs = parsePositiveInt(options.maxCompletedJobs, DEFAULT_MAX_COMPLETED_JOBS);
    this.now = options.now || Date.now;
  }

  createJob(coordinates: Coordinate[], geocode = this.defaultGeocode): GeocodeJobSnapshot {
    if (!geocode) {
      throw new Error('Geocode operation is required to create a job.');
    }

    this.evictCompletedJobs();
    const now = new Date(this.now()).toISOString();
    const id = createJobId();
    const job: GeocodeJobState = {
      id,
      groups: groupCoordinatesWithinMeters(coordinates, this.dedupMeters),
      total: coordinates.length,
      doneCount: 0,
      failCount: 0,
      nextGroupIndex: 0,
      status: 'running',
      resultados: [],
      errors: [],
      createdAt: now,
      updatedAt: now,
      geocode,
      workerActive: false,
      cancelled: false
    };

    this.jobs.set(id, job);
    this.persist(job);
    void this.processJob(job);
    return this.snapshot(job);
  }

  getJob(id: string): GeocodeJobSnapshot | null {
    this.evictCompletedJobs();
    const job = this.jobs.get(id);
    return job ? this.snapshot(job) : null;
  }

  pauseJob(id: string): GeocodeJobSnapshot | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'running') {
      job.status = 'paused';
      this.touch(job);
    }
    return this.snapshot(job);
  }

  resumeJob(id: string): GeocodeJobSnapshot | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.status === 'paused') {
      job.status = 'running';
      this.touch(job);
      void this.processJob(job);
    }
    return this.snapshot(job);
  }

  discardJob(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;

    job.cancelled = true;
    this.jobs.delete(id);
    this.store?.delete(id);
    return true;
  }

  restoreInterruptedJobs(): number {
    if (!this.store) return 0;

    let interrupted = 0;
    for (const progress of this.store.list()) {
      const wasInterrupted = progress.status === 'running' || progress.status === 'paused';
      const job = this.restoreJob(progress, wasInterrupted);
      this.jobs.set(job.id, job);
      if (wasInterrupted) {
        interrupted++;
        this.persist(job);
      }
    }
    this.evictCompletedJobs();
    return interrupted;
  }

  private restoreJob(progress: PersistedGeocodeJobProgress, wasInterrupted: boolean): GeocodeJobState {
    const updatedAt = new Date(this.now()).toISOString();
    return {
      id: progress.id,
      groups: [],
      total: progress.total,
      doneCount: progress.feitos,
      failCount: progress.falhas,
      nextGroupIndex: 0,
      status: wasInterrupted ? 'error' : progress.status,
      resultados: [],
      errors: progress.errors.map(error => ({ ...error })),
      error: wasInterrupted
        ? 'Job interrompido por reinicialização do servidor.'
        : progress.error,
      createdAt: progress.createdAt,
      updatedAt: wasInterrupted ? updatedAt : progress.updatedAt,
      geocode: async () => {
        throw new Error('Job restaurado não pode ser retomado após reinicialização.');
      },
      workerActive: false,
      cancelled: false
    };
  }

  private async processJob(job: GeocodeJobState): Promise<void> {
    if (job.workerActive || job.cancelled) return;
    job.workerActive = true;

    try {
      while (!job.cancelled && job.status === 'running' && job.nextGroupIndex < job.groups.length) {
        const group = job.groups[job.nextGroupIndex];
        const primary = await job.geocode(group.representative);
        // Uma pausa durante a chamada em voo não descarta o resultado já obtido;
        // apenas o cancelamento (job removido) descarta. O `while` encerra o laço
        // na próxima checagem quando o status deixa de ser 'running'.
        if (job.cancelled) break;

        const replicated = group.members.map((member, memberIndex) => (
          replicateGeocodeResult(primary, member.coord, memberIndex > 0)
        ));

        job.resultados.push(...replicated);
        job.doneCount += replicated.length;
        replicated.filter(isFailure).forEach(item => {
          job.failCount++;
          job.errors.push({
            consulta_id: item.consulta_id,
            status_api: item.status_api,
            provider_status: item.provider_status,
            provider_error_message: item.provider_error_message,
            retryable: item.retryable
          });
        });
        job.nextGroupIndex++;
        this.touch(job);
      }

      if (!job.cancelled && job.status === 'running' && job.nextGroupIndex >= job.groups.length) {
        job.status = 'done';
        this.touch(job);
      }
    } catch (error: unknown) {
      if (!job.cancelled) {
        job.status = 'error';
        job.error = error instanceof Error ? error.message : 'Falha inesperada no job de geocodificação.';
        this.touch(job);
      }
    } finally {
      job.workerActive = false;
      this.evictCompletedJobs();
    }
  }

  private touch(job: GeocodeJobState) {
    job.updatedAt = new Date(this.now()).toISOString();
    this.persist(job);
  }

  private persist(job: GeocodeJobState) {
    this.store?.save({
      id: job.id,
      total: job.total,
      feitos: job.doneCount,
      falhas: job.failCount,
      status: job.status,
      errors: job.errors.map(error => ({ ...error })),
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    });
  }

  private evictCompletedJobs() {
    const completed = Array.from(this.jobs.values())
      .filter(job => !job.workerActive && (job.status === 'done' || job.status === 'error'))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const expiry = this.now() - this.completedJobTtlMs;

    completed.forEach((job, index) => {
      if (Date.parse(job.updatedAt) <= expiry || index >= this.maxCompletedJobs) {
        this.jobs.delete(job.id);
        this.store?.delete(job.id);
      }
    });
  }

  private snapshot(job: GeocodeJobState): GeocodeJobSnapshot {
    const resultados = job.resultados.map(result => ({ ...result }));
    return {
      id: job.id,
      total: job.total,
      feitos: job.doneCount,
      falhas: job.failCount,
      status: job.status,
      resultados,
      results: resultados.map(result => ({ ...result })),
      errors: job.errors.map(error => ({ ...error })),
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt
    };
  }
}

export function buildGeocodeFailure(coord: Coordinate, message: string): EnderecoConsulta {
  return buildGeocodeRecord(coord.lat, coord.lng, {
    status_api: 'FALHA',
    provider_status: 'JOB_ERROR',
    provider_error_message: message,
    endereco_formatado: message,
    fonte: 'geocode-job',
    retryable: false
  });
}
