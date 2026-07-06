import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

async function stopProcess(pid?: number) {
  if (!pid) return;
  await new Promise<void>(resolve => {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('exit', () => resolve());
    killer.on('error', () => resolve());
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

const server = spawn(process.env.ComSpec || 'cmd.exe', ['/c', 'npm.cmd', 'run', 'dev'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    PORT: String(PORT),
    GEOCODER_MODE: 'google',
    ALLOW_MOCK_GEOCODER: 'false',
    GOOGLE_MAPS_SERVER_KEY: ''
  },
  stdio: 'ignore',
  windowsHide: true
});

try {
  await waitForServer();

  const zip = new JSZip();
  zip.file('doc-a.kml', kmlPoint('Ponto A', -46.1, -23.1));
  zip.file('nested/doc-b.kml', kmlPoint('Ponto B', -46.2, -23.2));
  const kmzBase64 = await zip.generateAsync({ type: 'base64' });

  const response = await postUpload('multi.kmz', kmzBase64);
  assert.equal(response.status, 200);
  const parsed = await response.json();

  assert.equal(parsed.resumo.quantidade_kmls, 2);
  assert.equal(parsed.resumo.quantidade_points, 2);
  assert.equal(parsed.pontos.length, 2);
  assert.deepEqual(
    parsed.features.map((f: any) => f.kml_origem).sort(),
    ['doc-a.kml', 'nested/doc-b.kml']
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
  await stopProcess(server.pid);
}
