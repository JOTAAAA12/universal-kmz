import { createReadStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

import municipiosIbge from './data/municipios-ibge.json';
import { getDistanceMeters } from './kmlParser';

export interface CnefeAddressRecord {
  id: string;
  lat: number;
  lng: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  municipioResolvido: boolean;
}

export interface CnefeNearestMatch {
  record: CnefeAddressRecord;
  distanceMeters: number;
}

export interface CnefeIndexStats {
  dir: string;
  files: number;
  indexedRows: number;
  skippedRows: number;
  partial: boolean;
  maxRows: number;
  messages: string[];
}

export interface CnefeIndex {
  stats: CnefeIndexStats;
  lookupNearest(lat: number, lng: number, maxDistanceMeters?: number): CnefeNearestMatch[];
}

export interface CnefeIndexOptions {
  dir?: string;
  maxRows?: number;
  cellDegrees?: number;
  onProgress?: (stats: CnefeIndexStats) => void;
}

type ColumnMap = Record<keyof Omit<CnefeAddressRecord, 'lat' | 'lng' | 'logradouro' | 'municipioResolvido'> | 'lat' | 'lng' | 'tipo' | 'titulo' | 'nome' | 'codMunicipio', number>;
type MunicipioIbgeEntry = { nome: string; uf: string };
type FileMeta = { path: string; size: number; mtimeMs: number; rows: number; skippedRows: number; partial: boolean; maxRows: number };
type CsvFile = { path: string; name: string; size: number; mtimeMs: number };

const DEFAULT_DIR = './dados/cnefe';
const DEFAULT_MAX_ROWS = Number.MAX_SAFE_INTEGER;
const DEFAULT_CELL_DEGREES = 0.001;
const DEFAULT_MAX_DISTANCE_METERS = 150;
const MAX_NEAREST_MATCHES = 5;
const INGEST_BATCH_ROWS = 50000;
const SQLITE_FILE_NAME = 'cnefe-index.sqlite';
const META_CELL_DEGREES = 'index:cellDegrees';
const META_ROW_COUNT = 'index:rowCount';
const UF_BY_CODE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
};
const MUNICIPIOS_IBGE = municipiosIbge as Record<string, MunicipioIbgeEntry>;

export function resolveCnefeDir(dir?: string): string {
  return path.resolve(process.cwd(), dir || process.env.CNEFE_DIR || DEFAULT_DIR);
}

function parsePositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function pickColumn(headers: string[], alternatives: string[]): number {
  const normalizedAlternatives = alternatives.map(normalizeHeader);
  const normalizedHeaders = headers.map(normalizeHeader);
  for (const alternative of normalizedAlternatives) {
    const exact = normalizedHeaders.indexOf(alternative);
    if (exact >= 0) return exact;
  }
  for (const alternative of normalizedAlternatives) {
    const partial = normalizedHeaders.findIndex(header => header.includes(alternative) || alternative.includes(header));
    if (partial >= 0) return partial;
  }
  return -1;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const output: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      output.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  output.push(current.trim());
  return output.map(value => value.replace(/^"|"$/g, '').trim());
}

function detectDelimiter(header: string): string {
  return (header.match(/;/g) || []).length >= (header.match(/,/g) || []).length ? ';' : ',';
}

function parseNumber(value: string): number {
  const normalized = value.replace(',', '.').trim();
  return Number(normalized);
}

