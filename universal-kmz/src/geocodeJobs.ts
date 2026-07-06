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
}

const DEFAULT_DEDUP_METERS = 10;

function createJobId(): string {
  return `geo-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isFailure(item: EnderecoConsulta): boolean {
  return !['SUCESSO', 'ZERO_RESULTS', 'ZERO_RESULTADOS'].includes(item.status_api);
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

export class GeocodeJobManager {
  private readonly jobs = new Map<string, GeocodeJobState>();

  constructor(
    private readonly defaultGeocode?: GeocodeOperation,
    private readonly dedupMeters = DEFAULT_DEDUP_METERS
  ) {}

  createJob(coordinates: Coordinate[], geocode = this.defaultGeocode): GeocodeJobSnapshot {
    if (!geocode) {
      throw new Error('Geocode operation is required to create a job.');
    }

    const now = new Date().toISOString();
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
      workerActive: false
    };

    this.jobs.set(id, job);
    void this.processJob(job);
    return this.snapshot(job);
  }

  getJob(id: string): GeocodeJobSnapshot | null {
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

  private async processJob(job: GeocodeJobState): Promise<void> {
    if (job.workerActive) return;
    job.workerActive = true;

    try {
      while (job.status === 'running' && job.nextGroupIndex < job.groups.length) {
        const group = job.groups[job.nextGroupIndex];
        const primary = await job.geocode(group.representative);
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

      if (job.status === 'running' && job.nextGroupIndex >= job.groups.length) {
        job.status = 'done';
        this.touch(job);
      }
    } catch (error: any) {
      job.status = 'error';
      job.error = error?.message || 'Falha inesperada no job de geocodificação.';
      this.touch(job);
    } finally {
      job.workerActive = false;
    }
  }

  private touch(job: GeocodeJobState) {
    job.updatedAt = new Date().toISOString();
  }

  private snapshot(job: GeocodeJobState): GeocodeJobSnapshot {
    const results = [...job.resultados];
    return {
      id: job.id,
      total: job.total,
      feitos: job.doneCount,
      falhas: job.failCount,
      status: job.status,
      resultados: results,
      results,
      errors: [...job.errors],
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
