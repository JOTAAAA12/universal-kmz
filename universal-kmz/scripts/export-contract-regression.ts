import assert from 'node:assert/strict';
import JSZip from 'jszip';

import { generateDownloadZip, generateGeoJson, generateKml, generateWorkbook } from '../src/exporters';
import { getSha256, parseKmlStringToResult } from '../src/kmlParser';

const fixture = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Ponto Export</name>
      <Point><coordinates>-46.1,-23.1,0</coordinates></Point>
    </Placemark>
    <Placemark>
      <name>Linha Export</name>
      <LineString><coordinates>-46.1,-23.1,0 -46.2,-23.2,0</coordinates></LineString>
    </Placemark>
    <Placemark>
      <name>Area Export</name>
      <Polygon>
        <outerBoundaryIs><LinearRing><coordinates>-46.4,-23.4,0 -46.4,-23.3,0 -46.3,-23.3,0 -46.3,-23.4,0 -46.4,-23.4,0</coordinates></LinearRing></outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

const parsed = parseKmlStringToResult(fixture, 'export.kml', getSha256(fixture));

const workbook = generateWorkbook(parsed);
assert.deepEqual(
  workbook.SheetNames,
  ['Resumo', 'Features', 'Pontos', 'Trechos', 'Trechos_Enderecos', 'Poligonos', 'Enderecos', 'Associacoes', 'Erros_Alertas', 'Auditoria']
);

const geojson = JSON.parse(generateGeoJson(parsed));
assert.equal(geojson.type, 'FeatureCollection');
assert.equal(geojson.features.length, 3);

const kml = generateKml(parsed);
assert.match(kml, /<kml xmlns="http:\/\/www.opengis.net\/kml\/2.2">/);
assert.match(kml, /Ponto Export/);
assert.match(kml, /LineString/);
assert.match(kml, /Polygon/);

const zipBuffer = await generateDownloadZip(parsed, 'export.kml');
const zip = await JSZip.loadAsync(zipBuffer);
assert.ok(zip.file('export-dados-completos.xlsx'));
assert.ok(zip.file('features.geojson'));
assert.ok(zip.file('features.kml'));
assert.ok(zip.file('dados-normalizados.json'));
assert.ok(zip.file('csv/resumo.csv'));
assert.ok(zip.file('csv/trechos-enderecos.csv'));

console.log('export contract regression passed');
