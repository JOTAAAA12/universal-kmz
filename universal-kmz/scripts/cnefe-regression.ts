import assert from 'node:assert/strict';
import { access, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import v8 from 'node:v8';

import { loadCnefeIndex, type CnefeIndex } from '../src/cnefeIndex';

function closeIndex(index: CnefeIndex) {
  const idx = index as CnefeIndex & { close?: () => void; db?: any };
  if (idx.db) {
    try {
      idx.db.exec('PRAGMA checkpoint(RESTART)');
    } catch {}
  }
  idx.close?.();
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

  // Test interrupted ingestion: simulate partial load without meta
  const interruptedCsvPath = path.join(tmp, 'cnefe_fixture_interrupted_SP.csv');
  const interruptedCsv = [
    'COD_UNICO_ENDERECO;TIPO_LOGRADOURO;NOME_LOGRADOURO;NUM_ENDERECO;DSC_LOCALIDADE;COD_MUNICIPIO;CEP;LATITUDE;LONGITUDE',
    '10;Rua;Flores;10;Centro;3550308;01001000;-23.550520;-46.633310',
    '11;Avenida;Brasil;200;Jardim;3550308;01002000;-23.551000;-46.634000'
  ].join('\n');
  await writeFile(interruptedCsvPath, interruptedCsv, 'utf8');

  const { DatabaseSync } = await import('node:sqlite');
  const dbPath = path.join(tmp, 'cnefe-index.sqlite');
  {
    const dbForInterrupt = new DatabaseSync(dbPath);
    const insertStmt = dbForInterrupt.prepare(`
      INSERT INTO enderecos (
        source, source_row, id, lat, lng, logradouro, numero, bairro, municipio, uf, cep,
        municipio_resolvido, cell_lat, cell_lng
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    // Simulate interrupted ingestion: insert rows without writing FileMeta
    insertStmt.run(
      interruptedCsvPath, 1, '10', -23.550520, -46.633310, 'Rua Flores', '10', 'Centro',
      'São Paulo', 'SP', '01001000', 1, -23550, -46633
    );
    insertStmt.run(
      interruptedCsvPath, 2, '11', -23.551000, -46.634000, 'Avenida Brasil', '200', 'Jardim',
      'São Paulo', 'SP', '01002000', 1, -23551, -46634
    );
    dbForInterrupt.close();
  }

  // Reload index: should not duplicate orphaned rows
  const afterInterrupted = await loadCnefeIndex({ dir: tmp, maxRows: 100 });
  assert.equal(afterInterrupted.stats.indexedRows, 5, 'Should have 3 (original) + 2 (interrupted), not 3 + 2 + 2');
  assert.equal(afterInterrupted.stats.files, 2);
  closeIndex(afterInterrupted);
} finally {
  await new Promise(r => setTimeout(r, 200));
  try {
    await rm(tmp, { recursive: true, force: true });
  } catch (error: any) {
    // WAL files may still be locked; OS will clean up eventually
    if ((error?.code as string) !== 'EBUSY') throw error;
  }
}

console.log('cnefe regression passed');
