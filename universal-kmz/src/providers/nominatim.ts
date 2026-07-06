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

const throttle = createThrottledQueue(1000);

function mapAddress(address: any) {
  const logradouro = pickFirst(address?.road);
  const numero = pickFirst(address?.house_number);
  return {
    logradouro,
    numero,
    bairro: pickFirst(address?.suburb, address?.neighbourhood),
    municipio: pickFirst(address?.city, address?.town, address?.village, address?.municipality),
    uf: ufFromIso(address?.['ISO3166-2-lvl4'], address?.state),
    cep: pickFirst(address?.postcode),
    pais: pickFirst(address?.country),
    ...streetGranularity(logradouro, numero)
  };
}

export function mapNominatimResponse(data: any, request: GeocodeProviderRequest, httpStatus = 200) {
  if (!data || typeof data !== 'object' || data.error) {
    const status = data?.error ? 'ZERO_RESULTS' : 'FALHA';
    return buildGeocodeRecord(request.lat, request.lng, {
      status_api: status,
      provider_status: data?.error ? 'ZERO_RESULTS' : 'INVALID_RESPONSE',
      provider_error_message: data?.error,
      http_status: httpStatus,
      endereco_formatado: data?.error || `Sem endereço retornado (${status})`,
      fonte: 'nominatim',
      retryable: false
    });
  }

  const mapped = mapAddress(data.address || {});
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    http_status: httpStatus,
    quantidade_resultados: 1,
    fonte: 'nominatim',
    endereco_formatado: pickFirst(data.display_name),
    place_id: pickFirst(data.place_id),
    tipos: pickFirst(data.type, data.category),
    ...mapped
  });
}

export const nominatimProvider: GeocodeProvider = {
  name: 'nominatim',
  isEnabled: () => true,
  reverse: request => throttle(async () => {
    const url = new URL('https://nominatim.openstreetmap.org/reverse');
    url.search = new URLSearchParams({
      format: 'jsonv2',
      lat: String(request.lat),
      lon: String(request.lng),
      'accept-language': request.language || 'pt-BR'
    }).toString();

    const contact = (request.env.NOMINATIM_EMAIL || 'NOMINATIM_EMAIL not configured').trim();
    const response = await fetchJson(url, request, {
      Accept: 'application/json',
      'User-Agent': `universal-kmz/1.0 (${contact})`
    });
    if (!response.ok) {
      return buildFetchFailure('nominatim', request, response);
    }
    return mapNominatimResponse(response.data, request, response.status);
  })
};
