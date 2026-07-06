import { Coordinate, EnderecoConsulta } from './types';
import { getDistanceMeters } from './kmlParser';

// In-memory address cache to prevent duplicate queries and optimize quotas
type CachedEnderecoConsulta = EnderecoConsulta & { cache_language: string; cache_region: string };

const addressCache: CachedEnderecoConsulta[] = [];
const MAX_ADDRESS_CACHE_ITEMS = 1000;

const PLACEHOLDER_GOOGLE_KEYS = new Set([
  'YOUR_API_KEY',
  'YOUR_GOOGLE_MAPS_API_KEY',
  'MY_GOOGLE_MAPS_API_KEY',
  'GOOGLE_MAPS_API_KEY',
  ''
]);

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

interface GeocodeReverseOptions {
  allowMock?: boolean;
}

export function isPlaceholderGoogleKey(apiKey?: string): boolean {
  return PLACEHOLDER_GOOGLE_KEYS.has((apiKey || '').trim());
}

export function isOperationalGeocodeFailureStatus(status?: string): boolean {
  return OPERATIONAL_FAILURE_STATUSES.has(status || '');
}

function isRetryableStatus(status: string): boolean {
  return status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR' || status === 'FALHA';
}

function buildGeocodeRecord(
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
    fonte: fields.fonte || 'Google API',
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

// Helper to find a cached coordinate within tolerance (meters)
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
  return item.fonte === 'Mock' || item.status_api === 'Mocked';
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

// Map Google Geocoding address components to structured entities
function parseAddressComponents(components: any[]) {
  let logradouro = '';
  let numero = '';
  let bairro = '';
  let subdistrito = '';
  let distrito = '';
  let municipio = '';
  let uf = '';
  let cep = '';
  let pais = '';
  let locality = '';
  let adminLevel2 = '';

  if (!components || !Array.isArray(components)) {
    return { logradouro, numero, bairro, subdistrito, distrito, municipio, uf, cep, pais };
  }

  for (const comp of components) {
    const types = comp.types || [];
    if (types.includes('street_number')) {
      numero = comp.long_name;
    } else if (types.includes('route')) {
      logradouro = comp.long_name;
    } else if (types.includes('sublocality_level_1') || types.includes('neighborhood')) {
      bairro = comp.long_name;
    } else if (types.includes('sublocality_level_2')) {
      subdistrito = comp.long_name;
    } else if (types.includes('administrative_area_level_3')) {
      distrito = comp.long_name;
    } else if (types.includes('locality')) {
      locality = comp.long_name;
    } else if (types.includes('administrative_area_level_2')) {
      adminLevel2 = comp.long_name;
    } else if (types.includes('administrative_area_level_1')) {
      uf = comp.short_name; // typically SP, RJ, etc.
    } else if (types.includes('postal_code')) {
      cep = comp.long_name;
    } else if (types.includes('country')) {
      pais = comp.long_name;
    }
  }

  municipio = locality || adminLevel2;

  return { logradouro, numero, bairro, subdistrito, distrito, municipio, uf, cep, pais };
}

// Mock Geocoder generating authentic Brasilian address profiles
export function generateMockAddress(lat: number, lng: number): EnderecoConsulta {
  // Simple deterministic generation so repeated coords yield identical mock addresses
  const hashVal = Math.abs(Math.sin(lat) * Math.cos(lng) * 100000);
  const streetNum = Math.floor(hashVal % 1500) + 12;

  const streets = [
    'Avenida Paulista', 'Rua Augusta', 'Rua XV de Novembro', 'Avenida Brasil', 
    'Rua das Palmeiras', 'Rua Bahia', 'Avenida Getúlio Vargas', 'Rua Marechal Deodoro', 
    'Avenida Atlântica', 'Rua Sete de Setembro', 'Alameda Santos', 'Rua Vergueiro'
  ];
  
  const neighborhoods = [
    'Bela Vista', 'Consolação', 'Centro', 'Jardins', 'Copacabana', 'Pinheiros', 
    'Botafogo', 'Vila Mariana', 'Moema', 'Butantã', 'Santana', 'Ipanema'
  ];

  const cities = [
    { city: 'São Paulo', uf: 'SP', cep: '01310-100' },
    { city: 'Rio de Janeiro', uf: 'RJ', cep: '22020-001' },
    { city: 'Belo Horizonte', uf: 'MG', cep: '30110-002' },
    { city: 'Curitiba', uf: 'PR', cep: '80010-010' },
    { city: 'Porto Alegre', uf: 'RS', cep: '90010-000' },
    { city: 'Salvador', uf: 'BA', cep: '40010-000' }
  ];

  const streetIdx = Math.floor(hashVal) % streets.length;
  const neighIdx = Math.floor(hashVal / 3) % neighborhoods.length;
  const cityIdx = Math.floor(hashVal / 7) % cities.length;

  const st = streets[streetIdx];
  const nh = neighborhoods[neighIdx];
  const ctDetail = cities[cityIdx];

  const formatAddress = `${st}, ${streetNum} - ${nh}, ${ctDetail.city} - ${ctDetail.uf}, ${ctDetail.cep}, Brasil`;

  const roundedLat = lat.toFixed(5);
  const roundedLng = lng.toFixed(5);

  const mockConsult: EnderecoConsulta = {
    consulta_id: `MOCK-${roundedLat}-${roundedLng}`,
    latitude: lat,
    longitude: lng,
    coordenada_normalizada: `${roundedLat},${roundedLng}`,
    endereco_formatado: formatAddress,
    logradouro: st,
    numero: String(streetNum),
    bairro: nh,
    subdistrito: '',
    distrito: '',
    municipio: ctDetail.city,
    uf: ctDetail.uf,
    cep: ctDetail.cep,
    pais: 'Brasil',
    place_id: `ChIJ_mock_place_${roundedLat.replace('.', '')}_${roundedLng.replace('.', '')}`,
    plus_code: `87JC8P${Math.floor((lat + 90) * 100).toString(16)}`,
    status_api: 'Mocked',
    quantidade_resultados: 1,
    fonte: 'Mock',
    cache_hit: false,
    necessita_revisao: true
  };

  return mockConsult;
}

// Performance Geocoding Action
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

  // Check Cache first
  const cacheItem = findInCache(lat, lng, 5, language, region); // 5 meter threshold
  if (cacheItem) {
    return cacheItem;
  }

  // Mock mode is explicit. Real geocoding fails closed when the server key is absent.
  if (isPlaceholderGoogleKey(apiKey)) {
    if (!options.allowMock) {
      return buildGeocodeRecord(lat, lng, {
        status_api: 'CONFIG_ERROR',
        provider_status: 'CONFIG_ERROR',
        endereco_formatado: 'GOOGLE_MAPS_SERVER_KEY ausente ou placeholder. Geocodificação real não executada.',
        provider_error_message: 'Configure GOOGLE_MAPS_SERVER_KEY no servidor para usar a Geocoding API.',
        retryable: false
      });
    }

    const mockAddr = generateMockAddress(lat, lng);
    pushCache(mockAddr, language, region);
    return mockAddr;
  }

  const roundedLat = lat.toFixed(5);
  const roundedLng = lng.toFixed(5);
  const id = `GEO-${roundedLat}-${roundedLng}`;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.search = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key: apiKey,
      language,
      region
    }).toString();
    
    const response = await fetch(url);
    if (!response.ok) {
      return buildGeocodeRecord(lat, lng, {
        status_api: 'FALHA',
        provider_status: 'HTTP_ERROR',
        http_status: response.status,
        endereco_formatado: `Falha HTTP na geocodificação: ${response.status} ${response.statusText}`,
        provider_error_message: `${response.status} ${response.statusText}`,
        retryable: response.status === 429 || response.status >= 500
      });
    }

    const data = await response.json();
    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const topResult = data.results[0];
      const parsedComp = parseAddressComponents(topResult.address_components);

      const consult: EnderecoConsulta = {
        ...buildGeocodeRecord(lat, lng, {
          consulta_id: id,
          status_api: 'SUCESSO',
          provider_status: data.status,
          http_status: response.status,
          quantidade_resultados: data.results.length,
          fonte: 'Google API',
          cache_hit: false,
          necessita_revisao: false
        }),
        endereco_formatado: topResult.formatted_address || '',
        ...parsedComp,
        place_id: topResult.place_id || '',
        plus_code: data.plus_code?.global_code || topResult.plus_code?.global_code || '',
        tipos: topResult.types ? topResult.types.join(', ') : '',
        granularidade: topResult.geometry?.location_type || 'UNKNOWN'
      };

      pushCache(consult, language, region);
      return consult;
    } else {
      const status = data.status || 'ZERO_RESULTS';
      return buildGeocodeRecord(lat, lng, {
        consulta_id: id,
        endereco_formatado: `Sem endereço retornado (${status})`,
        status_api: status,
        provider_status: status,
        provider_error_message: data.error_message,
        http_status: response.status,
        quantidade_resultados: 0,
        fonte: 'Google API',
        cache_hit: false,
        necessita_revisao: true,
        retryable: isRetryableStatus(status)
      });
    }
  } catch (err: any) {
    return buildGeocodeRecord(lat, lng, {
      consulta_id: id,
      status_api: 'FALHA',
      provider_status: 'NETWORK_ERROR',
      provider_error_message: err.message,
      endereco_formatado: `Falha na geocodificação: ${err.message}`,
      fonte: 'Google API',
      cache_hit: false,
      necessita_revisao: true,
      retryable: true
    });
  }
}
