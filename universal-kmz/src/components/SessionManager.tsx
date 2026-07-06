import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FolderOpen, Loader2, Save, Trash2, X } from 'lucide-react';

export interface SavedSessionMeta {
  id: string;
  nome: string;
  criado_em: string;
  tamanho?: number;
  tamanho_bytes?: number;
}

interface SessionManagerProps<TPayload> {
  open: boolean;
  canSave: boolean;
  defaultName: string;
  payload: TPayload | null;
  onClose: () => void;
  onOpenPayload: (payload: TPayload, session: SavedSessionMeta) => void;
  onSaved?: (session: SavedSessionMeta) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function formatSize(value?: number): string {
  if (!value || !Number.isFinite(value)) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SessionManager<TPayload>({
  open,
  canSave,
  defaultName,
  payload,
  onClose,
  onOpenPayload,
  onSaved
}: SessionManagerProps<TPayload>) {
  const [sessions, setSessions] = useState<SavedSessionMeta[]>([]);
  const [name, setName] = useState(defaultName);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openingId, setOpeningId] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (open) setName(defaultName);
  }, [defaultName, open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    fetch('/api/sessions')
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || 'Falha ao listar sessões.');
        if (!active) return;
        setSessions(Array.isArray(payload) ? payload : payload.sessions || []);
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao listar sessões.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const payloadSize = useMemo(() => {
    if (!payload) return 0;
    return new Blob([JSON.stringify(payload)]).size;
  }, [payload]);

  if (!open) return null;

  const refreshList = async () => {
    const response = await fetch('/api/sessions');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error || 'Falha ao atualizar sessões.');
    setSessions(Array.isArray(data) ? data : data.sessions || []);
  };

  const saveSession = async () => {
    if (!payload || !name.trim()) return;
    setSaving(true);
    setError('');
    setToast('');
    try {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: name.trim(), payload })
      });
      const data: SavedSessionMeta = await response.json();
      if (!response.ok) throw new Error((data as any)?.error || 'Falha ao salvar sessão.');
      setToast('Sessão salva.');
      onSaved?.(data);
      await refreshList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar sessão.');
    } finally {
      setSaving(false);
    }
  };

  const openSession = async (session: SavedSessionMeta) => {
    setOpeningId(session.id);
    setError('');
    try {
      const response = await fetch(`/api/sessions/${session.id}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || 'Falha ao abrir sessão.');
      onOpenPayload(data.payload ?? data, session);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao abrir sessão.');
    } finally {
      setOpeningId('');
    }
  };

  const deleteSession = async (session: SavedSessionMeta) => {
    if (!window.confirm(`Excluir a sessão "${session.nome}"?`)) return;
    setDeletingId(session.id);
    setError('');
    try {
      const response = await fetch(`/api/sessions/${session.id}`, { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'Falha ao excluir sessão.');
      setSessions(current => current.filter(item => item.id !== session.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao excluir sessão.');
    } finally {
      setDeletingId('');
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-start justify-center bg-slate-950/40 p-4 backdrop-blur-sm md:items-center">
      <section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">Sessões</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 p-5">
          {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}
          {toast && <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{toast}</div>}

          <div className="rounded border border-slate-300 bg-slate-50 p-3">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">Salvar estado atual</div>
            <div className="flex flex-col gap-2 md:flex-row">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canSave}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={saveSession}
                disabled={!canSave || saving || !name.trim()}
                className="inline-flex items-center justify-center gap-2 rounded border border-indigo-700 bg-indigo-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Salvar sessão
              </button>
            </div>
            <div className="mt-2 text-[10px] font-mono text-slate-500">Tamanho estimado: {formatSize(payloadSize)}</div>
          </div>

          <div className="rounded border border-slate-300 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Sessões salvas</span>
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            </div>
            <div className="divide-y divide-slate-100">
              {sessions.map(session => (
                <div key={session.id} className="flex flex-col gap-2 px-3 py-3 md:flex-row md:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-bold text-slate-800">{session.nome}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[10px] font-mono text-slate-500">
                      <span>{formatDate(session.criado_em)}</span>
                      <span>{formatSize(session.tamanho_bytes ?? session.tamanho)}</span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => openSession(session)} disabled={Boolean(openingId)} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase text-indigo-700 disabled:opacity-60">
                      {openingId === session.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderOpen className="h-3 w-3" />}
                      Abrir
                    </button>
                    <button type="button" onClick={() => deleteSession(session)} disabled={Boolean(deletingId)} className="inline-flex items-center gap-1 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] font-bold uppercase text-rose-700 disabled:opacity-60">
                      {deletingId === session.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                      Excluir
                    </button>
                  </div>
                </div>
              ))}
              {!loading && sessions.length === 0 && (
                <div className="px-3 py-6 text-center text-xs font-semibold text-slate-500">Nenhuma sessão salva.</div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
