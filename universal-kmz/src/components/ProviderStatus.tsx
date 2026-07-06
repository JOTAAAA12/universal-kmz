import React, { useEffect, useState } from 'react';
import { Database, Gauge, RefreshCw } from 'lucide-react';

interface ProviderStatusItem {
  nome: string;
  habilitado: boolean;
  usados_na_sessao: number;
  cooldown_ativo: boolean;
  cooldown_ate?: string;
  linhas_indexadas?: number;
  indice_parcial?: boolean;
  mensagens?: string[];
}

interface ProviderStatusPayload {
  providers: ProviderStatusItem[];
}

function formatCooldown(iso?: string): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return '';
  return `${Math.ceil(ms / 1000)}s`;
}

export default function ProviderStatus() {
  const [providers, setProviders] = useState<ProviderStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const response = await fetch('/api/geocode/providers');
        const payload: ProviderStatusPayload = await response.json();
        if (!active) return;
        if (!response.ok) {
          throw new Error('Falha ao ler provedores.');
        }
        setProviders(Array.isArray(payload.providers) ? payload.providers : []);
        setError('');
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Falha ao ler provedores.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    const timer = window.setInterval(load, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <section className="bg-white border border-slate-300 rounded p-3 shadow-xs" id="provider-status-panel">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 text-slate-700">
          <Gauge className="h-4 w-4 text-indigo-600" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Provedores e cotas</span>
          {loading && <RefreshCw className="h-3 w-3 animate-spin text-slate-400" />}
          {error && <span className="text-[10px] font-semibold text-rose-600">{error}</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          {providers.map(provider => (
            <div
              key={provider.nome}
              className={`flex items-center gap-2 rounded border px-2 py-1 text-[10px] ${
                provider.habilitado
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-slate-50 text-slate-500'
              }`}
              title={(provider.mensagens || []).join(' | ')}
            >
              <span className="font-bold uppercase">{provider.nome}</span>
              <span className="font-mono">{provider.usados_na_sessao} usadas</span>
              {provider.cooldown_ativo && (
                <span className="rounded bg-amber-100 px-1 font-bold text-amber-800">
                  cooldown {formatCooldown(provider.cooldown_ate)}
                </span>
              )}
              {provider.linhas_indexadas !== undefined && (
                <span className="inline-flex items-center gap-1 rounded bg-white/70 px-1 font-mono">
                  <Database className="h-3 w-3" />
                  {provider.linhas_indexadas.toLocaleString('pt-BR')}
                  {provider.indice_parcial ? ' parcial' : ''}
                </span>
              )}
            </div>
          ))}
          {!loading && providers.length === 0 && (
            <span className="text-[10px] font-semibold text-slate-500">Nenhum provedor configurado.</span>
          )}
        </div>
      </div>
    </section>
  );
}
