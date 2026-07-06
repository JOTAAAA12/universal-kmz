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

const throttle = createThrottledQueue(1000);

export function mapPhotonResponse(data: any, request: GeocodeProviderRequest, httpStatus = 200) {
  const features = Array.isArray(data?.features) ? data.features : [];
  if (features.length === 0) {
    return buildGeocodeRecord(request.lat, request.lng, {
      status_api: 'ZERO_RESULTS',
      provider_status: 'ZERO_RESULTS',
      http_status: httpStatus,
      endereco_formatado: 'Sem endereço retornado (ZERO_RESULTS)',
      fonte: 'photon',
      retryable: false
    });
  }

  const props = features[0]?.properties || {};
  const logradouro = pickFirst(props.street);
  const numero = pickFirst(props.housenumber);
  const precision = streetGranularity(logradouro, numero);
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    http_status: httpStatus,
    quantidade_resultados: features.length,
    fonte: 'photon',
    endereco_formatado: [logradouro && `${logradouro}${numero ? `, ${numero}` : ''}`, props.city, props.state, props.country]
      .filter(Boolean)
      .join(', '),
    logradouro,
    numero,
    bairro: pickFirst(props.district),
    municipio: pickFirst(props.city),
    uf: pickFirst(props.state),
    cep: pickFirst(props.postcode),
    pais: pickFirst(props.country),
    place_id: pickFirst(props.osm_id),
    tipos: pickFirst(props.osm_type, props.type),
    ...precision
  });
}

export const photonProvider: GeocodeProvider = {
  name: 'photon',
  isEnabled: () => true,
  reverse: request => throttle(async () => {
    const url = new URL('https://photon.komoot.io/reverse');
    url.search = new URLSearchParams({
      lat: String(request.lat),
      lon: String(request.lng),
      lang: 'default'
    }).toString();

    const response = await fetchJson(url, request, { Accept: 'application/json' });
    if (!response.ok) {
      return buildFetchFailure('photon', request, response);
    }
    return mapPhotonResponse(response.data, request, response.status);
  })
};
