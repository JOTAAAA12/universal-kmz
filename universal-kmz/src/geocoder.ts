import { EnderecoConsulta } from './types';
import { getDistanceMeters } from './kmlParser';
import { bigDataCloudProvider } from './providers/bigdatacloud';
import { geoapifyProvider } from './providers/geoapify';
import { googleProvider } from './providers/google';
import { locationIqProvider } from './providers/locationiq';
import { generateMockAddress, mockProvider } from './providers/mock';
import { nominatimProvider } from './providers/nominatim';
import { photonProvider } from './providers/photon';
import {
  buildGeocodeRecord,
  GeocodeProvider,
  GeocodeProviderRequest,
  GeocoderProviderStatus,
  isPlaceholderGoogleKey,
  isRetryableProviderResult
} from './providers/types';

export { generateMockAddress, isPlaceholderGoogleKey };

type CachedEnderecoConsulta = EnderecoConsulta & { cache_language: string; cache_region: string };

interface GeocodeReverseOptions {
  allowMock?: boolean;
  providers?: GeocodeProvider[];
  env?: NodeJS.ProcessEnv;
  chain?: string[];
  skipCache?: boolean;
  timeoutMs?: number;
}

const addressCache: CachedEnderecoConsulta[] = [];
const MAX_ADDRESS_CACHE_ITEMS = 1000;
const REQUEST_TIMEOUT_MS = 10000;
const PROVIDER_COOLDOWN_MS = 60000;
const DEFAULT_CHAIN = ['google', 'nominatim', 'photon', 'bigdatacloud'];

const OPERATIONAL_FAILURE_STATUSES = new Set([
  'CONFIG_ERROR',
  'INVALID_COORDINATE',
  'REQUEST_DENIED',
  'OVER_DAILY_LIMIT',
  'OVER_QUERY_LIMIT',
  'INVALID_REQUEST',
  'UNKNOWN_ERROR',
  'FALHA'
]);

const BUILT_IN_PROVIDERS: Record<string, GeocodeProvider> = {
  google: googleProvider,
  nominatim: nominatimProvider,
  photon: photonProvider,
  locationiq: locationIqProvider,
  geoapify: geoapifyProvider,
  bigdatacloud: bigDataCloudProvider,
  mock: mockProvider
};

const providerUsage = new Map<string, number>();
const providerCooldownUntil = new Map<string, number>();

export function isOperationalGeocodeFailureStatus(status?: string): boolean {
  return OPERATIONAL_FAILURE_STATUSES.has(status || '');
}

export function findInCache(
  lat: number,
  lng: number,
  toleranceMeters: number = 5,
  language = 'pt-BR',
  region = 'BR'
): EnderecoConsulta | null {
  for (const item of addressCache) {
    if (item.cache_language !== language || item.cache_region !== region) {
      continue;
    }
    const dist = getDistanceMeters({ lat, lng }, { lat: item.latitude, lng: item.longitude });
    if (dist <= toleranceMeters) {
      const { cache_language, cache_region, ...publicItem } = item;
      return {
        ...publicItem,
        cache_hit: true
      };
    }
  }
  return null;
}

function pushCache(item: EnderecoConsulta, language: string, region: string) {
  addressCache.push({
    ...item,
    cache_language: language,
    cache_region: region
  });

  if (addressCache.length > MAX_ADDRESS_CACHE_ITEMS) {
    addressCache.splice(0, addressCache.length - MAX_ADDRESS_CACHE_ITEMS);
  }
}

function isMockResult(item: EnderecoConsulta): boolean {
  return item.fonte === 'mock' || item.fonte === 'Mock' || item.status_api === 'Mocked';
}

export function resolveGeocodeMode(results: EnderecoConsulta[], allowMock: boolean): 'google' | 'mock' {
  if (allowMock && results.length > 0 && results.every(isMockResult)) {
    return 'mock';
  }
  return 'google';
}

export function isMockGeocodeResult(item: EnderecoConsulta): boolean {
  return isMockResult(item);
}

function parseChainFromEnv(env: NodeJS.ProcessEnv): string[] | null {
  const raw = (env.GEOCODER_CHAIN || '').trim();
  if (!raw) {
    return null;
  }
  return raw
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
}

