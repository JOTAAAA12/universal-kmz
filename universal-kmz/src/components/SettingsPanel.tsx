import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Eye, EyeOff, Loader2, Save, Settings, X, XCircle } from 'lucide-react';

const KEEP_SECRET = '__KEEP__';
const PROVIDERS = ['google', 'locationiq', 'geoapify', 'nominatim', 'photon', 'bigdatacloud', 'cnefe', 'mock'];

interface ApiConfig {
  googleServerKey?: string;
  locationiqKey?: string;
  geoapifyKey?: string;
  nominatimEmail?: string;
  geocoderChain?: string[] | string;
  viacepValidation?: boolean;
  geocodeCrosscheck?: boolean;
  stepMeters?: number;
}

interface TestResult {
  ok: boolean;
  status?: string;
  mensagem?: string;
  endereco_resumido?: string;
}

interface SecretFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  visible: boolean;
  onToggleVisible: () => void;
  onChange: (value: string) => void;
}

function parseChain(value: ApiConfig['geocoderChain']): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map(item => item.trim()).filter(Boolean);
  return ['google', 'nominatim', 'photon', 'bigdatacloud'];
}

function SecretField({ label, value, placeholder, visible, onToggleVisible, onChange }: SecretFieldProps) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      <div className="flex rounded border border-slate-300 bg-slate-50 focus-within:border-indigo-500 focus-within:ring-1 focus-within:ring-indigo-500">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder || 'Não configurada'}
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-xs font-mono text-slate-700 outline-none"
        />
        <button
          type="button"
          onClick={onToggleVisible}
          className="border-l border-slate-300 px-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          title={visible ? 'Ocultar chave' : 'Mostrar chave'}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </label>
  );
}

