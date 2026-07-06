import { EnderecoConsulta } from '../types';
import {
  buildFetchFailure,
  buildGeocodeRecord,
  fetchJson,
  GeocodeProvider,
  isPlaceholderGoogleKey
} from './types';

function isRetryableGoogleStatus(status: string): boolean {
  return status === 'OVER_QUERY_LIMIT' || status === 'UNKNOWN_ERROR' || status === 'FALHA';
}

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
      uf = comp.short_name;
    } else if (types.includes('postal_code')) {
      cep = comp.long_name;
    } else if (types.includes('country')) {
      pais = comp.long_name;
    }
  }

  municipio = locality || adminLevel2;

  return { logradouro, numero, bairro, subdistrito, distrito, municipio, uf, cep, pais };
}

export const googleProvider: GeocodeProvider = {
  name: 'google',
  isEnabled: request => !isPlaceholderGoogleKey(request.apiKey),
  reverse: async request => {
    if (isPlaceholderGoogleKey(request.apiKey)) {
      return buildGeocodeRecord(request.lat, request.lng, {
        status_api: 'CONFIG_ERROR',
        provider_status: 'CONFIG_ERROR',
        endereco_formatado: 'GOOGLE_MAPS_SERVER_KEY ausente ou placeholder. Geocodificação real não executada.',
        provider_error_message: 'Configure GOOGLE_MAPS_SERVER_KEY no servidor para usar a Geocoding API.',
        fonte: 'google',
        retryable: false
      });
    }

    const roundedLat = request.lat.toFixed(5);
    const roundedLng = request.lng.toFixed(5);
    const id = `GEO-${roundedLat}-${roundedLng}`;
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.search = new URLSearchParams({
      latlng: `${request.lat},${request.lng}`,
      key: request.apiKey,
      language: request.language,
      region: request.region
    }).toString();

    const response = await fetchJson(url, request);
    if (!response.ok) {
      return buildFetchFailure('google', request, response);
    }

    const data = response.data;
    if (data?.status === 'OK' && data.results && data.results.length > 0) {
      const topResult = data.results[0];
      const parsedComp = parseAddressComponents(topResult.address_components);
      const consult: EnderecoConsulta = {
        ...buildGeocodeRecord(request.lat, request.lng, {
          consulta_id: id,
          status_api: 'SUCESSO',
          provider_status: data.status,
          http_status: response.status,
          quantidade_resultados: data.results.length,
          fonte: 'google',
          cache_hit: false,
          necessita_revisao: !parsedComp.logradouro
        }),
        endereco_formatado: topResult.formatted_address || '',
        ...parsedComp,
        place_id: topResult.place_id || '',
        plus_code: data.plus_code?.global_code || topResult.plus_code?.global_code || '',
        tipos: topResult.types ? topResult.types.join(', ') : '',
        granularidade: topResult.geometry?.location_type || 'UNKNOWN'
      };

      return consult;
    }

    const status = data?.status || 'ZERO_RESULTS';
    return buildGeocodeRecord(request.lat, request.lng, {
      consulta_id: id,
      endereco_formatado: `Sem endereço retornado (${status})`,
      status_api: status,
      provider_status: status,
      provider_error_message: data?.error_message,
      http_status: response.status,
      quantidade_resultados: 0,
      fonte: 'google',
      cache_hit: false,
      necessita_revisao: true,
      retryable: isRetryableGoogleStatus(status)
    });
  }
};
