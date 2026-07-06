import React from 'react';
import { Pause, Play, Square } from 'lucide-react';

interface GeocodeControlBarProps {
  isGeocoding: boolean;
  geocodeProgress: number;
  geocodeTotal: number;
  geocodeError: string;
  geocodeMode: string;
  geocodeJobStatus: 'idle' | 'running' | 'paused' | 'done' | 'error';
  pendingCount: number;
  currentIndex: number;
  onModeChange: (mode: string) => void;
  onStart: () => void;
  onPause: () => void;
  onCancel: () => void;
}

export default function GeocodeControlBar({
  isGeocoding,
  geocodeProgress,
  geocodeTotal,
  geocodeError,
  geocodeMode,
  geocodeJobStatus,
  pendingCount,
  currentIndex,
  onModeChange,
  onStart,
  onPause,
  onCancel
}: GeocodeControlBarProps) {
  return (
    <div className="bg-white p-4 border border-slate-300 rounded shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
      <div className="space-y-1 w-full md:w-auto text-center md:text-left flex-1">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Estágio de Geocodificação das Coordenadas</span>
        <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start">
          <span className="font-mono font-bold text-slate-800 text-xs md:text-sm leading-none block">
            {isGeocoding ? `RESOLVENDO COORDENADAS: ${geocodeProgress} / ${geocodeTotal}` : 'Enriquecimento de Endereços:'}
          </span>

          {!isGeocoding && (
            <select
              value={geocodeMode}
              onChange={(event) => onModeChange(event.target.value)}
              className="p-1 border border-slate-300 rounded text-xs bg-slate-50 font-bold text-indigo-700 focus:outline-none cursor-pointer"
            >
              <option value="DESATIVADO">Offline (KML carregado ou pendente)</option>
              <option value="PONTOS">Apenas Pontos</option>
              <option value="EXTREMIDADES">Extremidades de Trechos</option>
              <option value="AMOSTRAGEM">Amostragem de Trechos</option>
              <option value="COMPLETO">Modo Completo (Pontos + Linhas + Polígonos)</option>
            </select>
          )}
          {isGeocoding && (
            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded font-bold uppercase font-mono">
              {geocodeMode}
            </span>
          )}
          {pendingCount > 20 && geocodeJobStatus !== 'idle' && (
            <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-bold uppercase font-mono">
              Job {geocodeJobStatus}
            </span>
          )}
        </div>

        {geocodeTotal > 0 && (
          <div className="w-full md:w-[280px] bg-slate-100 h-2 border border-slate-200 rounded mt-1 overflow-hidden">
            <div
              className="bg-indigo-600 h-full transition-all duration-300"
              style={{ width: `${(geocodeProgress / geocodeTotal) * 100}%` }}
            />
          </div>
        )}
        {geocodeError && (
          <div className="text-[11px] text-rose-700 bg-rose-50 border border-rose-200 rounded px-3 py-2 max-w-xl">
            {geocodeError}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 justify-center">
        {geocodeMode === 'DESATIVADO' ? (
          <span className="text-[10px] text-slate-400 font-medium max-w-xs text-center md:text-right">
            As localizações já possuem endereços offline atribuídos. Selecione outro modo caso queira rodar geocodificação real por API.
          </span>
        ) : (
          <>
            {!isGeocoding ? (
              <button
                onClick={onStart}
                disabled={currentIndex >= pendingCount}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white font-bold text-xs rounded border border-indigo-700 transition cursor-pointer flex items-center gap-1.5 shadow-xs uppercase tracking-wider"
                id="start-enrich-geocode-btn"
              >
                <Play className="h-3.5 w-3.5" />
                {geocodeJobStatus === 'paused' ? 'Retomar Job' : currentIndex > 0 ? 'Retomar' : 'Iniciar Geocodificação'}
              </button>
            ) : (
              <button
                onClick={onPause}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded border border-amber-600 transition cursor-pointer flex items-center gap-1.5 shadow-xs uppercase tracking-wider"
                id="pause-enrich-geocode-btn"
              >
                <Pause className="h-3.5 w-3.5" /> Pausar
              </button>
            )}

            <button
              onClick={onCancel}
              disabled={currentIndex === 0}
              className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs rounded transition cursor-pointer flex items-center gap-1.5 uppercase tracking-wider"
            >
              <Square className="h-3.5 w-3.5" /> Reiniciar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
