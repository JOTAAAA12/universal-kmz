import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { CnefeDownloadManager } from '../src/cnefeDownloader';
import type { CnefeIndex } from '../src/cnefeIndex';

const ETAG_V1 = '"cnefe-fixture-v1"';
const ETAG_V2 = '"cnefe-fixture-v2"';
const LAST_MODIFIED = 'Wed, 01 Jan 2025 00:00:00 GMT';

function closeIndex(index: CnefeIndex | null) {
  (index as CnefeIndex & { close?: () => void } | null)?.close?.();
}

async function waitUntil(predicate: () => Promise<boolean>, label: string) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timeout aguardando ${label}.`);
}

function getRequestHeader(init: RequestInit | undefined, name: string) {
  const headers = init?.headers;
  if (!headers) return null;
  return new Headers(headers).get(name);
}

function zipResponse(zipBuffer: Buffer, status: 200 | 206, etag: string, start = 0) {
  const body = status === 206 ? zipBuffer.subarray(start) : zipBuffer;
  return new Response(body, {
    status,
    headers: {
      'content-length': String(body.length),
      ...(status === 206 ? { 'content-range': `bytes ${start}-${zipBuffer.length - 1}/${zipBuffer.length}` } : {}),
      etag,
      'last-modified': LAST_MODIFIED
    }
  });
}

async function expectMissing(filePath: string) {
  const exists = await stat(filePath).then(
    () => true,
    error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  );
  assert.equal(exists, false, `${filePath} deve ser removido.`);
}

async function buildZip(files: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const tmp = await mkdtemp(path.join(tmpdir(), 'universal-kmz-cnefe-downloader-'));
let activeIndex: CnefeIndex | null = null;

try {
  const header = 'COD_UNICO_ENDERECO;TIPO_LOGRADOURO;NOME_LOGRADOURO;NUM_ENDERECO;DSC_LOCALIDADE;COD_MUNICIPIO;CEP;LATITUDE;LONGITUDE';
  const zipBuffer = await buildZip({
    'CNEFE_SP_parte_1.csv': [header, '1;Rua;das Flores;10;Centro;3550308;01001000;-23.550520;-46.633310'].join('\n'),
    'CNEFE_SP_parte_2.csv': [header, '2;Avenida;Doutor Brasil;200;Jardim;3509502;13013001;-22.905560;-47.060830'].join('\n')
  });

  const resumeDir = path.join(tmp, 'resume');
  const resumePart = path.join(resumeDir, '35_SP.zip.part');
  await mkdir(resumeDir, { recursive: true });
  await writeFile(resumePart, zipBuffer.subarray(0, Math.min(12, zipBuffer.length - 1)));
  await writeFile(`${resumePart}.meta.json`, JSON.stringify({ etag: ETAG_V1, lastModified: LAST_MODIFIED }));
  let sawRange = false;
  let sawIfRange = false;
  const resumeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'HEAD') return zipResponse(zipBuffer, 200, ETAG_V1);
    const range = getRequestHeader(init, 'range');
    if (range) {
      sawRange = true;
      sawIfRange = getRequestHeader(init, 'if-range') === ETAG_V1;
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] || 0);
      return zipResponse(zipBuffer, 206, ETAG_V1, start);
    }
    return zipResponse(zipBuffer, 200, ETAG_V1);
  }) as typeof fetch;
  const resumeManager = new CnefeDownloadManager({
    dir: resumeDir,
    fetchFn: resumeFetch,
    onIndexReady: index => {
      closeIndex(activeIndex);
      activeIndex = index;
    }
  });

  await resumeManager.start('sp');
  await waitUntil(async () => (await resumeManager.getState('SP'))?.estado === 'pronto', 'resume SP pronto');
  assert.equal(sawRange, true);
  assert.equal(sawIfRange, true);
  assert.equal((await resumeManager.getState('SP'))?.linhas, 2);
  await stat(path.join(resumeDir, 'cnefe_SP.csv'));

  const stale200Dir = path.join(tmp, 'stale-200');
  const stale200Part = path.join(stale200Dir, '35_SP.zip.part');
  await mkdir(stale200Dir, { recursive: true });
  await writeFile(stale200Part, Buffer.from('prefixo-obsoleto'));
  await writeFile(`${stale200Part}.meta.json`, JSON.stringify({ etag: ETAG_V1, lastModified: LAST_MODIFIED }));
  let stale200RangeRequests = 0;
  const stale200Fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'HEAD') return zipResponse(zipBuffer, 200, ETAG_V2);
    if (getRequestHeader(init, 'range')) stale200RangeRequests += 1;
    return zipResponse(zipBuffer, 200, ETAG_V2);
  }) as typeof fetch;
  const stale200Manager = new CnefeDownloadManager({
    dir: stale200Dir,
    fetchFn: stale200Fetch,
    onIndexReady: index => {
      closeIndex(activeIndex);
      activeIndex = index;
    }
  });

  await stale200Manager.start('SP');
  await waitUntil(async () => (await stale200Manager.getState('SP'))?.estado === 'pronto', 'reinício após resposta 200');
  assert.equal(stale200RangeRequests, 1);
  await stat(path.join(stale200Dir, 'cnefe_SP.csv'));

  const divergentMetaDir = path.join(tmp, 'meta-divergente');
  const divergentMetaPart = path.join(divergentMetaDir, '35_SP.zip.part');
  await mkdir(divergentMetaDir, { recursive: true });
  await writeFile(divergentMetaPart, zipBuffer.subarray(0, Math.min(12, zipBuffer.length - 1)));
  await writeFile(`${divergentMetaPart}.meta.json`, JSON.stringify({ etag: ETAG_V1, lastModified: LAST_MODIFIED }));
  let divergentRangeRequests = 0;
  let divergentFreshRequests = 0;
  const divergentMetaFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'HEAD') return zipResponse(zipBuffer, 200, ETAG_V2);
    const range = getRequestHeader(init, 'range');
    if (range) {
      divergentRangeRequests += 1;
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] || 0);
      return zipResponse(zipBuffer, 206, ETAG_V2, start);
    }
    divergentFreshRequests += 1;
    return zipResponse(zipBuffer, 200, ETAG_V2);
  }) as typeof fetch;
  const divergentMetaManager = new CnefeDownloadManager({
    dir: divergentMetaDir,
    fetchFn: divergentMetaFetch,
    onIndexReady: index => {
      closeIndex(activeIndex);
      activeIndex = index;
    }
  });

  await divergentMetaManager.start('SP');
  await waitUntil(async () => (await divergentMetaManager.getState('SP'))?.estado === 'pronto', 'reinício após metadados divergentes');
  assert.equal(divergentRangeRequests, 1);
  assert.equal(divergentFreshRequests, 1);

  const invalidZip = await buildZip({ 'leia-me.txt': 'sem CSV' });
  const extractionFailureDir = path.join(tmp, 'falha-extracao');
  const extractionFailureFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'HEAD') return zipResponse(invalidZip, 200, ETAG_V1);
    return zipResponse(invalidZip, 200, ETAG_V1);
  }) as typeof fetch;
  const extractionFailureManager = new CnefeDownloadManager({
    dir: extractionFailureDir,
    fetchFn: extractionFailureFetch
  });

  await extractionFailureManager.start('SP');
  await waitUntil(async () => (await extractionFailureManager.getState('SP'))?.estado === 'erro', 'falha de extração');
  await expectMissing(path.join(extractionFailureDir, '35_SP.zip'));
  await expectMissing(path.join(extractionFailureDir, '35_SP.zip.part'));
  await expectMissing(path.join(extractionFailureDir, '35_SP.zip.part.meta.json'));
} finally {
  closeIndex(activeIndex);
  await rm(tmp, { recursive: true, force: true });
}

console.log('cnefe downloader regression passed');
