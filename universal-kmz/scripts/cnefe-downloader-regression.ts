import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';

import { CnefeDownloadManager } from '../src/cnefeDownloader';
import type { CnefeIndex } from '../src/cnefeIndex';

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

const tmp = await mkdtemp(path.join(tmpdir(), 'universal-kmz-cnefe-downloader-'));
let activeIndex: CnefeIndex | null = null;

try {
  const csv = [
    'COD_UNICO_ENDERECO;TIPO_LOGRADOURO;NOME_LOGRADOURO;NUM_ENDERECO;DSC_LOCALIDADE;COD_MUNICIPIO;CEP;LATITUDE;LONGITUDE',
    '1;Rua;das Flores;10;Centro;3550308;01001000;-23.550520;-46.633310',
    '2;Avenida;Doutor Brasil;200;Jardim;3509502;13013001;-22.905560;-47.060830'
  ].join('\n');
  const zip = new JSZip();
  zip.file('CNEFE_SP_fixture.csv', csv);
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const splitAt = Math.min(12, zipBuffer.length - 1);
  await writeFile(path.join(tmp, '35_SP.zip.part'), zipBuffer.subarray(0, splitAt));

  let sawRange = false;
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    const range = init?.headers instanceof Headers
      ? init.headers.get('range')
      : (init?.headers as Record<string, string> | undefined)?.Range || (init?.headers as Record<string, string> | undefined)?.range;
    if (range) {
      sawRange = true;
      const start = Number(range.match(/bytes=(\d+)-/)?.[1] || 0);
      return new Response(zipBuffer.subarray(start), {
        status: 206,
        headers: {
          'content-length': String(zipBuffer.length - start),
          'content-range': `bytes ${start}-${zipBuffer.length - 1}/${zipBuffer.length}`
        }
      });
    }
    return new Response(zipBuffer, {
      status: 200,
      headers: { 'content-length': String(zipBuffer.length) }
    });
  }) as typeof fetch;

  const manager = new CnefeDownloadManager({
    dir: tmp,
    fetchFn: fakeFetch,
    onIndexReady: index => {
      closeIndex(activeIndex);
      activeIndex = index;
    }
  });

  const initial = await manager.listStates();
  assert.equal(initial.length, 27);
  assert.equal(initial.find(item => item.uf === 'SP')?.estado, 'ausente');

  await manager.start('sp');
  await waitUntil(async () => (await manager.getState('SP'))?.estado === 'pronto', 'download SP pronto');
  assert.equal(sawRange, true);
  await stat(path.join(tmp, 'cnefe_SP.csv'));

  const ready = await manager.getState('SP');
  assert.equal(ready?.estado, 'pronto');
  assert.equal(ready?.linhas, 2);
  assert.ok(activeIndex?.lookupNearest(-23.55052, -46.63331));

  const duplicate = await manager.start('SP').then(
    () => null,
    error => error as Error
  );
  assert.ok(duplicate?.message.includes('ja esta pronto'));

  const removed = await manager.remove('SP');
  assert.equal(removed.removedFiles, 1);
  assert.equal(removed.removedRows, 2);
  const afterRemoval = await manager.getState('SP');
  assert.equal(afterRemoval?.estado, 'ausente');
  assert.equal(afterRemoval?.linhas, undefined);
} finally {
  closeIndex(activeIndex);
  await rm(tmp, { recursive: true, force: true });
}

console.log('cnefe downloader regression passed');
