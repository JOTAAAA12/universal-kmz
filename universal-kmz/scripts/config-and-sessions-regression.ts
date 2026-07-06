import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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

  console.log('config and sessions regression passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
