import {
  buildFetchFailure,
  buildGeocodeRecord,
  createThrottledQueue,
  fetchJson,
  GeocodeProvider,
  GeocodeProviderRequest,
  pickFirst,
  streetGranularity
} from './types';

const throttle = createThrottledQueue(200);

function mapGeoapifyResponse(data: any, request: GeocodeProviderRequest, httpStatus = 200) {
  const features = Array.isArray(data?.features) ? data.features : [];
  if (features.length === 0) {
    return buildGeocodeRecord(request.lat, request.lng, {
      status_api: 'ZERO_RESULTS',
      provider_status: 'ZERO_RESULTS',
      http_status: httpStatus,
      endereco_formatado: 'Sem endereço retornado (ZERO_RESULTS)',
      fonte: 'geoapify',
      retryable: false
    });
  }

  const props = features[0]?.properties || {};
  const logradouro = pickFirst(props.street, props.address_line1);
  const numero = pickFirst(props.housenumber);
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    http_status: httpStatus,
    quantidade_resultados: features.length,
    fonte: 'geoapify',
    endereco_formatado: pickFirst(props.formatted, props.address_line2),
    logradouro,
    numero,
    bairro: pickFirst(props.suburb, props.district, props.neighbourhood),
    municipio: pickFirst(props.city, props.town, props.village, props.municipality, props.county),
    uf: pickFirst(props.state_code, props.state),
    cep: pickFirst(props.postcode),
    pais: pickFirst(props.country),
    place_id: pickFirst(props.place_id),
    tipos: pickFirst(props.result_type, props.datasource?.sourcename),
    ...streetGranularity(logradouro, numero)
  });
}

export const geoapifyProvider: GeocodeProvider = {
  name: 'geoapify',
  isEnabled: request => Boolean((request.env.GEOAPIFY_API_KEY || '').trim()),
  reverse: request => throttle(async () => {
    const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
    url.search = new URLSearchParams({
      lat: String(request.lat),
      lon: String(request.lng),
      apiKey: (request.env.GEOAPIFY_API_KEY || '').trim(),
      lang: 'pt'
    }).toString();

    const response = await fetchJson(url, request, { Accept: 'application/json' });
    if (!response.ok) {
      return buildFetchFailure('geoapify', request, response);
    }
    return mapGeoapifyResponse(response.data, request, response.status);
  })
};
