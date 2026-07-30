import { EnderecoConsulta } from './types';
import { addressesLikelyEqual, normalizeUf } from './addressNormalize';
import { getDistanceMeters } from './kmlParser';
import { bigDataCloudProvider } from './providers/bigdatacloud';
import { cnefeProvider } from './providers/cnefe';
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

export interface GeocodeCacheStore {
  get(
    lat: number,
    lng: number,
    language: string,
    region: string
  ): EnderecoConsulta | null | Promise<EnderecoConsulta | null>;
  set(item: EnderecoConsulta, language: string, region: string): void | Promise<void>;
}

interface GeocodeReverseOptions {
  allowMock?: boolean;
  providers?: GeocodeProvider[];
  env?: NodeJS.ProcessEnv;
  chain?: string[];
  skipCache?: boolean;
  cache?: GeocodeCacheStore;
  timeoutMs?: number;
}

const addressCache: CachedEnderecoConsulta[] = [];
const MAX_ADDRESS_CACHE_ITEMS = 1000;
const REQUEST_TIMEOUT_MS = 10000;
const PROVIDER_COOLDOWN_MS = 60000;
const PROVIDER_MAX_ATTEMPTS = 3;
const PROVIDER_RETRY_BASE_DELAY_MS = 250;
const PROVIDER_RETRY_MAX_DELAY_MS = 4000;
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
  cnefe: cnefeProvider,
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
const inFlightGeocodeRequests = new Map<string, Promise<EnderecoConsulta>>();

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

export function isCacheableGeocodeResult(item: EnderecoConsulta): boolean {
  return !isMockResult(item) && (
    item.status_api === 'SUCESSO' ||
    item.status_api === 'ZERO_RESULTS' ||
    item.status_api === 'ZERO_RESULTADOS'
  );
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

function markCooldown(providerName: string, result?: EnderecoConsulta, now = Date.now()) {
  providerCooldownUntil.set(providerName, now + (getRetryAfterMs(result, now) ?? PROVIDER_COOLDOWN_MS));
}

function incrementUsage(providerName: string) {
  providerUsage.set(providerName, (providerUsage.get(providerName) || 0) + 1);
}

function getRetryAfterMs(result: EnderecoConsulta | undefined, now = Date.now()): number | null {
  if (!result) return null;

  const metadata = result as EnderecoConsulta & {
    retryAfter?: string | number;
    retry_after?: string | number;
    responseHeaders?: Record<string, string | undefined>;
    response_headers?: Record<string, string | undefined>;
  };
  const explicitRetryAfter = metadata.retryAfter
    ?? metadata.retry_after
    ?? metadata.responseHeaders?.['retry-after']
    ?? metadata.responseHeaders?.['Retry-After']
    ?? metadata.response_headers?.['retry-after']
    ?? metadata.response_headers?.['Retry-After'];
  const errorRetryAfter = result.provider_error_message?.match(
    /retry[-_ ]?after\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i
  )?.[1] ?? result.provider_error_message?.match(/retry[-_ ]?after\s*[:=]\s*([^;|]+)/i)?.[1];
  const retryAfter = explicitRetryAfter ?? errorRetryAfter;
  if (retryAfter === undefined) return null;

  const seconds = typeof retryAfter === 'number' ? retryAfter : Number(retryAfter.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAt = Date.parse(String(retryAfter));
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - now) : null;
}

function getRetryDelayMs(attempt: number): number {
  const exponentialDelay = Math.min(
    PROVIDER_RETRY_MAX_DELAY_MS,
    PROVIDER_RETRY_BASE_DELAY_MS * (2 ** attempt)
  );
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(exponentialDelay * 0.25)));
  return exponentialDelay + jitter;
}

function waitForRetry(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function buildProviderFailure(
  provider: GeocodeProvider,
  request: GeocodeProviderRequest,
  error: unknown
): EnderecoConsulta {
  const message = error instanceof Error ? error.message : 'Falha inesperada ao consultar o provedor.';
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'FALHA',
    provider_status: 'REQUEST_ERROR',
    provider_error_message: message,
    endereco_formatado: `Falha temporária no provedor ${provider.name}.`,
    fonte: provider.name,
    retryable: true
  });
}

async function reverseProviderWithRetry(
  provider: GeocodeProvider,
  request: GeocodeProviderRequest
): Promise<EnderecoConsulta> {
  let lastResult: EnderecoConsulta | null = null;

  for (let attempt = 0; attempt < PROVIDER_MAX_ATTEMPTS; attempt++) {
    incrementUsage(provider.name);
    let result: EnderecoConsulta;
    try {
      result = await provider.reverse(request);
    } catch (error: unknown) {
      result = buildProviderFailure(provider, request, error);
    }

    if (!isRetryableProviderResult(result)) {
      return result;
    }

    lastResult = result;
    if (attempt < PROVIDER_MAX_ATTEMPTS - 1) {
      await waitForRetry(getRetryDelayMs(attempt));
    }
  }

  const failure = lastResult || buildProviderFailure(provider, request, new Error('Falha sem resposta do provedor.'));
  markCooldown(provider.name, failure);
  return failure;
}

function buildInFlightKey(
  request: GeocodeProviderRequest,
  providers: GeocodeProvider[]
): string {
  return [
    request.lat.toFixed(7),
    request.lng.toFixed(7),
    request.language,
    request.region,
    request.allowMock ? 'mock' : 'real',
    request.timeoutMs,
    providers.map(provider => provider.name).join(',')
  ].join('|');
}

export function getGeocoderProviderByName(name: string): GeocodeProvider | null {
  return BUILT_IN_PROVIDERS[name.trim().toLowerCase()] || null;
}

