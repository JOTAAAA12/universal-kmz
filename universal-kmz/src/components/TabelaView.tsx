import React, { useState } from 'react';
import { 
  Search, RefreshCw, Edit, Check, X
} from 'lucide-react';
import {
  ParserResult,
  PointFeature,
  EnderecoConsulta
} from '../types';
import SourceBadge from './SourceBadge';
import TrechosTable from './TrechosTable';
import PoligonosTable from './PoligonosTable';
import { AccuracyBadges } from './AccuracyBadges';

interface TabelaViewProps {
  result: ParserResult;
  onUpdateResult: (updated: ParserResult) => void;
  onTriggerAuditLog: (acao: string, entidade: string, antes: string, depois: string) => void;
  onGeocodeTrechos?: () => void;
  isGeocodingTrechos?: boolean;
}

type TabType = 'features' | 'pontos' | 'trechos' | 'poligonos' | 'enderecos' | 'associacoes' | 'erros';

type ResolutionStatus = 'SUCESSO' | 'PARCIAL' | 'FALHA';

interface ResolutionBadge {
  status: ResolutionStatus;
  label: string;
  color: string;
}

function getAddressStatusForCoords(
  result: ParserResult,
  lat: number,
  lng: number,
  fallbackAddr?: string
): ResolutionBadge {
  const addr = result.enderecos.find(e => {
    const dLat = Math.abs(e.latitude - lat);
    const dLng = Math.abs(e.longitude - lng);
    return dLat < 0.0001 && dLng < 0.0001;
  });

  const text = addr?.endereco_formatado || fallbackAddr;

  if (
    !text ||
    text === 'Não geocodificado' ||
    text.toLowerCase().includes('desconhecido') ||
    addr?.status_api === 'FALHA' ||
    addr?.status_api === 'ZERO_RESULTS' ||
    addr?.status_api === 'PENDENTE'
  ) {
    return {
      status: 'FALHA',
      label: 'Falha / Pendente',
      color: 'bg-rose-50 text-rose-700 border border-rose-200'
    };
  }

  // To check completeness
  const hasLogradouro = !!addr?.logradouro;
  const hasNumero = !!addr?.numero;
  const hasBairro = !!addr?.bairro;
  const hasMunicipio = !!addr?.municipio || !!addr?.uf;
  
  const isFull = hasLogradouro && (hasNumero || hasBairro) && hasMunicipio;

  if (isFull) {
    return {
      status: 'SUCESSO',
      label: 'Sucesso (Completo)',
      color: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    };
  } else {
    return {
      status: 'PARCIAL',
      label: 'Parcial',
      color: 'bg-amber-50 text-amber-700 border border-amber-200'
    };
  }
}

function getPointStatus(p: PointFeature): ResolutionBadge {
  if (p.conflito_endereco) {
    return {
      status: 'PARCIAL',
      label: 'Conflito / Revisar',
      color: 'bg-amber-50 text-amber-700 border border-amber-200'
    };
  }

  if (
    !p.endereco_formatado ||
    p.status_api === 'FALHA' ||
    p.status_api === 'ZERO_RESULTS' ||
    p.status_api === 'PENDENTE' ||
    p.endereco_formatado === 'Não geocodificado' ||
    p.endereco_formatado.toLowerCase().includes('desconhecido')
  ) {
    return {
      status: 'FALHA',
      label: 'Falha / Pendente',
      color: 'bg-rose-50 text-rose-700 border border-rose-200'
    };
  }

  const hasLogradouro = !!p.logradouro;
  const hasNumero = !!p.numero;
  const hasBairro = !!p.bairro;
  const hasMunicipio = !!p.municipio || !!p.uf;

  const isFull = hasLogradouro && (hasNumero || hasBairro) && hasMunicipio;

  if (isFull) {
    return {
      status: 'SUCESSO',
      label: 'Sucesso (Completo)',
      color: 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    };
  } else {
    return {
      status: 'PARCIAL',
      label: 'Parcial',
      color: 'bg-amber-50 text-amber-700 border border-amber-200'
    };
  }
}

function coordinateKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function getAddressRecordForCoords(result: ParserResult, lat: number, lng: number): EnderecoConsulta | undefined {
  return result.enderecos.find(e => Math.abs(e.latitude - lat) < 0.0001 && Math.abs(e.longitude - lng) < 0.0001);
}

function recalculateAddressSummary(result: ParserResult): ParserResult {
  const pointAddressesMissing = result.pontos.filter(p => !p.endereco_formatado).length;
  const trechoAddressesMissing = result.trechos.reduce((count, t) => count + (t.inicio_endereco ? 0 : 1) + (t.fim_endereco ? 0 : 1), 0);
  const polygonAddressesMissing = result.poligonos.filter(p => !p.centroid_endereco).length;
  const completedAddresses = result.enderecos.filter(e => e.endereco_formatado && e.status_api === 'SUCESSO').length;

  return {
    ...result,
    resumo: {
      ...result.resumo,
      resultados_completos: completedAddresses,
      resultados_sem_endereco: pointAddressesMissing + trechoAddressesMissing + polygonAddressesMissing
    }
  };
}

function upsertManualPointAddress(result: ParserResult, point: PointFeature): ParserResult {
  if (!point.endereco_formatado) return result;

  const key = coordinateKey(point.latitude, point.longitude);
  const manualRecord: EnderecoConsulta = {
    consulta_id: `MANUAL-${key}`,
    latitude: point.latitude,
    longitude: point.longitude,
    coordenada_normalizada: key,
    endereco_formatado: point.endereco_formatado,
    logradouro: point.logradouro || '',
    numero: point.numero || '',
    bairro: point.bairro || '',
    municipio: point.municipio || '',
    uf: point.uf || '',
    cep: point.cep || '',
    pais: point.pais || 'Brasil',
    status_api: 'SUCESSO',
    quantidade_resultados: 1,
    fonte: 'Manual',
    cache_hit: false,
    necessita_revisao: point.necessita_revisao
  };

  const existingIndex = result.enderecos.findIndex(e => e.consulta_id === manualRecord.consulta_id);
  const enderecos = existingIndex >= 0
    ? result.enderecos.map(e => e.consulta_id === manualRecord.consulta_id ? manualRecord : e)
    : [...result.enderecos, manualRecord];

  return {
    ...result,
    enderecos
  };
}

