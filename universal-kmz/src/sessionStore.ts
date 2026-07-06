import * as fs from 'node:fs/promises';
import path from 'node:path';

const MAX_SESSION_BYTES = 100 * 1024 * 1024;
const SAFE_ID = /^[a-z0-9-]+$/;

export interface SessionSummary {
  id: string;
  nome: string;
  criado_em: string;
  tamanho_bytes: number;
}

export interface SavedSession {
  id: string;
  nome: string;
  criado_em: string;
  payload: unknown;
}

function baseDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(path.resolve((env.GEOCODE_CACHE_DIR || './dados').trim() || './dados'), 'sessoes');
}

function slugify(value: string): string {
  const slug = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug || 'sessao';
}

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id) || id.includes('..')) {
    throw new Error('ID de sessao invalido.');
  }
}

function sessionPath(id: string, env?: NodeJS.ProcessEnv): string {
  assertSafeId(id);
  return path.join(baseDir(env), `${id}.json`);
}

async function ensureDir(env?: NodeJS.ProcessEnv): Promise<void> {
  await fs.mkdir(baseDir(env), { recursive: true });
}

async function atomicWriteJson(filePath: string, body: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, body, 'utf8');
  await fs.rename(tmpPath, filePath);
}

export async function createSession(
  input: { nome?: unknown; payload?: unknown },
  env?: NodeJS.ProcessEnv
): Promise<SessionSummary> {
  const nome = typeof input?.nome === 'string' && input.nome.trim() ? input.nome.trim() : 'Sessao';
  const criado_em = new Date().toISOString();
  const timestamp = criado_em.replace(/[^0-9]/g, '');
  const id = `${slugify(nome)}-${timestamp}`;
  const payload = input?.payload;
  const body = `${JSON.stringify({ id, nome, criado_em, payload }, null, 2)}\n`;
  const tamanho_bytes = Buffer.byteLength(body, 'utf8');
  if (tamanho_bytes > MAX_SESSION_BYTES) {
    throw new Error('Sessao excede limite de 100 MB.');
  }
  await ensureDir(env);
  await atomicWriteJson(sessionPath(id, env), body);
  return { id, nome, criado_em, tamanho_bytes };
}

export async function listSessions(env?: NodeJS.ProcessEnv): Promise<SessionSummary[]> {
  await ensureDir(env);
  const entries = await fs.readdir(baseDir(env), { withFileTypes: true });
  const sessions: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const id = entry.name.slice(0, -5);
    if (!SAFE_ID.test(id)) continue;
    const filePath = sessionPath(id, env);
    const [raw, stat] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)]);
    const parsed = JSON.parse(raw) as SavedSession;
    sessions.push({
      id,
      nome: typeof parsed.nome === 'string' ? parsed.nome : id,
      criado_em: typeof parsed.criado_em === 'string' ? parsed.criado_em : stat.mtime.toISOString(),
      tamanho_bytes: stat.size
    });
  }
  return sessions.sort((a, b) => b.criado_em.localeCompare(a.criado_em));
}

export async function getSession(id: string, env?: NodeJS.ProcessEnv): Promise<SavedSession | null> {
  const filePath = sessionPath(id, env);
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as SavedSession;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function deleteSession(id: string, env?: NodeJS.ProcessEnv): Promise<boolean> {
  const filePath = sessionPath(id, env);
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

