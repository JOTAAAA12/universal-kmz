import assert from 'node:assert/strict';

import { mergeGeocodedBatch } from '../src/pericialMerge';
import { getSha256, parseKmlStringToResult } from '../src/kmlParser';
import { EnderecoConsulta, ParserResult, PointFeature } from '../src/types';

const coordinateKey = (latitude: number, longitude: number) => `${latitude.toFixed(5)},${longitude.toFixed(5)}`;

function parseFixture(name: string, kml: string): ParserResult {
  return parseKmlStringToResult(kml, name, getSha256(kml));
}

function withOriginalAddress(result: ParserResult, point: PointFeature): ParserResult {
  const original: EnderecoConsulta = {
    consulta_id: `KML-${point.point_id}`,
    latitude: point.latitude,
    longitude: point.longitude,
    coordenada_normalizada: coordinateKey(point.latitude, point.longitude),
    endereco_formatado: point.endereco_formatado || `Endereço original de ${point.municipio || 'origem KML'}`,
    municipio: point.municipio,
    uf: point.uf,
    status_api: 'SUCESSO',
    quantidade_resultados: 1,
    fonte: 'Original',
    cache_hit: false,
    necessita_revisao: false
  };

  return { ...result, enderecos: [...result.enderecos, original] };
}

function externalAddress(
  consultaId: string,
  latitude: number,
  longitude: number,
  fonte: string,
  municipio: string,
  uf: string
): EnderecoConsulta {
  return {
    consulta_id: consultaId,
    latitude,
    longitude,
    coordenada_normalizada: coordinateKey(latitude, longitude),
    endereco_formatado: `Rua Externa, 123 - Centro, ${municipio} - ${uf}`,
    logradouro: 'Rua Externa',
    numero: '123',
    bairro: 'Centro',
    municipio,
    uf,
    cep: '00000-000',
    pais: 'Brasil',
    status_api: 'SUCESSO',
    quantidade_resultados: 1,
    fonte,
    cache_hit: false,
    necessita_revisao: false
  };
}

const kmlComOrigem = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Ponto Original</name>
      <ExtendedData>
        <Data name="cidade"><value>Cidade KML</value></Data>
        <Data name="uf"><value>SP</value></Data>
      </ExtendedData>
      <Point><coordinates>-46.6333,-23.5505,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Ponto Sem Endereço Original</name>
      <Point><coordinates>-46.6343,-23.5515,0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;

const fixtureComOrigem = parseFixture('origem-kml.kml', kmlComOrigem);
const baseComOrigem = withOriginalAddress(fixtureComOrigem, fixtureComOrigem.pontos[0]);
const pontoOriginal = baseComOrigem.pontos[0];
const externoGoogle = externalAddress('google-divergente', pontoOriginal.latitude, pontoOriginal.longitude, 'google', 'Cidade Externa', 'RJ');
const entradaOriginalAntesDoGoogle = structuredClone(baseComOrigem);
const resultadoGoogle = mergeGeocodedBatch(baseComOrigem, [externoGoogle]);

assert.deepEqual(baseComOrigem, entradaOriginalAntesDoGoogle, 'o merge não deve mutar o resultado de origem');
assert.equal(resultadoGoogle.pontos[0].municipio, 'Cidade KML');
assert.equal(resultadoGoogle.pontos[0].uf, 'SP');
assert.equal(resultadoGoogle.pontos[0].necessita_revisao, true);
assert.match(resultadoGoogle.pontos[0].conflito_endereco || '', /Cidade KML/);
assert.match(resultadoGoogle.pontos[0].conflito_endereco || '', /Cidade Externa/);
assert.equal(resultadoGoogle.enderecos.length, 2);
assert.equal(resultadoGoogle.enderecos.find(item => item.fonte === 'Original')?.fonte, 'Original');
assert.equal(resultadoGoogle.enderecos.find(item => item.consulta_id === 'google-divergente-GEO')?.necessita_revisao, true);

const externoCnefe = externalAddress('cnefe-divergente', pontoOriginal.latitude, pontoOriginal.longitude, 'cnefe', 'Cidade CNEFE', 'MG');
const resultadoCnefe = mergeGeocodedBatch(baseComOrigem, [externoCnefe]);

assert.equal(resultadoCnefe.pontos[0].municipio, 'Cidade KML');
assert.equal(resultadoCnefe.pontos[0].uf, 'SP');
assert.equal(resultadoCnefe.pontos[0].necessita_revisao, true);
assert.match(resultadoCnefe.pontos[0].conflito_endereco || '', /Cidade KML/);
assert.match(resultadoCnefe.pontos[0].conflito_endereco || '', /Cidade CNEFE/);
assert.equal(resultadoCnefe.enderecos.find(item => item.consulta_id === 'cnefe-divergente-GEO')?.necessita_revisao, true);

const pontoSemOrigem = baseComOrigem.pontos[1];
const loteComDependencia = [
  externoGoogle,
  externoCnefe,
  externalAddress('google-coordenada-nova', pontoSemOrigem.latitude, pontoSemOrigem.longitude, 'google', 'Cidade Aceita', 'PR')
];
const loteAntesDoMerge = structuredClone(loteComDependencia);
const resultadoEmLote = mergeGeocodedBatch(baseComOrigem, loteComDependencia);
const resultadoSequencial = loteComDependencia.reduce(
  (atual, endereco) => mergeGeocodedBatch(atual, [endereco]),
  baseComOrigem
);

assert.deepEqual(loteComDependencia, loteAntesDoMerge, 'o merge não deve mutar os endereços recebidos');
assert.deepEqual(
  resultadoEmLote,
  resultadoSequencial,
  'o lote completo deve preservar a semântica do merge sequencial, inclusive duas fontes na mesma coordenada'
);

const resultadoSemEnderecoOriginal = mergeGeocodedBatch(baseComOrigem, [
  externalAddress('google-sem-original', pontoSemOrigem.latitude, pontoSemOrigem.longitude, 'google', 'Cidade Aceita', 'PR')
]);

assert.equal(resultadoSemEnderecoOriginal.pontos[1].municipio, 'Cidade Aceita');
assert.equal(resultadoSemEnderecoOriginal.pontos[1].uf, 'PR');
assert.equal(resultadoSemEnderecoOriginal.pontos[1].origem_endereco, 'Geocoding API');
assert.equal(resultadoSemEnderecoOriginal.pontos[1].conflito_endereco, undefined);
assert.ok(resultadoSemEnderecoOriginal.enderecos.some(item => item.consulta_id === 'google-sem-original'));
assert.equal(resultadoSemEnderecoOriginal.enderecos.some(item => item.consulta_id === 'google-sem-original-GEO'), false);

process.stdout.write('pericial merge regression passed\n');