function compact(parts: string[]): string {
  return parts.map(part => part.trim()).filter(Boolean).join(' ');
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function cellCoordinate(value: number, cellDegrees: number): number {
  return Math.floor(value / cellDegrees);
}

function deriveUfFromFile(fileName: string): string {
  const upper = fileName.toUpperCase();
  const match = upper.match(/(?:^|[^A-Z])([A-Z]{2})(?:[^A-Z]|$)/);
  return match?.[1] || '';
}

function matchesUfSource(source: string, uf: string): boolean {
  return deriveUfFromFile(path.basename(source)) === uf.toUpperCase();
}

function buildColumnMap(headers: string[]): ColumnMap {
  return {
    id: pickColumn(headers, ['COD_UNICO_ENDERECO', 'codigo', 'cod_endereco']),
    tipo: pickColumn(headers, ['tipo_logradouro', 'tipo_seglogr', 'tipo']),
    titulo: pickColumn(headers, ['titulo_logradouro', 'titulo_seglogr', 'titulo']),
    nome: pickColumn(headers, ['nome_logradouro', 'nom_seglogr', 'logradouro']),
    numero: pickColumn(headers, ['NUM_ENDERECO', 'numero', 'num']),
    bairro: pickColumn(headers, ['DSC_LOCALIDADE', 'localidade', 'bairro']),
    municipio: pickColumn(headers, ['NOM_MUNICIPIO', 'nome_municipio', 'municipio', 'cidade']),
    codMunicipio: pickColumn(headers, ['COD_MUNICIPIO', 'codigo_municipio', 'cod_mun']),
    uf: pickColumn(headers, ['UF', 'COD_UF', 'sigla_uf']),
    cep: pickColumn(headers, ['CEP', 'cod_cep']),
    lat: pickColumn(headers, ['LATITUDE', 'lat']),
    lng: pickColumn(headers, ['LONGITUDE', 'lng', 'lon']),
  };
}

function valueAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] || '').trim() : '';
}

function resolveMunicipio(
  municipioRaw: string,
  codMunicipioRaw: string,
  ufRaw: string,
  fallbackUf: string
): { municipio: string; uf: string; municipioResolvido: boolean } {
  const municipioCode = onlyDigits(codMunicipioRaw) || (/^\d{7}$/.test(municipioRaw.trim()) ? municipioRaw.trim() : '');
  const municipioEntry = municipioCode ? MUNICIPIOS_IBGE[municipioCode] : undefined;
  const uf = municipioEntry?.uf || UF_BY_CODE[ufRaw] || ufRaw.toUpperCase() || fallbackUf;

  if (municipioEntry) {
    return {
      municipio: municipioEntry.nome,
      uf,
      municipioResolvido: true
    };
  }

  if (municipioCode && (!municipioRaw || municipioRaw.trim() === municipioCode)) {
    return {
      municipio: municipioCode,
      uf,
      municipioResolvido: false
    };
  }

  return {
    municipio: municipioRaw,
    uf,
    municipioResolvido: Boolean(municipioRaw)
  };
}

function mapRow(row: string[], columns: ColumnMap, fallbackUf: string): CnefeAddressRecord | null {
  const lat = parseNumber(valueAt(row, columns.lat));
  const lng = parseNumber(valueAt(row, columns.lng));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const ufRaw = valueAt(row, columns.uf);
  const resolvedMunicipio = resolveMunicipio(
    valueAt(row, columns.municipio),
    valueAt(row, columns.codMunicipio),
    ufRaw,
    fallbackUf
  );
  const logradouro = compact([
    valueAt(row, columns.tipo),
    valueAt(row, columns.titulo),
    valueAt(row, columns.nome)
  ]);

  return {
    id: valueAt(row, columns.id),
    lat,
    lng,
    logradouro,
    numero: valueAt(row, columns.numero),
    bairro: valueAt(row, columns.bairro),
    municipio: resolvedMunicipio.municipio,
    uf: resolvedMunicipio.uf,
    cep: onlyDigits(valueAt(row, columns.cep)),
    municipioResolvido: resolvedMunicipio.municipioResolvido
  };
}

function notifyProgress(stats: CnefeIndexStats, onProgress?: (stats: CnefeIndexStats) => void) {
  onProgress?.({ ...stats, messages: [...stats.messages] });
}

async function listCsvFiles(dir: string, messages: string[]): Promise<CsvFile[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const csvNames = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
      .map(entry => entry.name)
      .sort((a, b) => a.localeCompare(b));
    const gzipCount = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.csv.gz')).length;
    if (gzipCount > 0) {
      messages.push(`${gzipCount} arquivo(s) .csv.gz ignorado(s); descompacte antes de indexar.`);
    }
    const files: CsvFile[] = [];
    for (const name of csvNames) {
      const filePath = path.join(dir, name);
      const info = await stat(filePath);
      files.push({ path: filePath, name, size: info.size, mtimeMs: Math.trunc(info.mtimeMs) });
    }
    return files;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      messages.push(`Diretório CNEFE não encontrado: ${dir}`);
      return [];
    }
    throw error;
  }
}

