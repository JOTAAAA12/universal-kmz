import React, { useState } from 'react';
import { 
  Download, FileSpreadsheet, Archive, Map, FileJson, CheckCircle, ShieldAlert, FileCode
} from 'lucide-react';
import { ParserResult } from '../types';
import { generateGeoJson, generateKml, generateWorkbook } from '../exporters';
import * as XLSX from 'xlsx';

interface DownloadViewProps {
  result: ParserResult;
  originalName: string;
}

export default function DownloadView({ result, originalName }: DownloadViewProps) {
  const [downloadingType, setDownloadingType] = useState<string | null>(null);

  // Trigger file download via client blob trigger
  const triggerDownload = async (endpoint: string, payload: any, defaultFilename: string) => {
    setDownloadingType(endpoint);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error('Falha no download.');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', defaultFilename);
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('Erro ao tentar baixar o arquivo. Verifique se o servidor está ativo.');
    } finally {
      setDownloadingType(null);
    }
  };

  // Trigger individual file downloads locally 
  const handleDownloadLocalFile = (content: string | Blob, mimeType: string, filename: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);
  };

  // States for custom metadata export selection
  const [exportTable, setExportTable] = useState<'Todo' | 'Pontos' | 'Enderecos' | 'Auditoria' | 'Trechos' | 'Trechos_Enderecos'>('Todo');
  const [exportFormat, setExportFormat] = useState<'xlsx' | 'csv'>('xlsx');

  const handleExportCustomMetadata = () => {
    try {
      const fileBaseName = originalName.replace(/\.[^/.]+$/, '');
      const wb = generateWorkbook(result);
      
      if (exportFormat === 'xlsx') {
        if (exportTable === 'Todo') {
          // Full metadata workbook export
          const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          handleDownloadLocalFile(blob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${fileBaseName}-metadados-completos.xlsx`);
        } else {
          // Export selected sheet as single-sheet workbook
          const singleWb = XLSX.utils.book_new();
          const ws = wb.Sheets[exportTable];
          if (!ws) throw new Error(`Planilha ${exportTable} não encontrada.`);
          XLSX.utils.book_append_sheet(singleWb, ws, exportTable);
          
          const wbout = XLSX.write(singleWb, { bookType: 'xlsx', type: 'array' });
          const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
          handleDownloadLocalFile(blob, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${fileBaseName}-metadados-${exportTable.toLowerCase()}.xlsx`);
        }
      } else { // exporting as csv
        if (exportTable === 'Todo') {
          // To export all in CSV format, we'll pack them in a zip or prompt user
          alert('Para exportar todos os dados combinados em CSV, use a opção de baixar o arquivo ZIP principal (que já inclui todos os arquivos CSV individuais nas subpastas) ou selecione uma tabela específica na lista acima para download instantâneo de CSV.');
          return;
        }
        
        const ws = wb.Sheets[exportTable];
        if (!ws) throw new Error(`Planilha ${exportTable} não encontrada.`);
        
        // Convert to CSV string
        const csvContent = XLSX.utils.sheet_to_csv(ws);
        // Include UTF-8 BOM so Excel opens PT-BR accents beautifully
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        handleDownloadLocalFile(blob, 'text/csv;charset=utf-8;', `${fileBaseName}-metadados-${exportTable.toLowerCase()}.csv`);
      }
    } catch (error: any) {
      console.error(error);
      alert(`Erro na exportação de metadados: ${error.message}`);
    }
  };

  const handleDownloadXlsx = () => {
    const fileBaseName = originalName.replace(/\.[^/.]+$/, '');
    triggerDownload('/api/export-xlsx', { data: result, filename: `${fileBaseName}-dados-completos.xlsx` }, `${fileBaseName}-dados-completos.xlsx`);
  };

  const handleDownloadZip = () => {
    const fileBaseName = originalName.replace(/\.[^/.]+$/, '');
    triggerDownload('/api/export-zip', { data: result, filename: `${fileBaseName}-pacote-completo.zip`, originalName }, `${fileBaseName}-pacote-completo.zip`);
  };

  const handleDownloadJson = () => {
    const fileBaseName = originalName.replace(/\.[^/.]+$/, '');
    handleDownloadLocalFile(JSON.stringify(result, null, 2), 'application/json', `${fileBaseName}-dados-normalizados.json`);
  };

  const handleDownloadGeoJson = () => {
    const fileBaseName = originalName.replace(/\.[^/.]+$/, '');
    const geoJsonContent = generateGeoJson(result);
    handleDownloadLocalFile(geoJsonContent, 'application/geo+json', `${fileBaseName}-features.geojson`);
  };

  const handleDownloadKml = () => {
    const fileBaseName = originalName.replace(/\.[^/.]+$/, '');
    const kmlContent = generateKml(result);
    handleDownloadLocalFile(kmlContent, 'application/vnd.google-earth.kml+xml;charset=utf-8;', `${fileBaseName}-features.kml`);
  };

  // Filtered download sets
  const handleDownloadFiltered = (category: 'linhas' | 'pontos' | 'poligonos') => {
    const filteredResult = { ...result };
    const fileBaseName = originalName.replace(/\.[^/.]+$/, '');

    if (category === 'linhas') {
      filteredResult.pontos = [];
      filteredResult.poligonos = [];
      triggerDownload('/api/export-xlsx', { data: filteredResult, filename: `${fileBaseName}-apenas-trechos.xlsx` }, `${fileBaseName}-apenas-trechos.xlsx`);
    } else if (category === 'pontos') {
      filteredResult.trechos = [];
      filteredResult.poligonos = [];
      triggerDownload('/api/export-xlsx', { data: filteredResult, filename: `${fileBaseName}-apenas-pontos.xlsx` }, `${fileBaseName}-apenas-pontos.xlsx`);
    } else if (category === 'poligonos') {
      filteredResult.trechos = [];
      filteredResult.pontos = [];
      triggerDownload('/api/export-xlsx', { data: filteredResult, filename: `${fileBaseName}-apenas-poligonos.xlsx` }, `${fileBaseName}-apenas-poligonos.xlsx`);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in font-sans" id="download-panel-screen">
      {/* Visual top */}
      <div>
        <h2 className="text-lg md:text-xl font-bold uppercase text-slate-900 tracking-tight">
          Download dos Dados e Relatórios de GIS
        </h2>
        <p className="text-xs text-slate-500 font-mono mt-0.5 uppercase">
          Exporte planilhas completas e pacotes geográficos normalizados em múltiplos formatos homologados.
        </p>
      </div>

      {/* Main Download Grid Card Options */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Option 1: ZIP Completo */}
        <div className="bg-indigo-50/40 p-5 rounded border border-indigo-200 flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-2">
            <div className="bg-indigo-600 text-white p-2 rounded w-fit">
              <Archive className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-xs">Pacote ZIP Completo</h3>
            <p className="text-xs text-slate-600 leading-relaxed font-mono">
              Contém a planilha XLSX principal, arquivos CSV separados de cada tabela, GeoJSON unificado, manifesto de auditoria e configurações.
            </p>
          </div>
          <button
            onClick={handleDownloadZip}
            disabled={downloadingType !== null}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-xs font-bold rounded border border-indigo-700 transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-xs"
          >
            {downloadingType === '/api/export-zip' ? (
              <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
            ) : <Download className="h-4 w-4" />}
            Baixar ZIP Completo
          </button>
        </div>

        {/* Option 2: Excel XLSX */}
        <div className="bg-white p-5 rounded border border-slate-300 flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-2">
            <div className="bg-slate-50 border border-slate-300 text-emerald-600 p-2 rounded w-fit">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-xs">Planilha XLSX</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-mono">
              Planilha Microsoft Excel contendo as abas relacionais formatadas (Resumo, Features, Pontos, Trechos, Trechos_Enderecos, Polígonos, Endereços).
            </p>
          </div>
          <button
            onClick={handleDownloadXlsx}
            disabled={downloadingType !== null}
            className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white text-xs font-bold rounded border border-emerald-700 transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-xs"
          >
            {downloadingType === '/api/export-xlsx' ? (
              <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
            ) : <Download className="h-4 w-4" />}
            Baixar Excel XLSX
          </button>
        </div>

        {/* Option 3: GeoJSON */}
        <div className="bg-white p-5 rounded border border-slate-300 flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-2">
            <div className="bg-slate-50 border border-slate-300 text-sky-600 p-2 rounded w-fit">
              <Map className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-xs">Vetor GeoJSON</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-mono">
              Coleção de feições espaciais (FeatureCollection) georreferenciadas prontas para carregar no QGIS, ArcGIS ou Leaflet de forma nativa.
            </p>
          </div>
          <button
            onClick={handleDownloadGeoJson}
            className="w-full py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold rounded border border-sky-700 transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-xs"
          >
            <Download className="h-4 w-4" />
            Baixar GeoJSON
          </button>
        </div>

        {/* Option 4: Normalised JSON */}
        <div className="bg-white p-5 rounded border border-slate-300 flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-2">
            <div className="bg-slate-50 border border-slate-300 text-amber-600 p-2 rounded w-fit">
              <FileJson className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-xs">JSON de Banco</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-mono">
              Dados normalizados brutos em formato plano estruturado, ideais para integrações via Webhook ou APIs secundárias corporativas.
            </p>
          </div>
          <button
            onClick={handleDownloadJson}
            className="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded border border-amber-700 transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-xs"
          >
            <Download className="h-4 w-4" />
            Baixar JSON Bruto
          </button>
        </div>

        {/* Option 5: Normalized KML */}
        <div className="bg-white p-5 rounded border border-slate-300 flex flex-col justify-between space-y-4 shadow-xs">
          <div className="space-y-2">
            <div className="bg-slate-50 border border-slate-300 text-violet-600 p-2 rounded w-fit">
              <FileCode className="h-5 w-5" />
            </div>
            <h3 className="font-bold text-slate-800 uppercase tracking-wider text-xs">KML Normalizado</h3>
            <p className="text-xs text-slate-500 leading-relaxed font-mono">
              Feições processadas em KML padrão para reabrir no Google Earth, QGIS ou ferramentas GIS compatíveis.
            </p>
          </div>
          <button
            onClick={handleDownloadKml}
            className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded border border-violet-700 transition cursor-pointer flex items-center justify-center gap-1.5 uppercase tracking-wider shadow-xs"
          >
            <Download className="h-4 w-4" />
            Baixar KML
          </button>
        </div>
      </div>

      {/* Seção de Exportador Customizado de Metadados */}
      <div className="bg-slate-50 border border-slate-300 rounded p-6 space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-widest flex items-center gap-1.5 font-sans">
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
            Exportador Avançado de Metadados do Workspace
          </h3>
          <p className="text-xs text-slate-500 font-mono mt-0.5 uppercase">
            Baixe tabelas dedicadas de coordenadas, endereços geocodificados e registros de auditoria em CSV ou Excel de forma instantânea.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-1">
          {/* Coluna 1: Escolha a Tabela de Metadados */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-sans">
              1. Selecionar Dados do Workspace
            </label>
            <div className="space-y-1.5">
              {[
                { id: 'Todo', label: 'Pasta de Trabalho Completa (Todas as Tabelas)', desc: 'Gera planilha consolidada com todas as abas agrupadas' },
                { id: 'Pontos', label: 'Coordenadas e Vértices dos Pontos', desc: 'Pontos e marcos geográficos com ID, altitude, tipo de resultado' },
                { id: 'Enderecos', label: 'Endereços Resolvidos (Geocoding)', desc: 'Logradouro, número, bairro, município, CEP e cota calculada' },
                { id: 'Auditoria', label: 'Logs e Registros de Auditoria', desc: 'Histórico completo de eventos, alterações e logs do workspace' },
                { id: 'Trechos', label: 'Trechos de Obra (Cabos)', desc: 'Segmentos de linha com coordenadas de início/fim e endereços complementares' },
                { id: 'Trechos_Enderecos', label: 'Endereços por Trecho', desc: 'Logradouro dominante por segmento de linha, extensão e revisão' },
              ].map((tab) => (
                <label 
                  key={tab.id}
                  onClick={() => setExportTable(tab.id as any)}
                  className={`flex items-start gap-2.5 p-2.5 rounded border cursor-pointer transition select-none ${
                    exportTable === tab.id 
                      ? 'border-indigo-600 bg-indigo-50/40 text-slate-900' 
                      : 'border-slate-300 hover:border-slate-400 hover:bg-slate-100/40 text-slate-700'
                  }`}
                >
                  <input 
                    type="radio" 
                    name="exportTable" 
                    checked={exportTable === tab.id}
                    onChange={() => {}} // handled by onClick on label safely
                    className="mt-0.5 accent-indigo-600 pointer-events-none"
                  />
                  <div>
                    <span className="text-xs font-bold block leading-tight">{tab.label}</span>
                    <span className="text-[10px] text-slate-500 block mt-0.5 font-mono leading-normal">{tab.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Coluna 2: Escolha o Formato e Baixar */}
          <div className="flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block font-sans">
                2. Selecionar Formato de Saída
              </span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setExportFormat('xlsx')}
                  className={`p-4 rounded border text-center transition cursor-pointer flex flex-col items-center justify-center space-y-1.5 ${
                    exportFormat === 'xlsx'
                      ? 'border-emerald-600 bg-emerald-50/20 text-emerald-700 font-bold shadow-xs'
                      : 'border-slate-300 hover:bg-slate-100/60 text-slate-600'
                  }`}
                >
                  <FileSpreadsheet className="h-5 w-5" />
                  <div className="text-[10px] font-bold uppercase tracking-wider font-sans">Excel (.xlsx)</div>
                </button>

                <button
                  type="button"
                  onClick={() => setExportFormat('csv')}
                  className={`p-4 rounded border text-center transition cursor-pointer flex flex-col items-center justify-center space-y-1.5 ${
                    exportFormat === 'csv'
                      ? 'border-indigo-600 bg-indigo-50/40 text-indigo-700 font-bold shadow-xs'
                      : 'border-slate-300 hover:bg-slate-100/60 text-slate-600'
                  }`}
                >
                  <Download className="h-5 w-5" />
                  <div className="text-[10px] font-bold uppercase tracking-wider font-sans">CSV (.csv)</div>
                </button>
              </div>

              <div className="bg-slate-100/80 rounded p-3.5 border border-slate-300 text-[11px] leading-relaxed text-slate-600 font-mono">
                {exportFormat === 'xlsx' ? (
                  <span>
                    O formato <strong>Microsoft Excel</strong> permite exportar planilhas com formatação legível, cabeçalhos otimizados em português brasileiro e compatibilidade instantânea com Office 365 e Google Planilhas.
                  </span>
                ) : (
                  <span>
                    O formato <strong>CSV (Valores Separados por Vírgula)</strong> exporta a tabela de metadados selecionada de forma plana com codificação UTF-8 (BOM incluído automaticamente), excelente para scripts Python, R ou ferramentas GIS integradas.
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleExportCustomMetadata}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-widest rounded border border-indigo-700 cursor-pointer shadow-sm transition flex items-center justify-center gap-2"
            >
              <Download className="h-4 w-4" />
              Executar Exportação de Metadados
            </button>
          </div>
        </div>
      </div>

      {/* Sub Filtered downloads area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-6 border-t border-slate-300">
        {/* Segmented Filter */}
        <div className="bg-white border border-slate-300 rounded p-5 space-y-3 lg:col-span-2">
          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
            <CheckCircle className="h-4 w-4 text-emerald-500" />
            Download Filtrado por Tipo de Geometria
          </h4>
          <p className="text-xs text-slate-500 font-mono">
            Prefere focar nas planilhas setoriais? Baixe apenas o preenchimento que deseja e reduza o volume de dados adicionais não essenciais.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              onClick={() => handleDownloadFiltered('linhas')}
              className="px-3.5 py-2 text-xs font-bold uppercase tracking-wider rounded bg-slate-50 border border-slate-300 hover:border-indigo-550 hover:bg-indigo-50/10 text-slate-705 text-slate-700 cursor-pointer transition"
            >
              Exportar Apenas Cabos (Linhas)
            </button>
            <button
              onClick={() => handleDownloadFiltered('pontos')}
              className="px-3.5 py-2 text-xs font-bold uppercase tracking-wider rounded bg-slate-50 border border-slate-300 hover:border-indigo-550 hover:bg-indigo-50/10 text-slate-705 text-slate-700 cursor-pointer transition"
            >
              Exportar Apenas Marcos (Pontos)
            </button>
            <button
              onClick={() => handleDownloadFiltered('poligonos')}
              className="px-3.5 py-2 text-xs font-bold uppercase tracking-wider rounded bg-slate-50 border border-slate-300 hover:border-indigo-550 hover:bg-indigo-50/10 text-slate-705 text-slate-700 cursor-pointer transition"
            >
              Exportar Apenas Áreas (Polígonos)
            </button>
          </div>
        </div>

        {/* Informative Limitations banner */}
        <div className="bg-rose-50 p-5 rounded border border-rose-200 space-y-2 flex flex-col justify-between">
          <div className="space-y-1">
            <span className="text-xs font-bold text-rose-800 uppercase tracking-widest flex items-center gap-1 text-[11px]">
              <ShieldAlert className="h-4 w-4 text-rose-550 shrink-0 text-rose-650" />
              Prevenção Técnica operacional
            </span>
            <p className="text-xs text-rose-900 leading-relaxed font-mono">
              Geocodificações reversas dependem da precisão oferecida no arquivo KML original e das limitações das APIs do Google.
            </p>
          </div>
          <div className="text-[10px] text-slate-400 font-mono uppercase tracking-wider">
            Versão de Homologação MVP
          </div>
        </div>
      </div>
    </div>
  );
}
