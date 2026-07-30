import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentGeocodeCache } from '../src/geocodeCache';
import {
  createPersistentGeocodeJobStore,
  GeocodeJobManager,
  geocodeCoordinateBatch
} from '../src/geocodeJobs';
import { buildGeocodeRecord } from '../src/providers/types';
import { Coordinate } from '../src/types';

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitUntil(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(10);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'universal-kmz-cache-'));

try {
  const cache = createPersistentGeocodeCache({
    dir: tempDir,
    maxItems: 2,
    flushDebounceMs: 50,
    flushBatchSize: 2
  });
  await cache.load();

  await cache.set(buildGeocodeRecord(-23.550521, -46.633309, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    endereco_formatado: 'Rua Persistida, 10',
    fonte: 'fake-provider',
    quantidade_resultados: 1,
    necessita_revisao: false
  }), 'pt-BR', 'BR');
  await cache.set(buildGeocodeRecord(-23.551, -46.634, {
    status_api: 'FALHA',
    fonte: 'fake-provider'
  }), 'pt-BR', 'BR');
  await cache.set(buildGeocodeRecord(-23.552, -46.635, {
    status_api: 'SUCESSO',
    fonte: 'mock'
  }), 'pt-BR', 'BR');
  await cache.flush();
  await cache.close();

  const reloaded = createPersistentGeocodeCache({ dir: tempDir, maxItems: 2 });
  await reloaded.load();
  const hit = await reloaded.get(-23.550521, -46.633309, 'pt-BR', 'BR');
  assert.equal(hit?.cache_hit, true);
  assert.equal(hit?.endereco_formatado, 'Rua Persistida, 10');
  assert.equal(await reloaded.get(-23.551, -46.634, 'pt-BR', 'BR'), null);
  assert.equal(await reloaded.get(-23.552, -46.635, 'pt-BR', 'BR'), null);
  await reloaded.close();

  const migrationDir = path.join(tempDir, 'migration');
  const migratedValue = buildGeocodeRecord(-23.56, -46.64, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    endereco_formatado: 'Rua Migrada, 20',
    fonte: 'legacy-cache',
    quantidade_resultados: 1,
    necessita_revisao: false
  });
  await mkdir(migrationDir, { recursive: true });
  await writeFile(path.join(migrationDir, 'geocode-cache.json'), JSON.stringify({
    version: 1,
    items: [{
      key: '-23.56000,-46.64000,pt-BR,BR',
      language: 'pt-BR',
      region: 'BR',
      value: migratedValue,
      createdAt: new Date().toISOString()
    }]
  }), 'utf8');
  const migratedCache = createPersistentGeocodeCache({ dir: migrationDir });
  await migratedCache.load();
  assert.equal((await migratedCache.get(-23.56, -46.64, 'pt-BR', 'BR'))?.endereco_formatado, 'Rua Migrada, 20');
  await stat(path.join(migrationDir, 'geocode-cache.sqlite'));
  await migratedCache.close();

  let cacheNow = Date.UTC(2026, 0, 1);
  const ttlCache = createPersistentGeocodeCache({
    dir: path.join(tempDir, 'ttl'),
    successTtlMs: 10,
    zeroResultTtlMs: 5,
    now: () => cacheNow
  });
  await ttlCache.load();
  await ttlCache.set(buildGeocodeRecord(-23.57, -46.65, {
    status_api: 'SUCESSO',
    fonte: 'ttl-provider'
  }), 'pt-BR', 'BR');
  await ttlCache.set(buildGeocodeRecord(-23.58, -46.66, {
    status_api: 'ZERO_RESULTS',
    fonte: 'ttl-provider'
  }), 'pt-BR', 'BR');
  cacheNow += 6;
  assert.ok(await ttlCache.get(-23.57, -46.65, 'pt-BR', 'BR'));
  assert.equal(await ttlCache.get(-23.58, -46.66, 'pt-BR', 'BR'), null);
  cacheNow += 5;
  assert.equal(await ttlCache.get(-23.57, -46.65, 'pt-BR', 'BR'), null);
  await ttlCache.close();

  const evictionCache = createPersistentGeocodeCache({ dir: path.join(tempDir, 'eviction'), maxItems: 2 });
  await evictionCache.load();
  for (const [lat, lng] of [[-23.59, -46.67], [-23.6, -46.68], [-23.61, -46.69]]) {
    await evictionCache.set(buildGeocodeRecord(lat, lng, {
      status_api: 'SUCESSO',
      fonte: 'eviction-provider'
    }), 'pt-BR', 'BR');
  }
  assert.equal(await evictionCache.get(-23.59, -46.67, 'pt-BR', 'BR'), null);
  assert.ok(await evictionCache.get(-23.6, -46.68, 'pt-BR', 'BR'));
  assert.ok(await evictionCache.get(-23.61, -46.69, 'pt-BR', 'BR'));
  await evictionCache.close();

  const coords: Coordinate[] = [
    { lat: 0, lng: 0 },
    { lat: 0, lng: 0.00005 },
    { lat: 0, lng: 0.001 }
  ];
  let geocodeCalls = 0;
  const batchResults = await geocodeCoordinateBatch(coords, async coord => {
    geocodeCalls++;
    return buildGeocodeRecord(coord.lat, coord.lng, {
      status_api: 'SUCESSO',
      provider_status: 'OK',
      endereco_formatado: `Endereco ${geocodeCalls}`,
      fonte: 'fake-provider',
      quantidade_resultados: 1,
      necessita_revisao: false
    });
  });

  assert.equal(geocodeCalls, 2);
  assert.equal(batchResults.length, 3);
  assert.equal(batchResults[1].cache_hit, true);
  assert.equal(batchResults[1].consulta_id, 'GEO-0.00000-0.00005');
  assert.equal(batchResults[2].cache_hit, false);

  const releases: Array<() => void> = [];
  const jobManager = new GeocodeJobManager(async coord => {
    await new Promise<void>(resolve => releases.push(resolve));
    return buildGeocodeRecord(coord.lat, coord.lng, {
      status_api: 'SUCESSO',
      provider_status: 'OK',
      endereco_formatado: `${coord.lat},${coord.lng}`,
      fonte: 'fake-provider',
      quantidade_resultados: 1,
      necessita_revisao: false
    });
  });

  const job = jobManager.createJob([
    { lat: 1, lng: 1 },
    { lat: 1.01, lng: 1.01 },
    { lat: 1.02, lng: 1.02 }
  ]);

  await waitUntil(() => releases.length === 1, 'first job request');
  jobManager.pauseJob(job.id);
  releases[0]();
  await waitUntil(() => {
    const snapshot = jobManager.getJob(job.id);
    return snapshot?.status === 'paused' && snapshot.feitos === 1;
  }, 'job pause with in-flight result recorded');
  assert.equal(jobManager.getJob(job.id)?.feitos, 1);

  jobManager.resumeJob(job.id);
  await waitUntil(() => releases.length === 2, 'second job request');
  releases[1]();
  await waitUntil(() => releases.length === 3, 'third job request');
  releases[2]();
  await waitUntil(() => jobManager.getJob(job.id)?.status === 'done', 'job completion');

  const completed = jobManager.getJob(job.id);
  assert.equal(completed?.feitos, 3);
  assert.equal(completed?.falhas, 0);
  assert.equal(completed?.resultados.length, 3);

  const cancellationReleases: Array<() => void> = [];
  const cancellableJobs = new GeocodeJobManager(async coord => {
    await new Promise<void>(resolve => cancellationReleases.push(resolve));
    return buildGeocodeRecord(coord.lat, coord.lng, {
      status_api: 'SUCESSO',
      fonte: 'cancel-provider'
    });
  });
  const cancellableJob = cancellableJobs.createJob([{ lat: 2, lng: 2 }, { lat: 2.01, lng: 2.01 }]);
  await waitUntil(() => cancellationReleases.length === 1, 'job request eligible for DELETE');
  assert.equal(cancellableJobs.discardJob(cancellableJob.id), true);
  cancellationReleases[0]();
  await wait(0);
  assert.equal(cancellableJobs.getJob(cancellableJob.id), null);

  const retainedJobs = new GeocodeJobManager(async coord => buildGeocodeRecord(coord.lat, coord.lng, {
    status_api: 'SUCESSO',
    fonte: 'eviction-provider'
  }), 10, { maxCompletedJobs: 1 });
  const firstRetained = retainedJobs.createJob([{ lat: 3, lng: 3 }]);
  await waitUntil(() => retainedJobs.getJob(firstRetained.id)?.status === 'done', 'first completed job');
  const secondRetained = retainedJobs.createJob([{ lat: 4, lng: 4 }]);
  await waitUntil(() => retainedJobs.getJob(secondRetained.id)?.status === 'done', 'second completed job');
  assert.equal(retainedJobs.getJob(firstRetained.id), null);
  assert.equal(retainedJobs.getJob(secondRetained.id)?.status, 'done');

  const progressStore = createPersistentGeocodeJobStore({ dir: path.join(tempDir, 'job-progress') });
  await progressStore.load();
  const persistedReleases: Array<() => void> = [];
  const jobsBeforeRestart = new GeocodeJobManager(async coord => {
    await new Promise<void>(resolve => persistedReleases.push(resolve));
    return buildGeocodeRecord(coord.lat, coord.lng, {
      status_api: 'SUCESSO',
      fonte: 'restart-provider'
    });
  }, 10, { store: progressStore });
  const runningBeforeRestart = jobsBeforeRestart.createJob([{ lat: 5, lng: 5 }]);
  await waitUntil(() => persistedReleases.length === 1, 'persisted running job');
  const jobsAfterRestart = new GeocodeJobManager(undefined, 10, { store: progressStore });
  assert.equal(jobsAfterRestart.restoreInterruptedJobs(), 1);
  assert.equal(jobsAfterRestart.getJob(runningBeforeRestart.id)?.status, 'error');
  assert.match(jobsAfterRestart.getJob(runningBeforeRestart.id)?.error || '', /reinicialização/);
  assert.equal(jobsAfterRestart.getJob(runningBeforeRestart.id)?.resultados.length, 0);
  assert.equal(jobsBeforeRestart.discardJob(runningBeforeRestart.id), true);
  persistedReleases[0]();
  await progressStore.close();

  console.log('cache and jobs regression passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
