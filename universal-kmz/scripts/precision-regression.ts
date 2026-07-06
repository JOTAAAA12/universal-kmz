import assert from 'node:assert/strict';

import { mergeExternalAddressRecord, mergePointWithGeocodedAddress } from '../src/addressConfidence';
import { generateKml } from '../src/exporters';
import { geocodeReverse, resolveGeocodeMode } from '../src/geocoder';
import { getSha256, parseKmlStringToResult } from '../src/kmlParser';
import { EnderecoConsulta } from '../src/types';

function parseFixture(name: string, kml: string) {
  return parseKmlStringToResult(kml, name, getSha256(kml));
}

const kmlWithoutCity = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Ponto Sem Cidade</name>
      <Point>
        <coordinates>-46.6333,-23.5505,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

const withoutCity = parseFixture('sem-cidade.kml', kmlWithoutCity);
assert.equal(withoutCity.pontos.length, 1);
assert.equal(withoutCity.enderecos.length, 0);
assert.equal(withoutCity.pontos[0].municipio, undefined);
assert.equal(withoutCity.pontos[0].uf, undefined);
assert.equal(withoutCity.pontos[0].endereco_formatado, undefined);
assert.equal(withoutCity.pontos[0].origem_endereco, 'Indisponível');
assert.equal(withoutCity.pontos[0].status_api, 'PENDENTE');
assert.equal(withoutCity.pontos[0].necessita_revisao, true);
assert.equal(withoutCity.resumo.resultados_sem_endereco, 1);

const kmlWithCity = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Ponto Com Cidade</name>
      <ExtendedData>
        <Data name="cidade"><value>CidadeDoArquivo</value></Data>
        <Data name="uf"><value>ZZ</value></Data>
      </ExtendedData>
      <Point>
        <coordinates>-46.6333,-23.5505,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

const withCity = parseFixture('com-cidade.kml', kmlWithCity);
assert.equal(withCity.pontos.length, 1);
assert.equal(withCity.enderecos.length, 0);
assert.equal(withCity.pontos[0].municipio, 'CidadeDoArquivo');
assert.equal(withCity.pontos[0].uf, 'ZZ');
assert.equal(withCity.pontos[0].endereco_formatado, undefined);
assert.equal(withCity.pontos[0].origem_endereco, 'Original');
assert.equal(withCity.pontos[0].status_api, 'PENDENTE');
assert.equal(withCity.pontos[0].necessita_revisao, true);
assert.equal(withCity.resumo.resultados_completos, 0);
assert.equal(withCity.resumo.resultados_sem_endereco, 1);

const externalMismatch: EnderecoConsulta = {
  consulta_id: 'GEO--23.55050--46.63330',
  latitude: -23.5505,
  longitude: -46.6333,
  coordenada_normalizada: '-23.55050,-46.63330',
  endereco_formatado: 'Avenida Externa, 123 - Outro Bairro, OutraCidade - YY',
  logradouro: 'Avenida Externa',
  numero: '123',
  bairro: 'Outro Bairro',
  municipio: 'OutraCidade',
  uf: 'YY',
  cep: '00000-000',
  pais: 'Brasil',
  status_api: 'SUCESSO',
  quantidade_resultados: 1,
  fonte: 'google',
  cache_hit: false,
  necessita_revisao: false
};

const mergedMismatch = mergePointWithGeocodedAddress(withCity.pontos[0], externalMismatch);
assert.equal(mergedMismatch.municipio, 'CidadeDoArquivo');
assert.equal(mergedMismatch.uf, 'ZZ');
assert.equal(mergedMismatch.endereco_formatado, undefined);
assert.equal(mergedMismatch.origem_endereco, 'Original');
assert.equal(mergedMismatch.status_api, 'SUCESSO');
assert.equal(mergedMismatch.necessita_revisao, true);
assert.match(mergedMismatch.conflito_endereco || '', /CidadeDoArquivo/);
assert.match(mergedMismatch.conflito_endereco || '', /OutraCidade/);

