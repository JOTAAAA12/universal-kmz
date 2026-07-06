import React from 'react';
import { ArrowUpDown, Check, Edit, X } from 'lucide-react';
import { ParserResult, TrechoEndereco, TrechoFeature } from '../types';
import SourceBadge from './SourceBadge';

type ResolutionStatus = 'SUCESSO' | 'PARCIAL' | 'FALHA';

interface ResolutionBadge {
  status: ResolutionStatus;
  label: string;
  color: string;
}

interface TrechosTableProps {
  result: ParserResult;
  trechos: TrechoFeature[];
  editingId: string | null;
  editFields: Record<string, string>;
  setEditFields: (fields: Record<string, string>) => void;
  setEditingId: (id: string | null) => void;
  onStartEdit: (id: string, initialFields: Record<string, string>) => void;
  onSaveEdit: (id: string) => void;
  onInvertTrecho: (id: string) => void;
}

function getAddressForCoords(result: ParserResult, lat: number, lng: number) {
  return result.enderecos.find(e => Math.abs(e.latitude - lat) < 0.0001 && Math.abs(e.longitude - lng) < 0.0001);
}

function getAddressStatusForCoords(result: ParserResult, lat: number, lng: number, fallbackAddr?: string): ResolutionBadge {
  const addr = getAddressForCoords(result, lat, lng);
  const text = addr?.endereco_formatado || fallbackAddr;
  if (!text || text === 'Não geocodificado' || text.toLowerCase().includes('desconhecido') || ['FALHA', 'ZERO_RESULTS', 'PENDENTE'].includes(addr?.status_api || '')) {
    return { status: 'FALHA', label: 'Falha / Pendente', color: 'bg-rose-50 text-rose-700 border border-rose-200' };
  }
  const isFull = Boolean(addr?.logradouro && (addr?.numero || addr?.bairro) && (addr?.municipio || addr?.uf));
  return isFull
    ? { status: 'SUCESSO', label: 'Sucesso (Completo)', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' }
    : { status: 'PARCIAL', label: 'Parcial', color: 'bg-amber-50 text-amber-700 border border-amber-200' };
}

function getTrechoStatus(result: ParserResult, trecho: TrechoFeature): ResolutionBadge {
  if (trecho.conflito_endereco) {
    return { status: 'PARCIAL', label: 'Conflito / Revisar', color: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }
  const startStatus = getAddressStatusForCoords(result, trecho.inicio_lat, trecho.inicio_lng, trecho.inicio_endereco);
  const endStatus = getAddressStatusForCoords(result, trecho.fim_lat, trecho.fim_lng, trecho.fim_endereco);
  if (startStatus.status === 'FALHA' || endStatus.status === 'FALHA') {
    return { status: 'FALHA', label: 'Falha / Pendente', color: 'bg-rose-50 text-rose-700 border border-rose-200' };
  }
  if (startStatus.status === 'PARCIAL' || endStatus.status === 'PARCIAL') {
    return { status: 'PARCIAL', label: 'Parcial', color: 'bg-amber-50 text-amber-700 border border-amber-200' };
  }
  return { status: 'SUCESSO', label: 'Sucesso (Completo)', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
}

function getLineAddressSegments(result: ParserResult, linhaId: string): TrechoEndereco[] {
  return (result.trechos_endereco || []).filter(item => item.linha_id === linhaId);
}

function formatNumberRange(segment: TrechoEndereco): string {
  if (segment.numero_inicio === undefined && segment.numero_fim === undefined) return '';
  if (segment.numero_inicio === segment.numero_fim || segment.numero_fim === undefined) return ` (nº ${segment.numero_inicio})`;
  if (segment.numero_inicio === undefined) return ` (nº ${segment.numero_fim})`;
  return ` (nº ${segment.numero_inicio}-${segment.numero_fim})`;
}

function formatTrechoEndereco(segment: TrechoEndereco): string {
  return `${segment.logradouro}${formatNumberRange(segment)}, ${segment.extensao_m.toFixed(0)} m`;
}

export default function TrechosTable({
  result,
  trechos,
  editingId,
  editFields,
  setEditFields,
  setEditingId,
  onStartEdit,
  onSaveEdit,
  onInvertTrecho
}: TrechosTableProps) {
  return (
    <table className="w-full text-left border-collapse text-xs animate-fade-in" id="trechos-grid-panel">
      <thead>
        <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
          <th className="p-3">ID Trecho</th>
          <th className="p-3">Nome</th>
          <th className="p-3 text-right">Compr. Declarado</th>
          <th className="p-3 text-right">Compr. Medido</th>
          <th className="p-3">Início (Endereço)</th>
          <th className="p-3">Fim (Endereço)</th>
          <th className="p-3">Trechos Endereçados</th>
          <th className="p-3 text-center">Inversão Direção</th>
          <th className="p-3 text-center">Resolução</th>
          <th className="p-3 font-semibold">Status</th>
          <th className="p-3 text-right">Ação</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {trechos.map(trecho => {
          const startSource = getAddressForCoords(result, trecho.inicio_lat, trecho.inicio_lng)?.fonte;
          const endSource = getAddressForCoords(result, trecho.fim_lat, trecho.fim_lng)?.fonte;
          const badge = getTrechoStatus(result, trecho);
          return (
            <tr key={trecho.trecho_id} className="hover:bg-slate-50/50">
              <td className="p-3 font-mono font-semibold text-indigo-600">{trecho.trecho_id}</td>
              <td className="p-3">
                {editingId === trecho.trecho_id ? (
                  <input
                    type="text"
                    value={editFields.nome}
                    onChange={(e) => setEditFields({ ...editFields, nome: e.target.value })}
                    className="p-1 border border-slate-200 rounded w-full text-xs"
                  />
                ) : (
                  <span className="font-semibold text-slate-700">{trecho.nome_original}</span>
                )}
              </td>
              <td className="p-3 text-right text-slate-400 font-mono font-medium">
                {trecho.comprimento_declarado_m > 0 ? `${trecho.comprimento_declarado_m}m` : 'N/A'}
              </td>
              <td className="p-3 text-right font-mono font-semibold text-slate-800">
                {trecho.comprimento_calculado_m.toFixed(1)}m
              </td>
              <td className="p-3 max-w-xs text-slate-500" title={trecho.inicio_endereco}>
                <span className="font-mono text-[10px]">({trecho.inicio_lat.toFixed(4)}, {trecho.inicio_lng.toFixed(4)})</span>
                <span className="mt-1 block truncate font-medium text-slate-700">{trecho.inicio_endereco || 'Não geocodificado'}</span>
                <div className="mt-1"><SourceBadge source={startSource} /></div>
              </td>
              <td className="p-3 max-w-xs text-slate-500" title={trecho.fim_endereco}>
                <span className="font-mono text-[10px]">({trecho.fim_lat.toFixed(4)}, {trecho.fim_lng.toFixed(4)})</span>
                <span className="mt-1 block truncate font-medium text-slate-700">{trecho.fim_endereco || 'Não geocodificado'}</span>
                <div className="mt-1"><SourceBadge source={endSource} /></div>
                {trecho.conflito_endereco && (
                  <span className="block mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-snug whitespace-normal">
                    {trecho.conflito_endereco}
                  </span>
                )}
              </td>
              <td className="p-3 min-w-[240px] max-w-sm">
                {(() => {
                  const segments = getLineAddressSegments(result, trecho.trecho_id);
                  if (segments.length === 0) return <span className="text-slate-400 italic">Não processado</span>;
                  return (
                    <div className="flex flex-col gap-1">
                      {segments.map(segment => (
                        <span
                          key={`${trecho.trecho_id}-${segment.ordem || segment.logradouro}`}
                          className={`text-[10px] leading-snug rounded border px-2 py-1 ${
                            segment.necessita_revisao
                              ? 'bg-amber-50 text-amber-800 border-amber-200'
                              : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          {formatTrechoEndereco(segment)}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </td>
              <td className="p-3 text-center">
                <button
                  onClick={() => onInvertTrecho(trecho.trecho_id)}
                  className="px-2 py-1 bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 hover:border-amber-300 rounded font-bold text-[10px] cursor-pointer transition select-none flex items-center gap-1 mx-auto"
                  title="Clique para inverter e recalcular início/fim"
                >
                  <ArrowUpDown className="h-3 w-3" /> Inverter
                </button>
              </td>
              <td className="p-3 text-center">
                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${badge.color}`}>
                  {badge.label}
                </span>
              </td>
              <td className="p-3">
                <span className={`px-2 py-0.5 rounded font-semibold text-[10px] ${
                  trecho.alerta_comprimento ? 'bg-rose-50 text-rose-600' : 'bg-slate-100 text-slate-600'
                }`}>
                  {trecho.status}
                </span>
              </td>
              <td className="p-3 text-right">
                {editingId === trecho.trecho_id ? (
                  <div className="flex justify-end gap-1">
                    <button onClick={() => onSaveEdit(trecho.trecho_id)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 p-1 rounded">
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setEditingId(null)} className="bg-rose-50 hover:bg-rose-100 text-rose-600 p-1 rounded">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onStartEdit(trecho.trecho_id, { nome: trecho.nome_original, obs: trecho.observacoes })}
                    className="text-slate-400 hover:text-indigo-600 p-1 transition rounded hover:bg-slate-100"
                  >
                    <Edit className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
