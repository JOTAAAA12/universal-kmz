import {
  buildFetchFailure,
  buildGeocodeRecord,
  createThrottledQueue,
  fetchJson,
  GeocodeProvider,
  GeocodeProviderRequest,
  pickFirst,
  streetGranularity,
  ufFromIso
} from './types';

const throttle = createThrottledQueue(500);

function mapLocationIqResponse(data: any, request: GeocodeProviderRequest, httpStatus = 200) {
  if (!data || typeof data !== 'object' || data.error) {
    return buildGeocodeRecord(request.lat, request.lng, {
      status_api: data?.error ? 'ZERO_RESULTS' : 'FALHA',
      provider_status: data?.error ? 'ZERO_RESULTS' : 'INVALID_RESPONSE',
      provider_error_message: data?.error,
      http_status: httpStatus,
      endereco_formatado: data?.error || 'Resposta inválida do LocationIQ.',
      fonte: 'locationiq',
      retryable: false
    });
  }

  const address = data.address || {};
  const logradouro = pickFirst(address.road, address.pedestrian, address.footway);
  const numero = pickFirst(address.house_number);
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    http_status: httpStatus,
    quantidade_resultados: 1,
    fonte: 'locationiq',
    endereco_formatado: pickFirst(data.display_name),
    logradouro,
    numero,
    bairro: pickFirst(address.suburb, address.neighbourhood),
    municipio: pickFirst(address.city, address.town, address.village, address.municipality),
    uf: ufFromIso(address['ISO3166-2-lvl4'], address.state),
    cep: pickFirst(address.postcode),
    pais: pickFirst(address.country),
    place_id: pickFirst(data.place_id),
    tipos: pickFirst(data.type, data.category),
    ...streetGranularity(logradouro, numero)
  });
}

export const locationIqProvider: GeocodeProvider = {
  name: 'locationiq',
  isEnabled: request => Boolean((request.env.LOCATIONIQ_API_KEY || '').trim()),
  reverse: request => throttle(async () => {
    const url = new URL('https://us1.locationiq.com/v1/reverse');
    url.search = new URLSearchParams({
      key: (request.env.LOCATIONIQ_API_KEY || '').trim(),
      lat: String(request.lat),
      lon: String(request.lng),
      format: 'json',
      'accept-language': request.language || 'pt-BR'
    }).toString();

    const response = await fetchJson(url, request, { Accept: 'application/json' });
    if (!response.ok) {
      return buildFetchFailure('locationiq', request, response);
    }
    return mapLocationIqResponse(response.data, request, response.status);
  })
};
