import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import {
  getMaskedRuntimeConfig,
  getRuntimeConfig,
  getRuntimeGeocoderEnv,
  loadRuntimeConfig,
  updateRuntimeConfig
} from '../src/runtimeConfig';
import { hasEnabledGeocoderProvider } from '../src/geocoder';
import { createSession, deleteSession, getSession, listSessions } from '../src/sessionStore';

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'universal-kmz-config-'));
const configPath = path.join(tempDir, 'config.json');

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('Não foi possível reservar porta para o servidor de teste.'));
        return;
      }
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Servidor de teste respondeu ${response.status} para ${url}.`);
  }
  return response.json() as Promise<T>;
}

async function waitForApi(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // O servidor ainda está iniciando.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Servidor de teste não respondeu a tempo.');
}

async function assertCnefeApiContract(tempRoot: string): Promise<void> {
  const port = await getFreePort();
  const cnefeDir = path.join(tempRoot, 'cnefe-api');
  await mkdir(cnefeDir, { recursive: true });

  const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      CNEFE_DIR: cnefeDir,
      GEOCODE_CACHE_DIR: path.join(tempRoot, 'geocode-api')
    },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${port}`;

  try {
    await waitForApi(`${base}/api/cnefe/estados`);
    const estadosResponse = await getJson<{ estados: Array<Record<string, unknown>> }>(`${base}/api/cnefe/estados`);
    const estados = estadosResponse.estados;
    assert.ok(Array.isArray(estados));
    assert.ok(estados.length > 0, 'listagem de estados CNEFE deve conter UFs');
    assert.ok('atualizacao_disponivel' in estados[0], 'listagem deve trazer selo de atualizacao');
    assert.ok('versao_local' in estados[0], 'listagem deve trazer versao local');

    const atualizacoes = await getJson(`${base}/api/cnefe/atualizacoes`);
    assert.equal(typeof atualizacoes, 'object');
  } finally {
    const exited = new Promise<void>(resolve => {
      if (server.exitCode !== null) resolve();
      else server.once('exit', () => resolve());
    });
    server.kill();
    await exited;
  }
}

try {
  const env = {
    ...process.env,
    GEOCODE_CACHE_DIR: tempDir,
    GOOGLE_MAPS_SERVER_KEY: 'env-google-secret',
    LOCATIONIQ_API_KEY: '',
    GEOAPIFY_API_KEY: '',
    NOMINATIM_EMAIL: 'env@example.test',
    GEOCODER_CHAIN: 'google,nominatim',
    VIACEP_VALIDATION: 'true',
    GEOCODE_CROSSCHECK: 'false',
    GEOCODE_STEP_METERS: '75'
  };

  const initial = await loadRuntimeConfig(env);
  assert.equal(initial.googleServerKey, 'env-google-secret');
  assert.equal(initial.nominatimEmail, 'env@example.test');
  assert.equal(initial.viacepValidation, true);
  assert.equal(initial.stepMeters, 75);

  const maskedInitial = getMaskedRuntimeConfig();
  assert.equal(maskedInitial.googleServerKey, 'env-...ret');
  assert.equal(maskedInitial.locationiqKey, '');
  assert.equal(await fileExists(configPath), false);

  await updateRuntimeConfig({
    googleServerKey: '',
    locationiqKey: 'locationiq-runtime-secret',
    geoapifyKey: '',
    nominatimEmail: 'runtime@example.test',
    geocoderChain: 'locationiq',
    viacepValidation: false,
    geocodeCrosscheck: true,
    stepMeters: 25
  });

  assert.equal(getRuntimeConfig().googleServerKey, '');
  assert.equal(getRuntimeConfig().locationiqKey, 'locationiq-runtime-secret');
  assert.equal(getMaskedRuntimeConfig().locationiqKey, 'loca...ret');
  assert.equal(getRuntimeGeocoderEnv().LOCATIONIQ_API_KEY, 'locationiq-runtime-secret');
  assert.equal(hasEnabledGeocoderProvider('', false, getRuntimeGeocoderEnv()), true);
  assert.equal(getRuntimeGeocoderEnv().GEOCODER_CHAIN, 'locationiq');
  const persistedConfig = JSON.parse(await readFile(configPath, 'utf8'));
  assert.equal(persistedConfig.googleServerKey, null);
  assert.equal(persistedConfig.geoapifyKey, null);

  await updateRuntimeConfig({
    googleServerKey: '__KEEP__',
    locationiqKey: '__KEEP__'
  });
  assert.equal(getRuntimeConfig().googleServerKey, '');
  assert.equal(getRuntimeConfig().locationiqKey, 'locationiq-runtime-secret');

  await loadRuntimeConfig({
    ...env,
    GOOGLE_MAPS_SERVER_KEY: 'changed-env-google',
    LOCATIONIQ_API_KEY: 'changed-env-locationiq'
  });
  assert.equal(getRuntimeConfig().googleServerKey, '');
  assert.equal(getRuntimeConfig().locationiqKey, 'locationiq-runtime-secret');

  await assert.rejects(
    updateRuntimeConfig({ stepMeters: '25' as unknown as number }),
    /stepMeters deve ser numero positivo/
  );

  const created = await createSession({
    nome: 'Minha Sessao KMZ',
    payload: { parser: { ok: true }, enderecos: [{ id: 1 }] }
  }, env);
  assert.match(created.id, /^minha-sessao-kmz-[0-9]+$/);
  assert.equal(created.nome, 'Minha Sessao KMZ');
  assert.equal((await listSessions(env)).length, 1);

  const loaded = await getSession(created.id, env);
  assert.deepEqual(loaded?.payload, { parser: { ok: true }, enderecos: [{ id: 1 }] });
  await assert.rejects(getSession('../config', env), /ID de sessao invalido/);
  assert.equal(await deleteSession(created.id, env), true);
  assert.equal(await deleteSession(created.id, env), false);
  assert.deepEqual(await listSessions(env), []);

  await assertCnefeApiContract(tempDir);

  console.log('config and sessions regression passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
