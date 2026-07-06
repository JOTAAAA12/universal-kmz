import React from 'react';
import { 
  FileText, Activity, Layers, TrendingUp, ShieldCheck, Gauge 
} from 'lucide-react';
import { ParserResult } from '../types';

interface SummaryViewProps {
  result: ParserResult;
}

export default function SummaryView({ result }: SummaryViewProps) {
  const { resumo } = result;

  const totalGeometries = resumo.quantidade_points + resumo.quantidade_linestrings + resumo.quantidade_polygons;
  const lengthKm = (resumo.comprimento_total_m / 1000).toFixed(2);
  const areaSqKm = (resumo.area_total_m2 / 1000000).toFixed(4);

  return (
    <div className="space-y-6 animate-fade-in font-sans" id="summary-dashboard-tab">
      {/* Title */}
      <div>
        <h2 className="text-lg md:text-xl font-bold uppercase text-slate-900 tracking-tight">
          Painel de Controle e Métricas de GIS
        </h2>
        <p className="text-xs text-slate-500 font-mono mt-0.5 uppercase">
          Metadados compilados e consistência matemática extraídos de {resumo.nome_arquivo}
        </p>
      </div>

      {/* Grid Cards dashboard info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="bg-white p-4 border border-slate-300 rounded flex items-start justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Entidades Totais</span>
            <p className="text-2xl font-bold font-mono text-slate-900">{totalGeometries}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Sendo {resumo.quantidade_placemarks} placemarks</p>
          </div>
          <div className="border border-slate-300 bg-slate-50 text-indigo-650 p-2 rounded text-indigo-600">
            <Layers className="h-4 w-4" />
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white p-4 border border-slate-300 rounded flex items-start justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Extensão Total</span>
            <p className="text-2xl font-bold font-mono text-slate-900">
              {lengthKm} <span className="text-xs font-normal text-slate-500 font-sans uppercase">km</span>
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">{resumo.quantidade_linestrings} trechos lineares</p>
          </div>
          <div className="border border-slate-300 bg-slate-50 text-sky-655 p-2 rounded text-sky-600">
            <TrendingUp className="h-4 w-4" />
          </div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white p-4 border border-slate-300 rounded flex items-start justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Área Abrangida</span>
            <p className="text-2xl font-bold font-mono text-slate-900">
              {areaSqKm} <span className="text-xs font-normal text-slate-500 font-sans uppercase">km²</span>
            </p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">{resumo.quantidade_polygons} polígonos mapeados</p>
          </div>
          <div className="border border-slate-300 bg-slate-50 text-emerald-655 p-2 rounded text-emerald-600">
            <ShieldCheck className="h-4 w-4" />
          </div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white p-4 border border-slate-300 rounded flex items-start justify-between shadow-xs">
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Vértices Geográficos</span>
            <p className="text-2xl font-bold font-mono text-slate-900">{resumo.total_vertices}</p>
            <p className="text-[10px] text-slate-400 uppercase tracking-wider font-mono">Média {(resumo.total_vertices / (totalGeometries || 1)).toFixed(1)} coords/fig</p>
          </div>
          <div className="border border-slate-300 bg-slate-50 text-amber-655 p-2 rounded text-amber-600">
            <Activity className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* Details structure sections split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Spatial Summary */}
        <div className="bg-white border border-slate-300 rounded p-5 space-y-4">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            DADOS ESTRUTURAIS DO ARQUIVO
          </h3>
          <div className="divide-y divide-slate-200 text-xs">
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Nome do arquivo</span>
              <span className="font-bold text-slate-800 break-all ml-4 text-right font-mono">{resumo.nome_arquivo}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Hash SHA256</span>
              <span className="font-mono text-[10px] text-slate-500 break-all ml-4 text-right">{resumo.hash_original}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Data de processamento</span>
              <span className="font-bold text-slate-800 font-mono">{new Date(resumo.data_processamento).toLocaleString()}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Documentos Internos</span>
              <span className="font-bold text-slate-800 font-mono">{resumo.quantidade_documents}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Pastas Aninhadas</span>
              <span className="font-bold text-slate-800 font-mono">{resumo.quantidade_folders}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Elementos MultiGeometry</span>
              <span className="font-bold text-slate-800 font-mono">{resumo.quantidade_multigeometry}</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Média por Linha</span>
              <span className="font-bold text-slate-800 font-mono">
                {(resumo.comprimento_total_m / (resumo.quantidade_linestrings || 1)).toFixed(1)} m
              </span>
            </div>
          </div>
        </div>

        {/* API Cost controls block */}
        <div className="bg-white border border-slate-300 rounded p-5 space-y-4 lg:col-span-2">
          <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
            <Gauge className="h-4 w-4 text-slate-400" />
            COTAS E ENRIQUECIMENTO DE ENDEREÇOS
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-slate-50 p-4 border border-slate-200 rounded space-y-2.5">
              <div className="flex justify-between items-center text-xs">
                <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Coordenadas únicas</span>
                <span className="font-bold font-mono text-slate-805 text-sm">{resumo.quantidade_coordenadas_unicas}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-t border-slate-200 pt-2">
                <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Consultas Realizadas</span>
                <span className="font-bold font-mono text-emerald-650 text-emerald-600 text-sm">{resumo.resultados_completos}</span>
              </div>
              <div className="flex justify-between items-center text-xs border-t border-slate-200 pt-2">
                <span className="text-slate-500 font-bold uppercase tracking-wider text-[10px]">Consultas Pendentes</span>
                <span className="font-bold font-mono text-amber-600 text-sm">{resumo.quantidade_coordenadas_unicas - resumo.resultados_completos}</span>
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Sinalizações do Compilador</span>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="bg-amber-50 text-amber-800 p-2 rounded border border-amber-200">
                  <p className="text-[10px] font-bold uppercase tracking-wider">Alertas</p>
                  <p className="text-xl font-bold font-mono mt-0.5">{resumo.alertas}</p>
                </div>
                <div className="bg-rose-50 text-rose-800 p-2 rounded border border-rose-200">
                  <p className="text-[10px] font-bold uppercase tracking-wider">Erros</p>
                  <p className="text-xl font-bold font-mono mt-0.5">{resumo.erros}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="text-[11px] text-slate-500 p-3 bg-slate-50 border border-slate-200 rounded leading-relaxed font-mono uppercase text-center">
            Duplicações geográficas em extremidades próximas são descartadas automaticamente para otimização operacional.
          </div>
        </div>
      </div>
    </div>
  );
}