function resolveProviderNames(
  env: NodeJS.ProcessEnv,
  allowMock: boolean,
  apiKey: string,
  explicitChain?: string[]
): string[] {
  if (explicitChain && explicitChain.length > 0) {
    return explicitChain.map(item => item.trim().toLowerCase()).filter(Boolean);
  }

  const configuredChain = parseChainFromEnv(env);
  if (configuredChain) {
    return configuredChain;
  }

  const mode = (env.GEOCODER_MODE || '').trim().toLowerCase();
  if (mode === 'mock' || (allowMock && isPlaceholderGoogleKey(apiKey))) {
    return ['mock'];
  }

  return DEFAULT_CHAIN;
}

function buildRequest(
  lat: number,
  lng: number,
  apiKey: string,
  language: string,
  region: string,
  options: GeocodeReverseOptions
): GeocodeProviderRequest {
  return {
    lat,
    lng,
    apiKey,
    language,
    region,
    allowMock: options.allowMock || false,
    env: options.env || process.env,
    timeoutMs: options.timeoutMs || REQUEST_TIMEOUT_MS
  };
}

function getProviderCandidates(request: GeocodeProviderRequest, options: GeocodeReverseOptions) {
  if (options.providers) {
    return options.providers;
  }

  const names = resolveProviderNames(request.env, request.allowMock, request.apiKey, options.chain);
  return names
    .map(name => BUILT_IN_PROVIDERS[name])
    .filter((provider): provider is GeocodeProvider => Boolean(provider));
}

function isCoolingDown(providerName: string, now = Date.now()): boolean {
  return (providerCooldownUntil.get(providerName) || 0) > now;
}

function markCooldown(providerName: string, now = Date.now()) {
  providerCooldownUntil.set(providerName, now + PROVIDER_COOLDOWN_MS);
}

function incrementUsage(providerName: string) {
  providerUsage.set(providerName, (providerUsage.get(providerName) || 0) + 1);
}

export function getGeocoderProviderStats(
  apiKey = process.env.GOOGLE_MAPS_SERVER_KEY || '',
  allowMock = false,
  env: NodeJS.ProcessEnv = process.env
): GeocoderProviderStatus[] {
  const request = buildRequest(0, 0, apiKey, 'pt-BR', 'BR', { allowMock, env });
  const names = resolveProviderNames(env, allowMock, apiKey);
  const now = Date.now();

  return names.map(name => {
    const provider = BUILT_IN_PROVIDERS[name];
    const cooldownUntil = providerCooldownUntil.get(name) || 0;
    return {
      nome: name,
      habilitado: Boolean(provider && provider.isEnabled(request)),
      usados_na_sessao: providerUsage.get(name) || 0,
      cooldown_ativo: cooldownUntil > now,
      cooldown_ate: cooldownUntil > now ? new Date(cooldownUntil).toISOString() : undefined
    };
  });
}

export function hasEnabledGeocoderProvider(
  apiKey = process.env.GOOGLE_MAPS_SERVER_KEY || '',
  allowMock = false,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return getGeocoderProviderStats(apiKey, allowMock, env).some(item => item.habilitado);
}

export async function geocodeReverse(
  lat: number,
  lng: number,
  apiKey: string,
  language = 'pt-BR',
  region = 'BR',
  options: GeocodeReverseOptions = {}
): Promise<EnderecoConsulta> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return buildGeocodeRecord(lat, lng, {
      status_api: 'INVALID_COORDINATE',
      provider_status: 'INVALID_COORDINATE',
      endereco_formatado: 'Coordenada inválida para geocodificação.',
      retryable: false
    });
  }

  if (!options.skipCache) {
    const cacheItem = findInCache(lat, lng, 5, language, region);
    if (cacheItem) {
      return cacheItem;
    }
  }

  const request = buildRequest(lat, lng, apiKey, language, region, options);
  const providers = getProviderCandidates(request, options);
  let lastFailure: EnderecoConsulta | null = null;

  for (const provider of providers) {
    if (!provider.isEnabled(request) || isCoolingDown(provider.name)) {
      continue;
    }

    incrementUsage(provider.name);
    const result = await provider.reverse(request);
    if (result.status_api === 'SUCESSO' || isMockResult(result)) {
      if (!options.skipCache) {
        pushCache(result, language, region);
      }
      return result;
    }

    lastFailure = result;
    if (isRetryableProviderResult(result)) {
      markCooldown(provider.name);
    }
  }

  if (lastFailure) {
    return lastFailure;
  }

  return buildGeocodeRecord(lat, lng, {
    status_api: 'CONFIG_ERROR',
    provider_status: 'NO_ENABLED_PROVIDER',
    endereco_formatado: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
    provider_error_message: 'Configure GEOCODER_CHAIN e as chaves necessárias, ou habilite mock explicitamente.',
    fonte: 'geocoder-chain',
    retryable: false
  });
}
