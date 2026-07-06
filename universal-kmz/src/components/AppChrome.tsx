import React from 'react';
import { FolderOpen, RotateCcw, Save, Settings } from 'lucide-react';

interface AppHeaderProps {
  fileName?: string;
  onReset: () => void;
  onOpenSettings: () => void;
  onOpenSessions: () => void;
  onSaveSession: () => void;
  hasWorkspace: boolean;
  hasUnsavedChanges: boolean;
}

export function AppHeader({
  fileName,
  onReset,
  onOpenSettings,
  onOpenSessions,
  onSaveSession,
  hasWorkspace,
  hasUnsavedChanges
}: AppHeaderProps) {
  return (
    <header className="h-16 border-b border-slate-300 bg-white flex items-center justify-between px-6 shrink-0 sticky top-0 z-50">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-indigo-600 flex items-center justify-center text-white font-bold rounded text-sm font-mono tracking-tight shadow-sm">
          KM
        </div>
        <div>
          <h1 className="text-sm md:text-base font-bold tracking-tight uppercase leading-none text-slate-900">
            Universal Geocoder <span className="text-slate-400 font-light italic text-xs capitalize">KML / KMZ</span>
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full font-medium">
          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          <span>Connected (pt-BR)</span>
        </div>

        {hasUnsavedChanges && (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
            alterações não salvas
          </span>
        )}

        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded border border-slate-300 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          title="Configurações de APIs"
        >
          <Settings className="h-4 w-4" />
        </button>

        <button
          type="button"
          onClick={onOpenSessions}
          className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
          title="Abrir sessão"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Abrir
        </button>

        {hasWorkspace && (
          <button
            type="button"
            onClick={onSaveSession}
            className="inline-flex items-center gap-1.5 rounded border border-indigo-700 bg-indigo-600 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition hover:bg-indigo-700"
            title="Salvar sessão"
          >
            <Save className="h-3.5 w-3.5" />
            Salvar
          </button>
        )}

        {fileName && (
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-slate-100 text-slate-700 font-bold border border-slate-200 rounded text-[11px] font-mono">
              {fileName}
            </span>
            <button
              onClick={onReset}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1 rounded cursor-pointer transition uppercase tracking-wider"
              id="reset-workspace-btn"
            >
              <RotateCcw className="h-3 w-3" />
              Novo arquivo
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="h-12 border-t border-slate-300 bg-white flex items-center justify-between px-6 shrink-0 text-[10px] text-slate-400 font-mono">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-300"></span> Port: 3000 Ingress</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-indigo-500"></span> UTF-8 Brazilian Compliant</span>
      </div>
      <div>
        Universal KMZ Reader & Geocoder &bull; MVP
      </div>
    </footer>
  );
}
