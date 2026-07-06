import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import municipiosIbge from './data/municipios-ibge.json';

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
  lookupNearest(lat: number, lng: number, maxDistanceMeters?: number): CnefeNearestMatch | null;
}

interface CnefeIndexOptions {
  dir?: string;
  maxRows?: number;
  cellDegrees?: number;
  onProgress?: (stats: CnefeIndexStats) => void;
}

type ColumnMap = Record<keyof Omit<CnefeAddressRecord, 'lat' | 'lng' | 'logradouro' | 'municipioResolvido'> | 'lat' | 'lng' | 'tipo' | 'titulo' | 'nome' | 'codMunicipio', number>;
type MunicipioIbgeEntry = { nome: string; uf: string };

const DEFAULT_DIR = './dados/cnefe';
const DEFAULT_MAX_ROWS = 3000000;
const DEFAULT_CELL_DEGREES = 0.001;
const DEFAULT_MAX_DISTANCE_METERS = 150;
const UF_BY_CODE: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
};
const MUNICIPIOS_IBGE = municipiosIbge as Record<string, MunicipioIbgeEntry>;

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

function cellKey(lat: number, lng: number, cellDegrees: number): string {
  return `${Math.round(lat / cellDegrees)}:${Math.round(lng / cellDegrees)}`;
}

function haversineMeters(latA: number, lngA: number, latB: number, lngB: number): number {
  const toRad = (value: number) => value * Math.PI / 180;
  const earthRadius = 6371000;
  const dLat = toRad(latB - latA);
  const dLng = toRad(lngB - lngA);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function deriveUfFromFile(fileName: string): string {
  const upper = fileName.toUpperCase();
  const match = upper.match(/(?:^|[^A-Z])([A-Z]{2})(?:[^A-Z]|$)/);
  return match?.[1] || '';
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

class GridCnefeIndex implements CnefeIndex {
  readonly stats: CnefeIndexStats;
  private readonly grid = new Map<string, CnefeAddressRecord[]>();

  constructor(stats: CnefeIndexStats, private readonly cellDegrees: number) {
    this.stats = stats;
  }

  add(record: CnefeAddressRecord) {
    const key = cellKey(record.lat, record.lng, this.cellDegrees);
    const bucket = this.grid.get(key) || [];
    bucket.push(record);
    this.grid.set(key, bucket);
    this.stats.indexedRows++;
  }

  lookupNearest(lat: number, lng: number, maxDistanceMeters = DEFAULT_MAX_DISTANCE_METERS): CnefeNearestMatch | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const latCell = Math.round(lat / this.cellDegrees);
    const lngCell = Math.round(lng / this.cellDegrees);
    const radiusCells = Math.ceil(maxDistanceMeters / 111) + 1;
    let best: CnefeNearestMatch | null = null;

    for (let dLat = -radiusCells; dLat <= radiusCells; dLat++) {
      for (let dLng = -radiusCells; dLng <= radiusCells; dLng++) {
        const bucket = this.grid.get(`${latCell + dLat}:${lngCell + dLng}`) || [];
        for (const record of bucket) {
          const distanceMeters = haversineMeters(lat, lng, record.lat, record.lng);
          if (distanceMeters <= maxDistanceMeters && (!best || distanceMeters < best.distanceMeters)) {
            best = { record, distanceMeters };
          }
        }
      }
    }
    return best;
  }
}

async function listCsvFiles(dir: string, messages: string[]): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const files = entries
      .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.csv'))
      .map(entry => path.join(dir, entry.name))
      .sort((a, b) => a.localeCompare(b));
    const gzipCount = entries.filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.csv.gz')).length;
    if (gzipCount > 0) {
      messages.push(`${gzipCount} arquivo(s) .csv.gz ignorado(s); descompacte antes de indexar.`);
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

function notifyProgress(stats: CnefeIndexStats, onProgress?: (stats: CnefeIndexStats) => void) {
  onProgress?.(stats);
}

async function loadFile(
  filePath: string,
  index: GridCnefeIndex,
  maxRows: number,
  onProgress?: (stats: CnefeIndexStats) => void
): Promise<void> {
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  let delimiter = ';';
  let columns: ColumnMap | null = null;
  const fallbackUf = deriveUfFromFile(path.basename(filePath));

  for await (const line of reader) {
    if (!line.trim()) continue;
    if (!columns) {
      delimiter = detectDelimiter(line);
      columns = buildColumnMap(parseCsvLine(line.replace(/^\uFEFF/, ''), delimiter));
      if (columns.lat < 0 || columns.lng < 0) {
        index.stats.messages.push(`Arquivo ignorado sem latitude/longitude reconhecida: ${path.basename(filePath)}`);
        notifyProgress(index.stats, onProgress);
        return;
      }
      continue;
    }
    if (index.stats.indexedRows >= maxRows) {
      index.stats.partial = true;
      index.stats.messages.push(`Índice CNEFE parcial: limite CNEFE_MAX_ROWS=${maxRows} atingido.`);
      notifyProgress(index.stats, onProgress);
      return;
    }
    const record = mapRow(parseCsvLine(line, delimiter), columns, fallbackUf);
    if (record) {
      index.add(record);
    } else {
      index.stats.skippedRows++;
    }
    const processedRows = index.stats.indexedRows + index.stats.skippedRows;
    if (processedRows % 10000 === 0) {
      notifyProgress(index.stats, onProgress);
    }
  }
  notifyProgress(index.stats, onProgress);
}

export async function loadCnefeIndex(options: CnefeIndexOptions = {}): Promise<CnefeIndex> {
  const dir = path.resolve(process.cwd(), options.dir || process.env.CNEFE_DIR || DEFAULT_DIR);
  const maxRows = parsePositiveInt(options.maxRows ?? process.env.CNEFE_MAX_ROWS, DEFAULT_MAX_ROWS);
  const stats: CnefeIndexStats = {
    dir,
    files: 0,
    indexedRows: 0,
    skippedRows: 0,
    partial: false,
    maxRows,
    messages: []
  };
  const index = new GridCnefeIndex(stats, options.cellDegrees || DEFAULT_CELL_DEGREES);
  notifyProgress(stats, options.onProgress);
  const files = await listCsvFiles(dir, stats.messages);
  stats.files = files.length;
  notifyProgress(stats, options.onProgress);

  for (const file of files) {
    if (stats.partial) break;
    await loadFile(file, index, maxRows, options.onProgress);
    notifyProgress(stats, options.onProgress);
  }

  if (stats.indexedRows === 0 && files.length === 0) {
    stats.messages.push('Nenhum CSV CNEFE carregado.');
  }
  notifyProgress(stats, options.onProgress);
  return index;
}
