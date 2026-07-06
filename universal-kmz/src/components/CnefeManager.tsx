import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Database, Download, HardDrive, Loader2, RefreshCw, Trash2, XCircle } from 'lucide-react';

type CnefeEstadoStatus = 'ausente' | 'baixando' | 'ingerindo' | 'pronto' | 'erro';

interface CnefeProgress {
  uf: string;
  baixados_bytes?: number;
  total_bytes?: number;
  fase?: 'baixando' | 'extraindo' | 'ingerindo' | 'pronto' | 'erro';
  mensagem?: string;
}

interface CnefeEstado {
  cod: string;
  uf: string;
  nome: string;
  estado: CnefeEstadoStatus;
  linhas?: number;
  tamanho_estimado?: number | string | null;
  progresso?: CnefeProgress;
}

interface CnefeDisco {
  livre_bytes?: number;
  usado_cnefe_bytes?: number;
}

const REGIOES: Array<{ nome: string; ufs: string[] }> = [
  { nome: 'Norte', ufs: ['AC', 'AP', 'AM', 'PA', 'RO', 'RR', 'TO'] },
  { nome: 'Nordeste', ufs: ['AL', 'BA', 'CE', 'MA', 'PB', 'PE', 'PI', 'RN', 'SE'] },
  { nome: 'Centro-Oeste', ufs: ['DF', 'GO', 'MT', 'MS'] },
  { nome: 'Sudeste', ufs: ['ES', 'MG', 'RJ', 'SP'] },
  { nome: 'Sul', ufs: ['PR', 'RS', 'SC'] },
];

function formatBytes(value?: number | null): string {
  if (!Number.isFinite(value || 0) || !value) return 'indisponível';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  return `${amount.toLocaleString('pt-BR', { maximumFractionDigits: unitIndex === 0 ? 0 : 1 })} ${units[unitIndex]}`;
}

function formatRows(value?: number): string {
  if (!Number.isFinite(value || 0) || !value) return 'sem linhas indexadas';
  return `${value.toLocaleString('pt-BR')} linhas`;
}

function getPercent(progress?: CnefeProgress): number {
  if (!progress?.total_bytes || !progress.baixados_bytes) return 0;
  return Math.max(0, Math.min(100, Math.round((progress.baixados_bytes / progress.total_bytes) * 100)));
}

function getStatusLabel(item: CnefeEstado): string {
  if (item.estado === 'pronto') return 'Pronto';
  if (item.estado === 'baixando') return 'Baixando';
  if (item.estado === 'ingerindo') return 'Ingerindo';
  if (item.estado === 'erro') return 'Erro';
  return 'Ausente';
}

function getStatusClass(status: CnefeEstadoStatus): string {
  if (status === 'pronto') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'erro') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'baixando' || status === 'ingerindo') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : 'Falha ao executar operação CNEFE.';
    throw new Error(message);
  }
  return payload as T;
}

