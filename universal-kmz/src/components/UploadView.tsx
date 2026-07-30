import React, { useEffect, useRef, useState } from 'react';
import { Upload, FileCode, CheckCircle2, ChevronRight, Settings, Info, CreditCard } from 'lucide-react';
import { ParserResult } from '../types';

interface UploadViewProps {
  onUploadSuccess: (result: ParserResult, originalFile: { name: string; size: number; raw: string }) => void;
  apiKey: string;
  setApiKey: (key: string) => void;
  processingType: string;
  setProcessingType: (t: string) => void;
  geocodeMode: string;
  setGeocodeMode: (m: string) => void;
  sampleInterval: number;
  setSampleInterval: (m: number) => void;
  toleranceGroup: number;
  setToleranceGroup: (m: number) => void;
  toleranceMatch: number;
  setToleranceMatch: (m: number) => void;
}

export default function UploadView({
  onUploadSuccess,
  apiKey,
  setApiKey,
  processingType,
  setProcessingType,
  geocodeMode,
  setGeocodeMode,
  sampleInterval,
  setSampleInterval,
  toleranceGroup,
  setToleranceGroup,
  toleranceMatch,
  setToleranceMatch
}: UploadViewProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [file, setFile] = useState<{ name: string; size: number; content: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileReaderRef = useRef<FileReader | null>(null);
  const uploadAbortControllerRef = useRef<AbortController | null>(null);

  const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

  const getRequestErrorMessage = (error: unknown) =>
    error instanceof Error && error.name === 'TimeoutError'
      ? 'O envio demorou demais. Tente novamente.'
      : error instanceof Error ? error.message : 'Falha de comunicação com o servidor secundário.';

  useEffect(() => () => {
    fileReaderRef.current?.abort();
    uploadAbortControllerRef.current?.abort();
  }, []);

  const calculateEstimateCost = () => {
    if (!file) return 0;
    // Basic estimate: 
    // real counts are calculated from coordinates once uploaded,
    // we can show a placeholder or standard rules depending on the mode.
    return geocodeMode === 'DESATIVADO' ? 0 : 25; // standard estimate indicator
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setIsDragActive(true);
    } else if (e.type === 'dragleave') {
      setIsDragActive(false);
    }
  };

  const processFileContents = (fileName: string, fileSize: number, base64OrText: string) => {
    // Max 50MB check
    if (fileSize > 50 * 1024 * 1024) {
      setErrorMsg('O tamanho máximo permitido de arquivo é de 50MB.');
      return;
    }

    if (!fileName.toLowerCase().endsWith('.kml') && !fileName.toLowerCase().endsWith('.kmz')) {
      setErrorMsg('Arquivo inválido. Envie apenas arquivos .kml ou .kmz.');
      return;
    }

    setFile({ name: fileName, size: fileSize, content: base64OrText });
    setErrorMsg('');
  };

  const readFile = (selectedFile: File) => {
    if (selectedFile.size > 50 * 1024 * 1024) {
      setErrorMsg('O tamanho máximo permitido de arquivo é de 50MB.');
      return;
    }
    if (!selectedFile.name.toLowerCase().endsWith('.kml') && !selectedFile.name.toLowerCase().endsWith('.kmz')) {
      setErrorMsg('Arquivo inválido. Envie apenas arquivos .kml ou .kmz.');
      return;
    }

    fileReaderRef.current?.abort();
    const reader = new FileReader();
    fileReaderRef.current = reader;
    setIsReadingFile(true);
    setErrorMsg('');
    reader.onerror = () => {
      if (fileReaderRef.current !== reader) return;
      fileReaderRef.current = null;
      setIsReadingFile(false);
      setErrorMsg('Não foi possível ler o arquivo selecionado. Tente novamente.');
    };
    reader.onabort = () => {
      if (fileReaderRef.current !== reader) return;
      fileReaderRef.current = null;
      setIsReadingFile(false);
    };
    reader.onload = (event) => {
      if (fileReaderRef.current !== reader) return;
      const content = event.target?.result as string;
      const normalizedContent = selectedFile.name.toLowerCase().endsWith('.kmz')
        ? content.split(',')[1] || content
        : content;
      processFileContents(selectedFile.name, selectedFile.size, normalizedContent);
      fileReaderRef.current = null;
      setIsReadingFile(false);
    };

    if (selectedFile.name.toLowerCase().endsWith('.kmz')) {
      reader.readAsDataURL(selectedFile);
    } else {
      reader.readAsText(selectedFile);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      readFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      readFile(e.target.files[0]);
    }
  };

  const handleProcess = async () => {
    if (!file) return;
    setLoading(true);
    setErrorMsg('');
    uploadAbortControllerRef.current?.abort();
    const uploadController = new AbortController();
    uploadAbortControllerRef.current = uploadController;

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: file.name,
          content: file.content,
          processingType,
          geocodeMode,
          sampleInterval,
          toleranceGroup,
          toleranceMatch
        }),
        signal: AbortSignal.any([uploadController.signal, AbortSignal.timeout(60_000)])
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erro desconhecido ao processar arquivo.');
      }

      const parsedResult: ParserResult = await response.json();
      
      // Update Resumo fields matching the modes and options configured
      parsedResult.resumo.modo_processamento = processingType;
      parsedResult.resumo.parametros_usados = `Tolerância de agrupamento: ${toleranceGroup}m, Tolerância proximidade: ${toleranceMatch}m, Intervalo Amostras: ${sampleInterval}m, Modo Geocode: ${geocodeMode}`;

      onUploadSuccess(parsedResult, {
        name: file.name,
        size: file.size,
        raw: file.content
      });
    } catch (err: unknown) {
      if (isAbortError(err)) return;
      setErrorMsg(getRequestErrorMessage(err));
    } finally {
      // Envio substituído por um novo não libera o botão: quem manda no estado
      // de carregamento é o envio vigente.
      if (uploadAbortControllerRef.current === uploadController) {
        uploadAbortControllerRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-8" id="upload-screen">
      {/* Visual Header */}
      <div className="text-center space-y-2">
        <h1 className="text-2xl md:text-3xl font-bold text-slate-900 uppercase tracking-tight">
          Universal KMZ/KML Reader & Geocoder
        </h1>
        <p className="text-slate-500 max-w-xl mx-auto text-xs md:text-sm">
          Extraia, mapeie, agrupe e geocodifique trechos e pontos residenciais diretamente do seu arquivo geográfico corporativo.
        </p>
      </div>

      {/* Main Drag Sandbox */}
      <div
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border border-dashed rounded p-8 md:p-12 text-center cursor-pointer transition duration-200 flex flex-col items-center justify-center space-y-4 ${
          isDragActive 
            ? 'border-indigo-600 bg-indigo-50/50' 
            : 'border-slate-300 hover:border-slate-400 bg-white shadow-xs'
        }`}
        id="drag-and-drop-container"
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileInput}
          accept=".kml,.kmz"
          className="hidden"
        />

        {isReadingFile ? (
          <div className="space-y-3 flex flex-col items-center animate-fade-in">
            <div className="bg-indigo-50 text-indigo-600 p-4 rounded-full border border-indigo-200">
              <FileCode className="h-8 w-8 animate-pulse" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-base">Lendo arquivo...</p>
              <p className="text-xs text-slate-400 mt-1">Arquivos grandes podem levar alguns instantes.</p>
            </div>
          </div>
        ) : file ? (
          <div className="space-y-3 flex flex-col items-center animate-fade-in">
            <div className="bg-emerald-50 text-emerald-600 p-4 rounded-full border border-emerald-200">
              <FileCode className="h-8 w-8" />
            </div>
            <div>
              <p className="font-bold text-slate-800 text-base font-mono break-all">{file.name}</p>
              <p className="text-xs text-slate-400 mt-1">{(file.size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1 rounded border border-emerald-200 font-bold uppercase tracking-wider">
              <CheckCircle2 className="h-4 w-4" /> Pronto para processar
            </div>
          </div>
        ) : (
          <div className="space-y-4 flex flex-col items-center">
            <div className="bg-slate-50 text-slate-400 p-4 rounded border border-slate-200">
              <Upload className="h-6 w-6 text-indigo-650 animate-pulse text-indigo-600" />
            </div>
            <div className="space-y-1">
              <p className="font-bold text-slate-700 md:text-base">
                Arraste seu arquivo KML ou KMZ ou <span className="text-indigo-600 font-bold underline">clique para buscar</span>
              </p>
              <p className="text-[11px] text-slate-400">
                Suporta KML bruto ou coleções compactadas KMZ com limite máximo de até 50MB.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Config Collapsible Header panel */}
      <div className="bg-white rounded border border-slate-300 overflow-hidden shadow-xs">
        <button
          onClick={() => setShowConfig(!showConfig)}
          className="w-full flex items-center justify-between p-4 bg-slate-50 border-b border-slate-300 text-slate-700 font-bold uppercase tracking-wider text-xs hover:bg-slate-100 transition duration-150"
          id="config-toggle-btn"
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-indigo-600" />
            <span>Configurações Adicionais e Escopo</span>
          </div>
          <ChevronRight className={`h-4 w-4 text-slate-400 transform transition-transform ${showConfig ? 'rotate-90' : ''}`} />
        </button>

        {showConfig && (
          <div className="p-5 space-y-6 animate-fade-in" id="config-panel-body">
            {/* API Key Ingress */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Chave pública do Google Maps (Navegador)</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={process.env.GOOGLE_MAPS_BROWSER_KEY ? 'Preenchida via Segredo do Sistema' : 'Cole sua chave pública para visualizar o mapa'}
                className="w-full p-2.5 border border-slate-300 rounded font-mono focus:border-indigo-500 focus:outline-none transition text-xs bg-slate-50/50"
              />
              <p className="text-[11px] text-slate-400 flex items-center gap-1">
                <Info className="h-3 w-3 text-slate-400 shrink-0" />
                Esta chave é apenas para o mapa no navegador. A geocodificação reversa real usa <b>GOOGLE_MAPS_SERVER_KEY</b> no servidor e falha fechado se ela não estiver configurada.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Type processing */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Tipo de Processamento</label>
                <select
                  value={processingType}
                  onChange={(e) => setProcessingType(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded bg-white text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option value="AUTO">Automático (Detecção pelo KML)</option>
                  <option value="PONTOS">Somente Pontos</option>
                  <option value="TRECHOS">Somente Linhas e Trechos</option>
                  <option value="POLIGONOS">Somente Polígonos de Área</option>
                  <option value="COMPLETO">Processamento Completo</option>
                </select>
              </div>

              {/* Geocode Mode */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">Modo de Geocodificação Reversa</label>
                <select
                  value={geocodeMode}
                  onChange={(e) => setGeocodeMode(e.target.value)}
                  className="w-full p-2.5 border border-slate-300 rounded bg-white text-xs focus:outline-none focus:border-indigo-500"
                >
                  <option value="DESATIVADO">Modo 1 - Desativado (Sem Google APIs)</option>
                  <option value="PONTOS">Modo 2 - Apenas Pontos originais do KML</option>
                  <option value="EXTREMIDADES">Modo 3 - Extremidades de linhas (Início e Fim)</option>
                  <option value="AMOSTRAGEM">Modo 4 - Amostragem ao longo das linhas</option>
                  <option value="COMPLETO">Modo 5 - Geocodificação Total (Pontos, Terminais, Polígonos, Amostras)</option>
                </select>
              </div>
            </div>

            {/* Tolerances settings */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-slate-200">
              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Intervalo de Amostragem (Linhas)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={sampleInterval}
                    onChange={(e) => setSampleInterval(Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded text-xs"
                  />
                  <span className="text-xs text-slate-400">metros</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tolerância de Agrupamento</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={toleranceGroup}
                    onChange={(e) => setToleranceGroup(Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded text-xs"
                  />
                  <span className="text-xs text-slate-400">metros</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider">Tolerância Associação Ponto-Linha</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    value={toleranceMatch}
                    onChange={(e) => setToleranceMatch(Number(e.target.value))}
                    className="w-full p-2 border border-slate-300 rounded text-xs"
                  />
                  <span className="text-xs text-slate-400">metros</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Estimations banner / alerts */}
      {file && (
        <div className="bg-amber-50 rounded p-4 border border-amber-200 flex items-start gap-4 animate-fade-in" id="estimation-banner">
          <CreditCard className="h-5 w-5 text-amber-605 shrink-0 mt-0.5 text-amber-700" />
          <div className="space-y-1 text-slate-700">
            <h4 className="font-bold text-amber-950 text-xs md:text-sm uppercase tracking-wider">Previsão e Auditoria Logística</h4>
            <p className="text-xs leading-relaxed text-amber-900/80">
              Com as configurações selecionadas (<b>{geocodeMode === 'DESATIVADO' ? 'Modo Sem APIs' : `Modo ${geocodeMode}`}</b>), o aplicativo irá ler todas as geometrias do KML e agrupar coordenadas duplicadas dentro de {toleranceGroup} metros para economizar sua cota.
            </p>
          </div>
        </div>
      )}

      {/* Technical Errors */}
      {errorMsg && (
        <span className="block text-center text-rose-600 text-xs font-mono font-bold bg-rose-50 border border-rose-200 p-3 rounded max-w-lg mx-auto whitespace-pre-line select-text" id="error-message-label">
          {errorMsg}
        </span>
      )}

      {/* Button Run */}
      {file && (
        <div className="text-center">
          <button
            onClick={handleProcess}
            disabled={loading}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-xs uppercase tracking-wider rounded border border-indigo-700 cursor-pointer transition flex items-center gap-2 mx-auto justify-center shadow-xs"
            id="run-process-btn"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                <span>Processando Geometrias KML...</span>
              </>
            ) : (
              <span>Carregar e Mapear Dados</span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
