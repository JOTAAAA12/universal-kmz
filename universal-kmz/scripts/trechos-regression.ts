import assert from 'node:assert/strict';

import { getDistanceMeters } from '../src/kmlParser';
import {
  consolidateSegments,
  resolveDominantPolygonAddress,
  samplePolygon,
  samplePolyline
} from '../src/lineSampling';
import { buildGeocodeRecord } from '../src/providers/types';
import { Coordinate, EnderecoConsulta } from '../src/types';

function near(actual: number, expected: number, tolerance: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

function fakeEndereco(coord: Coordinate, fields: Partial<EnderecoConsulta>): EnderecoConsulta {
  return buildGeocodeRecord(coord.lat, coord.lng, {
    status_api: 'SUCESSO',
    fonte: 'fake-geocoder',
    quantidade_resultados: 1,
    necessita_revisao: false,
    ...fields
  });
}

const longLine = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.0036 }
];
const sampled = samplePolyline(longLine, 100);
assert.deepEqual(sampled[0], longLine[0]);
assert.deepEqual(sampled[sampled.length - 1], longLine[1]);
assert.ok(sampled.length >= 5, 'line should include interpolated samples');
for (let i = 1; i < sampled.length; i++) {
  const gap = getDistanceMeters(sampled[i - 1], sampled[i]);
  assert.ok(gap >= 10, `duplicate/near sample at ${i}`);
  assert.ok(gap <= 110, `sample gap too large at ${i}: ${gap}`);
}

const roadCoords: Coordinate[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.0009 },
  { lat: 0, lng: 0.0018 },
  { lat: 0, lng: 0.0027 },
  { lat: 0, lng: 0.0036 },
  { lat: 0, lng: 0.0045 },
  { lat: 0, lng: 0.0054 }
];
const consolidated = consolidateSegments([
  { coord: roadCoords[0], endereco: fakeEndereco(roadCoords[0], { logradouro: 'Rua Álfa', numero: '300', bairro: 'Centro', municipio: 'Teste', uf: 'SP' }) },
  { coord: roadCoords[1], endereco: fakeEndereco(roadCoords[1], { logradouro: 'rua alfa', numero: '100', bairro: 'Centro', municipio: 'Teste', uf: 'SP' }) },
  { coord: roadCoords[2], endereco: fakeEndereco(roadCoords[2], { logradouro: 'RUA ALFA', numero: '200', bairro: 'Centro', municipio: 'Teste', uf: 'SP' }) },
  { coord: roadCoords[3], endereco: fakeEndereco(roadCoords[3], { logradouro: 'Rua Beta', numero: '450', bairro: 'Jardim', municipio: 'Teste', uf: 'SP' }) },
  { coord: roadCoords[4], endereco: fakeEndereco(roadCoords[4], { logradouro: 'Rua Beta', numero: '400', bairro: 'Jardim', municipio: 'Teste', uf: 'SP' }) },
  { coord: roadCoords[5], endereco: fakeEndereco(roadCoords[5], { logradouro: 'Rua Gama', numero: '700', bairro: 'Norte', municipio: 'Teste', uf: 'SP' }) },
  { coord: roadCoords[6], endereco: fakeEndereco(roadCoords[6], { logradouro: 'Rua Gama', numero: '650', bairro: 'Norte', municipio: 'Teste', uf: 'SP', necessita_revisao: true }) }
]);
assert.equal(consolidated.length, 3);
assert.equal(consolidated[0].logradouro, 'Rua Álfa');
assert.equal(consolidated[0].numero_inicio, 100);
assert.equal(consolidated[0].numero_fim, 300);
assert.equal(consolidated[0].quantidade_amostras, 3);
near(consolidated[0].extensao_m, 200, 25, 'alpha length');
assert.equal(consolidated[1].logradouro, 'Rua Beta');
assert.equal(consolidated[1].numero_inicio, 400);
assert.equal(consolidated[1].numero_fim, 450);
near(consolidated[1].extensao_m, 100, 20, 'beta length');
assert.equal(consolidated[2].logradouro, 'Rua Gama');
assert.equal(consolidated[2].necessita_revisao, true);

const unknown = consolidateSegments([
  { coord: { lat: 1, lng: 1 }, endereco: fakeEndereco({ lat: 1, lng: 1 }, { logradouro: '', necessita_revisao: true }) },
  { coord: { lat: 1, lng: 1.0005 }, endereco: fakeEndereco({ lat: 1, lng: 1.0005 }, { logradouro: undefined, necessita_revisao: false }) }
]);
assert.equal(unknown.length, 1);
assert.equal(unknown[0].logradouro, 'NÃO IDENTIFICADO');
assert.equal(unknown[0].necessita_revisao, true);

const polygonRing: Coordinate[] = [
  { lat: 0, lng: 0 },
  { lat: 0, lng: 0.001 },
  { lat: 0.001, lng: 0.001 },
  { lat: 0.001, lng: 0 },
  { lat: 0, lng: 0 }
];
const polygonSamples = samplePolygon(polygonRing);
assert.equal(polygonSamples.length, 5);
near(polygonSamples[0].lat, 0.0004, 0.0002, 'polygon centroid lat');
near(polygonSamples[0].lng, 0.0004, 0.0002, 'polygon centroid lng');

const polygonAddress = resolveDominantPolygonAddress([
  { coord: polygonSamples[0], endereco: fakeEndereco(polygonSamples[0], { logradouro: 'Rua Obra', municipio: 'Teste', bairro: 'Centro', uf: 'SP' }) },
  { coord: polygonSamples[1], endereco: fakeEndereco(polygonSamples[1], { logradouro: 'Rua Obra', municipio: 'Teste', bairro: 'Centro', uf: 'SP' }) },
  { coord: polygonSamples[2], endereco: fakeEndereco(polygonSamples[2], { logradouro: 'Rua Confronto', municipio: 'Teste', bairro: 'Centro', uf: 'SP' }) },
  { coord: polygonSamples[3], endereco: fakeEndereco(polygonSamples[3], { logradouro: 'Rua Obra', municipio: 'Teste', bairro: 'Centro', uf: 'SP' }) },
  { coord: polygonSamples[4], endereco: fakeEndereco(polygonSamples[4], { logradouro: 'Rua Obra', municipio: 'Teste', bairro: 'Centro', uf: 'SP' }) }
]);
assert.equal(polygonAddress.logradouro, 'Rua Obra');
assert.deepEqual(polygonAddress.confrontantes, ['Rua Confronto']);
assert.equal(polygonAddress.quantidade_amostras, 5);

process.stdout.write('trechos regression passed\n');
