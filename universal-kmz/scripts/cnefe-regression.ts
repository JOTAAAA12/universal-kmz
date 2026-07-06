import assert from 'node:assert/strict';
import { access, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { loadCnefeIndex, type CnefeIndex } from '../src/cnefeIndex';

function closeIndex(index: CnefeIndex) {
  (index as CnefeIndex & { close?: () => void }).close?.();
}

const tmp = await mkdtemp(path.join(tmpdir(), 'universal-kmz-cnefe-sqlite-'));

try {
  const csvPath = path.join(tmp, 'cnefe_fixture_SP.csv');
  const csv = [
    'COD_UNICO_ENDERECO;TIPO_LOGRADOURO;NOME_LOGRADOURO;NUM_ENDERECO;DSC_LOCALIDADE;COD_MUNICIPIO;CEP;LATITUDE;LONGITUDE',
    '1;Rua;das Flores;10;Centro;3550308;01001000;-23.550520;-46.633310',
    '2;Avenida;Doutor Brasil;200;Jardim;3550308;01002000;-23.551000;-46.634000',
    '3;Rua;Jose Paulino;1010;Centro;3509502;13013001;-22.905560;-47.060830'
  ].join('\n');
  await writeFile(csvPath, csv, 'utf8');

  let ingestProgressEvents = 0;
  const first = await loadCnefeIndex({
    dir: tmp,
    maxRows: 100,
    onProgress: stats => {
      if (stats.messages.some(message => message.includes('Atualizando índice CNEFE SQLite'))) {
        ingestProgressEvents++;
      }
    }
  });

  assert.equal(first.stats.files, 1);
  assert.equal(first.stats.indexedRows, 3);
  assert.equal(first.stats.skippedRows, 0);
  assert.equal(first.stats.partial, false);
  assert.ok(ingestProgressEvents > 0);
  await access(path.join(tmp, 'cnefe-index.sqlite'));

  const nearest = first.lookupNearest(-23.55052, -46.63331);
  assert.ok(nearest);
  assert.equal(nearest.record.logradouro, 'Rua das Flores');
  assert.equal(nearest.record.numero, '10');
  assert.equal(nearest.record.municipio, 'São Paulo');
  assert.equal(nearest.record.uf, 'SP');
  assert.equal(nearest.record.cep, '01001000');

  const cutoff = first.lookupNearest(-23.7, -46.8, 150);
  assert.equal(cutoff, null);

  const campinas = first.lookupNearest(-22.90556, -47.06083);
  assert.ok(campinas);
  assert.equal(campinas.record.municipio, 'Campinas');
  assert.equal(campinas.record.uf, 'SP');
  assert.equal(campinas.record.municipioResolvido, true);
  closeIndex(first);

  let reopenIngestEvents = 0;
  const reopened = await loadCnefeIndex({
    dir: tmp,
    maxRows: 100,
    onProgress: stats => {
      if (stats.messages.some(message => message.includes('Atualizando índice CNEFE SQLite'))) {
        reopenIngestEvents++;
      }
    }
  });
  assert.equal(reopened.stats.indexedRows, 3);
  assert.equal(reopenIngestEvents, 0);
  assert.ok(reopened.stats.messages.includes('Índice CNEFE SQLite reaberto sem reindexação.'));
  closeIndex(reopened);

  await unlink(csvPath);
  const afterRemoval = await loadCnefeIndex({ dir: tmp, maxRows: 100 });
  assert.equal(afterRemoval.stats.files, 0);
  assert.equal(afterRemoval.stats.indexedRows, 0);
  assert.ok(afterRemoval.stats.messages.includes('Nenhum CSV CNEFE carregado.'));
  closeIndex(afterRemoval);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

console.log('cnefe regression passed');
