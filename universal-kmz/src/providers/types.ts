import { EnderecoConsulta } from '../types';

export type GeocoderProviderName =
  | 'google'
  | 'nominatim'
  | 'photon'
  | 'locationiq'
  | 'geoapify'
  | 'bigdatacloud'
  | 'mock'
  | string;

export interface GeocodeProviderRequest {
  lat: number;
  lng: number;
  apiKey: string;
  language: string;
  region: string;
  allowMock: boolean;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface GeocodeProvider {
  name: GeocoderProviderName;
  isEnabled: (request: GeocodeProviderRequest) => boolean;
  reverse: (request: GeocodeProviderRequest) => Promise<EnderecoConsulta>;
}

export interface GeocoderProviderStatus {
  nome: string;
  habilitado: boolean;
  usados_na_sessao: number;
  cooldown_ativo: boolean;
  cooldown_ate?: string;
}

export interface JsonFetchResult {
  ok: boolean;
  status: number;
  statusText: string;
  data?: any;
  error?: Error;
  timedOut?: boolean;
}

const PLACEHOLDER_GOOGLE_KEYS = new Set([
  'YOUR_API_KEY',
  'YOUR_GOOGLE_MAPS_API_KEY',
  'MY_GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  ''
]);

export function isPlaceholderGoogleKey(apiKey?: string): boolean {
  return PLACEHOLDER_GOOGLE_KEYS.has((apiKey || '').trim());
}

export function buildGeocodeRecord(
  lat: number,
  lng: number,
  fields: Partial<EnderecoConsulta>
): EnderecoConsulta {
  const roundedLat = Number.isFinite(lat) ? lat.toFixed(5) : String(lat);
  const roundedLng = Number.isFinite(lng) ? lng.toFixed(5) : String(lng);

  return {
    consulta_id: fields.consulta_id || `GEO-${roundedLat}-${roundedLng}`,
    latitude: lat,
    longitude: lng,
    coordenada_normalizada: `${roundedLat},${roundedLng}`,
    status_api: fields.status_api || 'FALHA',
    provider_status: fields.provider_status,
    provider_error_message: fields.provider_error_message,
    http_status: fields.http_status,
    retryable: fields.retryable || false,
    quantidade_resultados: fields.quantidade_resultados || 0,
    fonte: fields.fonte || 'geocoder',
    cache_hit: fields.cache_hit || false,
    necessita_revisao: fields.necessita_revisao ?? true,
    endereco_formatado: fields.endereco_formatado,
    logradouro: fields.logradouro,
    numero: fields.numero,
    bairro: fields.bairro,
    subdistrito: fields.subdistrito,
    distrito: fields.distrito,
    municipio: fields.municipio,
    uf: fields.uf,
    cep: fields.cep,
    pais: fields.pais,
    place_id: fields.place_id,
    plus_code: fields.plus_code,
    tipos: fields.tipos,
    granularidade: fields.granularidade
  };
}

export function pickFirst(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }
  return '';
}

export function ufFromIso(value: unknown, fallback = ''): string {
  const raw = pickFirst(value, fallback);
  const match = raw.match(/(?:^|-)BR-([A-Z]{2})$/i) || raw.match(/^([A-Z]{2})$/i);
  return match ? match[1].toUpperCase() : raw;
}

export function streetGranularity(logradouro: string, numero: string) {
  if (logradouro && numero) {
    return { granularidade: 'ROOFTOP-like', necessita_revisao: false };
  }
  if (logradouro) {
    return { granularidade: 'STREET', necessita_revisao: true };
  }
  return { granularidade: 'APPROXIMATE', necessita_revisao: true };
}

export function isRetryableProviderResult(item: EnderecoConsulta): boolean {
  return Boolean(
    item.retryable ||
    item.provider_status === 'OVER_QUERY_LIMIT' ||
    item.provider_status === 'TIMEOUT' ||
    item.http_status === 429
  );
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function createThrottledQueue(intervalMs: number) {
  let nextStartAt = 0;
  let tail = Promise.resolve();

  return async function throttle<T>(operation: () => Promise<T>): Promise<T> {
    const run = tail.catch(() => undefined).then(async () => {
      const waitMs = Math.max(0, nextStartAt - Date.now());
      if (waitMs > 0) {
        await wait(waitMs);
      }
      nextStartAt = Date.now() + intervalMs;
      return operation();
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };
}

export async function fetchJson(
  url: URL,
  request: GeocodeProviderRequest,
  headers: Record<string, string> = {}
): Promise<JsonFetchResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    let data: any;
    try {
      data = await response.json();
    } catch {
      data = undefined;
    }
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      data
    };
  } catch (error: any) {
    const timedOut = error?.name === 'AbortError';
    return {
      ok: false,
      status: timedOut ? 408 : 0,
      statusText: timedOut ? 'Request timeout' : error?.message || 'Network error',
      error: error instanceof Error ? error : new Error(String(error)),
      timedOut
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function buildFetchFailure(
  provider: string,
  request: GeocodeProviderRequest,
  result: JsonFetchResult
): EnderecoConsulta {
  const providerStatus = result.timedOut ? 'TIMEOUT' : result.status === 429 ? 'HTTP_429' : 'HTTP_ERROR';
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'FALHA',
    provider_status: providerStatus,
    http_status: result.status || undefined,
    endereco_formatado: `Falha HTTP na geocodificação: ${result.status} ${result.statusText}`,
    provider_error_message: result.statusText,
    fonte: provider,
    retryable: result.timedOut || result.status === 429 || result.status >= 500
  });
}
