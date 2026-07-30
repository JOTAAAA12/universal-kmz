import assert from 'node:assert/strict';

import { geocodeReverse, getGeocoderProviderStats } from '../src/geocoder';
import { mapNominatimResponse } from '../src/providers/nominatim';
import { buildGeocodeRecord, GeocodeProvider, GeocodeProviderRequest } from '../src/providers/types';

const request: GeocodeProviderRequest = {
  lat: -23.55052,
  lng: -46.63331,
  apiKey: '',
  language: 'pt-BR',
  region: 'BR',
  allowMock: false,
  env: {},
  timeoutMs: 10000
};

let disabledCalls = 0;
let quotaCalls = 0;
let fallbackCalls = 0;

const disabledProvider: GeocodeProvider = {
  name: 'disabled-fake',
  isEnabled: () => false,
  reverse: async item => {
    disabledCalls++;
    return buildGeocodeRecord(item.lat, item.lng, {
      status_api: 'FALHA',
      provider_status: 'SHOULD_NOT_RUN',
      fonte: 'disabled-fake'
    });
  }
};

const quotaProvider: GeocodeProvider = {
  name: 'quota-fake',
  isEnabled: () => true,
  reverse: async item => {
    quotaCalls++;
    return buildGeocodeRecord(item.lat, item.lng, {
      status_api: 'OVER_QUERY_LIMIT',
      provider_status: 'OVER_QUERY_LIMIT',
      fonte: 'quota-fake',
      retryable: true,
      provider_error_message: 'Retry-After: 1'
    });
  }
};

const fallbackProvider: GeocodeProvider = {
  name: 'fallback-fake',
  isEnabled: () => true,
  reverse: async item => {
    fallbackCalls++;
    return buildGeocodeRecord(item.lat, item.lng, {
      status_api: 'SUCESSO',
      provider_status: 'OK',
      quantidade_resultados: 1,
      fonte: 'fallback-fake',
      endereco_formatado: 'Rua Fallback, 10 - Centro',
      logradouro: 'Rua Fallback',
      numero: '10',
      municipio: 'Sao Paulo',
      uf: 'SP',
      pais: 'Brasil',
      necessita_revisao: false,
      granularidade: 'ROOFTOP-like'
    });
  }
};

const fallbackResult = await geocodeReverse(request.lat, request.lng, '', request.language, request.region, {
  providers: [disabledProvider, quotaProvider, fallbackProvider],
  env: request.env,
  skipCache: true
});

assert.equal(disabledCalls, 0);
assert.equal(quotaCalls, 3);
assert.equal(fallbackCalls, 1);
assert.equal(fallbackResult.fonte, 'fallback-fake');
assert.equal(fallbackResult.status_api, 'SUCESSO');
assert.equal(fallbackResult.necessita_revisao, true);
assert.match(fallbackResult.observacao_validacao || '', /Fallback para fallback-fake após falha de quota-fake\./);

const cooledFallbackResult = await geocodeReverse(request.lat, request.lng, '', request.language, request.region, {
  providers: [quotaProvider, fallbackProvider],
  env: request.env,
  skipCache: true
});
assert.equal(quotaCalls, 3);
assert.equal(fallbackCalls, 2);
assert.equal(cooledFallbackResult.fonte, 'fallback-fake');

let dedupCalls = 0;
let releaseDedup: (() => void) | null = null;
const dedupProvider: GeocodeProvider = {
  name: 'dedup-fake',
  isEnabled: () => true,
  reverse: async item => {
    dedupCalls++;
    await new Promise<void>(resolve => {
      releaseDedup = resolve;
    });
    return buildGeocodeRecord(item.lat, item.lng, {
      status_api: 'SUCESSO',
      provider_status: 'OK',
      quantidade_resultados: 1,
      fonte: 'dedup-fake',
      endereco_formatado: 'Rua Deduplicada, 1',
      necessita_revisao: false
    });
  }
};

const firstInFlight = geocodeReverse(request.lat, request.lng, '', request.language, request.region, {
  providers: [dedupProvider],
  env: request.env,
  skipCache: true
});
const secondInFlight = geocodeReverse(request.lat, request.lng, '', request.language, request.region, {
  providers: [dedupProvider],
  env: request.env,
  skipCache: true
});
await Promise.resolve();
assert.equal(dedupCalls, 1);
assert.ok(releaseDedup);
releaseDedup();
const [firstDedupResult, secondDedupResult] = await Promise.all([firstInFlight, secondInFlight]);
assert.equal(dedupCalls, 1);
assert.equal(firstDedupResult.endereco_formatado, 'Rua Deduplicada, 1');
assert.equal(secondDedupResult.endereco_formatado, 'Rua Deduplicada, 1');

const keylessStats = getGeocoderProviderStats('', false, {
  GEOCODER_CHAIN: 'google,locationiq,geoapify,bigdatacloud'
});
assert.deepEqual(
  keylessStats.map(item => [item.nome, item.habilitado]),
  [
    ['google', false],
    ['locationiq', false],
    ['geoapify', false],
    ['bigdatacloud', true]
  ]
);

const nominatimFixture = {
  place_id: 123456,
  display_name: 'Avenida Paulista, 1000, Bela Vista, Sao Paulo, SP, Brasil',
  type: 'house',
  address: {
    house_number: '1000',
    road: 'Avenida Paulista',
    suburb: 'Bela Vista',
    city: 'Sao Paulo',
    'ISO3166-2-lvl4': 'BR-SP',
    postcode: '01310-100',
    country: 'Brasil'
  }
};

const mappedNominatim = mapNominatimResponse(nominatimFixture, request, 200);
assert.equal(mappedNominatim.status_api, 'SUCESSO');
assert.equal(mappedNominatim.fonte, 'nominatim');
assert.equal(mappedNominatim.logradouro, 'Avenida Paulista');
assert.equal(mappedNominatim.numero, '1000');
assert.equal(mappedNominatim.bairro, 'Bela Vista');
assert.equal(mappedNominatim.municipio, 'Sao Paulo');
assert.equal(mappedNominatim.uf, 'SP');
assert.equal(mappedNominatim.cep, '01310-100');
assert.equal(mappedNominatim.granularidade, 'ROOFTOP-like');
assert.equal(mappedNominatim.necessita_revisao, false);

console.log('provider chain regression passed');
