import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createPersistentGeocodeCache } from '../src/geocodeCache';
import { GeocodeJobManager, geocodeCoordinateBatch } from '../src/geocodeJobs';
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

  const reloaded = createPersistentGeocodeCache({ dir: tempDir, maxItems: 2 });
  await reloaded.load();
  const hit = await reloaded.get(-23.550521, -46.633309, 'pt-BR', 'BR');
  assert.equal(hit?.cache_hit, true);
  assert.equal(hit?.endereco_formatado, 'Rua Persistida, 10');
  assert.equal(await reloaded.get(-23.551, -46.634, 'pt-BR', 'BR'), null);
  assert.equal(await reloaded.get(-23.552, -46.635, 'pt-BR', 'BR'), null);

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

  console.log('cache and jobs regression passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
