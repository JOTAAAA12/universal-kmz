import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

import {
  getCnefeIndexedUfStats,
  loadCnefeIndex,
  removeCnefeUf,
  resolveCnefeDir,
  type CnefeIndex,
  type CnefeIndexStats
} from './cnefeIndex';

export type CnefeDownloadPhase = 'baixando' | 'extraindo' | 'ingerindo' | 'pronto' | 'erro';
export type CnefeUfState = 'ausente' | 'baixando' | 'ingerindo' | 'pronto' | 'erro';

export interface CnefeStateInfo {
  cod: string;
  uf: string;
  nome: string;
  regiao: string;
  zip: string;
  estado: CnefeUfState;
  linhas?: number;
  tamanho_estimado?: string | null;
  progresso?: CnefeDownloadProgress;
}

export interface CnefeDownloadProgress {
  uf: string;
  baixados_bytes: number;
  total_bytes: number | null;
  fase: CnefeDownloadPhase;
  mensagem: string;
}

type FetchLike = typeof fetch;
type IndexLoader = typeof loadCnefeIndex;
type RemoveUf = typeof removeCnefeUf;

export const CNEFE_BASE_URL =
  'https://ftp.ibge.gov.br/Cadastro_Nacional_de_Enderecos_para_Fins_Estatisticos/Censo_Demografico_2022/Arquivos_CNEFE/CSV/UF/';

export const CNEFE_STATES = [
  ['11', 'RO', 'Rondonia', 'Norte'], ['12', 'AC', 'Acre', 'Norte'],
  ['13', 'AM', 'Amazonas', 'Norte'], ['14', 'RR', 'Roraima', 'Norte'],
  ['15', 'PA', 'Para', 'Norte'], ['16', 'AP', 'Amapa', 'Norte'],
  ['17', 'TO', 'Tocantins', 'Norte'], ['21', 'MA', 'Maranhao', 'Nordeste'],
  ['22', 'PI', 'Piaui', 'Nordeste'], ['23', 'CE', 'Ceara', 'Nordeste'],
  ['24', 'RN', 'Rio Grande do Norte', 'Nordeste'], ['25', 'PB', 'Paraiba', 'Nordeste'],
  ['26', 'PE', 'Pernambuco', 'Nordeste'], ['27', 'AL', 'Alagoas', 'Nordeste'],
  ['28', 'SE', 'Sergipe', 'Nordeste'], ['29', 'BA', 'Bahia', 'Nordeste'],
  ['31', 'MG', 'Minas Gerais', 'Sudeste'], ['32', 'ES', 'Espirito Santo', 'Sudeste'],
  ['33', 'RJ', 'Rio de Janeiro', 'Sudeste'], ['35', 'SP', 'Sao Paulo', 'Sudeste'],
  ['41', 'PR', 'Parana', 'Sul'], ['42', 'SC', 'Santa Catarina', 'Sul'],
  ['43', 'RS', 'Rio Grande do Sul', 'Sul'], ['50', 'MS', 'Mato Grosso do Sul', 'Centro-Oeste'],
  ['51', 'MT', 'Mato Grosso', 'Centro-Oeste'], ['52', 'GO', 'Goias', 'Centro-Oeste'],
  ['53', 'DF', 'Distrito Federal', 'Centro-Oeste']
].map(([cod, uf, nome, regiao]) => ({ cod, uf, nome, regiao, zip: `${cod}_${uf}.zip`, tamanho_estimado: uf === 'SP' ? '~1 GB zip' : null }));

function normalizeUf(value: string): string {
  return value.trim().toUpperCase();
}

function getStateByUf(uf: string) {
  return CNEFE_STATES.find(item => item.uf === normalizeUf(uf));
}

function parseTotalBytes(response: Response, resumeBytes: number): number | null {
  const range = response.headers.get('content-range');
  const rangeTotal = range?.match(/\/(\d+)$/)?.[1];
  if (rangeTotal) return Number(rangeTotal);
  const length = Number(response.headers.get('content-length') || 0);
  return length > 0 ? length + resumeBytes : null;
}

async function safeSize(filePath: string): Promise<number> {
  try {
    return (await stat(filePath)).size;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(entryPath);
      if (entry.isFile()) total += (await stat(entryPath)).size;
    }
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  return total;
}