const mergedAddresses = mergeExternalAddressRecord(withCity.enderecos, externalMismatch);
assert.equal(mergedAddresses.length, 1);
assert.equal(mergedAddresses[0].fonte, 'google');

const lineOnly = parseFixture('linha.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Linha Unica</name>
      <LineString><coordinates>-46.1,-23.1,0 -46.2,-23.2,0</coordinates></LineString>
    </Placemark>
  </Document>
</kml>`);
assert.equal(lineOnly.pontos.length, 0);
assert.equal(lineOnly.trechos.length, 1);
assert.equal(lineOnly.resumo.total_vertices, 2);
assert.equal(lineOnly.resumo.quantidade_coordenadas_unicas, 2);
assert.equal(lineOnly.resumo.chamadas_estimadas, 2);

const multiGeometry = parseFixture('multi.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Combo</name>
      <MultiGeometry>
        <Point><coordinates>-46.0,-23.0,0</coordinates></Point>
        <LineString><coordinates>-46.1,-23.1,0 -46.2,-23.2,0</coordinates></LineString>
        <Polygon>
          <outerBoundaryIs><LinearRing><coordinates>-46.4,-23.4,0 -46.4,-23.3,0 -46.3,-23.3,0 -46.3,-23.4,0 -46.4,-23.4,0</coordinates></LinearRing></outerBoundaryIs>
        </Polygon>
      </MultiGeometry>
    </Placemark>
  </Document>
</kml>`);
assert.equal(multiGeometry.features.length, 3);
assert.equal(multiGeometry.pontos.length, 1);
assert.equal(multiGeometry.trechos.length, 1);
assert.equal(multiGeometry.poligonos.length, 1);
assert.equal(multiGeometry.resumo.quantidade_multigeometry, 1);
assert.equal(multiGeometry.features.some(f => f.geometry_type === 'MultiGeometry'), false);

