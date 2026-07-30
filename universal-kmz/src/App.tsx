import React, { useEffect, useRef, useState } from 'react';

import {
  ParserResult,
  Coordinate,
  EnderecoConsulta,
  AuditoriaLog,
  EnderecoPoligono,
  TrechoEndereco
} from './types';
import UploadView from './components/UploadView';
import SummaryView from './components/SummaryView';
import TabelaView from './components/TabelaView';
import DownloadView from './components/DownloadView';
import MapView from './components/MapView';
import ProviderStatus from './components/ProviderStatus';
import { AppFooter, AppHeader } from './components/AppChrome';
import SettingsPanel from './components/SettingsPanel';
import SessionManager, { SavedSessionMeta } from './components/SessionManager';
import WorkflowNav from './components/WorkflowNav';
import GeocodeControlBar from './components/GeocodeControlBar';
import WorkspaceTabs, { WorkspaceTab } from './components/WorkspaceTabs';
import CoberturaAviso from './components/CoberturaAviso';
import { formatBytes } from './components/CnefeManager';
import { publishWorkspaceSnapshot } from './components/ErrorBoundary';
import { mergeExternalAddressRecord } from './addressConfidence';
import { mergeGeocodedBatch } from './pericialMerge';
import { detectUfs } from './ufBounds';
import {
  CnefeEstado,
  UfAusente,
  isRecord,
  normalizarEstadosCnefe,
  ufsSemCobertura
} from './cnefeCobertura';

interface AppSessionPayload {
  result: ParserResult;
  originalFile: { name: string; size: number; raw: string } | null;
  geocodeMode: string;
  sampleInterval: number;
  toleranceGroup: number;
  toleranceMatch: number;
  activeWorkspaceTab: WorkspaceTab;
}

interface CoberturaCnefe {
  ufsAusentes: UfAusente[];
  espacoLivre: string;
}

interface GeocodeRunOptions {
  coordinates?: Coordinate[];
  startIndex?: number;
  allowResume?: boolean;
}

const carregarEstadosCnefe = async (): Promise<CnefeEstado[]> => {
  const response = await fetch('/api/cnefe/estados');
  if (!response.ok) {
    throw new Error('Não foi possível consultar a cobertura CNEFE.');
  }
  return normalizarEstadosCnefe(await response.json());
};

// GET /api/cnefe/disco devolve { livre_bytes, usado_cnefe_bytes } — bytes crus.
// Nunca lança: o espaço livre é informativo e não pode suprimir o aviso de cobertura.
const carregarEspacoLivreCnefe = async (): Promise<string> => {
  try {
    const response = await fetch('/api/cnefe/disco');
    if (!response.ok) return 'indisponível';
    const payload: unknown = await response.json();
    if (!isRecord(payload) || typeof payload.livre_bytes !== 'number') return 'indisponível';
    return formatBytes(payload.livre_bytes);
  } catch {
    return 'indisponível';
  }
};