export class CnefeDownloadManager {
  private readonly dir: string;
  private readonly fetchFn: FetchLike;
  private readonly loadIndex: IndexLoader;
  private readonly removeUf: RemoveUf;
  private readonly progress = new Map<string, CnefeDownloadProgress>();
  private readonly queue: string[] = [];
  private activeUf: string | null = null;
  private abortController: AbortController | null = null;
  private latestIndex: CnefeIndex | null = null;

  constructor(private readonly options: {
    dir?: string;
    fetchFn?: FetchLike;
    loadIndex?: IndexLoader;
    removeUf?: RemoveUf;
    onIndexReady?: (index: CnefeIndex) => void;
    onIndexProgress?: (stats: CnefeIndexStats) => void;
  } = {}) {
    this.dir = resolveCnefeDir(options.dir);
    this.fetchFn = options.fetchFn || fetch;
    this.loadIndex = options.loadIndex || loadCnefeIndex;
    this.removeUf = options.removeUf || removeCnefeUf;
  }

  async listStates(): Promise<CnefeStateInfo[]> {
    const rowsByUf = new Map((await getCnefeIndexedUfStats(this.dir)).map(item => [item.uf, item.rows]));
    return CNEFE_STATES.map(item => {
      const current = this.progress.get(item.uf);
      const rows = rowsByUf.get(item.uf) || 0;
      const estado = current && current.fase !== 'pronto'
        ? (current.fase === 'erro' ? 'erro' : current.fase === 'ingerindo' ? 'ingerindo' : 'baixando')
        : rows > 0 ? 'pronto' : 'ausente';
      return { ...item, estado, linhas: rows || undefined, progresso: current };
    });
  }

  async getState(ufInput: string): Promise<CnefeStateInfo | null> {
    const uf = normalizeUf(ufInput);
    return (await this.listStates()).find(item => item.uf === uf) || null;
  }

  async start(ufInput: string): Promise<CnefeDownloadProgress> {
    const state = getStateByUf(ufInput);
    if (!state) throw new Error('UF CNEFE desconhecida.');
    const current = await this.getState(state.uf);
    if (current?.estado === 'pronto') throw new Error('CNEFE desta UF ja esta pronto.');
    if (current?.estado === 'baixando' || current?.estado === 'ingerindo') {
      throw new Error('CNEFE desta UF ja esta em andamento.');
    }

    const progress = this.setProgress(state.uf, 'baixando', 0, null, this.activeUf ? 'Download na fila.' : 'Download iniciado.');
    this.queue.push(state.uf);
    void this.pump();
    return progress;
  }

