import {
  buildFetchFailure,
  buildGeocodeRecord,
  fetchJson,
  GeocodeProvider,
  GeocodeProviderRequest,
  pickFirst,
  ufFromIso
} from './types';

function mapBigDataCloudResponse(data: any, request: GeocodeProviderRequest, httpStatus = 200) {
  if (!data || typeof data !== 'object') {
    return buildGeocodeRecord(request.lat, request.lng, {
      status_api: 'FALHA',
      provider_status: 'INVALID_RESPONSE',
      http_status: httpStatus,
      endereco_formatado: 'Resposta inválida do BigDataCloud.',
      fonte: 'bigdatacloud',
      retryable: false
    });
  }

  const state = pickFirst(data.principalSubdivisionCode, data.principalSubdivision);
  const city = pickFirst(data.city, data.locality);
  return buildGeocodeRecord(request.lat, request.lng, {
    status_api: 'SUCESSO',
    provider_status: 'OK',
    http_status: httpStatus,
    quantidade_resultados: 1,
    fonte: 'bigdatacloud',
    endereco_formatado: [data.locality, data.city, data.principalSubdivision, data.countryName].filter(Boolean).join(', '),
    bairro: pickFirst(data.locality),
    municipio: city,
    uf: ufFromIso(state),
    cep: pickFirst(data.postcode),
    pais: pickFirst(data.countryName, data.countryCode),
    granularidade: 'APPROXIMATE',
    necessita_revisao: true
  });
}

export const bigDataCloudProvider: GeocodeProvider = {
  name: 'bigdatacloud',
  isEnabled: () => true,
  reverse: async request => {
    const url = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
    url.search = new URLSearchParams({
      latitude: String(request.lat),
      longitude: String(request.lng),
      localityLanguage: 'pt'
    }).toString();

    const response = await fetchJson(url, request, { Accept: 'application/json' });
    if (!response.ok) {
      return buildFetchFailure('bigdatacloud', request, response);
    }
    return mapBigDataCloudResponse(response.data, request, response.status);
  }
};
