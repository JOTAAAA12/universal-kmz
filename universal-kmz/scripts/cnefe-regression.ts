import assert from 'node:assert/strict';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getCnefeIndexedUfStats, loadCnefeIndex, removeCnefeUf, type CnefeIndex } from '../src/cnefeIndex';
import { createCnefeProvider } from '../src/providers/cnefe';

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
  assert.ok(nearest.length >= 2);
  assert.equal(nearest[0].record.logradouro, 'Rua das Flores');
  assert.equal(nearest[0].record.numero, '10');
  assert.equal(nearest[0].record.municipio, 'São Paulo');
  assert.equal(nearest[0].record.uf, 'SP');
  assert.equal(nearest[0].record.cep, '01001000');

  const cutoff = first.lookupNearest(-23.7, -46.8, 150);
  assert.deepEqual(cutoff, []);

  const campinas = first.lookupNearest(-22.90556, -47.06083);
  assert.ok(campinas.length > 0);
  assert.equal(campinas[0].record.municipio, 'Campinas');
  assert.equal(campinas[0].record.uf, 'SP');
  assert.equal(campinas[0].record.municipioResolvido, true);

  // Acerto exato, número presente e município resolvido: o logradouro divergente mais
  // próximo está a ~88 m, longe demais para disputar o ponto, logo segue CNEFE_ALTA.
  const exactAddress = await createCnefeProvider(first).reverse({ lat: -23.55052, lng: -46.63331 } as any);
  assert.equal((exactAddress as any).granularidade, 'CNEFE_ALTA');
  assert.equal((exactAddress as any).necessita_revisao, false);

  // Divergência real: dois logradouros disputando o mesmo ponto a distâncias equivalentes.
  const baseRecord = {
    lat: -23.55052,
    lng: -46.63331,
    numero: '10',
    bairro: 'Centro',
    municipio: 'São Paulo',
    uf: 'SP',
    cep: '01001000',
    municipioResolvido: true
  };
  const ambiguousAddress = await createCnefeProvider({
    stats: first.stats,
    lookupNearest: () => [
      { record: { ...baseRecord, logradouro: 'Rua das Flores' }, distanceMeters: 4 },
      { record: { ...baseRecord, logradouro: 'Avenida Doutor Brasil' }, distanceMeters: 9 }
    ]
  }).reverse({ lat: -23.55052, lng: -46.63331 } as any);
  assert.equal((ambiguousAddress as any).granularidade, 'CNEFE_MEDIA');
  assert.equal((ambiguousAddress as any).necessita_revisao, true);

  // Mesmo logradouro em vizinhos distintos não é divergência.
  const sameStreetAddress = await createCnefeProvider({
    stats: first.stats,
    lookupNearest: () => [
      { record: { ...baseRecord, logradouro: 'Rua das Flores' }, distanceMeters: 4 },
      { record: { ...baseRecord, logradouro: 'RUA  DAS FLORES', numero: '12' }, distanceMeters: 9 }
    ]
  }).reverse({ lat: -23.55052, lng: -46.63331 } as any);
  assert.equal((sameStreetAddress as any).granularidade, 'CNEFE_ALTA');
  assert.equal((sameStreetAddress as any).necessita_revisao, false);

  const semNumero = await createCnefeProvider({
    stats: first.stats,
    lookupNearest: () => [{
      record: {
        lat: -23.55052,
        lng: -46.63331,
        logradouro: 'Rua sem número',
        numero: 'SN',
        bairro: 'Centro',
        municipio: 'São Paulo',
        uf: 'SP',
        cep: '01001000',
        municipioResolvido: true
      },
      distanceMeters: 1
    }]
  }).reverse({ lat: -23.55052, lng: -46.63331 } as any);
  assert.equal((semNumero as any).granularidade, 'CNEFE_MEDIA');
  assert.equal((semNumero as any).necessita_revisao, true);

  const municipioNaoResolvido = await createCnefeProvider({
    stats: first.stats,
    lookupNearest: () => [{
      record: {
        lat: -23.55052,
        lng: -46.63331,
        logradouro: 'Rua sem município resolvido',
        numero: '10',
        bairro: 'Centro',
        municipio: '3550308',
        uf: 'SP',
        cep: '01001000',
        municipioResolvido: false
      },
      distanceMeters: 1
    }]
  }).reverse({ lat: -23.55052, lng: -46.63331 } as any);
  assert.equal((municipioNaoResolvido as any).granularidade, 'CNEFE_MEDIA');
  assert.equal((municipioNaoResolvido as any).necessita_revisao, true);
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

  const regraded = await loadCnefeIndex({ dir: tmp, maxRows: 100, cellDegrees: 0.01 });
  assert.equal(regraded.stats.indexedRows, 3);
  assert.ok(regraded.stats.messages.some(message => message.includes('células recalculadas')));
  const regradedNearest = regraded.lookupNearest(-23.55052, -46.63331);
  assert.ok(regradedNearest.length > 0);
  assert.equal(regradedNearest[0].record.logradouro, 'Rua das Flores');
  closeIndex(regraded);

  // Banco legado (anterior à persistência de cellDegrees): sem a chave de meta e com
  // células gravadas por outra grade. A migração precisa recalcular in loco, ser idempotente
  // e reproduzir exatamente Math.floor(coord / cellDegrees), inclusive em coordenadas negativas.
  const { DatabaseSync } = await import('node:sqlite');
  const legacyDb = new DatabaseSync(path.join(tmp, 'cnefe-index.sqlite'));
  legacyDb.exec("DELETE FROM meta WHERE chave = 'index:cellDegrees'");
  legacyDb.exec('UPDATE enderecos SET cell_lat = 0, cell_lng = 0');
  legacyDb.close();

  const migrated = await loadCnefeIndex({ dir: tmp, maxRows: 100, cellDegrees: 0.001 });
  assert.equal(migrated.stats.indexedRows, 3);
  assert.ok(migrated.stats.messages.some(message => message.includes('células recalculadas')));
  assert.equal(migrated.lookupNearest(-23.55052, -46.63331)[0]?.record.logradouro, 'Rua das Flores');
  assert.equal(migrated.lookupNearest(-22.90556, -47.06083)[0]?.record.municipio, 'Campinas');
  closeIndex(migrated);

  const cellsDb = new DatabaseSync(path.join(tmp, 'cnefe-index.sqlite'));
  const storedCells = cellsDb.prepare('SELECT lat, lng, cell_lat, cell_lng FROM enderecos').all() as Array<{
    lat: number; lng: number; cell_lat: number; cell_lng: number;
  }>;
  cellsDb.close();
  assert.equal(storedCells.length, 3);
  for (const cell of storedCells) {
    assert.equal(cell.cell_lat, Math.floor(cell.lat / 0.001), 'cell_lat recalculada deve usar piso, nao truncamento');
    assert.equal(cell.cell_lng, Math.floor(cell.lng / 0.001), 'cell_lng recalculada deve usar piso, nao truncamento');
  }

  const migratedAgain = await loadCnefeIndex({ dir: tmp, maxRows: 100, cellDegrees: 0.001 });
  assert.equal(migratedAgain.stats.indexedRows, 3, 'reabrir apos a migracao nao pode duplicar nem perder linhas');
  assert.equal(migratedAgain.stats.messages.some(message => message.includes('células recalculadas')), false);
  closeIndex(migratedAgain);

  // Test interrupted ingestion: simulate partial load without meta
  const interruptedCsvPath = path.join(tmp, 'cnefe_fixture_interrupted_SP.csv');
  const interruptedCsv = [
    'COD_UNICO_ENDERECO;TIPO_LOGRADOURO;NOME_LOGRADOURO;NUM_ENDERECO;DSC_LOCALIDADE;COD_MUNICIPIO;CEP;LATITUDE;LONGITUDE',
    '10;Rua;Flores;10;Centro;3550308;01001000;-23.550520;-46.633310',
    '11;Avenida;Brasil;200;Jardim;3550308;01002000;-23.551000;-46.634000'
  ].join('\n');
  await writeFile(interruptedCsvPath, interruptedCsv, 'utf8');

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

  const quotedDir = await mkdtemp(path.join(tmp, 'uf-column-'));
  const nonConventionalCsv = path.join(quotedDir, 'Sao_Paulo.csv');
  await writeFile(nonConventionalCsv, [
    '"COD_UNICO_ENDERECO";"TIPO_LOGRADOURO";"NOME_LOGRADOURO";"NUM_ENDERECO";"DSC_LOCALIDADE";"COD_MUNICIPIO";"CEP";"LATITUDE";"LONGITUDE"',
    '"40";"Rua";"São ""João"", Centro";"SN";"Bairro, Central";"3550308";"01001000";"-23,550520";"-46,633310"'
  ].join('\n'), 'utf8');

  const quotedIndex = await loadCnefeIndex({ dir: quotedDir, maxRows: 100 });
  const quotedNearest = quotedIndex.lookupNearest(-23.55052, -46.63331);
  assert.equal(quotedNearest.length, 1);
  assert.equal(quotedNearest[0].record.logradouro, 'Rua São "João", Centro');
  assert.equal(quotedNearest[0].record.numero, 'SN');
  assert.equal(quotedNearest[0].record.lat, -23.55052);
  assert.equal(quotedNearest[0].record.lng, -46.63331);
  closeIndex(quotedIndex);

  const ufStats = await getCnefeIndexedUfStats(quotedDir);
  assert.deepEqual(ufStats, [{ uf: 'SP', rows: 1, sources: [nonConventionalCsv] }]);
  const removedUf = await removeCnefeUf('SP', quotedDir);
  assert.deepEqual(removedUf, { uf: 'SP', removedFiles: 1, removedRows: 1 });
  assert.deepEqual(await getCnefeIndexedUfStats(quotedDir), []);
  await assert.rejects(access(nonConventionalCsv));
} finally {
  await new Promise(r => setTimeout(r, 200));
  try {
    await rm(tmp, { recursive: true, force: true });
  } catch (error: any) {
    // WAL files may still be locked; OS will clean up eventually
    if ((error?.code as string) !== 'EBUSY') throw error;
  }
}

process.stdout.write('cnefe regression passed\n');
