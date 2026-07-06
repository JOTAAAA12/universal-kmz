import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import JSZip from 'jszip';

import { generateDownloadZip } from '../../src/exporters';
import { getSha256, parseKmlStringToResult } from '../../src/kmlParser';

const fixture = readFileSync(new URL('../fixtures/pericial-referencia.kml', import.meta.url), 'utf8');
const parsed = parseKmlStringToResult(
  fixture,
  'pericial-referencia.kml',
  getSha256(fixture),
  'PERICIAL',
  'SP',
  {
    sourceKmlName: 'pericial-referencia.kml',
    quantidadeKmls: 1,
    parametrosUsados: 'Modo Pericial: export fixture local sem rede'
  }
);

const zipBuffer = await generateDownloadZip(parsed, 'pericial-referencia.kml');
const zip = await JSZip.loadAsync(zipBuffer);

assert.ok(zip.file('pericial-referencia-dados-completos.xlsx'));
assert.ok(zip.file('features.geojson'));
assert.ok(zip.file('features.kml'));
assert.ok(zip.file('dados-normalizados.json'));
assert.ok(zip.file('processamento-config.json'));
assert.ok(zip.file('csv/resumo.csv'));

const manifestFile = zip.file('pericial/manifesto-pericial.json');
assert.ok(manifestFile, 'pericial manifest must be present in the ZIP');

const manifest = JSON.parse(await manifestFile.async('string'));
assert.equal(manifest.schema_version, 'pericial-kmz/v1');
assert.equal(manifest.project.name, 'pericial-referencia');
assert.equal(manifest.resumo.placemarks, 2);
assert.equal(manifest.resumo.pontos, 1);
assert.equal(manifest.resumo.trechos, 1);
assert.equal(manifest.resumo.poligonos, 0);
assert.equal(manifest.resumo.officialSourcesProvided, false);
assert.ok(
  manifest.evidencias.some((item: { origin: string; field: string; value: string }) =>
    item.origin === 'ORIGINAL_KML_KMZ' &&
    item.field === 'extended_data.prova_id' &&
    item.value === 'PV-2026-001'
  )
);
assert.ok(
  manifest.pendenciasCriticas.some((item: { code: string }) =>
    item.code === 'OFFICIAL_MUNICIPAL_BOUNDARIES_MISSING'
  )
);
assert.ok(
  manifest.bloqueios.some((item: { code: string }) =>
    item.code === 'OFFICIAL_MUNICIPAL_OVERLAY_BLOCKED'
  )
);

console.log('pericial-export-contract: ok');