function initDatabase(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS enderecos (
      source TEXT NOT NULL,
      source_row INTEGER NOT NULL,
      id TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      logradouro TEXT NOT NULL,
      numero TEXT NOT NULL,
      bairro TEXT NOT NULL,
      municipio TEXT NOT NULL,
      uf TEXT NOT NULL,
      cep TEXT NOT NULL,
      municipio_resolvido INTEGER NOT NULL,
      cell_lat INTEGER NOT NULL,
      cell_lng INTEGER NOT NULL
    );
    DROP INDEX IF EXISTS idx_enderecos_cell;
    CREATE INDEX IF NOT EXISTS idx_enderecos_cell_range ON enderecos(cell_lat, cell_lng, lat, lng);
    CREATE INDEX IF NOT EXISTS idx_enderecos_source ON enderecos(source);
    CREATE INDEX IF NOT EXISTS idx_enderecos_uf ON enderecos(uf);
  `);
}

function metaKey(source: string): string {
  return `source:${source}`;
}

function readFileMeta(db: DatabaseSync): Map<string, FileMeta> {
  const rows = db.prepare('SELECT chave, valor FROM meta WHERE chave LIKE ?').all('source:%') as Array<{ chave: string; valor: string }>;
  const output = new Map<string, FileMeta>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.valor) as FileMeta;
      if (parsed.path) output.set(parsed.path, parsed);
    } catch {
      db.prepare('DELETE FROM meta WHERE chave = ?').run(row.chave);
    }
  }
  return output;
}

function writeFileMeta(db: DatabaseSync, meta: FileMeta) {
  db.prepare('INSERT OR REPLACE INTO meta(chave, valor) VALUES (?, ?)').run(metaKey(meta.path), JSON.stringify(meta));
}

function deleteFileMeta(db: DatabaseSync, source: string) {
  db.prepare('DELETE FROM meta WHERE chave = ?').run(metaKey(source));
}

function readMetaValue(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT valor FROM meta WHERE chave = ?').get(key) as { valor?: string } | undefined;
  return typeof row?.valor === 'string' ? row.valor : null;
}

function writeMetaValue(db: DatabaseSync, key: string, value: string) {
  db.prepare('INSERT OR REPLACE INTO meta(chave, valor) VALUES (?, ?)').run(key, value);
}

function countRows(db: DatabaseSync): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM enderecos').get() as { total: number };
  return Number(row.total || 0);
}

function readCachedRowCount(db: DatabaseSync): number | null {
  const raw = readMetaValue(db, META_ROW_COUNT);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readIndexedRowCount(db: DatabaseSync): number {
  const cached = readCachedRowCount(db);
  if (cached !== null) return cached;
  const counted = countRows(db);
  writeMetaValue(db, META_ROW_COUNT, String(counted));
  return counted;
}

function writeIndexedRowCount(db: DatabaseSync, rows: number) {
  writeMetaValue(db, META_ROW_COUNT, String(Math.max(0, rows)));
}

function ensureCellDegrees(db: DatabaseSync, cellDegrees: number, messages: string[]): boolean {
  const persisted = Number(readMetaValue(db, META_CELL_DEGREES));
  if (persisted === cellDegrees) return false;

  const hasRows = Boolean(db.prepare('SELECT 1 FROM enderecos LIMIT 1').get());
  if (!hasRows) {
    writeMetaValue(db, META_CELL_DEGREES, String(cellDegrees));
    return false;
  }

  // Bancos anteriores à persistência de cellDegrees não têm a chave no meta, mas foram
  // construídos com a mesma grade. Amostrar evita recalcular 22,9M linhas sem necessidade —
  // o UPDATE é síncrono (node:sqlite) e travaria o processo por minutos.
  const sample = db.prepare('SELECT lat, lng, cell_lat, cell_lng FROM enderecos LIMIT 50').all() as
    { lat: number; lng: number; cell_lat: number; cell_lng: number }[];
  const gradeConsistente = sample.every(row =>
    cellCoordinate(Number(row.lat), cellDegrees) === Number(row.cell_lat) &&
    cellCoordinate(Number(row.lng), cellDegrees) === Number(row.cell_lng));
  if (gradeConsistente) {
    writeMetaValue(db, META_CELL_DEGREES, String(cellDegrees));
    return false;
  }

  // ponytail: recálculo síncrono bloqueia o boot em bases grandes; só ocorre quando a grade
  // realmente mudou. Se isso virar rotina, fatiar em lotes com yield entre eles.
  const recalculateCells = db.prepare(`
    UPDATE enderecos
    SET
      cell_lat = CAST(lat / ? AS INTEGER) - CASE WHEN lat / ? < CAST(lat / ? AS INTEGER) THEN 1 ELSE 0 END,
      cell_lng = CAST(lng / ? AS INTEGER) - CASE WHEN lng / ? < CAST(lng / ? AS INTEGER) THEN 1 ELSE 0 END
  `);
  db.exec('BEGIN TRANSACTION;');
  try {
    recalculateCells.run(cellDegrees, cellDegrees, cellDegrees, cellDegrees, cellDegrees, cellDegrees);
    writeMetaValue(db, META_CELL_DEGREES, String(cellDegrees));
    db.exec('COMMIT;');
  } catch (error) {
    db.exec('ROLLBACK;');
    throw error;
  }
  messages.push('Grade CNEFE incompatível detectada; células recalculadas sem reingerir CSV.');
  return true;
}

function sumSkippedRows(metas: Iterable<FileMeta>): number {
  let total = 0;
  for (const meta of metas) total += meta.skippedRows || 0;
  return total;
}

function isFresh(file: CsvFile, meta: FileMeta | undefined, maxRows: number): boolean {
  return Boolean(meta
    && meta.size === file.size
    && meta.mtimeMs === file.mtimeMs
    && maxRows >= meta.rows
    && (!meta.partial || meta.maxRows === maxRows));
}

function rowToRecord(row: any): CnefeAddressRecord {
  return {
    id: String(row.id || ''),
    lat: Number(row.lat),
    lng: Number(row.lng),
    logradouro: String(row.logradouro || ''),
    numero: String(row.numero || ''),
    bairro: String(row.bairro || ''),
    municipio: String(row.municipio || ''),
    uf: String(row.uf || ''),
    cep: String(row.cep || ''),
    municipioResolvido: Boolean(row.municipio_resolvido)
  };
}

class SqliteCnefeIndex implements CnefeIndex {
  readonly stats: CnefeIndexStats;
  private readonly selectWithinCells = this.db.prepare(`
    SELECT id, lat, lng, logradouro, numero, bairro, municipio, uf, cep, municipio_resolvido
    FROM enderecos
    WHERE cell_lat BETWEEN ? AND ?
      AND cell_lng BETWEEN ? AND ?
  `);

  constructor(stats: CnefeIndexStats, private readonly db: DatabaseSync, private readonly cellDegrees: number) {
    this.stats = stats;
  }

  close() {
    this.db.close();
  }

  lookupNearest(lat: number, lng: number, maxDistanceMeters = DEFAULT_MAX_DISTANCE_METERS): CnefeNearestMatch[] {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    const latCell = cellCoordinate(lat, this.cellDegrees);
    const lngCell = cellCoordinate(lng, this.cellDegrees);
    const metersPerCell = Math.max(1, this.cellDegrees * 111320);
    const radiusCells = Math.ceil(maxDistanceMeters / metersPerCell) + 1;
    const matches: CnefeNearestMatch[] = [];

    for (const row of this.selectWithinCells.iterate(
      latCell - radiusCells,
      latCell + radiusCells,
      lngCell - radiusCells,
      lngCell + radiusCells
    ) as Iterable<any>) {
      const record = rowToRecord(row);
      const distanceMeters = getDistanceMeters({ lat, lng }, { lat: record.lat, lng: record.lng });
      if (distanceMeters <= maxDistanceMeters) {
        const match = { record, distanceMeters };
        const position = matches.findIndex(candidate => distanceMeters < candidate.distanceMeters);
        if (position < 0) {
          matches.push(match);
        } else {
          matches.splice(position, 0, match);
        }
        if (matches.length > MAX_NEAREST_MATCHES) {
          matches.pop();
        }
      }
    }
    return matches;
  }
}

async function ingestFile(
  db: DatabaseSync,
  file: CsvFile,
  stats: CnefeIndexStats,
  cellDegrees: number,
  maxRows: number,
  onProgress?: (stats: CnefeIndexStats) => void
): Promise<FileMeta> {
  const insert = db.prepare(`
    INSERT INTO enderecos (
      source, source_row, id, lat, lng, logradouro, numero, bairro, municipio, uf, cep,
      municipio_resolvido, cell_lat, cell_lng
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const stream = createReadStream(file.path, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let delimiter = ';';
  let columns: ColumnMap | null = null;
  let sourceRow = 0;
  let rows = 0;
  let skippedRows = 0;
  let batchRows = 0;
  let transactionOpen = false;
  const fallbackUf = deriveUfFromFile(file.name);

  const begin = () => {
    if (!transactionOpen) {
      db.exec('PRAGMA synchronous = OFF; BEGIN TRANSACTION;');
      transactionOpen = true;
    }
  };
  const commit = () => {
    if (transactionOpen) {
      db.exec('COMMIT; PRAGMA synchronous = NORMAL;');
      transactionOpen = false;
      batchRows = 0;
    }
  };

  try {
    begin();
    // Clean up any orphaned rows from previous interrupted ingestion
    const removedRows = Number(db.prepare('DELETE FROM enderecos WHERE source = ?').run(file.path).changes || 0);
    stats.indexedRows = Math.max(0, stats.indexedRows - removedRows);
    for await (const line of reader) {
      if (!line.trim()) continue;
      if (!columns) {
        delimiter = detectDelimiter(line);
        columns = buildColumnMap(parseCsvLine(line.replace(/^\uFEFF/, ''), delimiter));
        if (columns.lat < 0 || columns.lng < 0) {
          stats.messages.push(`Arquivo ignorado sem latitude/longitude reconhecida: ${file.name}`);
          commit();
          notifyProgress(stats, onProgress);
          const ignoredFileMeta = { path: file.path, size: file.size, mtimeMs: file.mtimeMs, rows: 0, skippedRows: 0, partial: false, maxRows };
          writeFileMeta(db, ignoredFileMeta);
          return ignoredFileMeta;
        }
        continue;
      }
      if (stats.indexedRows >= maxRows) {
        stats.partial = true;
        stats.messages.push(`Índice CNEFE parcial: limite CNEFE_MAX_ROWS=${maxRows} atingido.`);
        break;
      }
      sourceRow++;
      const record = mapRow(parseCsvLine(line, delimiter), columns, fallbackUf);
      if (record) {
        insert.run(
          file.path,
          sourceRow,
          record.id,
          record.lat,
          record.lng,
          record.logradouro,
          record.numero,
          record.bairro,
          record.municipio,
          record.uf,
          record.cep,
          record.municipioResolvido ? 1 : 0,
          cellCoordinate(record.lat, cellDegrees),
          cellCoordinate(record.lng, cellDegrees)
        );
        rows++;
        batchRows++;
        stats.indexedRows++;
      } else {
        skippedRows++;
        stats.skippedRows++;
      }
      if (batchRows >= INGEST_BATCH_ROWS) {
        commit();
        notifyProgress(stats, onProgress);
        begin();
      } else if ((rows + skippedRows) % 10000 === 0) {
        notifyProgress(stats, onProgress);
      }
    }
    commit();
  } catch (error) {
    if (transactionOpen) db.exec('ROLLBACK; PRAGMA synchronous = NORMAL;');
    throw error;
  }

  const fileMeta = { path: file.path, size: file.size, mtimeMs: file.mtimeMs, rows, skippedRows, partial: stats.partial, maxRows };
  writeFileMeta(db, fileMeta);
  notifyProgress(stats, onProgress);
  return fileMeta;
}

function reconcileRemovedAndChangedSources(
  db: DatabaseSync,
  files: CsvFile[],
  storedMeta: Map<string, FileMeta>,
  maxRows: number
): { filesToIngest: CsvFile[]; removedRows: number } {
  const currentPaths = new Set(files.map(file => file.path));
  const changedOrMissingSources = new Set<string>();
  const filesToIngest: CsvFile[] = [];

  for (const [source, meta] of storedMeta) {
    if (!currentPaths.has(source)) {
      changedOrMissingSources.add(source);
    } else {
      const file = files.find(candidate => candidate.path === source);
      if (file && !isFresh(file, meta, maxRows)) changedOrMissingSources.add(source);
    }
  }

  const deleteRows = db.prepare('DELETE FROM enderecos WHERE source = ?');
  let removedRows = 0;
  for (const source of changedOrMissingSources) {
    removedRows += Number(deleteRows.run(source).changes || 0);
    deleteFileMeta(db, source);
    storedMeta.delete(source);
  }

  for (const file of files) {
    if (!isFresh(file, storedMeta.get(file.path), maxRows)) {
      filesToIngest.push(file);
    }
  }
  return { filesToIngest, removedRows };
}

function hasOrphanedRowsForUntrackedSources(db: DatabaseSync, filesToIngest: CsvFile[], storedMeta: Map<string, FileMeta>): boolean {
  const findRowsForSource = db.prepare('SELECT 1 FROM enderecos WHERE source = ? LIMIT 1');
  return filesToIngest.some(file => !storedMeta.has(file.path) && Boolean(findRowsForSource.get(file.path)));
}

export async function loadCnefeIndex(options: CnefeIndexOptions = {}): Promise<CnefeIndex> {
  const dir = resolveCnefeDir(options.dir);
  const maxRows = parsePositiveInt(options.maxRows ?? process.env.CNEFE_MAX_ROWS, DEFAULT_MAX_ROWS);
  const cellDegrees = Number.isFinite(options.cellDegrees) && (options.cellDegrees as number) > 0
    ? options.cellDegrees as number
    : DEFAULT_CELL_DEGREES;
  const stats: CnefeIndexStats = {
    dir,
    files: 0,
    indexedRows: 0,
    skippedRows: 0,
    partial: false,
    maxRows,
    messages: []
  };
  notifyProgress(stats, options.onProgress);

  await mkdir(dir, { recursive: true });
  const files = await listCsvFiles(dir, stats.messages);
  stats.files = files.length;
  const dbPath = path.join(dir, SQLITE_FILE_NAME);
  const db = new DatabaseSync(dbPath);
  initDatabase(db);

  const storedMeta = readFileMeta(db);
  const indexedRowsBeforeReconciliation = readIndexedRowCount(db);
  const reconciliation = reconcileRemovedAndChangedSources(db, files, storedMeta, maxRows);
  const filesToIngest = reconciliation.filesToIngest;
  const recalculatedCells = ensureCellDegrees(db, cellDegrees, stats.messages);
  stats.indexedRows = Math.max(0, indexedRowsBeforeReconciliation - reconciliation.removedRows);
  if (hasOrphanedRowsForUntrackedSources(db, filesToIngest, storedMeta)) {
    stats.indexedRows = countRows(db);
  }
  writeIndexedRowCount(db, stats.indexedRows);
  stats.skippedRows = sumSkippedRows(readFileMeta(db).values());
  stats.partial = [...readFileMeta(db).values()].some(meta => meta.partial);
  notifyProgress(stats, options.onProgress);

  if (filesToIngest.length > 0) {
    stats.messages.push(`Atualizando índice CNEFE SQLite: ${filesToIngest.length} arquivo(s) novo(s) ou alterado(s).`);
  }
  for (const file of filesToIngest) {
    if (stats.partial || stats.indexedRows >= maxRows) {
      stats.partial = true;
      break;
    }
    const meta = await ingestFile(db, file, stats, cellDegrees, maxRows, options.onProgress);
    storedMeta.set(file.path, meta);
  }

  if (files.length === 0) {
    stats.messages.push('Nenhum CSV CNEFE carregado.');
  } else if (filesToIngest.length === 0 && stats.indexedRows > 0 && !recalculatedCells) {
    stats.messages.push('Índice CNEFE SQLite reaberto sem reindexação.');
  }
  writeIndexedRowCount(db, stats.indexedRows);
  const finalMeta = readFileMeta(db);
  stats.skippedRows = sumSkippedRows(finalMeta.values());
  stats.partial = [...finalMeta.values()].some(meta => meta.partial);
  notifyProgress(stats, options.onProgress);

  return new SqliteCnefeIndex(stats, db, cellDegrees);
}

export interface CnefeIndexedUfStats {
  uf: string;
  rows: number;
  sources: string[];
}

export async function getCnefeIndexedUfStats(dirInput?: string): Promise<CnefeIndexedUfStats[]> {
  const dir = resolveCnefeDir(dirInput);
  const dbPath = path.join(dir, SQLITE_FILE_NAME);
  try {
    await stat(dbPath);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const db = new DatabaseSync(dbPath);
  try {
    initDatabase(db);
    const rowsByUf = db.prepare(`
      SELECT uf, COUNT(*) AS rows
      FROM enderecos
      WHERE TRIM(uf) <> ''
      GROUP BY uf
      ORDER BY uf
    `).all() as Array<{ uf: string; rows: number }>;
    const sourcesByUf = new Map<string, string[]>();
    const sourceRows = db.prepare(`
      SELECT uf, source
      FROM enderecos
      WHERE TRIM(uf) <> ''
      GROUP BY uf, source
      ORDER BY uf, source
    `).all() as Array<{ uf: string; source: string }>;
    for (const row of sourceRows) {
      const sources = sourcesByUf.get(row.uf) || [];
      sources.push(row.source);
      sourcesByUf.set(row.uf, sources);
    }
    return rowsByUf.map(row => ({
      uf: row.uf,
      rows: Number(row.rows || 0),
      sources: sourcesByUf.get(row.uf) || []
    }));
  } finally {
    db.close();
  }
}

export async function removeCnefeUf(ufInput: string, dirInput?: string): Promise<{ uf: string; removedFiles: number; removedRows: number }> {
  const uf = ufInput.trim().toUpperCase();
  const dir = resolveCnefeDir(dirInput);
  await mkdir(dir, { recursive: true });
  const dbPath = path.join(dir, SQLITE_FILE_NAME);
  const files = await listCsvFiles(dir, []);
  const db = new DatabaseSync(dbPath);
  let removedRows = 0;
  const sourcesToDelete = new Set<string>();

  try {
    initDatabase(db);
    const storedMeta = readFileMeta(db);
    const targetRowsBySource = db.prepare(`
      SELECT source, COUNT(*) AS rows
      FROM enderecos
      WHERE uf = ?
      GROUP BY source
    `).all(uf) as Array<{ source: string; rows: number }>;
    const hasOtherUfInSource = db.prepare(`
      SELECT 1
      FROM enderecos
      WHERE source = ? AND TRIM(uf) <> '' AND uf <> ?
      LIMIT 1
    `);
    const hasKnownUfInSource = db.prepare(`
      SELECT 1
      FROM enderecos
      WHERE source = ? AND TRIM(uf) <> ''
      LIMIT 1
    `);

    for (const row of targetRowsBySource) {
      if (!hasOtherUfInSource.get(row.source, uf)) {
        sourcesToDelete.add(row.source);
      }
    }

    for (const [source] of storedMeta) {
      if (matchesUfSource(source, uf) && !hasKnownUfInSource.get(source)) {
        sourcesToDelete.add(source);
      }
    }
    for (const file of files) {
      if (matchesUfSource(file.path, uf) && !hasKnownUfInSource.get(file.path)) {
        sourcesToDelete.add(file.path);
      }
    }

    const cachedRows = readCachedRowCount(db);
    const deleteRowsByUf = db.prepare('DELETE FROM enderecos WHERE uf = ?');
    const deleteRowsBySource = db.prepare('DELETE FROM enderecos WHERE source = ?');
    db.exec('BEGIN TRANSACTION;');
    try {
      removedRows += Number(deleteRowsByUf.run(uf).changes || 0);
      for (const source of sourcesToDelete) {
        removedRows += Number(deleteRowsBySource.run(source).changes || 0);
        deleteFileMeta(db, source);
      }
      for (const row of targetRowsBySource) {
        if (sourcesToDelete.has(row.source)) continue;
        const meta = storedMeta.get(row.source);
        if (meta) {
          writeFileMeta(db, { ...meta, rows: Math.max(0, meta.rows - Number(row.rows || 0)) });
        }
      }
      if (cachedRows === null) {
        writeIndexedRowCount(db, countRows(db));
      } else {
        writeIndexedRowCount(db, cachedRows - removedRows);
      }
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    db.close();
  }

  let removedFiles = 0;
  for (const source of sourcesToDelete) {
    try {
      await unlink(source);
      removedFiles++;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { uf, removedFiles, removedRows };
}