export default function CnefeManager() {
  const [estados, setEstados] = useState<CnefeEstado[]>([]);
  const [disco, setDisco] = useState<CnefeDisco>({});
  const [loading, setLoading] = useState(false);
  const [busyUf, setBusyUf] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const hasActiveDownload = estados.some(item => item.estado === 'baixando' || item.estado === 'ingerindo');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [estadosResponse, discoResponse] = await Promise.all([
        fetch('/api/cnefe/estados'),
        fetch('/api/cnefe/disco'),
      ]);
      const estadosPayload = await readJson<CnefeEstado[]>(estadosResponse);
      const discoPayload = await readJson<CnefeDisco>(discoResponse);
      setEstados(Array.isArray(estadosPayload) ? estadosPayload : []);
      setDisco(discoPayload || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao carregar estados CNEFE.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!hasActiveDownload) return undefined;
    const timer = window.setInterval(() => void load(true), 2500);
    return () => window.clearInterval(timer);
  }, [hasActiveDownload, load]);

  const groupedEstados = useMemo(() => {
    const byUf = new Map(estados.map(item => [item.uf.toUpperCase(), item]));
    return REGIOES.map(region => ({
      ...region,
      estados: region.ufs.map(uf => byUf.get(uf)).filter((item): item is CnefeEstado => Boolean(item)),
    })).filter(region => region.estados.length > 0);
  }, [estados]);

  const runAction = async (uf: string, action: 'download' | 'cancelar' | 'remove') => {
    const item = estados.find(estado => estado.uf === uf);
    if (!item) return;
    if (action === 'download') {
      const confirmed = window.confirm(`Baixar o CNEFE de ${item.nome} (${uf})? Estados grandes ocupam vários GB em disco; SP pode passar de 1 GB compactado e vários GB indexado.`);
      if (!confirmed) return;
    }
    if (action === 'remove') {
      const confirmed = window.confirm(`Remover o CSV e as linhas indexadas do CNEFE de ${item.nome} (${uf})?`);
      if (!confirmed) return;
    }

    setBusyUf(uf);
    setError('');
    setToast('');
    try {
      const path = action === 'download'
        ? `/api/cnefe/estados/${uf}/download`
        : action === 'cancelar'
          ? `/api/cnefe/estados/${uf}/cancelar`
          : `/api/cnefe/estados/${uf}`;
      const response = await fetch(path, { method: action === 'remove' ? 'DELETE' : 'POST' });
      await readJson<Record<string, unknown>>(response);
      setToast(action === 'download' ? `Download de ${uf} enfileirado.` : action === 'cancelar' ? `Download de ${uf} cancelado.` : `Base de ${uf} removida.`);
      await load(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao executar operação CNEFE.');
    } finally {
      setBusyUf('');
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Arquivos CNEFE podem ser grandes. Estados maiores ocupam vários GB entre download, extração e índice local.</p>
          </div>
        </div>
        <div className="rounded border border-slate-300 bg-white p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <HardDrive className="h-3.5 w-3.5" />
            Livre em disco
          </div>
          <div className="mt-1 text-sm font-bold text-slate-800">{formatBytes(disco.livre_bytes)}</div>
        </div>
        <div className="rounded border border-slate-300 bg-white p-3">
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Database className="h-3.5 w-3.5" />
            CNEFE local
          </div>
          <div className="mt-1 text-sm font-bold text-slate-800">{formatBytes(disco.usado_cnefe_bytes)}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800">Base de Endereços CNEFE</h3>
          <p className="text-xs text-slate-500">Baixe, acompanhe a ingestão e remova bases estaduais do índice local.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-bold uppercase text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar
        </button>
      </div>

      {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}
      {toast && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{toast}</div>}

      <div className="space-y-4">
        {groupedEstados.map(region => (
          <section key={region.nome} className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{region.nome}</h4>
            <div className="grid gap-2 md:grid-cols-2">
              {region.estados.map(item => {
                const progress = item.progresso;
                const percent = getPercent(progress);
                const busy = busyUf === item.uf;
                const active = item.estado === 'baixando' || item.estado === 'ingerindo';
                return (
                  <article key={item.uf} className="rounded border border-slate-300 bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-black text-slate-900">{item.uf}</span>
                          <span className="truncate text-sm font-semibold text-slate-700">{item.nome}</span>
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${getStatusClass(item.estado)}`}>{getStatusLabel(item)}</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {formatRows(item.linhas)}
                          {item.tamanho_estimado ? ` · estimado ${typeof item.tamanho_estimado === 'number' ? formatBytes(item.tamanho_estimado) : item.tamanho_estimado}` : ''}
                        </div>
                      </div>
                    </div>

                    {active && (
                      <div className="mt-3 space-y-1">
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-indigo-600 transition-all" style={{ width: `${percent || 8}%` }} />
                        </div>
                        <div className="flex justify-between gap-3 text-[11px] text-slate-500">
                          <span>{progress?.mensagem || progress?.fase || getStatusLabel(item)}</span>
                          <span>{percent ? `${percent}%` : formatBytes(progress?.baixados_bytes)}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {active ? (
                        <button type="button" onClick={() => void runAction(item.uf, 'cancelar')} disabled={busy} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold uppercase text-rose-700 disabled:opacity-60">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                          Cancelar
                        </button>
                      ) : (
                        <button type="button" onClick={() => void runAction(item.uf, 'download')} disabled={busy || item.estado === 'pronto'} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase text-indigo-700 disabled:opacity-50">
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                          Baixar
                        </button>
                      )}
                      <button type="button" onClick={() => void runAction(item.uf, 'remove')} disabled={busy || active || item.estado === 'ausente'} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold uppercase text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                        <Trash2 className="h-3.5 w-3.5" />
                        Remover
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
