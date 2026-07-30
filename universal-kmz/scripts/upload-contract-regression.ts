import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import JSZip from 'jszip';

const PORT = 3199;
const baseUrl = `http://127.0.0.1:${PORT}`;

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await wait(500);
  }
  throw new Error('Servidor de teste nao ficou pronto em 30s.');
}

async function stopProcess(server: ChildProcess) {
  if (!server.pid || server.exitCode !== null || server.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timeout = setTimeout(resolve, 5000);
    server.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    if (!server.kill()) {
      clearTimeout(timeout);
      resolve();
    }
  });
}

function kmlPoint(name: string, lng: number, lat: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>${name}</name>
      <Point><coordinates>${lng},${lat},0</coordinates></Point>
    </Placemark>
  </Document>
</kml>`;
}

function kmlPrefixedPoint(name: string, lng: number, lat: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml:kml xmlns:kml="http://www.opengis.net/kml/2.2">
  <kml:Document>
    <kml:Placemark>
      <kml:name>${name}</kml:name>
      <kml:Point><kml:coordinates>${lng},${lat},0</kml:coordinates></kml:Point>
    </kml:Placemark>
  </kml:Document>
</kml:kml>`;
}

async function postUpload(name: string, content: string) {
  return fetch(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      content,
      processingType: 'COMPLETO',
      geocodeMode: 'COMPLETO',
      sampleInterval: 25,
      toleranceGroup: 5,
      toleranceMatch: 30
    })
  });
}

const server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    GEOCODER_MODE: 'google',
    ALLOW_MOCK_GEOCODER: 'false',
    GOOGLE_MAPS_SERVER_KEY: ''
  },
  stdio: 'ignore'
});

try {
  await waitForServer();

  const zip = new JSZip();
  zip.file('doc-a.kml', kmlPoint('Ponto A', -46.1, -23.1));
  zip.file('nested/doc-b.kml', kmlPoint('Ponto B', -46.2, -23.2));
  zip.file('prefixed.kml', kmlPrefixedPoint('Ponto Prefixado', -46.3, -23.3));
  const kmzBase64 = await zip.generateAsync({ type: 'base64' });

  const response = await postUpload('multi.kmz', kmzBase64);
  assert.equal(response.status, 200);
  const parsed = await response.json();

  assert.equal(parsed.resumo.quantidade_kmls, 3);
  assert.equal(parsed.resumo.quantidade_points, 3);
  assert.equal(parsed.pontos.length, 3);
  assert.deepEqual(
    parsed.features.map((f: any) => f.kml_origem).sort(),
    ['doc-a.kml', 'nested/doc-b.kml', 'prefixed.kml']
  );

  const emptyZip = new JSZip();
  emptyZip.file('readme.txt', 'sem kml');
  const emptyBase64 = await emptyZip.generateAsync({ type: 'base64' });
  const emptyResponse = await postUpload('empty.kmz', emptyBase64);
  assert.equal(emptyResponse.status, 400);
  const emptyBody = await emptyResponse.json();
  assert.match(emptyBody.error, /Nenhum arquivo KML/);

  console.log('upload contract regression passed');
} finally {
  await stopProcess(server);
}
