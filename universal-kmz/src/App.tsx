import React, { useState, useRef } from 'react';
import { 
  Upload, LayoutDashboard, Map as MapIcon, TableProperties, Download, 
  Settings, RefreshCw, AlertTriangle, Play, Pause, Square, Plus, Trash2, 
  HelpCircle, Eye, LogOut, CheckCircle, BrainCircuit
} from 'lucide-react';

import {
  ParserResult,
  Coordinate,
  EnderecoConsulta,
  PointFeature,
  TrechoFeature,
  AuditoriaLog,
  EnderecoPoligono,
  TrechoEndereco
} from './types';
import UploadView from './components/UploadView';
import SummaryView from './components/SummaryView';
import TabelaView from './components/TabelaView';
import DownloadView from './components/DownloadView';
import MapView from './components/MapView';
import {
  buildExistingAddressConflict,
  mergeExternalAddressRecord,
  mergePointWithGeocodedAddress,
} from './addressConfidence';

export default function App() {
  // Config state
  const [apiKey, setApiKey] = useState(
    process.env.GOOGLE_MAPS_BROWSER_KEY || ''
  );
  const [processingType, setProcessingType] = useState('AUTO');
  const [geocodeMode, setGeocodeMode] = useState('COMPLETO');
  const [sampleInterval, setSampleInterval] = useState(100);
  const [toleranceGroup, setToleranceGroup] = useState(5);
  const [toleranceMatch, setToleranceMatch] = useState(30);

  // Loaded KML state
  const [result, setResult] = useState<ParserResult | null>(null);
  const [originalFile, setOriginalFile] = useState<{ name: string; size: number; raw: string } | null>(null);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'summary' | 'map' | 'tables' | 'download'>('summary');

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

  // Unified logging for Auditoria tab
  const addAuditLog = (acao: string, entidade: string, antes: string, depois: string, status: 'SUCESSO' | 'ALERTA' | 'ERRO' = 'SUCESSO') => {
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

  const handleUploadSuccess = (parsed: ParserResult, orig: { name: string; size: number; raw: string }) => {
    setResult(parsed);
    setOriginalFile(orig);
    setActiveWorkspaceTab('summary');
    
    // Prep pending coordinates list based on configured geocoding mode
    analyzePendingCoordinates(parsed);
    setCurrentIndex(0);
    setGeocodeProgress(0);
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    jobAppliedCountRef.current = 0;
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
  };

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const pollGeocodeJob = async (jobId: string) => {
    while (!cancelGeocodingRef.current) {
      const res = await fetch(`/api/geocode/jobs/${jobId}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Falha ao consultar progresso do job.');
      }

      const fetchedAddrs: EnderecoConsulta[] = data.resultados || data.results || [];
      const freshAddrs = fetchedAddrs.slice(jobAppliedCountRef.current);
      freshAddrs.forEach(addr => updateStateWithGeocodedAddress(addr));
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
  };

  const startOrResumeGeocodeJob = async () => {
    cancelGeocodingRef.current = false;

    if (geocodeJobId && geocodeJobStatus === 'paused') {
      const resumeResponse = await fetch(`/api/geocode/jobs/${geocodeJobId}/resume`, { method: 'POST' });
      const resumeData = await resumeResponse.json();
      if (!resumeResponse.ok) {
        throw new Error(resumeData?.error || 'Falha ao retomar job de geocodificação.');
      }
      setGeocodeJobStatus(resumeData.status || 'running');
      await pollGeocodeJob(geocodeJobId);
      return;
    }

    const response = await fetch('/api/geocode/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: pendingCoords })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || 'Falha ao criar job de geocodificação.');
    }

    setGeocodeJobId(data.id);
    setGeocodeJobStatus(data.status || 'running');
    jobAppliedCountRef.current = 0;
    await pollGeocodeJob(data.id);
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
    addAuditLog('GEOCODE_TRECHOS_START', 'Linhas e Polígonos', '-', `Linhas: ${linhas.length}; Polígonos: ${poligonos.length}`);

    try {
      const response = await fetch('/api/geocode/trechos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linhas, poligonos, stepMeters: sampleInterval })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Falha ao geocodificar trechos.');
      }

      setResult(current => current ? mergeTrechosGeocodePayload(current, data) : current);
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
      const message = e instanceof Error ? e.message : 'Falha inesperada na geocodificação por trechos.';
      setGeocodeError(message);
      setGeocodeJobStatus('error');
      addAuditLog('GEOCODE_TRECHOS_ERROR', 'Linhas e Polígonos', 'Processamento por trechos', message, 'ERRO');
    } finally {
      setIsGeocoding(false);
    }
  };

  // Run/Resume batch geocoding loop
  const handleStartGeocoding = async () => {
    if (!result || pendingCoords.length === 0) return;
    setIsGeocoding(true);
    setGeocodeError('');
    cancelGeocodingRef.current = false;

    let idx = currentIndex;

    // Record audit run starting
    addAuditLog('GEOCODE_START', 'Processamento API', `Registros a processar: ${pendingCoords.length}`, `Indice atual: ${idx}`);

    if (pendingCoords.length > 20) {
      try {
        await startOrResumeGeocodeJob();
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Falha inesperada no job de geocodificação.';
        setGeocodeError(message);
        addAuditLog('GEOCODE_ERROR', 'Processamento API', 'Job em lote', message, 'ERRO');
      } finally {
        setIsGeocoding(false);
      }
      return;
    }

    while (idx < pendingCoords.length && !cancelGeocodingRef.current) {
      const coord = pendingCoords[idx];
      setGeocodeProgress(idx + 1);
      setCurrentIndex(idx + 1);

      try {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coordinates: [coord]
          })
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
          updateStateWithGeocodedAddress(addr);
          if (addr.necessita_revisao && addr.provider_error_message) {
            setGeocodeError(addr.provider_error_message);
          }
        }
      } catch (e) {
        console.error('Batch geocoding step crash:', e);
        const message = e instanceof Error ? e.message : 'Falha inesperada na geocodificação.';
        setGeocodeError(message);
        addAuditLog('GEOCODE_ERROR', 'Processamento API', `Coordenada: ${coord.lat},${coord.lng}`, message, 'ERRO');
        cancelGeocodingRef.current = true;
        break;
      }

      // Small throttle/quota pause
      await new Promise(r => setTimeout(r, 600));
      idx++;
    }

    setIsGeocoding(false);
    if (cancelGeocodingRef.current) {
      addAuditLog('GEOCODE_PAUSED', 'Processamento API', `Pausado em ${currentIndex}`, `Total: ${pendingCoords.length}`, 'ALERTA');
    } else {
      addAuditLog('GEOCODE_COMPLETE', 'Processamento API', '-', `Processados: ${pendingCoords.length}`, 'SUCESSO');
    }
  };

  const handlePauseGeocoding = () => {
    if (geocodeJobId && geocodeJobStatus === 'running') {
      void fetch(`/api/geocode/jobs/${geocodeJobId}/pause`, { method: 'POST' });
      setGeocodeJobStatus('paused');
    }
    cancelGeocodingRef.current = true;
    setIsGeocoding(false);
  };

  const handleCancelGeocoding = () => {
    cancelGeocodingRef.current = true;
    setIsGeocoding(false);
    setCurrentIndex(0);
    setGeocodeProgress(0);
    if (geocodeJobId && geocodeJobStatus === 'running') {
      void fetch(`/api/geocode/jobs/${geocodeJobId}/pause`, { method: 'POST' });
    }
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    jobAppliedCountRef.current = 0;
  };

  // Reactively updatesPoints, Trechos, Polygons and Addresses cached states
  const updateStateWithGeocodedAddress = (addr: EnderecoConsulta) => {
    setResult(current => {
      if (!current) return current;
      const result = current;

      // Normalize address keys and guarantee a fallback empty string for missing or partial fields
      const safeAddr: EnderecoConsulta = {
        ...addr,
        endereco_formatado: addr.endereco_formatado || '',
        logradouro: addr.logradouro || '',
        numero: addr.numero || '',
        bairro: addr.bairro || '',
        subdistrito: addr.subdistrito || '',
        distrito: addr.distrito || '',
        municipio: addr.municipio || '',
        uf: addr.uf || '',
        cep: addr.cep || '',
        pais: addr.pais || '',
        place_id: addr.place_id || '',
        plus_code: addr.plus_code || '',
        status_api: addr.status_api || 'SUCESSO',
        fonte: addr.fonte || 'Geocoding API',
      };

    const updatedPontos = result.pontos.map(p => {
      // match coordinate rounded mapping within ~5 meters (5 decimal places)
      const matchLat = p.latitude.toFixed(5) === safeAddr.latitude.toFixed(5);
      const matchLng = p.longitude.toFixed(5) === safeAddr.longitude.toFixed(5);
      if (matchLat && matchLng) {
        return mergePointWithGeocodedAddress(p, safeAddr);
      }
      return p;
    });

    const updatedTrechos = result.trechos.map(t => {
      let changed = false;
      const startMatch = t.inicio_lat.toFixed(5) === safeAddr.latitude.toFixed(5) && t.inicio_lng.toFixed(5) === safeAddr.longitude.toFixed(5);
      const endMatch = t.fim_lat.toFixed(5) === safeAddr.latitude.toFixed(5) && t.fim_lng.toFixed(5) === safeAddr.longitude.toFixed(5);
      
      let initAddr = t.inicio_endereco;
      let initPlaceId = t.inicio_place_id;
      let finalAddr = t.fim_endereco;
      let finalPlaceId = t.fim_place_id;
      let conflict = t.conflito_endereco || '';

      if (startMatch) {
         const startConflict = buildExistingAddressConflict(t.inicio_endereco, safeAddr, `inicio do trecho ${t.trecho_id}`);
         if (startConflict) {
           conflict = conflict ? `${conflict} ${startConflict}` : startConflict;
         } else {
           initAddr = safeAddr.endereco_formatado || t.inicio_endereco;
         }
         initPlaceId = safeAddr.place_id || t.inicio_place_id;
         changed = true;
      }
      if (endMatch) {
         const endConflict = buildExistingAddressConflict(t.fim_endereco, safeAddr, `fim do trecho ${t.trecho_id}`);
         if (endConflict) {
           conflict = conflict ? `${conflict} ${endConflict}` : endConflict;
         } else {
           finalAddr = safeAddr.endereco_formatado || t.fim_endereco;
         }
         finalPlaceId = safeAddr.place_id || t.fim_place_id;
         changed = true;
      }

      if (changed) {
        return {
          ...t,
          inicio_endereco: initAddr,
          inicio_place_id: initPlaceId,
          fim_endereco: finalAddr,
          fim_place_id: finalPlaceId,
          status: conflict ? 'Conflito de Endereço' : 'Endereço Resolvido',
          conflito_endereco: conflict || undefined,
          observacoes: conflict && !t.observacoes.includes(conflict) ? `${t.observacoes ? `${t.observacoes} ` : ''}${conflict}` : t.observacoes
        };
      }
      return t;
    });

    const updatedPoligonos = result.poligonos.map(pl => {
      const centroidMatch = pl.centroid_lat.toFixed(5) === safeAddr.latitude.toFixed(5) && pl.centroid_lng.toFixed(5) === safeAddr.longitude.toFixed(5);
      if (centroidMatch) {
        const conflict = buildExistingAddressConflict(pl.centroid_endereco, safeAddr, `centroide do poligono ${pl.poligono_id}`);
        return {
          ...pl,
          centroid_endereco: conflict ? pl.centroid_endereco : safeAddr.endereco_formatado || pl.centroid_endereco,
          conflito_endereco: conflict || pl.conflito_endereco,
          observacoes: conflict && !pl.observacoes.includes(conflict) ? `${pl.observacoes ? `${pl.observacoes} ` : ''}${conflict}` : pl.observacoes
        };
      }
      return pl;
    });

    const updatedEnderecos = mergeExternalAddressRecord(result.enderecos, safeAddr);

    // Recalculate geocoding metrics from address records, not only point rows.
    const geocodedRecords = updatedEnderecos.filter(item => item.fonte !== 'Original');
    const completedCount = updatedEnderecos.filter(item => item.endereco_formatado && item.status_api === 'SUCESSO').length;

      return {
        ...result,
        pontos: updatedPontos,
        trechos: updatedTrechos,
        poligonos: updatedPoligonos,
        enderecos: updatedEnderecos,
        resumo: {
          ...result.resumo,
          resultados_completos: completedCount,
          chamadas_realizadas: geocodedRecords.length
        }
      };
    });
  };

  const handleResetWorkspace = () => {
    setResult(null);
    setOriginalFile(null);
    setCurrentIndex(0);
    setGeocodeProgress(0);
    setGeocodeJobId('');
    setGeocodeJobStatus('idle');
    jobAppliedCountRef.current = 0;
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col font-sans" id="application-root">
      
      {/* Universal Top Bar Header */}
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

        <div className="flex items-center gap-4 text-xs">
          {/* Status Indicator */}
          <div className="flex items-center gap-2 px-3 py-1 bg-green-50 text-green-700 border border-green-200 rounded-full font-medium">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span>Connected (pt-BR)</span>
          </div>

          {result && (
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-slate-100 text-slate-700 font-bold border border-slate-200 rounded text-[11px] font-mono">
                {originalFile?.name}
              </span>
              <button
                onClick={handleResetWorkspace}
                className="text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 px-3 py-1 rounded cursor-pointer transition uppercase tracking-wider"
                id="reset-workspace-btn"
              >
                Novo
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main app body screen router */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {result ? (
          /* Real loaded Workspace state view */
          <div className="max-w-7xl w-full mx-auto p-4 md:p-6 space-y-6 flex-1 overflow-y-auto" id="workspace-loaded-view">
            
            {/* Horizontal Geocoder Engine Bar controls (pause/play) */}
            <div className="bg-white p-4 border border-slate-300 rounded shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="space-y-1 w-full md:w-auto text-center md:text-left flex-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Estágio de Geocodificação das Coordenadas</span>
                <div className="flex flex-wrap items-center gap-3 justify-center md:justify-start">
                  <span className="font-mono font-bold text-slate-800 text-xs md:text-sm leading-none block">
                    {isGeocoding 
                      ? `RESOLVENDO COORDENADAS: ${geocodeProgress} / ${geocodeTotal}` 
                      : `Enriquecimento de Endereços:`
                    }
                  </span>
                  
                  {!isGeocoding && (
                    <select
                      value={geocodeMode}
                      onChange={(e) => {
                        const newMode = e.target.value;
                        setGeocodeMode(newMode);
                        if (result) {
                          analyzePendingCoordinates(result, newMode);
                          setCurrentIndex(0);
                          setGeocodeProgress(0);
                        }
                      }}
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
                  {pendingCoords.length > 20 && geocodeJobStatus !== 'idle' && (
                    <span className="text-[10px] bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 font-bold uppercase font-mono">
                      Job {geocodeJobStatus}
                    </span>
                  )}
                </div>
                
                {/* Micro progress meter */}
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

              {/* Loop Trigger commands */}
              <div className="flex flex-wrap gap-2 justify-center">
                {geocodeMode === 'DESATIVADO' ? (
                  <span className="text-[10px] text-slate-400 font-medium max-w-xs text-center md:text-right">
                    As localizações já possuem endereços offline atribuídos. Selecione outro modo caso queira rodar geocodificação real por API.
                  </span>
                ) : (
                  <>
                    {!isGeocoding ? (
                      <button
                        onClick={handleStartGeocoding}
                        disabled={currentIndex >= pendingCoords.length}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 text-white font-bold text-xs rounded border border-indigo-700 transition cursor-pointer flex items-center gap-1.5 shadow-xs uppercase tracking-wider"
                        id="start-enrich-geocode-btn"
                      >
                        <Play className="h-3.5 w-3.5" />
                        {geocodeJobStatus === 'paused' ? 'Retomar Job' : currentIndex > 0 ? 'Retomar' : 'Iniciar Geocodificação'}
                      </button>
                    ) : (
                      <button
                        onClick={handlePauseGeocoding}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs rounded border border-amber-600 transition cursor-pointer flex items-center gap-1.5 shadow-xs uppercase tracking-wider"
                        id="pause-enrich-geocode-btn"
                      >
                        <Pause className="h-3.5 w-3.5" /> Pausar
                      </button>
                    )}

                    <button
                      onClick={handleCancelGeocoding}
                      disabled={currentIndex === 0}
                      className="px-4 py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 font-bold text-xs rounded transition cursor-pointer flex items-center gap-1.5 uppercase tracking-wider"
                    >
                      <Square className="h-3.5 w-3.5" /> Reiniciar
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Middle Nav Tab list */}
            <div className="flex border border-slate-300 bg-white rounded overflow-hidden" id="workspace-tabs-navigator">
              <button
                onClick={() => setActiveWorkspaceTab('summary')}
                className={`flex-1 py-3 text-center transition duration-150 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider border-r border-slate-300 last:border-r-0 ${
                  activeWorkspaceTab === 'summary'
                    ? 'bg-slate-50 text-indigo-600 border-b-2 border-b-indigo-600 font-bold'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
                }`}
              >
                <LayoutDashboard className="h-4 w-4" />
                Métricas e Resumo
              </button>
              <button
                onClick={() => setActiveWorkspaceTab('map')}
                className={`flex-1 py-3 text-center transition duration-150 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider border-r border-slate-300 last:border-r-0 ${
                  activeWorkspaceTab === 'map'
                    ? 'bg-slate-50 text-indigo-600 border-b-2 border-b-indigo-600 font-bold'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
                }`}
              >
                <MapIcon className="h-4 w-4" />
                Dióptica Comercial (Mapa)
              </button>
              <button
                onClick={() => setActiveWorkspaceTab('tables')}
                className={`flex-1 py-3 text-center transition duration-150 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider border-r border-slate-300 last:border-r-0 ${
                  activeWorkspaceTab === 'tables'
                    ? 'bg-slate-50 text-indigo-600 border-b-2 border-b-indigo-600 font-bold'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
                }`}
              >
                <TableProperties className="h-4 w-4" />
                Planilha de Dados
              </button>
              <button
                onClick={() => setActiveWorkspaceTab('download')}
                className={`flex-1 py-3 text-center transition duration-150 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider ${
                  activeWorkspaceTab === 'download'
                    ? 'bg-slate-50 text-indigo-600 border-b-2 border-b-indigo-600 font-bold'
                    : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
                }`}
              >
                <Download className="h-4 w-4" />
                Download dos Dados
              </button>
            </div>

            {/* Sandbox screen renders */}
            <div className="min-h-[400px]">
              {activeWorkspaceTab === 'summary' && (
                <SummaryView result={result} />
              )}

              {activeWorkspaceTab === 'map' && (
                <MapView result={result} apiKey={apiKey} />
              )}

              {activeWorkspaceTab === 'tables' && (
                <TabelaView 
                  result={result} 
                  onUpdateResult={(updated) => setResult(updated)} 
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
          </div>
        )}
      </main>

      {/* Structured technical footer */}
      <footer className="h-12 border-t border-slate-300 bg-white flex items-center justify-between px-6 shrink-0 text-[10px] text-slate-400 font-mono">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-slate-300"></div> Port: 3000 Ingress</span>
          <span className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-indigo-500"></div> UTF-8 Brazilian Compliant</span>
        </div>
        <div>
          Universal KMZ Reader & Geocoder &bull; MVP
        </div>
      </footer>
    </div>
  );
}
