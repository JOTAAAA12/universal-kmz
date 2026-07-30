import * as fs from 'node:fs/promises';
import path from 'node:path';

const KEEP_SECRET = '__KEEP__';

export interface RuntimeConfig {
  googleServerKey: string;
  /** Chave pública do Maps JavaScript API. Não é segredo: precisa chegar ao browser. */
  googleMapsBrowserKey: string;
  /** Map ID opcional de estilo do Google Maps. Não é segredo. */
  googleMapsMapId: string;
  locationiqKey: string;
  geoapifyKey: string;
  nominatimEmail: string;
  geocoderChain: string;
  viacepValidation: boolean;
  geocodeCrosscheck: boolean;
  stepMeters: number;
}

type RuntimeConfigPatch = Partial<Record<keyof RuntimeConfig, unknown>>;
type PersistedRuntimeConfig = Partial<Record<keyof RuntimeConfig, string | boolean | number | null>>;

const SECRET_FIELDS = new Set<keyof RuntimeConfig>([
  'googleServerKey',
  'locationiqKey',
  'geoapifyKey'
]);

const STRING_FIELDS = new Set<keyof RuntimeConfig>([
  'googleServerKey',
  'googleMapsBrowserKey',
  'googleMapsMapId',
  'locationiqKey',
  'geoapifyKey',
  'nominatimEmail',
  'geocoderChain'
]);

let currentConfig: RuntimeConfig | null = null;
let currentPath = '';
let persistedConfig: PersistedRuntimeConfig = {};

function boolFromEnv(value: string | undefined, fallback = false): boolean {
  const normalized = (value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function configFromEnv(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  return {
    googleServerKey: (env.GOOGLE_MAPS_SERVER_KEY || '').trim(),
    googleMapsBrowserKey: (env.GOOGLE_MAPS_BROWSER_KEY || '').trim(),
    googleMapsMapId: (env.GOOGLE_MAPS_MAP_ID || '').trim(),
    locationiqKey: (env.LOCATIONIQ_API_KEY || '').trim(),
    geoapifyKey: (env.GEOAPIFY_API_KEY || '').trim(),
    nominatimEmail: (env.NOMINATIM_EMAIL || '').trim(),
    geocoderChain: (env.GEOCODER_CHAIN || 'google,nominatim,photon,bigdatacloud').trim(),
    viacepValidation: boolFromEnv(env.VIACEP_VALIDATION),
    geocodeCrosscheck: boolFromEnv(env.GEOCODE_CROSSCHECK),
    stepMeters: numberFromEnv(env.GEOCODE_STEP_METERS, 100)
  };
}

function configDirFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return path.resolve((env.GEOCODE_CACHE_DIR || './dados').trim() || './dados');
}

function configPathFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(configDirFromEnv(env), 'config.json');
}

function normalizePersistedConfig(input: unknown): PersistedRuntimeConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {};
  }
  const record = input as Record<string, unknown>;
  const normalized: PersistedRuntimeConfig = {};
  for (const field of STRING_FIELDS) {
    const value = record[field];
    if (value === null) {
      normalized[field] = null;
    } else if (typeof value === 'string' && value.trim() !== '') {
      normalized[field] = value.trim();
    }
  }
  if (typeof record.viacepValidation === 'boolean') {
    normalized.viacepValidation = record.viacepValidation;
  }
  if (typeof record.geocodeCrosscheck === 'boolean') {
    normalized.geocodeCrosscheck = record.geocodeCrosscheck;
  }
  if (typeof record.stepMeters === 'number' && Number.isFinite(record.stepMeters) && record.stepMeters > 0) {
    normalized.stepMeters = record.stepMeters;
  }
  return normalized;
}

function stringFromPersisted(record: PersistedRuntimeConfig, field: keyof RuntimeConfig, defaults: RuntimeConfig): string {
  const value = record[field];
  if (value === null) return '';
  return typeof value === 'string' ? value : defaults[field] as string;
}

function normalizeLoadedConfig(input: unknown, defaults: RuntimeConfig): RuntimeConfig {
  const record = normalizePersistedConfig(input);
  return {
    googleServerKey: stringFromPersisted(record, 'googleServerKey', defaults),
    googleMapsBrowserKey: stringFromPersisted(record, 'googleMapsBrowserKey', defaults),
    googleMapsMapId: stringFromPersisted(record, 'googleMapsMapId', defaults),
    locationiqKey: stringFromPersisted(record, 'locationiqKey', defaults),
    geoapifyKey: stringFromPersisted(record, 'geoapifyKey', defaults),
    nominatimEmail: stringFromPersisted(record, 'nominatimEmail', defaults),
    geocoderChain: stringFromPersisted(record, 'geocoderChain', defaults),
    viacepValidation: typeof record.viacepValidation === 'boolean' ? record.viacepValidation : defaults.viacepValidation,
    geocodeCrosscheck: typeof record.geocodeCrosscheck === 'boolean' ? record.geocodeCrosscheck : defaults.geocodeCrosscheck,
    stepMeters: typeof record.stepMeters === 'number' && Number.isFinite(record.stepMeters) && record.stepMeters > 0
      ? record.stepMeters
      : defaults.stepMeters
  };
}