function envFlag(env: NodeJS.ProcessEnv, key: string): boolean {
  const value = (env[key] || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

function appendValidationNote(item: EnderecoConsulta, note: string): EnderecoConsulta {
  return {
    ...item,
    observacao_validacao: [item.observacao_validacao, note].filter(Boolean).join(' | ')
  };
}

function isZeroResult(item: EnderecoConsulta): boolean {
  return item.status_api === 'ZERO_RESULTS' || item.status_api === 'ZERO_RESULTADOS';
}

function isSuccessResult(item: EnderecoConsulta): boolean {
  return item.status_api === 'SUCESSO' || isMockResult(item);
}

function shouldCrossCheck(item: EnderecoConsulta, env: NodeJS.ProcessEnv): boolean {
  return envFlag(env, 'GEOCODE_CROSSCHECK') && isSuccessResult(item) && (!item.numero || item.necessita_revisao);
}

function providersAgree(primary: EnderecoConsulta, secondary: EnderecoConsulta): boolean {
  const primaryStreet = primary.logradouro || '';
  const secondaryStreet = secondary.logradouro || '';
  const primaryCity = primary.municipio || '';
  const secondaryCity = secondary.municipio || '';
  const primaryUf = primary.uf ? normalizeUf(primary.uf) : '';
  const secondaryUf = secondary.uf ? normalizeUf(secondary.uf) : '';
  return Boolean(primaryStreet && secondaryStreet && primaryCity && secondaryCity
    && addressesLikelyEqual(primaryStreet, secondaryStreet)
    && addressesLikelyEqual(primaryCity, secondaryCity, 1)
    && (!primaryUf || !secondaryUf || primaryUf === secondaryUf));
}

async function maybeCrossCheckResult(
  result: EnderecoConsulta,
  providers: GeocodeProvider[],
  providerIndex: number,
  request: GeocodeProviderRequest
): Promise<EnderecoConsulta> {
  if (!shouldCrossCheck(result, request.env)) {
    return result;
  }

  for (let index = providerIndex + 1; index < providers.length; index++) {
    const provider = providers[index];
    if (!provider.isEnabled(request) || isCoolingDown(provider.name)) {
      continue;
    }
    const comparison = await reverseProviderWithRetry(provider, request);
    if (!isSuccessResult(comparison)) {
      return result;
    }
    if (providersAgree(result, comparison)) {
      return {
        ...result,
        necessita_revisao: false
      };
    }
    return appendValidationNote({
      ...result,
      necessita_revisao: true
    }, `Cross-check diverge de ${comparison.fonte}: ${comparison.logradouro || 'sem logradouro'} / ${comparison.municipio || 'sem município'}.`);
  }

  return result;
}

async function cacheResultIfNeeded(
  result: EnderecoConsulta,
  language: string,
  region: string,
  options: GeocodeReverseOptions
) {
  if (options.skipCache || !isCacheableGeocodeResult(result)) {
    return;
  }
  if (options.cache) {
    await options.cache.set(result, language, region);
  } else {
    pushCache(result, language, region);
  }
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
      cooldown_ate: cooldownUntil > now ? new Date(cooldownUntil).toISOString() : undefined,
      ...(provider?.getStatus?.() || {})
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
    const cacheItem = options.cache
      ? await options.cache.get(lat, lng, language, region)
      : findInCache(lat, lng, 5, language, region);
    if (cacheItem) {
      return cacheItem;
    }
  }

  const request = buildRequest(lat, lng, apiKey, language, region, options);
  const providers = getProviderCandidates(request, options);
  const inFlightKey = buildInFlightKey(request, providers);
  const inFlight = inFlightGeocodeRequests.get(inFlightKey);
  // Cada chamador recebe seu próprio registro: antes da deduplicação cada chamada
  // produzia um objeto distinto, e compartilhar a mesma referência permitiria que
  // um chamador afetasse o resultado do outro.
  if (inFlight) return inFlight.then(item => ({ ...item }));

  const operation = geocodeWithProviders(request, providers, language, region, options);
  inFlightGeocodeRequests.set(inFlightKey, operation);
  try {
    return await operation;
  } finally {
    inFlightGeocodeRequests.delete(inFlightKey);
  }
}

async function geocodeWithProviders(
  request: GeocodeProviderRequest,
  providers: GeocodeProvider[],
  language: string,
  region: string,
  options: GeocodeReverseOptions
): Promise<EnderecoConsulta> {
  let lastFailure: EnderecoConsulta | null = null;
  let fallbackAfterFailure: string | null = null;

  for (let index = 0; index < providers.length; index++) {
    const provider = providers[index];
    if (!provider.isEnabled(request) || isCoolingDown(provider.name)) {
      continue;
    }

    const result = await reverseProviderWithRetry(provider, request);
    if (isSuccessResult(result)) {
      let finalResult = await maybeCrossCheckResult(result, providers, index, request);
      if (fallbackAfterFailure) {
        finalResult = appendValidationNote({
          ...finalResult,
          necessita_revisao: true
        }, `Fallback para ${provider.name} após falha de ${fallbackAfterFailure}.`);
      }
      await cacheResultIfNeeded(finalResult, language, region, options);
      return finalResult;
    }

    if (isZeroResult(result)) {
      lastFailure = result;
      continue;
    }

    lastFailure = result;
    fallbackAfterFailure = provider.name;
  }

  if (lastFailure) {
    await cacheResultIfNeeded(lastFailure, language, region, options);
    return lastFailure;
  }

  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'CONFIG_ERROR',
    provider_status: 'NO_ENABLED_PROVIDER',
    endereco_formatado: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
    provider_error_message: 'Configure GEOCODER_CHAIN e as chaves necessárias, ou habilite mock explicitamente.',
    fonte: 'geocoder-chain',
    retryable: false
  });
}