  async cancel(ufInput: string): Promise<CnefeDownloadProgress | null> {
    const uf = normalizeUf(ufInput);
    if (!getStateByUf(uf)) throw new Error('UF CNEFE desconhecida.');
    const queuedIndex = this.queue.indexOf(uf);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      await rm(this.partPath(uf), { force: true });
      return this.setProgress(uf, 'erro', 0, null, 'Download cancelado.');
    }
    if (this.activeUf === uf) {
      this.abortController?.abort();
      return this.setProgress(uf, 'erro', 0, null, 'Download cancelado.');
    }
    return this.progress.get(uf) || null;
  }

  async remove(ufInput: string) {
    const uf = normalizeUf(ufInput);
    if (!getStateByUf(uf)) throw new Error('UF CNEFE desconhecida.');
    await this.cancel(uf);
    await rm(this.zipPath(uf), { force: true });
    const removed = await this.removeUf(uf, this.dir);
    this.progress.delete(uf);
    await this.reloadIndex();
    return removed;
  }

  async disk() {
    await mkdir(this.dir, { recursive: true });
    const fsStats = await statfs(this.dir);
    return {
      livre_bytes: Number(fsStats.bavail) * Number(fsStats.bsize),
      usado_cnefe_bytes: await dirSize(this.dir)
    };
  }

  private async pump() {
    if (this.activeUf) return;
    const next = this.queue.shift();
    if (!next) return;
    this.activeUf = next;
    this.abortController = new AbortController();
    try {
      await this.run(next, this.abortController.signal);
    } catch (error: any) {
      const message = error?.message || 'Falha no download CNEFE.';
      if (message.includes('cancelado')) await rm(this.partPath(next), { force: true });
      this.setProgress(next, 'erro', await safeSize(this.partPath(next)), null, message);
    } finally {
      this.activeUf = null;
      this.abortController = null;
      void this.pump();
    }
  }

  private async run(uf: string, signal: AbortSignal) {
    await mkdir(this.dir, { recursive: true });
    const state = getStateByUf(uf)!;
    const partPath = this.partPath(uf);
    const zipPath = this.zipPath(uf);
    const resumeBytes = await safeSize(partPath);
    const headers: HeadersInit = resumeBytes > 0 ? { Range: `bytes=${resumeBytes}-` } : {};
    const response = await this.fetchFn(`${CNEFE_BASE_URL}${state.zip}`, { headers, signal });
    if (!response.ok && response.status !== 206) throw new Error(`IBGE respondeu HTTP ${response.status}.`);
    const append = resumeBytes > 0 && response.status === 206;
    if (resumeBytes > 0 && !append) await rm(partPath, { force: true });
    const downloaded = append ? resumeBytes : 0;
    const total = parseTotalBytes(response, downloaded);
    await this.writeResponseBody(response, partPath, append, downloaded, total, uf, signal);
    await rm(zipPath, { force: true });
    await rename(partPath, zipPath);
    await this.extractCsv(uf, zipPath);
    await rm(zipPath, { force: true });
    this.setProgress(uf, 'ingerindo', total || downloaded, total, 'Ingerindo CSV no SQLite.');
    await this.reloadIndex(stats => {
      this.setProgress(uf, 'ingerindo', total || downloaded, total, `Ingerindo CSV no SQLite: ${stats.indexedRows} linhas.`);
    });
    this.setProgress(uf, 'pronto', total || downloaded, total, 'CNEFE pronto.');
  }

  private async writeResponseBody(
    response: Response,
    filePath: string,
    append: boolean,
    initialBytes: number,
    total: number | null,
    uf: string,
    signal: AbortSignal
  ) {
    const body = response.body;
    if (!body) throw new Error('Resposta sem corpo para download.');
    const writer = createWriteStream(filePath, { flags: append ? 'a' : 'w' });
    const reader = body.getReader();
    let downloaded = initialBytes;
    try {
      while (true) {
        if (signal.aborted) throw new Error('Download cancelado.');
        const { done, value } = await reader.read();
        if (done) break;
        downloaded += value.byteLength;
        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), err => err ? reject(err) : resolve());
        });
        this.setProgress(uf, 'baixando', downloaded, total, 'Baixando arquivo CNEFE.');
      }
    } finally {
      await new Promise<void>(resolve => writer.end(() => resolve()));
    }
  }

  private async extractCsv(uf: string, zipPath: string) {
    this.setProgress(uf, 'extraindo', await safeSize(zipPath), null, 'Extraindo CSV do ZIP.');
    const zip = await JSZip.loadAsync(await readFile(zipPath));
    const csvEntry = Object.values(zip.files).find(file => !file.dir && file.name.toLowerCase().endsWith('.csv'));
    if (!csvEntry) throw new Error('ZIP CNEFE sem CSV.');
    await writeFile(path.join(this.dir, `cnefe_${uf}.csv`), await csvEntry.async('nodebuffer'));
  }

  private async reloadIndex(onProgress = this.options.onIndexProgress) {
    const oldIndex = this.latestIndex as CnefeIndex & { close?: () => void } | null;
    const index = await this.loadIndex({ dir: this.dir, onProgress });
    if (!this.options.onIndexReady) oldIndex?.close?.();
    this.latestIndex = index;
    this.options.onIndexReady?.(index);
  }

  private setProgress(uf: string, fase: CnefeDownloadPhase, baixados: number, total: number | null, mensagem: string) {
    const snapshot = { uf, baixados_bytes: baixados, total_bytes: total, fase, mensagem };
    this.progress.set(uf, snapshot);
    return snapshot;
  }

  private partPath(uf: string) {
    return path.join(this.dir, `${getStateByUf(uf)!.zip}.part`);
  }

  private zipPath(uf: string) {
    return path.join(this.dir, getStateByUf(uf)!.zip);
  }
}
