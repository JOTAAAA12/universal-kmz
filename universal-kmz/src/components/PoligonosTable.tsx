import React from 'react';
import { Edit } from 'lucide-react';
import { EnderecoPoligono, ParserResult, PoligonoFeature } from '../types';
import SourceBadge from './SourceBadge';

interface PoligonosTableProps {
  result: ParserResult;
  poligonos: PoligonoFeature[];
  onStartEdit: (id: string, initialFields: Record<string, string>) => void;
}

function getAddressForCoords(result: ParserResult, lat: number, lng: number) {
  return result.enderecos.find(e => Math.abs(e.latitude - lat) < 0.0001 && Math.abs(e.longitude - lng) < 0.0001);
}

function getAddressStatusForCoords(result: ParserResult, lat: number, lng: number, fallbackAddr?: string) {
  const addr = getAddressForCoords(result, lat, lng);
  const text = addr?.endereco_formatado || fallbackAddr;
  if (!text || text === 'Não geocodificado' || text.toLowerCase().includes('desconhecido') || ['FALHA', 'ZERO_RESULTS', 'PENDENTE'].includes(addr?.status_api || '')) {
    return { label: 'Falha / Pendente', color: 'bg-rose-50 text-rose-700 border border-rose-200' };
  }
  const isFull = Boolean(addr?.logradouro && (addr?.numero || addr?.bairro) && (addr?.municipio || addr?.uf));
  return isFull
    ? { label: 'Sucesso (Completo)', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' }
    : { label: 'Parcial', color: 'bg-amber-50 text-amber-700 border border-amber-200' };
}

function getPolygonAddress(result: ParserResult, poligonoId: string): EnderecoPoligono | undefined {
  return (result.enderecos_poligono || []).find(item => item.poligono_id === poligonoId);
}

export default function PoligonosTable({ result, poligonos, onStartEdit }: PoligonosTableProps) {
  return (
    <table className="w-full text-left border-collapse text-xs">
      <thead>
        <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
          <th className="p-3">ID Polígono</th>
          <th className="p-3">Nome KML</th>
          <th className="p-3 text-right">Área Estimada (m²)</th>
          <th className="p-3 text-right">Perímetro (m)</th>
          <th className="p-3">Centroid (Lat, Lng)</th>
          <th className="p-3">Endereço Centroid</th>
          <th className="p-3">Dominante / Confrontantes</th>
          <th className="p-3 text-center">Resolução</th>
          <th className="p-3 text-center">Status</th>
          <th className="p-3 text-right">Ação</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-50">
        {poligonos.map(poligono => {
          const endereco = getPolygonAddress(result, poligono.poligono_id);
          const source = getAddressForCoords(result, poligono.centroid_lat, poligono.centroid_lng)?.fonte;
          const badge = poligono.conflito_endereco
            ? { label: 'Conflito / Revisar', color: 'bg-amber-50 text-amber-700 border border-amber-200' }
            : getAddressStatusForCoords(result, poligono.centroid_lat, poligono.centroid_lng, poligono.centroid_endereco);

          return (
            <tr key={poligono.poligono_id} className="hover:bg-slate-50/50">
              <td className="p-3 font-mono font-semibold text-slate-700">{poligono.poligono_id}</td>
              <td className="p-3 font-semibold text-slate-700">{poligono.nome_original}</td>
              <td className="p-3 text-right font-mono text-slate-800 font-medium">{poligono.area_m2.toFixed(1)}m²</td>
              <td className="p-3 text-right font-mono text-slate-500">{poligono.perimetro_m.toFixed(1)}m</td>
              <td className="p-3 font-mono text-slate-500">
                ({poligono.centroid_lat.toFixed(5)}, {poligono.centroid_lng.toFixed(5)})
              </td>
              <td className="p-3 text-slate-600 max-w-xs">
                <span className="block truncate">{poligono.centroid_endereco || 'Não geocodificado'}</span>
                <div className="mt-1"><SourceBadge source={source} /></div>
                {poligono.conflito_endereco && (
                  <span className="block mt-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-snug">
                    {poligono.conflito_endereco}
                  </span>
                )}
              </td>
              <td className="p-3 min-w-[220px] max-w-sm">
                {!endereco ? (
                  <span className="text-slate-400 italic">Não processado</span>
                ) : (
                  <div className="space-y-1">
                    <span className={`block text-[10px] rounded border px-2 py-1 font-semibold ${
                      endereco.necessita_revisao
                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                        : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    }`}>
                      {endereco.logradouro}{endereco.municipio ? `, ${endereco.municipio}` : ''}
                    </span>
                    {endereco.confrontantes.length > 0 && (
                      <span className="block text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                        Confrontantes: {endereco.confrontantes.join(' | ')}
                      </span>
                    )}
                  </div>
                )}
              </td>
              <td className="p-3 text-center">
                <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${badge.color}`}>
                  {badge.label}
                </span>
              </td>
              <td className="p-3 text-center">
                <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                  poligono.valido ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                }`}>
                  {poligono.valido ? 'Válido' : 'Inválido'}
                </span>
              </td>
              <td className="p-3 text-right">
                <button
                  onClick={() => onStartEdit(poligono.poligono_id, { nome: poligono.nome_original, obs: poligono.observacoes })}
                  className="text-slate-400 hover:text-indigo-600 p-1 transition rounded hover:bg-slate-100"
                >
                  <Edit className="h-3.5 w-3.5" />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