const polygonWithHole = parseFixture('furo.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Area com furo</name>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>-46.0,-23.0,0 -46.0,-22.9,0 -45.9,-22.9,0 -45.9,-23.0,0 -46.0,-23.0,0</coordinates></LinearRing></outerBoundaryIs>
        <innerBoundaryIs><LinearRing><coordinates>-45.98,-22.98,0 -45.98,-22.96,0 -45.96,-22.96,0 -45.96,-22.98,0 -45.98,-22.98,0</coordinates></LinearRing></innerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`);
assert.equal(polygonWithHole.poligonos.length, 1);
assert.equal(polygonWithHole.poligonos[0].quantidade_aneis, 2);
assert.equal(JSON.parse(polygonWithHole.poligonos[0].geojson).coordinates.length, 2);
assert.match(generateKml(polygonWithHole), /innerBoundaryIs/);

const originalGeocoderChain = process.env.GEOCODER_CHAIN;
process.env.GEOCODER_CHAIN = 'google';

const noKey = await geocodeReverse(-23.551, -46.634, '');
assert.equal(noKey.status_api, 'CONFIG_ERROR');
assert.equal(noKey.fonte, 'geocoder-chain');
assert.equal(noKey.necessita_revisao, true);
assert.equal(noKey.quantidade_resultados, 0);

process.env.GEOCODER_CHAIN = 'mock';
const explicitMock = await geocodeReverse(-23.552, -46.635, '', 'pt-BR', 'BR', { allowMock: true });
assert.equal(explicitMock.status_api, 'Mocked');
assert.equal(explicitMock.fonte, 'mock');
assert.equal(explicitMock.necessita_revisao, true);
assert.equal(resolveGeocodeMode([explicitMock], true), 'mock');

process.env.GEOCODER_CHAIN = 'google';
const invalidCoordinate = await geocodeReverse(999, -46.636, 'valid-server-key');
assert.equal(invalidCoordinate.status_api, 'INVALID_COORDINATE');
assert.equal(invalidCoordinate.retryable, false);

const originalFetch = globalThis.fetch;
try {
  let capturedUrl = '';
  globalThis.fetch = (async (input: string | URL | Request) => {
    capturedUrl = String(input);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        status: 'OK',
        results: [
          {
            formatted_address: 'Rua Teste, 123 - Centro, Sao Paulo - SP, Brasil',
            place_id: 'place-ok',
            types: ['street_address'],
            geometry: { location_type: 'ROOFTOP' },
            address_components: [
              { long_name: '123', short_name: '123', types: ['street_number'] },
              { long_name: 'Rua Teste', short_name: 'Rua Teste', types: ['route'] },
              { long_name: 'Centro', short_name: 'Centro', types: ['neighborhood'] },
              { long_name: 'Sao Paulo', short_name: 'Sao Paulo', types: ['locality', 'political'] },
              { long_name: 'Regiao Administrativa Errada', short_name: 'RAE', types: ['administrative_area_level_2', 'political'] },
              { long_name: 'Sao Paulo', short_name: 'SP', types: ['administrative_area_level_1', 'political'] },
              { long_name: 'Brasil', short_name: 'BR', types: ['country', 'political'] },
              { long_name: '01000-000', short_name: '01000-000', types: ['postal_code'] }
            ]
          }
        ],
        plus_code: { global_code: '588MOK' }
      })
    } as Response;
  }) as typeof fetch;

  const googleOk = await geocodeReverse(-23.553, -46.637, 'valid-server-key', 'pt-BR', 'BR');
  assert.match(capturedUrl, /maps\.googleapis\.com\/maps\/api\/geocode\/json/);
  assert.match(capturedUrl, /latlng=-23\.553%2C-46\.637/);
  assert.equal(googleOk.status_api, 'SUCESSO');
  assert.equal(googleOk.provider_status, 'OK');
  assert.equal(googleOk.municipio, 'Sao Paulo');
  assert.equal(googleOk.uf, 'SP');
  assert.equal(googleOk.place_id, 'place-ok');
  assert.equal(googleOk.granularidade, 'ROOFTOP');
  assert.equal(resolveGeocodeMode([googleOk], true), 'google');

  let languageFetches = 0;
  globalThis.fetch = (async () => {
    languageFetches++;
    const city = languageFetches === 1 ? 'English City' : 'Cidade PT';
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        status: 'OK',
        results: [
          {
            formatted_address: `${city}, SP, Brasil`,
            place_id: `place-${languageFetches}`,
            types: ['locality'],
            geometry: { location_type: 'APPROXIMATE' },
            address_components: [
              { long_name: city, short_name: city, types: ['locality', 'political'] },
              { long_name: 'Sao Paulo', short_name: 'SP', types: ['administrative_area_level_1', 'political'] },
              { long_name: 'Brasil', short_name: 'BR', types: ['country', 'political'] }
            ]
          }
        ]
      })
    } as Response;
  }) as typeof fetch;

  const english = await geocodeReverse(-23.601, -46.601, 'valid-server-key', 'en-US', 'US');
  const portuguese = await geocodeReverse(-23.601, -46.601, 'valid-server-key', 'pt-BR', 'BR');
  assert.equal(languageFetches, 2);
  assert.equal(english.municipio, 'English City');
  assert.equal(portuguese.municipio, 'Cidade PT');

  globalThis.fetch = (async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      status: 'REQUEST_DENIED',
      error_message: 'API keys with referer restrictions cannot be used with this API.',
      results: []
    })
  } as Response)) as typeof fetch;

  const denied = await geocodeReverse(-23.554, -46.638, 'browser-key-used-on-server');
  assert.equal(denied.status_api, 'REQUEST_DENIED');
  assert.equal(denied.provider_status, 'REQUEST_DENIED');
  assert.match(denied.provider_error_message || '', /referer restrictions/);
  assert.equal(denied.retryable, false);
  assert.equal(denied.necessita_revisao, true);
} finally {
  globalThis.fetch = originalFetch;
  if (originalGeocoderChain === undefined) {
    delete process.env.GEOCODER_CHAIN;
  } else {
    process.env.GEOCODER_CHAIN = originalGeocoderChain;
  }
}

console.log('precision regression passed');