export default function SettingsPanel({
  open,
  onClose,
  onSaved
}: {
  open: boolean;
  onClose: () => void;
  onSaved?: (stepMeters: number) => void;
}) {
  const [config, setConfig] = useState<ApiConfig>({});
  const [secrets, setSecrets] = useState({ googleServerKey: '', locationiqKey: '', geoapifyKey: '' });
  const [touchedSecrets, setTouchedSecrets] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [chain, setChain] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [testing, setTesting] = useState('');
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError('');
    fetch('/api/config')
      .then(async response => {
        const payload: ApiConfig = await response.json();
        if (!response.ok) throw new Error('Falha ao carregar configurações.');
        if (!active) return;
        setConfig(payload);
        setSecrets({ googleServerKey: '', locationiqKey: '', geoapifyKey: '' });
        setTouchedSecrets({});
        setChain(parseChain(payload.geocoderChain));
      })
      .catch(err => {
        if (active) setError(err instanceof Error ? err.message : 'Falha ao carregar configurações.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const availableProviders = useMemo(() => {
    const merged = [...chain, ...PROVIDERS];
    return Array.from(new Set(merged)).filter(Boolean);
  }, [chain]);

  if (!open) return null;

  const setSecret = (field: keyof typeof secrets, value: string) => {
    setSecrets(current => ({ ...current, [field]: value }));
    setTouchedSecrets(current => ({ ...current, [field]: true }));
  };

  const moveProvider = (provider: string, delta: number) => {
    const index = chain.indexOf(provider);
    const nextIndex = index + delta;
    if (index < 0 || nextIndex < 0 || nextIndex >= chain.length) return;
    setChain(current => {
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const toggleProvider = (provider: string) => {
    setChain(current => current.includes(provider) ? current.filter(item => item !== provider) : [...current, provider]);
  };

  const testProvider = async (provider: string) => {
    setTesting(provider);
    setTestResults(current => {
      const next = { ...current };
      delete next[provider];
      return next;
    });
    try {
      const response = await fetch(`/api/config/test/${provider}`, { method: 'POST' });
      const payload: TestResult = await response.json();
      setTestResults(current => ({ ...current, [provider]: { ...payload, ok: response.ok && payload.ok } }));
    } catch (err) {
      setTestResults(current => ({
        ...current,
        [provider]: { ok: false, mensagem: err instanceof Error ? err.message : 'Falha ao testar provedor.' }
      }));
    } finally {
      setTesting('');
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setToast('');
    const body: ApiConfig = {
      googleServerKey: touchedSecrets.googleServerKey ? secrets.googleServerKey : KEEP_SECRET,
      locationiqKey: touchedSecrets.locationiqKey ? secrets.locationiqKey : KEEP_SECRET,
      geoapifyKey: touchedSecrets.geoapifyKey ? secrets.geoapifyKey : KEEP_SECRET,
      nominatimEmail: config.nominatimEmail || '',
      geocoderChain: chain,
      viacepValidation: Boolean(config.viacepValidation),
      geocodeCrosscheck: Boolean(config.geocodeCrosscheck),
      stepMeters: Number(config.stepMeters) || 100
    };

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || 'Falha ao salvar configurações.');
      setToast('Configurações salvas.');
      setTouchedSecrets({});
      setSecrets({ googleServerKey: '', locationiqKey: '', geoapifyKey: '' });
      onSaved?.(Number(body.stepMeters) || 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar configurações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-slate-950/40 p-4 backdrop-blur-sm md:items-center">
      <section className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded border border-slate-300 bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white px-5 py-4">
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-indigo-600" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-800">Configurações de APIs</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          {loading && <div className="text-xs font-semibold text-slate-500">Carregando configuração...</div>}
          {error && <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{error}</div>}
          {toast && <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">{toast}</div>}

          <div className="grid gap-4 md:grid-cols-3">
            <SecretField label="Google Server Key" value={secrets.googleServerKey} placeholder={config.googleServerKey} visible={Boolean(visible.googleServerKey)} onToggleVisible={() => setVisible(current => ({ ...current, googleServerKey: !current.googleServerKey }))} onChange={(value) => setSecret('googleServerKey', value)} />
            <SecretField label="LocationIQ Key" value={secrets.locationiqKey} placeholder={config.locationiqKey} visible={Boolean(visible.locationiqKey)} onToggleVisible={() => setVisible(current => ({ ...current, locationiqKey: !current.locationiqKey }))} onChange={(value) => setSecret('locationiqKey', value)} />
            <SecretField label="Geoapify Key" value={secrets.geoapifyKey} placeholder={config.geoapifyKey} visible={Boolean(visible.geoapifyKey)} onToggleVisible={() => setVisible(current => ({ ...current, geoapifyKey: !current.geoapifyKey }))} onChange={(value) => setSecret('geoapifyKey', value)} />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block space-y-1 md:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">E-mail Nominatim</span>
              <input value={config.nominatimEmail || ''} onChange={(event) => setConfig(current => ({ ...current, nominatimEmail: event.target.value }))} className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </label>
            <label className="block space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">StepMeters dos trechos</span>
              <input type="number" min={5} step={5} value={config.stepMeters ?? 100} onChange={(event) => setConfig(current => ({ ...current, stepMeters: Number(event.target.value) }))} className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_260px]">
            <div className="rounded border border-slate-300 bg-slate-50 p-3">
              <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">Cadeia de provedores</div>
              <div className="space-y-2">
                {availableProviders.map(provider => {
                  const enabled = chain.includes(provider);
                  const result = testResults[provider];
                  return (
                    <div key={provider} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
                      <input type="checkbox" checked={enabled} onChange={() => toggleProvider(provider)} className="h-4 w-4 accent-indigo-600" />
                      <span className="min-w-24 flex-1 font-mono text-xs font-bold uppercase text-slate-700">{provider}</span>
                      <button type="button" disabled={!enabled} onClick={() => moveProvider(provider, -1)} className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30" title="Subir"><ArrowUp className="h-3.5 w-3.5" /></button>
                      <button type="button" disabled={!enabled} onClick={() => moveProvider(provider, 1)} className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30" title="Descer"><ArrowDown className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => testProvider(provider)} disabled={testing === provider} className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-bold uppercase text-indigo-700 disabled:opacity-60">
                        {testing === provider && <Loader2 className="h-3 w-3 animate-spin" />}
                        Testar
                      </button>
                      {result && (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`} title={result.mensagem || result.status}>
                          {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                          {result.ok ? (result.endereco_resumido || result.mensagem || 'ok') : (result.mensagem || result.status || 'falha')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="space-y-3 rounded border border-slate-300 bg-white p-3">
              <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                Validação ViaCEP
                <input type="checkbox" checked={Boolean(config.viacepValidation)} onChange={(event) => setConfig(current => ({ ...current, viacepValidation: event.target.checked }))} className="h-4 w-4 accent-indigo-600" />
              </label>
              <label className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-700">
                Cross-check entre provedores
                <input type="checkbox" checked={Boolean(config.geocodeCrosscheck)} onChange={(event) => setConfig(current => ({ ...current, geocodeCrosscheck: event.target.checked }))} className="h-4 w-4 accent-indigo-600" />
              </label>
            </div>
          </div>
        </div>

        <footer className="sticky bottom-0 flex justify-end border-t border-slate-300 bg-white px-5 py-4">
          <button type="button" onClick={save} disabled={saving || loading} className="inline-flex items-center gap-2 rounded border border-indigo-700 bg-indigo-600 px-4 py-2 text-xs font-bold uppercase tracking-wider text-white transition hover:bg-indigo-700 disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
        </footer>
      </section>
    </div>
  );
}