function maskSecret(value: string): string {
  if (!value) return '';
  if (value.length <= 7) return `${value.slice(0, 1)}...${value.slice(-1)}`;
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
}

function validateStringField(field: keyof RuntimeConfig, value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`${field} deve ser string.`);
  }
  return value.trim();
}

function validateBooleanField(field: keyof RuntimeConfig, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${field} deve ser boolean.`);
  }
  return value;
}

function validateNumberField(field: keyof RuntimeConfig, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} deve ser numero positivo.`);
  }
  return value;
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): Promise<RuntimeConfig> {
  const defaults = configFromEnv(env);
  currentPath = configPathFromEnv(env);
  try {
    const raw = await fs.readFile(currentPath, 'utf8');
    const parsed = JSON.parse(raw);
    persistedConfig = normalizePersistedConfig(parsed);
    currentConfig = normalizeLoadedConfig(parsed, defaults);
  } catch (error: any) {
    if (error?.code !== 'ENOENT') {
      throw new Error(`Falha ao ler config runtime: ${error.message}`);
    }
    persistedConfig = {};
    currentConfig = defaults;
  }
  return currentConfig;
}

export function getRuntimeConfig(): RuntimeConfig {
  if (!currentConfig) {
    currentConfig = configFromEnv();
    currentPath = configPathFromEnv();
  }
  return currentConfig;
}

export function getMaskedRuntimeConfig(): RuntimeConfig {
  const config = getRuntimeConfig();
  return {
    ...config,
    googleServerKey: maskSecret(config.googleServerKey),
    locationiqKey: maskSecret(config.locationiqKey),
    geoapifyKey: maskSecret(config.geoapifyKey)
  };
}

export async function updateRuntimeConfig(patch: RuntimeConfigPatch): Promise<RuntimeConfig> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new Error('Body deve ser objeto JSON.');
  }
  const allowed = new Set<keyof RuntimeConfig>([
    'googleServerKey',
    'googleMapsBrowserKey',
    'googleMapsMapId',
    'locationiqKey',
    'geoapifyKey',
    'nominatimEmail',
    'geocoderChain',
    'viacepValidation',
    'geocodeCrosscheck',
    'stepMeters'
  ]);
  const next = { ...getRuntimeConfig() };
  const nextPersisted: PersistedRuntimeConfig = { ...persistedConfig };
  for (const [rawField, value] of Object.entries(patch)) {
    const field = rawField as keyof RuntimeConfig;
    if (!allowed.has(field)) {
      throw new Error(`Campo desconhecido: ${rawField}.`);
    }
    if (SECRET_FIELDS.has(field) && value === KEEP_SECRET) {
      continue;
    }
    if (field === 'viacepValidation' || field === 'geocodeCrosscheck') {
      const normalizedValue = validateBooleanField(field, value);
      next[field] = normalizedValue as never;
      nextPersisted[field] = normalizedValue;
    } else if (field === 'stepMeters') {
      const normalizedValue = validateNumberField(field, value);
      next[field] = normalizedValue as never;
      nextPersisted[field] = normalizedValue;
    } else {
      const normalizedValue = validateStringField(field, value);
      next[field] = normalizedValue as never;
      nextPersisted[field] = normalizedValue === '' ? null : normalizedValue;
    }
  }
  currentConfig = next;
  persistedConfig = nextPersisted;
  await atomicWriteJson(currentPath || configPathFromEnv(), persistedConfig);
  return currentConfig;
}

export function getRuntimeGeocoderEnv(): NodeJS.ProcessEnv {
  const config = getRuntimeConfig();
  return {
    ...process.env,
    GOOGLE_MAPS_SERVER_KEY: config.googleServerKey,
    LOCATIONIQ_API_KEY: config.locationiqKey,
    GEOAPIFY_API_KEY: config.geoapifyKey,
    NOMINATIM_EMAIL: config.nominatimEmail,
    GEOCODER_CHAIN: config.geocoderChain,
    VIACEP_VALIDATION: String(config.viacepValidation),
    GEOCODE_CROSSCHECK: String(config.geocodeCrosscheck),
    GEOCODE_STEP_METERS: String(config.stepMeters)
  };
}