export default function TabelaView({
  result,
  onUpdateResult,
  onTriggerAuditLog,
  onGeocodeTrechos,
  isGeocodingTrechos = false
}: TabelaViewProps) {
  const [activeTab, setActiveTab] = useState<TabType>('features');
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Record<string, string>>({});

  // Filters 
  const filteredFeatures = result.features.filter(f => 
    f.placemark_nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.caminho_pasta.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.geometry_type.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPoints = result.pontos.filter(p => 
    p.point_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.endereco_formatado || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.tipo_ponto.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredTrechos = result.trechos.filter(t => 
    t.nome_original.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.caminho_pasta.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.inicio_endereco || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.fim_endereco || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (result.trechos_endereco || [])
      .filter(item => item.linha_id === t.trecho_id)
      .map(item => item.logradouro)
      .join(' ')
      .toLowerCase()
      .includes(searchTerm.toLowerCase())
  );

  const filteredPoligonas = result.poligonos.filter(pl => 
    pl.nome_original.toLowerCase().includes(searchTerm.toLowerCase()) ||
    pl.caminho_pasta.toLowerCase().includes(searchTerm.toLowerCase()) ||
    ((result.enderecos_poligono || []).find(item => item.poligono_id === pl.poligono_id)?.logradouro || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    ((result.enderecos_poligono || []).find(item => item.poligono_id === pl.poligono_id)?.confrontantes || []).join(' ').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredEnderecos = result.enderecos.filter(e => 
    e.coordenada_normalizada.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.endereco_formatado || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.bairro || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (e.municipio || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Inverter start/fim of Trecho (reverses points, swaps lat, lng and addresses)
  const handleInvertTrecho = (trecho_id: string) => {
    const backupTrechos = [...result.trechos];
    const trechoIndex = backupTrechos.findIndex(t => t.trecho_id === trecho_id);

    if (trechoIndex !== -1) {
      const target = backupTrechos[trechoIndex];
      const antesTxt = `Início: (${target.inicio_lat}, ${target.inicio_lng}) - Fim: (${target.fim_lat}, ${target.fim_lng})`;

      // Swapping coordinates and addresses
      const tempLat = target.inicio_lat;
      const tempLng = target.inicio_lng;
      const tempAddr = target.inicio_endereco;
      const tempPlaceId = target.inicio_place_id;

      target.inicio_lat = target.fim_lat;
      target.inicio_lng = target.fim_lng;
      target.inicio_endereco = target.fim_endereco;
      target.inicio_place_id = target.fim_place_id;

      target.fim_lat = tempLat;
      target.fim_lng = tempLng;
      target.fim_endereco = tempAddr;
      target.fim_place_id = tempPlaceId;

      target.direcao_original = target.direcao_original === 'Normal' ? 'Invertida' : 'Normal';
      target.inicio_fim_invertido = !target.inicio_fim_invertido;
      target.status = 'Revertido Manualmente';

      const depoisTxt = `Início: (${target.inicio_lat}, ${target.inicio_lng}) - Fim: (${target.fim_lat}, ${target.fim_lng})`;

    const updatedResults: ParserResult = {
        ...result,
        trechos: backupTrechos
      };

      onUpdateResult(recalculateAddressSummary(updatedResults));
      onTriggerAuditLog(
        'INVERT_TRECHO',
        `Trecho (${target.nome_original})`,
        antesTxt,
        depoisTxt
      );
    }
  };

  // Inline editing saving
  const handleStartEdit = (id: string, initialFields: Record<string, string>) => {
    setEditingId(id);
    setEditFields(initialFields);
  };

  const handleSaveEdit = (type: TabType, id: string) => {
    const updated = { ...result };
    let antes = '';
    let depois = '';

    if (type === 'features') {
      const idx = updated.features.findIndex(f => f.feature_id === id);
      if (idx !== -1) {
        antes = `Nome: ${updated.features[idx].placemark_nome}, Desc: ${updated.features[idx].placemark_descricao}`;
        updated.features[idx].placemark_nome = editFields.nome || updated.features[idx].placemark_nome;
        updated.features[idx].placemark_descricao = editFields.descricao || updated.features[idx].placemark_descricao;
        if (editFields.status) {
          updated.features[idx].status_validacao = editFields.status as any;
        }
        depois = `Nome: ${updated.features[idx].placemark_nome}, Desc: ${updated.features[idx].placemark_descricao}, Stat: ${updated.features[idx].status_validacao}`;
        onTriggerAuditLog('EDIT_FEATURE', `Feature: ${id}`, antes, depois);
      }
    } else if (type === 'pontos') {
      const idx = updated.pontos.findIndex(p => p.point_id === id);
      if (idx !== -1) {
        antes = `Endereço: ${updated.pontos[idx].endereco_formatado}, Obs: ${updated.pontos[idx].observacoes}`;
        updated.pontos[idx].endereco_formatado = editFields.endereco || updated.pontos[idx].endereco_formatado;
        updated.pontos[idx].observacoes = editFields.obs || updated.pontos[idx].observacoes;
        updated.pontos[idx].necessita_revisao = editFields.revisado === 'NÃO';
        depois = `Endereço: ${updated.pontos[idx].endereco_formatado}, Obs: ${updated.pontos[idx].observacoes}, Rev: ${editFields.revisado}`;
        Object.assign(updated, upsertManualPointAddress(updated, updated.pontos[idx]));
        onTriggerAuditLog('EDIT_PONTO', `Ponto: ${id}`, antes, depois);
      }
    } else if (type === 'trechos') {
      const idx = updated.trechos.findIndex(t => t.trecho_id === id);
      if (idx !== -1) {
        antes = `Nome: ${updated.trechos[idx].nome_original}, Obs: ${updated.trechos[idx].observacoes}`;
        updated.trechos[idx].nome_original = editFields.nome || updated.trechos[idx].nome_original;
        updated.trechos[idx].observacoes = editFields.obs || updated.trechos[idx].observacoes;
        depois = `Nome: ${updated.trechos[idx].nome_original}, Obs: ${updated.trechos[idx].observacoes}`;
        onTriggerAuditLog('EDIT_TRECHO', `Trecho: ${id}`, antes, depois);
      }
    } else if (type === 'poligonos') {
      const idx = updated.poligonos.findIndex(p => p.poligono_id === id);
      if (idx !== -1) {
        antes = `Nome: ${updated.poligonos[idx].nome_original}, Obs: ${updated.poligonos[idx].observacoes}`;
        updated.poligonos[idx].nome_original = editFields.nome || updated.poligonos[idx].nome_original;
        updated.poligonos[idx].observacoes = editFields.obs || updated.poligonos[idx].observacoes;
        depois = `Nome: ${updated.poligonos[idx].nome_original}, Obs: ${updated.poligonos[idx].observacoes}`;
        onTriggerAuditLog('EDIT_POLIGONO', `Polígono: ${id}`, antes, depois);
      }
    }

    onUpdateResult(recalculateAddressSummary(updated));
    setEditingId(null);
  };

  return (
    <div className="space-y-6 animate-fade-in" id="workspace-table-screen">
      {/* Search Header toolbar */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-white p-4 rounded border border-slate-300 shadow-xs">
        {/* Horizontal tabs */}
        <div className="flex flex-wrap gap-1.5 w-full md:w-auto" id="sheet-nav-tabs">
          {[
            { id: 'features', label: 'Features' },
            { id: 'pontos', label: 'Pontos' },
            { id: 'trechos', label: 'Trechos (Cabos)' },
            { id: 'poligonos', label: 'Polígonos' },
            { id: 'enderecos', label: 'Endereços / Fonte' },
            { id: 'associacoes', label: 'Associações' },
            { id: 'erros', label: 'Alertas' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id as any); setEditingId(null); }}
              className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider rounded border transition duration-150 flex items-center gap-1 ${
                activeTab === tab.id
                  ? 'bg-indigo-600 text-white border-indigo-700 font-bold shadow-xs'
                  : 'text-slate-500 bg-slate-50 border-slate-300 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {onGeocodeTrechos && (
          <button
            type="button"
            onClick={onGeocodeTrechos}
            disabled={isGeocodingTrechos || (result.trechos.length === 0 && result.poligonos.length === 0)}
            className="px-3 py-2 text-[11px] font-bold uppercase tracking-wider rounded border border-emerald-700 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white transition flex items-center gap-1.5"
            title="Geocodificar amostras de linhas e polígonos"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isGeocodingTrechos ? 'animate-spin' : ''}`} />
            Endereçar Trechos
          </button>
        )}

        {/* Global Filter Search */}
        <div className="relative w-full md:w-72">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Buscar em ${activeTab}...`}
            className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 rounded bg-slate-50 font-mono focus:outline-none focus:bg-white focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            id="sheet-filter-search-input"
          />
          <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
        </div>
      </div>

      {/* Grid rendering by sheets */}
      <div className="bg-white rounded border border-slate-300 shadow-xs overflow-x-auto" id="data-tables-rendering-container">
        
        {/* Features sheet */}
        {activeTab === 'features' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <th className="p-3">ID Feature</th>
                <th className="p-3">Nome KML</th>
                <th className="p-3">Pasta / Hierarquia</th>
                <th className="p-3">Geometria</th>
                <th className="p-3">Latitude Princ.</th>
                <th className="p-3">Longitude Princ.</th>
                <th className="p-3">Extensão/Área</th>
                <th className="p-3 text-center">Validação</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredFeatures.map(f => (
                <tr key={f.feature_id} className="hover:bg-slate-50/50">
                  <td className="p-3 font-mono font-semibold text-indigo-600 selection:bg-slate-100">{f.feature_id}</td>
                  <td className="p-3">
                    {editingId === f.feature_id ? (
                      <input
                        type="text"
                        value={editFields.nome}
                        onChange={(e) => setEditFields({ ...editFields, nome: e.target.value })}
                        className="p-1 border border-slate-200 rounded bg-white w-full text-xs"
                      />
                    ) : (
                      <span className="font-semibold text-slate-700">{f.placemark_nome}</span>
                    )}
                  </td>
                  <td className="p-3 text-slate-400 font-medium italic">{f.caminho_pasta}</td>
                  <td className="p-3">
                    <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono text-[10px] font-bold">
                      {f.geometry_type}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-slate-500">{f.latitude_principal.toFixed(6)}</td>
                  <td className="p-3 font-mono text-slate-500">{f.longitude_principal.toFixed(6)}</td>
                  <td className="p-3 text-slate-600">
                    {f.geometry_type === 'LineString' 
                      ? `${(f.comprimento_m).toFixed(1)}m` 
                      : f.geometry_type === 'Polygon' 
                        ? `${(f.area_m2).toFixed(1)}m²` 
                        : 'N/A'
                    }
                  </td>
                  <td className="p-3 text-center">
                    {editingId === f.feature_id ? (
                      <select
                        value={editFields.status}
                        onChange={(e) => setEditFields({ ...editFields, status: e.target.value })}
                        className="p-1 border border-slate-200 rounded text-xs"
                      >
                        <option value="Válido">Válido</option>
                        <option value="Inválido">Inválido</option>
                        <option value="Incompleto">Incompleto</option>
                        <option value="Atenção">Atenção</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] inline-block ${
                        f.status_validacao === 'Válido' ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' :
                        f.status_validacao === 'Atenção' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                        'bg-rose-50 text-rose-600 border border-rose-100'
                      }`}>
                        {f.status_validacao}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {editingId === f.feature_id ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleSaveEdit('features', f.feature_id)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 p-1 rounded">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="bg-rose-50 hover:bg-rose-100 text-rose-600 p-1 rounded">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartEdit(f.feature_id, { nome: f.placemark_nome, descricao: f.placemark_descricao, status: f.status_validacao })}
                        className="text-slate-400 hover:text-indigo-600 p-1 transition rounded hover:bg-slate-100"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Points sheet */}
        {activeTab === 'pontos' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <th className="p-3">ID Ponto</th>
                <th className="p-3">Ref Feature</th>
                <th className="p-3">Tipo Ponto</th>
                <th className="p-3">Origem</th>
                <th className="p-3">Coordenadas</th>
                <th className="p-3">Endereço / Origem</th>
                <th className="p-3">Status API</th>
                <th className="p-3 text-center">Exatidão</th>
                <th className="p-3 text-center">Resolução</th>
                <th className="p-3">Revisão</th>
                <th className="p-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredPoints.map(p => (
                <tr key={p.point_id} className="hover:bg-slate-50/50">
                  <td className="p-3 font-mono font-semibold text-slate-700">{p.point_id}</td>
                  <td className="p-3 font-mono text-indigo-600">{p.feature_id}</td>
                  <td className="p-3 font-semibold text-slate-600">{p.tipo_ponto}</td>
                  <td className="p-3 text-slate-400 italic">{p.origem_ponto}</td>
                  <td className="p-3 font-mono text-slate-500">({p.latitude.toFixed(5)}, {p.longitude.toFixed(5)})</td>
                  <td className="p-3 max-w-sm">
                    {editingId === p.point_id ? (
                      <input
                        type="text"
                        value={editFields.endereco}
                        onChange={(e) => setEditFields({ ...editFields, endereco: e.target.value })}
                        className="p-1 border border-slate-200 rounded w-full bg-white text-xs"
                      />
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="font-semibold text-slate-700 text-xs block leading-tight">{p.endereco_formatado || 'Desconhecido/Pendente'}</span>
                        <SourceBadge source={getAddressRecordForCoords(result, p.latitude, p.longitude)?.fonte || p.origem_endereco} />
                        {p.conflito_endereco && (
                          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-1 leading-snug">
                            {p.conflito_endereco}
                          </span>
                        )}
                        {(p.logradouro || p.bairro || p.cep) && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {p.logradouro && (
                              <span className="bg-slate-100 text-slate-700 text-[9px] px-1 py-0.5 rounded-sm font-medium">
                                Rua: {p.logradouro}{p.numero ? ` (Nº ${p.numero})` : ''}
                              </span>
                            )}
                            {p.bairro && (
                              <span className="bg-slate-100 text-slate-700 text-[9px] px-1 py-0.5 rounded-sm font-medium">
                                Bairro: {p.bairro}
                              </span>
                            )}
                            {p.municipio && (
                              <span className="bg-slate-100 text-slate-700 text-[9px] px-1 py-0.5 rounded-sm font-medium">
                                Cid: {p.municipio}
                              </span>
                            )}
                            {p.cep && (
                              <span className="bg-slate-100 text-slate-700 text-[9px] px-1 py-0.5 rounded-sm font-medium font-mono">
                                CEP: {p.cep}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded font-mono text-[9px] font-bold ${
                      p.status_api === 'SUCESSO' ? 'bg-emerald-100 text-emerald-800' :
                      p.status_api === 'Mocked' ? 'bg-indigo-100 text-indigo-800' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {p.status_api || 'PENDENTE'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <AccuracyBadges item={p} />
                  </td>
                  <td className="p-3 text-center">
                    {(() => {
                      const badge = getPointStatus(p);
                      return (
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${badge.color}`}>
                          {badge.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="p-3">
                    {editingId === p.point_id ? (
                      <select
                        value={editFields.revisado}
                        onChange={(e) => setEditFields({ ...editFields, revisado: e.target.value })}
                        className="p-1 border border-slate-200 rounded"
                      >
                        <option value="SIM">SIM (Ok)</option>
                        <option value="NÃO">NÃO (Revisar)</option>
                      </select>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        !p.necessita_revisao ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-rose-50 text-rose-600 border border-rose-100'
                      }`}>
                        {!p.necessita_revisao ? 'Ok' : 'Revisar'}
                      </span>
                    )}
                  </td>
                  <td className="p-3 text-right">
                    {editingId === p.point_id ? (
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleSaveEdit('pontos', p.point_id)} className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 p-1 rounded">
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="bg-rose-50 hover:bg-rose-100 text-rose-600 p-1 rounded">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleStartEdit(p.point_id, { endereco: p.endereco_formatado || '', obs: p.observacoes, revisado: p.necessita_revisao ? 'NÃO' : 'SIM' })}
                        className="text-slate-400 hover:text-indigo-600 p-1 transition rounded hover:bg-slate-100"
                      >
                        <Edit className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === 'trechos' && (
          <TrechosTable
            result={result}
            trechos={filteredTrechos}
            editingId={editingId}
            editFields={editFields}
            setEditFields={setEditFields}
            setEditingId={setEditingId}
            onStartEdit={handleStartEdit}
            onSaveEdit={(id) => handleSaveEdit('trechos', id)}
            onInvertTrecho={handleInvertTrecho}
          />
        )}

        {activeTab === 'poligonos' && (
          <PoligonosTable
            result={result}
            poligonos={filteredPoligonas}
            onStartEdit={handleStartEdit}
          />
        )}

        {/* Addresses sheets */}
        {activeTab === 'enderecos' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <th className="p-3">ID Consulta</th>
                <th className="p-3">Coordenada Normalizada</th>
                <th className="p-3">Endereço Retornado</th>
                <th className="p-3">Bairro</th>
                <th className="p-3">Município - UF</th>
                <th className="p-3">CEP</th>
                <th className="p-3">Fonte</th>
                <th className="p-3">Cache Hit</th>
                <th className="p-3 text-center">Resolução</th>
                <th className="p-3">Revisão</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredEnderecos.map(e => (
                <tr key={e.consulta_id} className="hover:bg-slate-50/50">
                  <td className="p-3 font-mono font-semibold text-indigo-600">{e.consulta_id}</td>
                  <td className="p-3 font-mono text-slate-500">{e.coordenada_normalizada}</td>
                  <td className="p-3 font-medium text-slate-700 max-w-xs truncate" title={e.endereco_formatado}>
                    {e.endereco_formatado || 'Sem resultado'}
                  </td>
                  <td className="p-3 text-slate-600">{e.bairro || 'N/A'}</td>
                  <td className="p-3 text-slate-700">{e.municipio ? `${e.municipio} - ${e.uf || ''}` : 'N/A'}</td>
                  <td className="p-3 font-mono text-slate-500">{e.cep || 'N/A'}</td>
                  <td className="p-3">
                    <SourceBadge source={e.fonte} />
                  </td>
                  <td className="p-3 font-bold text-slate-500">{e.cache_hit ? 'SIM' : 'NÃO'}</td>
                  <td className="p-3 text-center">
                    {(() => {
                      const badge = getAddressStatusForCoords(result, e.latitude, e.longitude, e.endereco_formatado);
                      return (
                        <span className={`px-2 py-0.5 rounded-full font-bold text-[10px] border ${badge.color}`}>
                          {badge.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold ${
                      !e.necessita_revisao ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                    }`}>
                      {!e.necessita_revisao ? 'Ok' : 'Revisar'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Associations Sheet */}
        {activeTab === 'associacoes' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <th className="p-3">ID Associação</th>
                <th className="p-3">Relação Logística</th>
                <th className="p-3">Feature Origem</th>
                <th className="p-3">Feature Destino</th>
                <th className="p-3 text-right">Distância</th>
                <th className="p-3">Método GIS</th>
                <th className="p-3">Confiança</th>
                <th className="p-3">Estado</th>
                <th className="p-3">Observações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {result.associacoes.map(a => (
                <tr key={a.associacao_id} className="hover:bg-slate-50/50">
                  <td className="p-3 font-mono font-semibold text-slate-600">{a.associacao_id}</td>
                  <td className="p-3 font-semibold text-slate-700">{a.tipo_associacao}</td>
                  <td className="p-3 font-mono text-indigo-500">{a.feature_a}</td>
                  <td className="p-3 font-mono text-indigo-500">{a.feature_b}</td>
                  <td className="p-3 text-right font-mono font-medium text-slate-800">{a.distancia_m.toFixed(1)}m</td>
                  <td className="p-3 text-slate-400 italic">{a.metodo}</td>
                  <td className="p-3">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      a.confianca === 'Alta' ? 'bg-emerald-55 text-emerald-700 bg-emerald-50/50' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {a.confianca}
                    </span>
                  </td>
                  <td className="p-3 font-medium text-slate-600">{a.status}</td>
                  <td className="p-3 text-slate-400">{a.observacoes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Errors / warnings sheet */}
        {activeTab === 'erros' && (
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                <th className="p-3">ID Alerta</th>
                <th className="p-3">Severidade</th>
                <th className="p-3">Categoria</th>
                <th className="p-3">Mensagem do Sistema</th>
                <th className="p-3">Detalhe Técnico</th>
                <th className="p-3">Ação Recomendada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {result.errosAlertas.map(e => (
                <tr key={e.erro_id} className="hover:bg-slate-50/50">
                  <td className="p-3 font-mono font-semibold text-rose-600">{e.erro_id}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                      {e.severidade}
                    </span>
                  </td>
                  <td className="p-3 font-bold text-slate-500 uppercase">{e.categoria}</td>
                  <td className="p-3 font-medium text-slate-800">{e.mensagem}</td>
                  <td className="p-3 font-mono text-slate-400 max-w-xs truncate" title={e.detalhe_tecnico}>{e.detalhe_tecnico}</td>
                  <td className="p-3 text-indigo-650 font-medium italic">{e.acao_recomendada}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