export default function App() {
  // Config state
  // A chave pública do Maps nunca vem no bundle: chega por GET /api/config no boot.
  const [apiKey, setApiKey] = useState('');
  const [mapId, setMapId] = useState('');
  const [processingType, setProcessingType] = useState('AUTO');
  const [geocodeMode, setGeocodeMode] = useState('COMPLETO');
  const [sampleInterval, setSampleInterval] = useState(100);
  const [toleranceGroup, setToleranceGroup] = useState(5);
  const [toleranceMatch, setToleranceMatch] = useState(30);

  // Loaded KML state
  const [result, setResult] = useState<ParserResult | null>(null);
  const [originalFile, setOriginalFile] = useState<{ name: string; size: number; raw: string } | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<WorkspaceTab>('summary');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [coberturaAviso, setCoberturaAviso] = useState<CoberturaCnefe | null>(null);
  const [downloadsCnefe, setDownloadsCnefe] = useState<Readonly<Record<string, string>>>({});
  const [regeocodificacaoCnefePendente, setRegeocodificacaoCnefePendente] = useState(false);
  const coberturaRequestRef = useRef(0);

  // Active geocoding loop state
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [geocodeError, setGeocodeError] = useState('');
  const [geocodeProgress, setGeocodeProgress] = useState(0);
  const [geocodeTotal, setGeocodeTotal] = useState(0);
  const cancelGeocodingRef = useRef(false);
  const [pendingCoords, setPendingCoords] = useState<Coordinate[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [geocodeJobId, setGeocodeJobId] = useState('');
  const [geocodeJobStatus, setGeocodeJobStatus] = useState<'idle' | 'running' | 'paused' | 'done' | 'error'>('idle');
  const jobAppliedCountRef = useRef(0);
  const geocodeAbortControllerRef = useRef<AbortController | null>(null);
  const pollAbortControllerRef = useRef<AbortController | null>(null);
  const trechosAbortControllerRef = useRef<AbortController | null>(null);

  const isAbortError = (error: unknown) => error instanceof Error && error.name === 'AbortError';

  const getRequestErrorMessage = (error: unknown, fallback: string) =>
    error instanceof Error && error.name === 'TimeoutError'
      ? 'A solicitação demorou demais. Tente novamente.'
      : error instanceof Error ? error.message : fallback;

  const signalWithTimeout = (controller: AbortController, timeoutMs: number) =>
    AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);

  const abortActiveGeocoding = () => {
    cancelGeocodingRef.current = true;
    geocodeAbortControllerRef.current?.abort();
    pollAbortControllerRef.current?.abort();
    trechosAbortControllerRef.current?.abort();
  };

  useEffect(() => () => {
    abortActiveGeocoding();
  }, []);

  // Boot: busca a chave pública do Maps e o Map ID no servidor. Falha em silêncio
  // (o app segue usável sem mapa) e nunca sobrescreve uma chave já digitada.
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/config', { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then((config: { googleMapsBrowserKey?: string; googleMapsMapId?: string } | null) => {
        if (!config) return;
        if (config.googleMapsBrowserKey) setApiKey(prev => prev || config.googleMapsBrowserKey || '');
        if (config.googleMapsMapId) setMapId(prev => prev || config.googleMapsMapId || '');
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const markDirty = () => {
    setHasUnsavedChanges(true);
  };

  // Unified logging for Auditoria tab
  const addAuditLog = (acao: string, entidade: string, antes: string, depois: string, status: 'SUCESSO' | 'ALERTA' | 'ERRO' = 'SUCESSO') => {
    markDirty();
    const log: AuditoriaLog = {
      timestamp: new Date().toISOString(),
      evento: `Edição manual no Workspace: ${acao}`,
      usuario: 'Operador',
      acao,
      entidade,
      antes,
      depois,
      origem: 'App UI',
      status
    };
    setResult(current => {
      if (!current) return current;
      return {
        ...current,
        auditoria: [log, ...current.auditoria]
      };
    });
  };

  const verificarCoberturaCnefe = async (parsed: ParserResult) => {
    const requestId = ++coberturaRequestRef.current;
    const ufsDetectadas = detectUfs(
      parsed.pontos
        .filter(ponto => Number.isFinite(ponto.latitude) && Number.isFinite(ponto.longitude))
        .map(ponto => ({ lat: ponto.latitude, lng: ponto.longitude }))
    );

    setCoberturaAviso(null);
    setDownloadsCnefe({});
    setRegeocodificacaoCnefePendente(false);

    if (ufsDetectadas.length === 0) return;

    try {
      const estados = await carregarEstadosCnefe();
      if (requestId !== coberturaRequestRef.current) return;

      const ufsAusentes = ufsSemCobertura(ufsDetectadas, estados);
      if (ufsAusentes.length === 0) return;

      const espacoLivre = await carregarEspacoLivreCnefe();
      if (requestId !== coberturaRequestRef.current) return;

      // Tamanho real por HEAD no IBGE: sem ele o usuário decidiria um download
      // de vários GB às cegas. Só as UFs exibidas são consultadas.
      const comTamanho = await Promise.all(ufsAusentes.map(async item => {
        if (item.tamanho) return item;
        try {
          const resposta = await fetch(`/api/cnefe/estados/${item.uf}/tamanho`);
          const dados = await resposta.json();
          const bytes = typeof dados?.bytes === 'number' ? dados.bytes : null;
          return bytes ? { ...item, tamanho: formatBytes(bytes) } : item;
        } catch {
          return item;
        }
      }));
      if (requestId !== coberturaRequestRef.current) return;

      setCoberturaAviso({ ufsAusentes: comTamanho, espacoLivre });
    } catch {
      if (requestId === coberturaRequestRef.current) {
        setCoberturaAviso(null);
      }
    }
  };

  const handleUploadSuccess = (parsed: ParserResult, orig: { name: string; size: number; raw: string }) => {
    setResult(parsed);
    setOriginalFile(orig);
    setActiveWorkspaceTab('summary');
    setHasUnsavedChanges(true);
    
    // Prep pending coordinates list based on configured geocoding mode
    analyzePendingCoordinates(parsed);
    setCurrentIndex(0);
    setGeocodeProgress(0);
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    jobAppliedCountRef.current = 0;
    void verificarCoberturaCnefe(parsed);
  };

  const analyzePendingCoordinates = (parsed: ParserResult, modeToUse = geocodeMode) => {
    const coordsMap: Record<string, Coordinate> = {};

    const addCoord = (lat: number, lng: number) => {
      // Group coords within tolerance (~5m grid is 5 decimal points)
      const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      coordsMap[key] = { lat, lng };
    };

    if (modeToUse === 'PONTOS' || modeToUse === 'COMPLETO') {
      parsed.pontos.forEach(p => addCoord(p.latitude, p.longitude));
    }

    if (modeToUse === 'EXTREMIDADES' || modeToUse === 'COMPLETO') {
      parsed.trechos.forEach(t => {
        addCoord(t.inicio_lat, t.inicio_lng);
        addCoord(t.fim_lat, t.fim_lng);
      });
    }

    if (modeToUse === 'AMOSTRAGEM' || modeToUse === 'COMPLETO') {
      // Create samples along line strings
      parsed.trechos.forEach(t => {
        addCoord(t.inicio_lat, t.inicio_lng);
        addCoord(t.fim_lat, t.fim_lng);
        // generate simplified amostragem point between extremities
        const midLat = (t.inicio_lat + t.fim_lat) / 2;
        const midLng = (t.inicio_lng + t.fim_lng) / 2;
        addCoord(midLat, midLng);
      });
    }

    const coordsArray = Object.values(coordsMap);
    setPendingCoords(coordsArray);
    setGeocodeTotal(coordsArray.length);
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    jobAppliedCountRef.current = 0;
    return coordsArray;
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const pollGeocodeJob = async (jobId: string, batchSignal: AbortSignal) => {
    const pollController = new AbortController();
    pollAbortControllerRef.current = pollController;

    try {
      while (!cancelGeocodingRef.current) {
        const res = await fetch(`/api/geocode/jobs/${jobId}`, {
          signal: AbortSignal.any([batchSignal, pollController.signal, AbortSignal.timeout(15_000)])
        });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Falha ao consultar progresso do job.');
      }

      const fetchedAddrs: EnderecoConsulta[] = data.resultados || data.results || [];
      const freshAddrs = fetchedAddrs.slice(jobAppliedCountRef.current);
        updateStateWithGeocodedAddresses(freshAddrs);
      jobAppliedCountRef.current = fetchedAddrs.length;

      setGeocodeProgress(data.feitos || 0);
      setCurrentIndex(data.feitos || 0);
      setGeocodeJobStatus(data.status || 'running');

      if (data.status === 'done') {
        addAuditLog('GEOCODE_COMPLETE', 'Processamento API', '-', `Processados: ${data.feitos}`, 'SUCESSO');
        break;
      }
      if (data.status === 'paused') {
        addAuditLog('GEOCODE_PAUSED', 'Processamento API', `Pausado em ${data.feitos}`, `Total: ${data.total}`, 'ALERTA');
        break;
      }
      if (data.status === 'error') {
        throw new Error(data.error || 'Job de geocodificação falhou.');
      }

      await wait(700);
      }
    } finally {
      if (pollAbortControllerRef.current === pollController) {
        pollAbortControllerRef.current = null;
      }
    }
  };

  const startOrResumeGeocodeJob = async (controller: AbortController, coordinates: Coordinate[], allowResume: boolean) => {
    cancelGeocodingRef.current = false;

    if (allowResume && geocodeJobId && geocodeJobStatus === 'paused') {
      const resumeResponse = await fetch(`/api/geocode/jobs/${geocodeJobId}/resume`, {
        method: 'POST',
        signal: signalWithTimeout(controller, 15_000)
      });
      const resumeData = await resumeResponse.json();
      if (!resumeResponse.ok) {
        throw new Error(resumeData?.error || 'Falha ao retomar job de geocodificação.');
      }
      setGeocodeJobStatus(resumeData.status || 'running');
      await pollGeocodeJob(geocodeJobId, controller.signal);
      return;
    }

    const response = await fetch('/api/geocode/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates }),
      signal: signalWithTimeout(controller, 30_000)
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Falha ao criar job de geocodificação.');
    }

    setGeocodeJobId(data.id);
    setGeocodeJobStatus(data.status || 'running');
    jobAppliedCountRef.current = 0;
    await pollGeocodeJob(data.id, controller.signal);
  };

  const tupleToCoordinate = (tuple: any): Coordinate | null => {
    if (!Array.isArray(tuple)) return null;
    const lng = Number(tuple[0]);
    const lat = Number(tuple[1]);
    const alt = tuple[2] === undefined ? undefined : Number(tuple[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return alt === undefined || Number.isFinite(alt) ? { lat, lng, alt } : { lat, lng };
  };

  const getFeatureGeometry = (featureId: string): any | null => {
    const feature = result?.features.find(item => item.feature_id === featureId);
    if (!feature?.geojson) return null;
    try {
      return JSON.parse(feature.geojson);
    } catch {
      return null;
    }
  };

  const getLineCoordinates = (featureId: string): Coordinate[] | null => {
    const geometry = getFeatureGeometry(featureId);
    if (geometry?.type !== 'LineString' || !Array.isArray(geometry.coordinates)) return null;
    const coords = geometry.coordinates.map(tupleToCoordinate);
    return coords.some((coord: Coordinate | null) => coord === null) ? null : coords as Coordinate[];
  };

  const getPolygonOuterRing = (featureId: string): Coordinate[] | null => {
    const geometry = getFeatureGeometry(featureId);
    const outerRing = geometry?.type === 'Polygon' && Array.isArray(geometry.coordinates)
      ? geometry.coordinates[0]
      : null;
    if (!Array.isArray(outerRing)) return null;
    const coords = outerRing.map(tupleToCoordinate);
    return coords.some((coord: Coordinate | null) => coord === null) ? null : coords as Coordinate[];
  };

  const mergeTrechosGeocodePayload = (
    current: ParserResult,
    payload: {
      trechos_por_linha?: Record<string, TrechoEndereco[]>;
      endereco_por_poligono?: Record<string, EnderecoPoligono>;
      results?: EnderecoConsulta[];
    }
  ): ParserResult => {
    const trechosEndereco = Object.values(payload.trechos_por_linha || {}).flat();
    const enderecosPoligono = Object.values(payload.endereco_por_poligono || {});
    const updatedEnderecos = (payload.results || []).reduce(
      (items, addr) => mergeExternalAddressRecord(items, addr),
      current.enderecos
    );
    const completedCount = updatedEnderecos.filter(item => item.endereco_formatado && item.status_api === 'SUCESSO').length;
    const geocodedRecords = updatedEnderecos.filter(item => item.fonte !== 'Original');

    return {
      ...current,
      trechos_endereco: trechosEndereco,
      enderecos_poligono: enderecosPoligono,
      enderecos: updatedEnderecos,
      resumo: {
        ...current.resumo,
        resultados_completos: completedCount,
        chamadas_realizadas: geocodedRecords.length
      }
    };
  };

  const handleStartTrechosGeocoding = async () => {
    if (!result) return;

    const linhas = result.trechos
      .map(trecho => ({
        id: trecho.trecho_id,
        coordenadas: getLineCoordinates(trecho.feature_id)
      }))
      .filter((item): item is { id: string; coordenadas: Coordinate[] } => Boolean(item.coordenadas && item.coordenadas.length >= 2));
    const poligonos = result.poligonos
      .map(poligono => ({
        id: poligono.poligono_id,
        anel_externo: getPolygonOuterRing(poligono.feature_id)
      }))
      .filter((item): item is { id: string; anel_externo: Coordinate[] } => Boolean(item.anel_externo && item.anel_externo.length >= 3));

    if (linhas.length === 0 && poligonos.length === 0) {
      setGeocodeError('Nenhuma linha ou polígono com geometria válida para endereçamento por trechos.');
      return;
    }

    setIsGeocoding(true);
    setGeocodeError('');
    setGeocodeJobStatus('running');
    setGeocodeTotal(linhas.length + poligonos.length);
    setGeocodeProgress(0);
    cancelGeocodingRef.current = false;
    trechosAbortControllerRef.current?.abort();
    const trechosController = new AbortController();
    trechosAbortControllerRef.current = trechosController;
    addAuditLog('GEOCODE_TRECHOS_START', 'Linhas e Polígonos', '-', `Linhas: ${linhas.length}; Polígonos: ${poligonos.length}`);

    try {
      const response = await fetch('/api/geocode/trechos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas, poligonos, stepMeters: sampleInterval }),
        signal: signalWithTimeout(trechosController, 60_000)
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao geocodificar trechos.');
      }

      setResult(current => current ? mergeTrechosGeocodePayload(current, data) : current);
      markDirty();
      setGeocodeTotal(data.total_amostras || linhas.length + poligonos.length);
      setGeocodeProgress(data.total_amostras || linhas.length + poligonos.length);
      setGeocodeJobStatus('done');
      if (data?.errors?.length) {
        setGeocodeError(`${data.errors.length} amostras exigem revisão ou falharam.`);
        addAuditLog('GEOCODE_TRECHOS_ALERT', 'Linhas e Polígonos', '-', JSON.stringify(data.errors), 'ALERTA');
      } else {
        addAuditLog('GEOCODE_TRECHOS_COMPLETE', 'Linhas e Polígonos', '-', `Amostras: ${data.total_amostras || 0}`, 'SUCESSO');
      }
    } catch (e) {
      if (isAbortError(e)) return;
      const message = getRequestErrorMessage(e, 'Falha inesperada na geocodificação por trechos.');
      setGeocodeError(message);
      setGeocodeJobStatus('error');
      addAuditLog('GEOCODE_TRECHOS_ERROR', 'Linhas e Polígonos', 'Processamento por trechos', message, 'ERRO');
    } finally {
      // Só a execução ainda vigente pode desligar o spinner: uma execução
      // substituída (abortada por um novo início) não deve apagar o estado
      // de carregamento que a execução nova acabou de ligar.
      if (trechosAbortControllerRef.current === trechosController) {
        trechosAbortControllerRef.current = null;
        setIsGeocoding(false);
      }
    }
  };

  // Run/Resume batch geocoding loop
  const handleStartGeocoding = async (options: GeocodeRunOptions = {}) => {
    const coordinates = options.coordinates || pendingCoords;
    const startIndex = options.startIndex ?? currentIndex;
    const allowResume = options.allowResume ?? true;

    if (!result || coordinates.length === 0) return;
    setIsGeocoding(true);
    setGeocodeError('');
    cancelGeocodingRef.current = false;
    geocodeAbortControllerRef.current?.abort();
    const geocodeController = new AbortController();
    geocodeAbortControllerRef.current = geocodeController;

    let idx = startIndex;

    // Record audit run starting
    addAuditLog('GEOCODE_START', 'Processamento API', `Registros a processar: ${coordinates.length}`, `Indice atual: ${idx}`);

    if (coordinates.length > 20) {
      try {
        await startOrResumeGeocodeJob(geocodeController, coordinates, allowResume);
      } catch (e) {
        if (isAbortError(e)) return;
        const message = getRequestErrorMessage(e, 'Falha inesperada no job de geocodificação.');
        setGeocodeError(message);
        addAuditLog('GEOCODE_ERROR', 'Processamento API', 'Job em lote', message, 'ERRO');
      } finally {
        if (geocodeAbortControllerRef.current === geocodeController) {
          geocodeAbortControllerRef.current = null;
          setIsGeocoding(false);
        }
      }
      return;
    }

    while (idx < coordinates.length && !cancelGeocodingRef.current) {
      const coord = coordinates[idx];
      setGeocodeProgress(idx + 1);
      setCurrentIndex(idx + 1);

      try {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coordinates: [coord]
          }),
          signal: signalWithTimeout(geocodeController, 30_000)
        });

        const data = await res.json();
        if (!res.ok) {
          const message = data?.error || data?.errors?.[0]?.provider_error_message || 'Falha na API de geocodificação.';
          setGeocodeError(message);
          addAuditLog('GEOCODE_ERROR', 'Processamento API', `Coordenada: ${coord.lat},${coord.lng}`, message, 'ERRO');
          cancelGeocodingRef.current = true;
          break;
        }

        const fetchedAddrs: EnderecoConsulta[] = Array.isArray(data) ? data : data.results || [];
        if (data?.errors?.length) {
          addAuditLog('GEOCODE_PROVIDER_ALERT', 'Google Geocoding API', '-', JSON.stringify(data.errors), 'ALERTA');
        }

        if (fetchedAddrs && fetchedAddrs.length > 0) {
          const addr = fetchedAddrs[0];
          
          // Reactively update Address state and map features live
          updateStateWithGeocodedAddresses([addr]);
          if (addr.necessita_revisao && addr.provider_error_message) {
            setGeocodeError(addr.provider_error_message);
          }
        }
      } catch (e) {
        if (isAbortError(e)) break;
        const message = getRequestErrorMessage(e, 'Falha inesperada na geocodificação.');
        setGeocodeError(message);
        addAuditLog('GEOCODE_ERROR', 'Processamento API', `Coordenada: ${coord.lat},${coord.lng}`, message, 'ERRO');
        cancelGeocodingRef.current = true;
        break;
      }

      // Small throttle/quota pause
      await new Promise(r => setTimeout(r, 600));
      idx++;
    }

    // Execução substituída por um novo início não encerra o spinner nem registra
    // desfecho na auditoria: a execução vigente é a dona desse estado.
    if (geocodeAbortControllerRef.current === geocodeController) {
      geocodeAbortControllerRef.current = null;
      setIsGeocoding(false);
      if (cancelGeocodingRef.current) {
        addAuditLog('GEOCODE_PAUSED', 'Processamento API', `Pausado em ${currentIndex}`, `Total: ${coordinates.length}`, 'ALERTA');
      } else {
        addAuditLog('GEOCODE_COMPLETE', 'Processamento API', '-', `Processados: ${coordinates.length}`, 'SUCESSO');
      }
    }
  };

  useEffect(() => {
    const ufsEmAcompanhamento = Object.entries(downloadsCnefe)
      .filter(([, estado]) => estado !== 'erro')
      .map(([uf]) => uf);

    if (ufsEmAcompanhamento.length === 0) return;

    let ativo = true;
    let requisicaoEmAndamento = false;
    const ufsConcluidas = new Set<string>();

    const atualizarDownloads = async () => {
      if (requisicaoEmAndamento) return;
      requisicaoEmAndamento = true;

      try {
        const estadosPorUf = new Map<string, string>(
          (await carregarEstadosCnefe()).map(estado => [estado.uf, estado.estado])
        );
        if (!ativo) return;

        const concluidasAgora = ufsEmAcompanhamento.filter(uf => estadosPorUf.get(uf) === 'pronto' && !ufsConcluidas.has(uf));
        concluidasAgora.forEach(uf => ufsConcluidas.add(uf));

        setDownloadsCnefe(atuais => {
          const proximos: [string, string][] = Object.entries<string>(atuais)
            .filter(([uf]) => !ufsConcluidas.has(uf))
            .map(([uf, estado]): [string, string] => [uf, estadosPorUf.get(uf) || estado]);
          const mudou = proximos.length !== Object.keys(atuais).length
            || proximos.some(([uf, estado]) => atuais[uf] !== estado);
          return mudou ? Object.fromEntries(proximos) : atuais;
        });

        if (concluidasAgora.length > 0) {
          setCoberturaAviso(atual => atual
            ? { ...atual, ufsAusentes: atual.ufsAusentes.filter(({ uf }) => !ufsConcluidas.has(uf)) }
            : atual
          );
          setRegeocodificacaoCnefePendente(true);
        }
      } catch {
        // A análise permanece disponível se o acompanhamento da fila falhar temporariamente.
      } finally {
        requisicaoEmAndamento = false;
      }
    };

    void atualizarDownloads();
    const intervalId = window.setInterval(() => void atualizarDownloads(), 2_000);

    return () => {
      ativo = false;
      window.clearInterval(intervalId);
    };
  }, [downloadsCnefe]);

  useEffect(() => {
    if (!regeocodificacaoCnefePendente || isGeocoding || !result) return;

    const coordinates = analyzePendingCoordinates(result);
    setCurrentIndex(0);
    setGeocodeProgress(0);
    setRegeocodificacaoCnefePendente(false);
    void handleStartGeocoding({ coordinates, startIndex: 0, allowResume: false });
  }, [geocodeMode, isGeocoding, regeocodificacaoCnefePendente, result]);

  const handleBaixarBaseCnefe = async (uf: string) => {
    const response = await fetch(`/api/cnefe/estados/${uf}/download`, { method: 'POST' });
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const mensagem = isRecord(payload) && typeof payload.error === 'string'
        ? payload.error
        : 'Não foi possível enfileirar o download da base CNEFE.';
      throw new Error(mensagem);
    }

    setDownloadsCnefe(atuais => ({ ...atuais, [uf]: 'enfileirado' }));
  };

  const handlePauseGeocoding = () => {
    abortActiveGeocoding();
    if (geocodeJobId && geocodeJobStatus === 'running') {
      void fetch(`/api/geocode/jobs/${geocodeJobId}/pause`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000)
      }).catch(error => {
        if (!isAbortError(error)) {
          setGeocodeError('Não foi possível confirmar a pausa do job no servidor.');
        }
      });
      setGeocodeJobStatus('paused');
    }
    setIsGeocoding(false);
  };

  const handleCancelGeocoding = () => {
    abortActiveGeocoding();
    setIsGeocoding(false);
    setCurrentIndex(0);
    setGeocodeProgress(0);
    if (geocodeJobId && geocodeJobStatus === 'running') {
      void fetch(`/api/geocode/jobs/${geocodeJobId}/pause`, {
        method: 'POST',
        signal: AbortSignal.timeout(15_000)
      }).catch(error => {
        if (!isAbortError(error)) {
          setGeocodeError('Não foi possível cancelar o job no servidor.');
        }
      });
    }
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    jobAppliedCountRef.current = 0;
  };

  // Merge one received batch in a single state pass while preserving the per-address rules.
  const updateStateWithGeocodedAddresses = (addresses: EnderecoConsulta[]) => {
    if (addresses.length === 0) return;

    markDirty();
    setResult(current => {
      if (!current) return current;
      return mergeGeocodedBatch(current, addresses);
    });
  };

  const resetWorkspace = () => {
    coberturaRequestRef.current += 1;
    setResult(null);
    setOriginalFile(null);
    setActiveWorkspaceTab('summary');
    setCurrentIndex(0);
    setGeocodeProgress(0);
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    setHasUnsavedChanges(false);
    setCoberturaAviso(null);
    setDownloadsCnefe({});
    setRegeocodificacaoCnefePendente(false);
    jobAppliedCountRef.current = 0;
  };

  const handleResetWorkspace = () => {
    if (hasUnsavedChanges && !window.confirm('Há alterações não salvas. Criar um novo arquivo mesmo assim?')) {
      return;
    }
    resetWorkspace();
  };

  const handleOpenUploadFromBreadcrumb = () => {
    handleResetWorkspace();
  };

  const handleUpdateResult = (updated: ParserResult) => {
    setResult(updated);
    markDirty();
  };

  const sessionPayload: AppSessionPayload | null = result ? {
    result,
    originalFile,
    geocodeMode,
    sampleInterval,
    toleranceGroup,
    toleranceMatch,
    activeWorkspaceTab
  } : null;

  useEffect(() => {
    publishWorkspaceSnapshot(sessionPayload);
  }, [activeWorkspaceTab, geocodeMode, originalFile, result, sampleInterval, toleranceGroup, toleranceMatch]);

  const defaultSessionName = originalFile?.name
    ? `${originalFile.name.replace(/\.(kml|kmz)$/i, '')} - ${new Date().toLocaleString('pt-BR')}`
    : `Sessão KMZ - ${new Date().toLocaleString('pt-BR')}`;

  const handleOpenSessionPayload = (payload: AppSessionPayload, session: SavedSessionMeta) => {
    if (!payload?.result) {
      window.alert('Sessão sem payload de resultado válido.');
      return;
    }
    if (hasUnsavedChanges && !window.confirm('Há alterações não salvas. Abrir outra sessão mesmo assim?')) {
      return;
    }
    coberturaRequestRef.current += 1;
    setResult(payload.result);
    setOriginalFile(payload.originalFile || { name: session.nome, size: 0, raw: '' });
    setGeocodeMode(payload.geocodeMode || 'COMPLETO');
    setSampleInterval(payload.sampleInterval || 100);
    setToleranceGroup(payload.toleranceGroup || 5);
    setToleranceMatch(payload.toleranceMatch || 30);
    setActiveWorkspaceTab(payload.activeWorkspaceTab || 'summary');
    analyzePendingCoordinates(payload.result, payload.geocodeMode || 'COMPLETO');
    setCurrentIndex(0);
    setGeocodeProgress(0);
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    setHasUnsavedChanges(false);
    setCoberturaAviso(null);
    setDownloadsCnefe({});
    setRegeocodificacaoCnefePendente(false);
    jobAppliedCountRef.current = 0;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans" id="application-root">
      <AppHeader
        fileName={result ? originalFile?.name : undefined}
        onReset={handleResetWorkspace}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSessions={() => setSessionsOpen(true)}
        onSaveSession={() => setSessionsOpen(true)}
        hasWorkspace={Boolean(result)}
        hasUnsavedChanges={hasUnsavedChanges}
      />

      {/* Main app body screen router */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {result ? (
          /* Real loaded Workspace state view */
          <div className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6 flex-1 overflow-y-auto" id="workspace-loaded-view">
            <WorkflowNav
              activeTab={activeWorkspaceTab}
              onBackToUpload={handleOpenUploadFromBreadcrumb}
              onNavigate={setActiveWorkspaceTab}
            />
            <GeocodeControlBar
              isGeocoding={isGeocoding}
              geocodeProgress={geocodeProgress}
              geocodeTotal={geocodeTotal}
              geocodeError={geocodeError}
              geocodeMode={geocodeMode}
              geocodeJobStatus={geocodeJobStatus}
              pendingCount={pendingCoords.length}
              currentIndex={currentIndex}
              onModeChange={(newMode) => {
                setGeocodeMode(newMode);
                analyzePendingCoordinates(result, newMode);
                setCurrentIndex(0);
                setGeocodeProgress(0);
              }}
              onStart={handleStartGeocoding}
              onPause={handlePauseGeocoding}
              onCancel={handleCancelGeocoding}
            />

            <ProviderStatus />

            {coberturaAviso && (
              <CoberturaAviso
                ufsAusentes={coberturaAviso.ufsAusentes}
                espacoLivre={coberturaAviso.espacoLivre}
                statusPorUf={downloadsCnefe}
                onBaixar={handleBaixarBaseCnefe}
                onDispensar={() => setCoberturaAviso(null)}
              />
            )}

            <WorkspaceTabs activeTab={activeWorkspaceTab} onChange={setActiveWorkspaceTab} />

            {/* Sandbox screen renders */}
            <div className="min-h-[400px]">
              {activeWorkspaceTab === 'summary' && (
                <SummaryView result={result} />
              )}

              {activeWorkspaceTab === 'map' && (
                <MapView result={result} apiKey={apiKey} mapId={mapId} />
              )}

              {activeWorkspaceTab === 'tables' && (
                <TabelaView 
                  result={result} 
                  onUpdateResult={handleUpdateResult} 
                  onTriggerAuditLog={addAuditLog}
                  onGeocodeTrechos={handleStartTrechosGeocoding}
                  isGeocodingTrechos={isGeocoding && geocodeJobStatus === 'running'}
                />
              )}

              {activeWorkspaceTab === 'download' && (
                <DownloadView result={result} originalName={originalFile?.name || 'dados.kml'} />
              )}
            </div>

          </div>
        ) : (
          /* Initial Empty upload state view */
          <div className="max-w-7xl w-full mx-auto p-4 md:p-6 flex-1 overflow-y-auto">
            <UploadView
              onUploadSuccess={handleUploadSuccess}
              apiKey={apiKey}
              setApiKey={setApiKey}
              processingType={processingType}
              setProcessingType={setProcessingType}
              geocodeMode={geocodeMode}
              setGeocodeMode={setGeocodeMode}
              sampleInterval={sampleInterval}
              setSampleInterval={setSampleInterval}
              toleranceGroup={toleranceGroup}
              setToleranceGroup={setToleranceGroup}
              toleranceMatch={toleranceMatch}
              setToleranceMatch={setToleranceMatch}
            />
            <div className="max-w-4xl mx-auto px-4 md:px-8 pb-8">
              <ProviderStatus />
            </div>
          </div>
        )}
      </main>

      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(stepMeters) => setSampleInterval(stepMeters)}
      />
      <SessionManager<AppSessionPayload>
        open={sessionsOpen}
        canSave={Boolean(result)}
        defaultName={defaultSessionName}
        payload={sessionPayload}
        onClose={() => setSessionsOpen(false)}
        onOpenPayload={handleOpenSessionPayload}
        onSaved={() => setHasUnsavedChanges(false)}
      />
      <AppFooter />
    </div>
  );
}
