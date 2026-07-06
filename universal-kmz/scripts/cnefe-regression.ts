import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadCnefeIndex } from '../src/cnefeIndex';
import { createCnefeProvider } from '../src/providers/cnefe';
import { validateCep } from '../src/providers/viacep';
import { geocodeReverse } from '../src/geocoder';
import { buildGeocodeRecord, GeocodeProvider } from '../src/providers/types';

const originalFetch = globalThis.fetch;

const tmp = await mkdtemp(path.join(tmpdir(), 'universal-kmz-cnefe-'));

try {
  const csv = [
    'codigo;tipo_logradouro;titulo_logradouro;nome_logradouro;numero;localidade;municipio;uf;cep;latitude;longitude',
    '1;Rua;;das Flores;10;Centro;Sao Paulo;SP;01001000;-23.550520;-46.633310',
    '2;Avenida;Doutor;Brasil;200;Jardim;Sao Paulo;SP;01002000;-23.551000;-46.634000',
    '3;Travessa;;Curta;5;Vila;Sao Paulo;SP;01003000;-23.552000;-46.632500',
    '4;Rua;;Longe;1;Centro;Sao Paulo;SP;01004000;-23.560000;-46.650000',
    '5;Rua;;Principal;99;Centro;Campinas;SP;13010000;-22.915560;-47.070830',
    '6;Avenida;;Secundaria;101;Cambui;Campinas;SP;13020000;-22.916000;-47.071000',
    '7;Rua;;Alternativa;102;Cambui;Campinas;SP;13030000;-22.917000;-47.072000',
    '8;Estrada;;Rural;S/N;Zona Rural;Campinas;SP;13040000;-22.918000;-47.073000'
  ].join('\n');
  const altCsv = [
    'COD_UNICO_ENDERECO;NOM_SEGLOGR;NUM_ENDERECO;DSC_LOCALIDADE;NOM_MUNICIPIO;CEP;LATITUDE;LONGITUDE',
    '9;Rua Nome Alternativo;321;Centro;Sao Paulo;01005000;-23.550600;-46.633250'
  ].join('\n');
  const ibgeCodeCsv = [
    'COD_UNICO_ENDERECO;TIPO_LOGRADOURO;NOME_LOGRADOURO;NUM_ENDERECO;DSC_LOCALIDADE;COD_MUNICIPIO;CEP;LATITUDE;LONGITUDE',
    '10;RUA;JOSE PAULINO;1010;CENTRO;3509502;13013001;-22.905560;-47.060830',
    '11;RUA;CODIGO DESCONHECIDO;1;CENTRO;9999999;13013002;-22.905000;-47.060000'
  ].join('\n');

  await writeFile(path.join(tmp, 'SP_fixture.csv'), csv, 'utf8');
  await writeFile(path.join(tmp, 'cnefe_alt_headers_SP.csv'), altCsv, 'utf8');
  await writeFile(path.join(tmp, 'cnefe_ibge_codes_SP.csv'), ibgeCodeCsv, 'utf8');

  const index = await loadCnefeIndex({ dir: tmp, maxRows: 100 });
  assert.equal(index.stats.indexedRows, 11);
  assert.equal(index.stats.partial, false);

  const provider = createCnefeProvider(index);
  const near = await provider.reverse({
    lat: -23.55052,
    lng: -46.63331,
    apiKey: '',
    language: 'pt-BR',
    region: 'BR',
    allowMock: false,
    env: {},
    timeoutMs: 10000
  });
  assert.equal(near.status_api, 'SUCESSO');
  assert.equal(near.fonte, 'cnefe');
  assert.equal(near.logradouro, 'Rua das Flores');
  assert.equal(near.numero, '10');
  assert.equal(near.bairro, 'Centro');
  assert.equal(near.municipio, 'Sao Paulo');
  assert.equal(near.uf, 'SP');
  assert.equal(near.cep, '01001000');
  assert.equal(near.granularidade, 'CNEFE_ALTA');
  assert.equal(near.necessita_revisao, false);

  const alternativeHeaders = await provider.reverse({
    lat: -23.55060,
    lng: -46.63325,
    apiKey: '',
    language: 'pt-BR',
    region: 'BR',
    allowMock: false,
    env: {},
    timeoutMs: 10000
  });
  assert.equal(alternativeHeaders.logradouro, 'Rua Nome Alternativo');
  assert.equal(alternativeHeaders.numero, '321');

  const campinasByIbgeCode = await provider.reverse({
    lat: -22.90556,
    lng: -47.06083,
    apiKey: '',
    language: 'pt-BR',
    region: 'BR',
    allowMock: false,
    env: {},
    timeoutMs: 10000
  });
  assert.equal(campinasByIbgeCode.status_api, 'SUCESSO');
  assert.equal(campinasByIbgeCode.logradouro, 'RUA JOSE PAULINO');
  assert.equal(campinasByIbgeCode.numero, '1010');
  assert.equal(campinasByIbgeCode.bairro, 'CENTRO');
  assert.equal(campinasByIbgeCode.municipio, 'Campinas');
  assert.equal(campinasByIbgeCode.uf, 'SP');
  assert.equal(campinasByIbgeCode.cep, '13013001');
  assert.equal(campinasByIbgeCode.endereco_formatado, 'RUA JOSE PAULINO, 1010 - CENTRO - Campinas - SP - 13013-001');
  assert.equal(campinasByIbgeCode.granularidade, 'CNEFE_ALTA');
  assert.equal(campinasByIbgeCode.necessita_revisao, false);

  const unknownMunicipioCode = await provider.reverse({
    lat: -22.90500,
    lng: -47.06000,
    apiKey: '',
    language: 'pt-BR',
    region: 'BR',
    allowMock: false,
    env: {},
    timeoutMs: 10000
  });
  assert.equal(unknownMunicipioCode.status_api, 'SUCESSO');
  assert.equal(unknownMunicipioCode.municipio, '9999999');
  assert.equal(unknownMunicipioCode.uf, 'SP');
  assert.equal(unknownMunicipioCode.necessita_revisao, true);

  const mid = await provider.reverse({
    lat: -23.55160,
    lng: -46.63420,
    apiKey: '',
    language: 'pt-BR',
    region: 'BR',
    allowMock: false,
    env: {},
    timeoutMs: 10000
  });
  assert.equal(mid.status_api, 'SUCESSO');
  assert.equal(mid.granularidade, 'CNEFE_MEDIA');
  assert.equal(mid.necessita_revisao, true);

  const far = await provider.reverse({
    lat: -23.7,
    lng: -46.8,
    apiKey: '',
    language: 'pt-BR',
    region: 'BR',
    allowMock: false,
    env: {},
    timeoutMs: 10000
  });
  assert.equal(far.status_api, 'ZERO_RESULTADOS');

  const partial = await loadCnefeIndex({ dir: tmp, maxRows: 3 });
  assert.equal(partial.stats.partial, true);
  assert.equal(partial.stats.indexedRows, 3);

  globalThis.fetch = async (url: string | URL | Request) => {
    const text = String(url);
    if (text.includes('01001000')) {
      return new Response(JSON.stringify({ cep: '01001-000', logradouro: 'Rua das Flores', localidade: 'Sao Paulo', uf: 'SP' }));
    }
    return new Response(JSON.stringify({ cep: '13010-000', logradouro: 'Rua Principal', localidade: 'Campinas', uf: 'SP' }));
  };

  const cepOk = await validateCep('01001000', 'Rua das Flores', 'Sao Paulo', 'SP');
  assert.equal(cepOk.ok, true);
  assert.equal(cepOk.message, undefined);

  const cepDivergent = await validateCep('01001000', 'Rua das Flores', 'Campinas', 'SP');
  assert.equal(cepDivergent.ok, false);
  assert.match(cepDivergent.message || '', /ViaCEP diverge/);

  let secondCalls = 0;
  const firstProvider: GeocodeProvider = {
    name: 'first-fake',
    isEnabled: () => true,
    reverse: async request => buildGeocodeRecord(request.lat, request.lng, {
      status_api: 'SUCESSO',
      provider_status: 'OK',
      quantidade_resultados: 1,
      fonte: 'first-fake',
      logradouro: 'Rua das Flores',
      municipio: 'São Paulo',
      uf: 'SP',
      necessita_revisao: true,
      granularidade: 'STREET'
    })
  };
  const agreeingProvider: GeocodeProvider = {
    name: 'agree-fake',
    isEnabled: () => true,
    reverse: async request => {
      secondCalls++;
      return buildGeocodeRecord(request.lat, request.lng, {
        status_api: 'SUCESSO',
        provider_status: 'OK',
        quantidade_resultados: 1,
        fonte: 'agree-fake',
        logradouro: 'RUA DAS FLORES',
        municipio: 'sao paulo',
        uf: 'SP',
        necessita_revisao: false,
        granularidade: 'ROOFTOP-like'
      });
    }
  };

  const crossChecked = await geocodeReverse(-23.55052, -46.63331, '', 'pt-BR', 'BR', {
    providers: [firstProvider, agreeingProvider],
    env: { GEOCODE_CROSSCHECK: 'true' },
    skipCache: true
  });
  assert.equal(crossChecked.necessita_revisao, false);
  assert.equal(secondCalls, 1);

  const divergent = await geocodeReverse(-23.55052, -46.63331, '', 'pt-BR', 'BR', {
    providers: [
      firstProvider,
      {
        ...agreeingProvider,
        reverse: async request => {
          secondCalls++;
          return buildGeocodeRecord(request.lat, request.lng, {
            status_api: 'SUCESSO',
            quantidade_resultados: 1,
            fonte: 'diverge-fake',
            logradouro: 'Avenida Brasil',
            municipio: 'Sao Paulo',
            necessita_revisao: false
          });
        }
      }
    ],
    env: { GEOCODE_CROSSCHECK: 'true' },
    skipCache: true
  });
  assert.equal(divergent.necessita_revisao, true);
  assert.match(divergent.observacao_validacao || '', /Cross-check diverge/);
} finally {
  globalThis.fetch = originalFetch;
  await rm(tmp, { recursive: true, force: true });
}

console.log('cnefe regression passed');
