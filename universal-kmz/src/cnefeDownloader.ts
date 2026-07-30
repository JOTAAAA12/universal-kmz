import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
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

interface CnefePartMeta {
  etag?: string;
  lastModified?: string;
}

interface DownloadRequest {
  response: Response;
  signal: AbortSignal;
  timedOut: () => boolean;
  refreshTimeout: () => void;
  stopTimeout: () => void;
}

const INACTIVITY_TIMEOUT_MS = 60_000;

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

function getPartMeta(response: Response): CnefePartMeta {
  const etag = response.headers.get('etag');
  const lastModified = response.headers.get('last-modified');
  return {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {})
  };
}

function getResumeValidator(meta: CnefePartMeta | null): string | null {
  if (!meta) return null;
  if (meta.etag && !meta.etag.startsWith('W/')) return meta.etag;
  return meta.lastModified || null;
}

function matchesPartMeta(saved: CnefePartMeta, received: CnefePartMeta): boolean {
  const comparable = [
    saved.etag && received.etag ? saved.etag === received.etag : null,
    saved.lastModified && received.lastModified ? saved.lastModified === received.lastModified : null
  ].filter((value): value is boolean => value !== null);
  return comparable.length > 0 && comparable.every(Boolean);
}

function formatBytes(bytes: number): string {
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(bytes / (1024 ** 3))} GB`;
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
      await this.removePartial(uf);
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
    await this.removePartial(uf);
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

  private async request(url: string, init: RequestInit, signal: AbortSignal): Promise<DownloadRequest> {
    const timeoutController = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const refreshTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => timeoutController.abort(), INACTIVITY_TIMEOUT_MS);
    };
    const stopTimeout = () => {
      if (timeout) clearTimeout(timeout);
      timeout = null;
    };
    const requestSignal = AbortSignal.any([signal, timeoutController.signal]);
    refreshTimeout();
    try {
      const response = await this.fetchFn(url, { ...init, signal: requestSignal });
      return {
        response,
        signal: requestSignal,
        timedOut: () => timeoutController.signal.aborted,
        refreshTimeout,
        stopTimeout
      };
    } catch (error) {
      stopTimeout();
      if (timeoutController.signal.aborted) throw new Error('Download interrompido por inatividade (60 s sem dados).');
      if (signal.aborted) throw new Error('Download cancelado.');
      throw error;
    }
  }

  private ensureRequestActive(request: DownloadRequest) {
    if (request.timedOut()) throw new Error('Download interrompido por inatividade (60 s sem dados).');
    if (request.signal.aborted) throw new Error('Download cancelado.');
  }

  private async preflight(url: string, signal: AbortSignal): Promise<number | null> {
    const disk = await this.disk();
    let request: DownloadRequest | null = null;
    try {
      request = await this.request(url, { method: 'HEAD' }, signal);
      if (!request.response.ok) return null;
      const total = parseTotalBytes(request.response, 0);
      if (total !== null && disk.livre_bytes < total * 2.5) {
        throw new Error(
          `Espaço em disco insuficiente: são necessários ao menos ${formatBytes(total * 2.5)} livres para baixar um ZIP de ${formatBytes(total)}, mas há ${formatBytes(disk.livre_bytes)} disponíveis.`
        );
      }
      return total;
    } finally {
      request?.stopTimeout();
    }
  }

  private async readPartMeta(filePath: string): Promise<CnefePartMeta | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object') return null;
      const candidate = parsed as CnefePartMeta;
      const meta = {
        ...(typeof candidate.etag === 'string' ? { etag: candidate.etag } : {}),
        ...(typeof candidate.lastModified === 'string' ? { lastModified: candidate.lastModified } : {})
      };
      return getResumeValidator(meta) ? meta : null;
    } catch (error: any) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  private async writePartMeta(filePath: string, meta: CnefePartMeta) {
    if (!getResumeValidator(meta)) {
      await rm(filePath, { force: true });
      return;
    }
    await writeFile(filePath, JSON.stringify(meta));
  }

  private async removePartial(uf: string) {
    await Promise.all([
      rm(this.partPath(uf), { force: true }),
      rm(this.partMetaPath(uf), { force: true })
    ]);
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
      if (message.includes('cancelado')) await this.removePartial(next);
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
    const partMetaPath = this.partMetaPath(uf);
    const zipPath = this.zipPath(uf);
    const url = `${CNEFE_BASE_URL}${state.zip}`;
    let preservePart = false;
    try {
      const estimatedTotal = await this.preflight(url, signal);
      let resumeBytes = await safeSize(partPath);
      let savedMeta = await this.readPartMeta(partMetaPath);
      const validator = getResumeValidator(savedMeta);
      if (resumeBytes > 0 && !validator) {
        await this.removePartial(uf);
        resumeBytes = 0;
        savedMeta = null;
      }

      const resumeHeaders: HeadersInit = resumeBytes > 0
        ? { Range: `bytes=${resumeBytes}-`, 'If-Range': validator! }
        : {};
      let request = await this.request(url, { headers: resumeHeaders }, signal);
      let append = false;
      if (resumeBytes > 0 && request.response.status === 206 && savedMeta && matchesPartMeta(savedMeta, getPartMeta(request.response))) {
        append = true;
      } else if (resumeBytes > 0 && request.response.status === 206) {
        try {
          await request.response.body?.cancel();
        } finally {
          request.stopTimeout();
        }
        await this.removePartial(uf);
        resumeBytes = 0;
        savedMeta = null;
        request = await this.request(url, {}, signal);
      } else if (resumeBytes > 0 && request.response.status === 200) {
        await this.removePartial(uf);
        resumeBytes = 0;
        savedMeta = null;
      }

      if (!request.response.ok) {
        request.stopTimeout();
        throw new Error(`IBGE respondeu HTTP ${request.response.status}.`);
      }
      if (!append && request.response.status !== 200) {
        request.stopTimeout();
        throw new Error(`IBGE respondeu HTTP ${request.response.status} para um download sem prefixo válido.`);
      }

      const downloaded = append ? resumeBytes : 0;
      const total = parseTotalBytes(request.response, downloaded) ?? estimatedTotal;
      if (total === null) {
        request.stopTimeout();
        throw new Error('IBGE não informou o tamanho do arquivo; não é seguro concluir o download.');
      }
      const responseMeta = getPartMeta(request.response);
      await this.writePartMeta(partMetaPath, responseMeta);
      const canResume = Boolean(getResumeValidator(responseMeta));
      let written: number;
      try {
        written = await this.writeResponseBody(request, partPath, append, downloaded, total, uf);
      } catch (error) {
        preservePart = canResume && (await safeSize(partPath)) > 0;
        throw error;
      }
      if (written !== total) {
        preservePart = canResume && written < total;
        throw new Error(`Download incompleto: recebidos ${written} de ${total} bytes.`);
      }

      await rm(zipPath, { force: true });
      await rename(partPath, zipPath);
      await rm(partMetaPath, { force: true });
      preservePart = false;
      await this.extractCsv(uf, zipPath);
      this.setProgress(uf, 'ingerindo', total, total, 'Ingerindo CSV no SQLite.');
      await this.reloadIndex(stats => {
        this.setProgress(uf, 'ingerindo', total, total, `Ingerindo CSV no SQLite: ${stats.indexedRows} linhas.`);
      });
      this.setProgress(uf, 'pronto', total, total, 'CNEFE pronto.');
    } finally {
      await rm(zipPath, { force: true });
      if (!preservePart) await this.removePartial(uf);
    }
  }

  private async writeResponseBody(
    request: DownloadRequest,
    filePath: string,
    append: boolean,
    initialBytes: number,
    total: number | null,
    uf: string
  ): Promise<number> {
    const body = request.response.body;
    if (!body) throw new Error('Resposta sem corpo para download.');
    const writer = createWriteStream(filePath, { flags: append ? 'a' : 'w' });
    const reader = body.getReader();
    let downloaded = initialBytes;
    try {
      while (true) {
        this.ensureRequestActive(request);
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch (error) {
          this.ensureRequestActive(request);
          throw error;
        }
        const { done, value } = chunk;
        if (done) break;
        downloaded += value.byteLength;
        await new Promise<void>((resolve, reject) => {
          writer.write(Buffer.from(value), err => err ? reject(err) : resolve());
        });
        request.refreshTimeout();
        this.setProgress(uf, 'baixando', downloaded, total, 'Baixando arquivo CNEFE.');
      }
      this.ensureRequestActive(request);
      return downloaded;
    } finally {
      request.stopTimeout();
      await new Promise<void>((resolve, reject) => {
        writer.once('error', reject);
        writer.end(() => resolve());
      });
    }
  }

  private async extractCsv(uf: string, zipPath: string) {
    this.setProgress(uf, 'extraindo', await safeSize(zipPath), null, 'Extraindo CSV do ZIP.');
    const zip = await JSZip.loadAsync(await readFile(zipPath));
    const csvEntries = Object.values(zip.files).filter(file => !file.dir && file.name.toLowerCase().endsWith('.csv'));
    if (csvEntries.length === 0) throw new Error('ZIP CNEFE sem CSV.');
    const csvPath = path.join(this.dir, `cnefe_${uf}.csv`);
    for (const [index, csvEntry] of csvEntries.entries()) {
      if (index > 0) await writeFile(csvPath, '\n', { flag: 'a' });
      await pipeline(
        csvEntry.nodeStream('nodebuffer'),
        createWriteStream(csvPath, { flags: index === 0 ? 'w' : 'a' })
      );
    }
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

  private partMetaPath(uf: string) {
    return `${this.partPath(uf)}.meta.json`;
  }

  private zipPath(uf: string) {
    return path.join(this.dir, getStateByUf(uf)!.zip);
  }
}
