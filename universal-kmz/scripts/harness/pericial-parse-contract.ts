import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { getSha256, parseKmlStringToResult } from '../../src/kmlParser';
import { buildPericialAnalysis } from '../../src/pericialMode';

const fixture = readFileSync(new URL('../fixtures/pericial-referencia.kml', import.meta.url), 'utf8');
const result = parseKmlStringToResult(
  fixture,
  'pericial-referencia.kml',
  getSha256(fixture),
  'PERICIAL',
  'SP',
  {
    sourceKmlName: 'pericial-referencia.kml',
    quantidadeKmls: 1,
    parametrosUsados: 'Modo Pericial: fixture local sem rede'
  }
);

assert.equal(result.resumo.modo_processamento, 'PERICIAL');
assert.equal(result.resumo.quantidade_kmls, 1);
assert.equal(result.resumo.quantidade_placemarks, 2);
assert.equal(result.pontos.length, 1);
assert.equal(result.trechos.length, 1);
assert.equal(result.poligonos.length, 0);
assert.equal(result.features.length, 2);
assert.ok(result.auditoria.some((item) => item.acao === 'IMPORT_KML' && item.origem === 'kmlParser'));

const analysis = buildPericialAnalysis(result, {
  projectName: 'Projeto Pericial de Referencia',
  baseDate: '2026-06-25',
  expectedRegion: 'SP',
  officialSourcesProvided: false,
  generatedAt: '2026-06-25T00:00:00.000Z'
});

assert.equal(analysis.schema_version, 'pericial-kmz/v1');
assert.equal(analysis.project.name, 'Projeto Pericial de Referencia');
assert.equal(analysis.resumo.placemarks, 2);
assert.equal(analysis.resumo.pontos, 1);
assert.equal(analysis.resumo.trechos, 1);
assert.equal(analysis.resumo.poligonos, 0);
assert.equal(analysis.resumo.officialSourcesProvided, false);

assert.ok(
  analysis.evidencias.some((item) =>
    item.origin === 'ORIGINAL_KML_KMZ' &&
    item.field === 'extended_data.prova_id' &&
    item.value === 'PV-2026-001'
  ),
  'ExtendedData prova_id must be preserved as original KML/KMZ evidence'
);

assert.ok(
  analysis.evidencias.some((item) =>
    item.origin === 'CALCULADO_GEOESPACIAL' &&
    item.field === 'comprimento_m' &&
    Number(item.value) > 0
  ),
  'Line length must be represented as calculated geospatial evidence'
);

assert.ok(
  analysis.pendenciasCriticas.some((item) => item.code === 'OFFICIAL_MUNICIPAL_BOUNDARIES_MISSING'),
  'Missing official municipal boundaries must be a critical pending item'
);

assert.ok(
  analysis.bloqueios.some((item) => item.code === 'OFFICIAL_MUNICIPAL_OVERLAY_BLOCKED'),
  'Municipal overlay must be blocked without official source'
);

assert.equal(analysis.qa.requiresHumanReview, true);
assert.equal(analysis.comparacoesDeclaradoCalculado.length, 1);
assert.equal(analysis.comparacoesDeclaradoCalculado[0].classification, 'SEM_VALOR_DECLARADO');

console.log('pericial-parse-contract: ok');
