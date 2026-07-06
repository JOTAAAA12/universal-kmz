import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'path';
import * as crypto from 'crypto';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';

import { parseKmlStringToResult } from './src/kmlParser';
import {
  geocodeReverse,
  getGeocoderProviderByName,
  getGeocoderProviderStats,
  hasEnabledGeocoderProvider,
  isOperationalGeocodeFailureStatus,
  isPlaceholderGoogleKey,
  resolveGeocodeMode
} from './src/geocoder';
import { loadCnefeIndex, type CnefeIndex, type CnefeIndexStats } from './src/cnefeIndex';
import { CnefeDownloadManager } from './src/cnefeDownloader';
import { createPersistentGeocodeCache, registerGeocodeCacheShutdown } from './src/geocodeCache';
import { GeocodeJobManager, geocodeCoordinateBatch } from './src/geocodeJobs';
import { setCnefeIndex } from './src/providers/cnefe';
import { validateCep } from './src/providers/viacep';
import {
  consolidateSegments,
  resolveDominantPolygonAddress,
  samplePolygon,
  samplePolyline
} from './src/lineSampling';
import { generateDownloadZip, generateKml, generateWorkbook } from './src/exporters';
import {
  getMaskedRuntimeConfig,
  getRuntimeConfig,
  getRuntimeGeocoderEnv,
  loadRuntimeConfig,
  updateRuntimeConfig
} from './src/runtimeConfig';
import { createSession, deleteSession, getSession, listSessions } from './src/sessionStore';
import * as XLSX from 'xlsx';
import { Coordinate, ParserResult, EnderecoConsulta, EnderecoPoligono, TrechoEndereco } from './src/types';

function isMockGeocoderEnabled() {
  const mode = (process.env.GEOCODER_MODE || '').trim().toLowerCase();
  const allowMock = (process.env.ALLOW_MOCK_GEOCODER || '').trim().toLowerCase();
  return mode === 'mock' || allowMock === 'true' || allowMock === '1';
}

function resolveClientDistPath() {
  const candidates = [
    path.resolve(__dirname),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(process.cwd())
  ];
  const found = candidates.find(candidate => fs.existsSync(path.join(candidate, 'index.html')));
  return found || candidates[0];
}

function getServerGeocodingKey() {
  return getRuntimeConfig().googleServerKey;
}

function normalizeLanguage(value: unknown) {
  const input = typeof value === 'string' ? value.trim() : '';
  return /^[a-z]{2}(-[a-z]{2})?$/i.test(input) ? input : 'pt-BR';
}

function normalizeRegion(value: unknown) {
  const input = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(input) ? input : 'BR';
}

function normalizeCoordinate(input: any): { lat: number; lng: number } | null {
  const lat = Number(input?.lat);
  const lng = Number(input?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizeCoordinateArray(input: any): Coordinate[] | null {
  if (!Array.isArray(input)) return null;
  const normalized = input.map(normalizeCoordinate);
  if (normalized.some(coord => coord === null)) return null;
  return normalized as Coordinate[];
}

function buildProcessingParams(input: any) {
  const parts = [
    `Tolerância de agrupamento: ${Number(input?.toleranceGroup) || 5}m`,
    `Tolerância proximidade: ${Number(input?.toleranceMatch) || 30}m`,
    `Intervalo Amostras: ${Number(input?.sampleInterval) || 100}m`,
    `Modo Geocode: ${typeof input?.geocodeMode === 'string' ? input.geocodeMode : 'COMPLETO'}`
  ];
  return parts.join(', ');
}

function isViaCepValidationEnabled() {
  return getRuntimeConfig().viacepValidation;
}

function appendValidationNote(item: EnderecoConsulta, note: string): EnderecoConsulta {
  return {
    ...item,
    observacao_validacao: [item.observacao_validacao, note].filter(Boolean).join(' | ')
  };
}

type CnefeProviderLoadState = {
  estado: 'carregando' | 'pronto' | 'ausente' | 'erro';
  linhas_indexadas: number;
  indice_parcial: boolean;
  mensagens: string[];
  mensagem?: string;
};

function buildCnefeProviderState(
  stats: CnefeIndexStats | null,
  estado: CnefeProviderLoadState['estado'],
  fallbackMessage: string
): CnefeProviderLoadState {
  const mensagens = stats?.messages.length ? stats.messages : [fallbackMessage];
  return {
    estado,
    linhas_indexadas: stats?.indexedRows || 0,
    indice_parcial: Boolean(stats?.partial),
    mensagens,
    mensagem: mensagens[mensagens.length - 1]
  };
}

async function validateAddressWithViaCep(item: EnderecoConsulta): Promise<EnderecoConsulta> {
  if (!isViaCepValidationEnabled() || item.status_api !== 'SUCESSO' || !item.cep) {
    return item;
  }
  const validation = await validateCep(item.cep, item.logradouro, item.municipio, item.uf);
  if (validation.ok || validation.skipped) {
    return item;
  }
  return appendValidationNote({
    ...item,
    necessita_revisao: true
  }, validation.message || 'ViaCEP indicou divergência de município/UF.');
}

function mergeParserResults(results: ParserResult[], fileName: string, fileHash: string): ParserResult {
  if (results.length === 0) {
    throw new Error('Nenhum KML foi processado.');
  }

  const [first, ...rest] = results;
  const initial: ParserResult = {
    ...first,
    features: [...first.features],
    pontos: [...first.pontos],
    trechos: [...first.trechos],
    poligonos: [...first.poligonos],
    trechos_endereco: [...(first.trechos_endereco || [])],
    enderecos_poligono: [...(first.enderecos_poligono || [])],
    enderecos: [...first.enderecos],
    associacoes: [...first.associacoes],
    errosAlertas: [...first.errosAlertas],
    auditoria: [...first.auditoria]
  };

  const merged = rest.reduce<ParserResult>((acc, item) => ({
    resumo: acc.resumo,
    features: [...acc.features, ...item.features],
    pontos: [...acc.pontos, ...item.pontos],
    trechos: [...acc.trechos, ...item.trechos],
    poligonos: [...acc.poligonos, ...item.poligonos],
    trechos_endereco: [...(acc.trechos_endereco || []), ...(item.trechos_endereco || [])],
    enderecos_poligono: [...(acc.enderecos_poligono || []), ...(item.enderecos_poligono || [])],
    enderecos: [...acc.enderecos, ...item.enderecos],
    associacoes: [...acc.associacoes, ...item.associacoes],
    errosAlertas: [...acc.errosAlertas, ...item.errosAlertas],
    auditoria: [...acc.auditoria, ...item.auditoria]
  }), initial);

  const resumo = {
    ...merged.resumo,
    nome_arquivo: fileName,
    hash_original: fileHash,
    data_processamento: new Date().toISOString(),
    quantidade_kmls: results.length,
    quantidade_documents: results.reduce((sum, item) => sum + item.resumo.quantidade_documents, 0),
    quantidade_folders: results.reduce((sum, item) => sum + item.resumo.quantidade_folders, 0),
    quantidade_placemarks: results.reduce((sum, item) => sum + item.resumo.quantidade_placemarks, 0),
    quantidade_points: merged.pontos.length,
    quantidade_linestrings: merged.trechos.length,
    quantidade_polygons: merged.poligonos.length,
    quantidade_multigeometry: results.reduce((sum, item) => sum + item.resumo.quantidade_multigeometry, 0),
    quantidade_nao_suportadas: results.reduce((sum, item) => sum + item.resumo.quantidade_nao_suportadas, 0),
    total_vertices: results.reduce((sum, item) => sum + item.resumo.total_vertices, 0),
    comprimento_total_m: results.reduce((sum, item) => sum + item.resumo.comprimento_total_m, 0),
    area_total_m2: results.reduce((sum, item) => sum + item.resumo.area_total_m2, 0),
    quantidade_coordenadas_unicas: new Set([
      ...merged.pontos.map(p => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`),
      ...merged.trechos.flatMap(t => [
        `${t.inicio_lat.toFixed(5)},${t.inicio_lng.toFixed(5)}`,
        `${t.fim_lat.toFixed(5)},${t.fim_lng.toFixed(5)}`
      ]),
      ...merged.poligonos.map(p => `${p.centroid_lat.toFixed(5)},${p.centroid_lng.toFixed(5)}`)
    ]).size,
    chamadas_realizadas: 0,
    resultados_completos: merged.enderecos.length,
    resultados_parciais: 0,
    resultados_sem_endereco: results.reduce((sum, item) => sum + item.resumo.resultados_sem_endereco, 0),
    erros: merged.errosAlertas.filter(e => e.severidade === 'CRÍTICO').length,
    alertas: merged.errosAlertas.filter(e => e.severidade === 'ALERTA').length
  };

  resumo.chamadas_estimadas = resumo.quantidade_coordenadas_unicas;

  return {
    ...merged,
    resumo
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const geocodeCache = createPersistentGeocodeCache();
  let cnefeProviderState = buildCnefeProviderState(null, 'carregando', 'Indexação CNEFE em andamento.');
  let activeCnefeIndex: (CnefeIndex & { close?: () => void }) | null = null;

  const updateCnefeProviderState = (
    stats: CnefeIndexStats | null,
    estado: CnefeProviderLoadState['estado'],
    fallbackMessage: string
  ) => {
    cnefeProviderState = buildCnefeProviderState(stats, estado, fallbackMessage);
  };

  const startCnefeIndexInBackground = () => {
    updateCnefeProviderState(null, 'carregando', 'Carregamento do índice CNEFE em andamento.');
    void loadCnefeIndex({
      onProgress: stats => updateCnefeProviderState(stats, 'carregando', 'Carregamento do índice CNEFE em andamento.')
    }).then(index => {
      activeCnefeIndex?.close?.();
      activeCnefeIndex = index as CnefeIndex & { close?: () => void };
      setCnefeIndex(index);
      updateCnefeProviderState(
        index.stats,
        index.stats.indexedRows > 0 ? 'pronto' : 'ausente',
        index.stats.indexedRows > 0 ? 'Índice CNEFE SQLite pronto.' : 'Nenhum CSV CNEFE carregado.'
      );
    }).catch((err: any) => {
      const message = err?.message || 'Falha ao indexar CNEFE.';
      activeCnefeIndex?.close?.();
      activeCnefeIndex = null;
      setCnefeIndex(null);
      cnefeProviderState = {
        estado: 'erro',
        linhas_indexadas: 0,
        indice_parcial: false,
        mensagens: [message],
        mensagem: message
      };
      console.error('Erro ao indexar CNEFE:', err);
    });
  };

  await geocodeCache.load();
  await loadRuntimeConfig();
  registerGeocodeCacheShutdown(geocodeCache);
  const geocodeJobs = new GeocodeJobManager();
  const cnefeDownloader = new CnefeDownloadManager({
    onIndexProgress: stats => updateCnefeProviderState(stats, 'carregando', 'Carregamento do índice CNEFE em andamento.'),
    onIndexReady: index => {
      activeCnefeIndex?.close?.();
      activeCnefeIndex = index as CnefeIndex & { close?: () => void };
      setCnefeIndex(index);
      updateCnefeProviderState(
        index.stats,
        index.stats.indexedRows > 0 ? 'pronto' : 'ausente',
        index.stats.indexedRows > 0 ? 'Índice CNEFE SQLite pronto.' : 'Nenhum CSV CNEFE carregado.'
      );
    }
  });

  // Set body parser margins to 50MB as requested by user instructions
  app.use(express.json({ limit: '100mb' }));
  app.use(express.urlencoded({ limit: '100mb', extended: true }));

  // Helper to calculate SHA256 of file stream
  const calculateSha256 = (content: string): string => {
    return crypto.createHash('sha256').update(content).digest('hex');
  };

  app.get('/api/config', (_req, res) => {
    return res.json(getMaskedRuntimeConfig());
  });

  app.post('/api/config', async (req, res) => {
    try {
      await updateRuntimeConfig(req.body);
      return res.json(getMaskedRuntimeConfig());
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Configuração inválida.' });
    }
  });

  app.post('/api/config/test/:provider', async (req, res) => {
    const providerName = String(req.params.provider || '').trim().toLowerCase();
    const provider = getGeocoderProviderByName(providerName);
    if (!provider) {
      return res.status(404).json({ ok: false, status: 'UNKNOWN_PROVIDER', mensagem: 'Provedor desconhecido.' });
    }

    const env = getRuntimeGeocoderEnv();
    const apiKeyValue = getServerGeocodingKey();
    const result = await geocodeReverse(
      -23.5614,
      -46.6559,
      apiKeyValue,
      'pt-BR',
      'BR',
      {
        allowMock: isMockGeocoderEnabled(),
        chain: [providerName],
        env,
        providers: [provider],
        skipCache: true,
        timeoutMs: 8000
      }
    );
    const stats = getGeocoderProviderStats(apiKeyValue, isMockGeocoderEnabled(), env)
      .find(item => item.nome === providerName);
    return res.json({
      ok: result.status_api === 'SUCESSO' || result.status_api === 'Mocked',
      status: result.status_api,
      mensagem: result.provider_error_message || result.endereco_formatado || result.provider_status || '',
      endereco_resumido: result.endereco_formatado || undefined,
      ...(providerName === 'cnefe' ? {
        estado: cnefeProviderState.estado,
        linhas_indexadas: cnefeProviderState.linhas_indexadas,
        mensagem_indexacao: cnefeProviderState.mensagem,
        indice_parcial: cnefeProviderState.indice_parcial,
        linhas_indexadas_estatistica: stats?.linhas_indexadas || 0
      } : {})
    });
  });

  app.post('/api/sessions', async (req, res) => {
    try {
      return res.status(201).json(await createSession(req.body));
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Sessão inválida.' });
    }
  });

  app.get('/api/sessions', async (_req, res) => {
    return res.json(await listSessions());
  });

  app.get('/api/sessions/:id', async (req, res) => {
    try {
      const session = await getSession(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Sessão não encontrada.' });
      }
      return res.json(session);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'ID de sessão inválido.' });
    }
  });

  app.delete('/api/sessions/:id', async (req, res) => {
    try {
      const removed = await deleteSession(req.params.id);
      if (!removed) {
        return res.status(404).json({ error: 'Sessão não encontrada.' });
      }
      return res.status(204).send();
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'ID de sessão inválido.' });
    }
  });

  // API Route: Upload and Parse KML/KMZ
  app.post('/api/upload', async (req, res) => {
    try {
      const { name, content } = req.body;
      if (!name || !content) {
        return res.status(400).json({ error: 'Nome do arquivo ou conteúdo ausente.' });
      }

      const fileHash = calculateSha256(content);
      const processingType = typeof req.body.processingType === 'string' ? req.body.processingType : 'AUTO';
      const parametrosUsados = buildProcessingParams(req.body);
      let kmlString = '';

      if (name.toLowerCase().endsWith('.kmz')) {
        // Base64 decoding for zipped binary
        const zipData = Buffer.from(content, 'base64');
        const zipped = await JSZip.loadAsync(zipData);

        const kmlEntries: { path: string; kml: string }[] = [];
        zipped.forEach((relativePath, file) => {
          if (!file.dir && relativePath.toLowerCase().endsWith('.kml')) {
            kmlEntries.push({ path: relativePath, kml: '' });
          }
        });

        if (kmlEntries.length === 0) {
          return res.status(400).json({ error: 'Nenhum arquivo KML válido encontrado dentro do KMZ.' });
        }

        const parsedResults: ParserResult[] = [];
        for (const entry of kmlEntries) {
          kmlString = await zipped.file(entry.path)!.async('string');
          parsedResults.push(parseKmlStringToResult(kmlString, name, fileHash, processingType, 'BRASIL', {
            sourceKmlName: entry.path,
            idSeed: `${fileHash}:${entry.path}`,
            quantidadeKmls: kmlEntries.length,
            parametrosUsados
          }));
        }

        return res.json(mergeParserResults(parsedResults, name, fileHash));
      } else if (name.toLowerCase().endsWith('.kml')) {
        // Direct conversion or base64 decode if sent as such
        if (content.startsWith('data:') || !content.includes('<kml')) {
          // Check if Base64, clean up data prefix
          const cleanBase64 = content.replace(/^data:.*?;base64,/, '');
          kmlString = Buffer.from(cleanBase64, 'base64').toString('utf8');
        } else {
          kmlString = content;
        }
      } else {
        return res.status(400).json({ error: 'Tipo de arquivo não suportado. Envie .kml ou .kmz.' });
      }

      // Safe parse
      const parsedResult = parseKmlStringToResult(kmlString, name, fileHash, processingType, 'BRASIL', {
        sourceKmlName: name,
        idSeed: fileHash,
        parametrosUsados
      });
      return res.json(parsedResult);
    } catch (err: any) {
      console.error('Error parsing file:', err);
      return res.status(500).json({ error: `Falha ao processar KML/KMZ: ${err.message}` });
    }
  });

  app.get('/api/geocode/providers', (_req, res) => {
    const apiKeyValue = getServerGeocodingKey();
    const allowMock = isMockGeocoderEnabled();
    const env = getRuntimeGeocoderEnv();
    return res.json({
      providers: getGeocoderProviderStats(apiKeyValue, allowMock, env).map(provider => (
        provider.nome === 'cnefe'
          ? {
            ...provider,
            estado: cnefeProviderState.estado,
            linhas_indexadas: cnefeProviderState.linhas_indexadas,
            indice_parcial: cnefeProviderState.indice_parcial,
            mensagens: cnefeProviderState.mensagens,
            mensagem: cnefeProviderState.mensagem
          }
          : provider
      ))
    });
  });

  app.get('/api/cnefe/estados', async (_req, res) => {
    try {
      return res.json({ estados: await cnefeDownloader.listStates() });
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Falha ao listar estados CNEFE.' });
    }
  });

  app.get('/api/cnefe/estados/:uf', async (req, res) => {
    try {
      const state = await cnefeDownloader.getState(req.params.uf);
      if (!state) return res.status(404).json({ error: 'UF CNEFE desconhecida.' });
      return res.json(state);
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Falha ao consultar estado CNEFE.' });
    }
  });

  app.post('/api/cnefe/estados/:uf/download', async (req, res) => {
    try {
      return res.status(202).json(await cnefeDownloader.start(req.params.uf));
    } catch (err: any) {
      const message = err.message || 'Falha ao iniciar download CNEFE.';
      const status = message.includes('ja esta') ? 409 : 400;
      return res.status(status).json({ error: message });
    }
  });

  app.post('/api/cnefe/estados/:uf/cancelar', async (req, res) => {
    try {
      const progress = await cnefeDownloader.cancel(req.params.uf);
      if (!progress) return res.status(404).json({ error: 'UF CNEFE desconhecida.' });
      return res.json(progress);
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Falha ao cancelar download CNEFE.' });
    }
  });

  app.delete('/api/cnefe/estados/:uf', async (req, res) => {
    try {
      return res.json(await cnefeDownloader.remove(req.params.uf));
    } catch (err: any) {
      return res.status(400).json({ error: err.message || 'Falha ao remover CNEFE da UF.' });
    }
  });

  app.get('/api/cnefe/disco', async (_req, res) => {
    try {
      return res.json(await cnefeDownloader.disk());
    } catch (err: any) {
      return res.status(500).json({ error: err.message || 'Falha ao consultar disco CNEFE.' });
    }
  });

  const buildGeocodeOperation = (apiKeyValue: string, allowMock: boolean, language: string, region: string) => async (
    coord: Coordinate
  ) => validateAddressWithViaCep(await geocodeReverse(
    coord.lat,
    coord.lng,
    apiKeyValue,
    language,
    region,
    { allowMock, cache: geocodeCache, env: getRuntimeGeocoderEnv() }
  ));

  const buildGeocodeErrors = (results: EnderecoConsulta[]) => results
    .filter(item => isOperationalGeocodeFailureStatus(item.status_api))
    .map(item => ({
      consulta_id: item.consulta_id,
      status_api: item.status_api,
      provider_status: item.provider_status,
      provider_error_message: item.provider_error_message,
      retryable: item.retryable
    }));

  app.post('/api/geocode/jobs', async (req, res) => {
    try {
      const { coordinates, language, region } = req.body;
      const apiKeyValue = getServerGeocodingKey();
      const allowMock = isMockGeocoderEnabled();

      if (!coordinates || !Array.isArray(coordinates)) {
        return res.status(400).json({ error: 'Lista de coordenadas ausente ou inválida.' });
      }

      const normalizedCoordinates = coordinates.map(normalizeCoordinate);
      if (normalizedCoordinates.some(coord => coord === null)) {
        return res.status(400).json({
          error: 'Lista de coordenadas contém latitude/longitude inválidas.',
          code: 'INVALID_COORDINATES'
        });
      }

      const env = getRuntimeGeocoderEnv();
      if (!hasEnabledGeocoderProvider(apiKeyValue, allowMock, env)) {
        const googleMissing = isPlaceholderGoogleKey(apiKeyValue);
        return res.status(503).json({
          error: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
          code: 'GEOCODER_PROVIDER_UNAVAILABLE',
          details: googleMissing
            ? 'Google sem chave válida foi pulado. Ajuste GEOCODER_CHAIN, configure chaves de provedores, ou habilite mock explicitamente.'
            : 'Ajuste GEOCODER_CHAIN ou configure as chaves necessárias para os provedores selecionados.',
          providers: getGeocoderProviderStats(apiKeyValue, allowMock, env)
        });
      }

      const safeLanguage = normalizeLanguage(language);
      const safeRegion = normalizeRegion(region);
      const snapshot = geocodeJobs.createJob(
        normalizedCoordinates as Coordinate[],
        buildGeocodeOperation(apiKeyValue, allowMock, safeLanguage, safeRegion)
      );

      return res.status(202).json(snapshot);
    } catch (err: any) {
      console.error('Error creating geocoding job:', err);
      return res.status(500).json({ error: `Erro ao criar job de geocodificação: ${err.message}` });
    }
  });

  app.get('/api/geocode/jobs/:id', (req, res) => {
    const snapshot = geocodeJobs.getJob(req.params.id);
    if (!snapshot) {
      return res.status(404).json({ error: 'Job de geocodificação não encontrado.' });
    }
    return res.json(snapshot);
  });

  app.post('/api/geocode/jobs/:id/pause', (req, res) => {
    const snapshot = geocodeJobs.pauseJob(req.params.id);
    if (!snapshot) {
      return res.status(404).json({ error: 'Job de geocodificação não encontrado.' });
    }
    return res.json(snapshot);
  });

  app.post('/api/geocode/jobs/:id/resume', (req, res) => {
    const snapshot = geocodeJobs.resumeJob(req.params.id);
    if (!snapshot) {
      return res.status(404).json({ error: 'Job de geocodificação não encontrado.' });
    }
    return res.json(snapshot);
  });

  // API Route: Bulk Geocode Reverse Coordination Set
  app.post('/api/geocode', async (req, res) => {
    try {
      const { coordinates, language, region } = req.body;
      const apiKeyValue = getServerGeocodingKey();
      const allowMock = isMockGeocoderEnabled();
      
      if (!coordinates || !Array.isArray(coordinates)) {
        return res.status(400).json({ error: 'Lista de coordenadas ausente ou inválida.' });
      }

      const normalizedCoordinates = coordinates.map(normalizeCoordinate);
      if (normalizedCoordinates.some(coord => coord === null)) {
        return res.status(400).json({
          error: 'Lista de coordenadas contém latitude/longitude inválidas.',
          code: 'INVALID_COORDINATES'
        });
      }

      const env = getRuntimeGeocoderEnv();
      if (!hasEnabledGeocoderProvider(apiKeyValue, allowMock, env)) {
        const googleMissing = isPlaceholderGoogleKey(apiKeyValue);
        return res.status(503).json({
          error: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
          code: 'GEOCODER_PROVIDER_UNAVAILABLE',
          details: googleMissing
            ? 'Google sem chave válida foi pulado. Ajuste GEOCODER_CHAIN, configure chaves de provedores, ou habilite mock explicitamente.'
            : 'Ajuste GEOCODER_CHAIN ou configure as chaves necessárias para os provedores selecionados.',
          providers: getGeocoderProviderStats(apiKeyValue, allowMock, env)
        });
      }

      const results: EnderecoConsulta[] = [];
      const safeLanguage = normalizeLanguage(language);
      const safeRegion = normalizeRegion(region);
      results.push(...await geocodeCoordinateBatch(
        normalizedCoordinates as Coordinate[],
        buildGeocodeOperation(apiKeyValue, allowMock, safeLanguage, safeRegion)
      ));

      const errors = buildGeocodeErrors(results);

      const payload = {
        mode: resolveGeocodeMode(results, allowMock),
        results,
        errors
      };

      if (errors.length > 0 && errors.length === results.length) {
        return res.status(502).json(payload);
      }

      return res.status(errors.length > 0 ? 207 : 200).json(payload);
    } catch (err: any) {
      console.error('Error geocoding:', err);
      return res.status(500).json({ error: `Erro na geocodificação: ${err.message}` });
    }
  });

  app.post('/api/geocode/trechos', async (req, res) => {
    try {
      const { linhas, poligonos, language, region } = req.body;
      const apiKeyValue = getServerGeocodingKey();
      const allowMock = isMockGeocoderEnabled();

      if (!Array.isArray(linhas) && !Array.isArray(poligonos)) {
        return res.status(400).json({ error: 'Informe linhas e/ou poligonos para geocodificação por trechos.' });
      }

      const env = getRuntimeGeocoderEnv();
      if (!hasEnabledGeocoderProvider(apiKeyValue, allowMock, env)) {
        const googleMissing = isPlaceholderGoogleKey(apiKeyValue);
        return res.status(503).json({
          error: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
          code: 'GEOCODER_PROVIDER_UNAVAILABLE',
          details: googleMissing
            ? 'Google sem chave válida foi pulado. Ajuste GEOCODER_CHAIN, configure chaves de provedores, ou habilite mock explicitamente.'
            : 'Ajuste GEOCODER_CHAIN ou configure as chaves necessárias para os provedores selecionados.',
          providers: getGeocoderProviderStats(apiKeyValue, allowMock, env)
        });
      }

      const requestedStep = Number(req.body.stepMeters);
      const stepMeters = Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : getRuntimeConfig().stepMeters;
      const lineInputs = Array.isArray(linhas) ? linhas : [];
      const polygonInputs = Array.isArray(poligonos) ? poligonos : [];
      const allSamples: Coordinate[] = [];
      const refs: Array<{ tipo: 'linha' | 'poligono'; id: string }> = [];
      const lineSamples = new Map<string, Array<{ coord: Coordinate; endereco: EnderecoConsulta }>>();
      const polygonSamples = new Map<string, Array<{ coord: Coordinate; endereco: EnderecoConsulta }>>();
      const lineOrder: string[] = [];
      const polygonOrder: string[] = [];

      for (const item of lineInputs) {
        const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : '';
        const coords = normalizeCoordinateArray(item?.coordenadas);
        if (!id || !coords || coords.length < 2) {
          return res.status(400).json({ error: 'Cada linha precisa de id e pelo menos duas coordenadas válidas.' });
        }

        lineOrder.push(id);
        lineSamples.set(id, []);
        samplePolyline(coords, stepMeters).forEach(coord => {
          allSamples.push(coord);
          refs.push({ tipo: 'linha', id });
        });
      }

      for (const item of polygonInputs) {
        const id = typeof item?.id === 'string' && item.id.trim() ? item.id.trim() : '';
        const coords = normalizeCoordinateArray(item?.anel_externo);
        if (!id || !coords || coords.length < 3) {
          return res.status(400).json({ error: 'Cada poligono precisa de id e anel_externo com pelo menos três coordenadas válidas.' });
        }

        polygonOrder.push(id);
        polygonSamples.set(id, []);
        samplePolygon(coords).forEach(coord => {
          allSamples.push(coord);
          refs.push({ tipo: 'poligono', id });
        });
      }

      if (allSamples.length === 0) {
        return res.json({
          stepMeters,
          total_amostras: 0,
          trechos_por_linha: {},
          endereco_por_poligono: {},
          results: [],
          errors: []
        });
      }

      const safeLanguage = normalizeLanguage(language);
      const safeRegion = normalizeRegion(region);
      const results = await geocodeCoordinateBatch(
        allSamples,
        buildGeocodeOperation(apiKeyValue, allowMock, safeLanguage, safeRegion)
      );

      results.forEach((endereco, index) => {
        const ref = refs[index];
        const sample = { coord: allSamples[index], endereco };
        if (ref.tipo === 'linha') {
          lineSamples.get(ref.id)?.push(sample);
        } else {
          polygonSamples.get(ref.id)?.push(sample);
        }
      });

      const trechosPorLinha: Record<string, TrechoEndereco[]> = {};
      lineOrder.forEach(id => {
        trechosPorLinha[id] = consolidateSegments(lineSamples.get(id) || [])
          .map((trecho, index) => ({
            ...trecho,
            linha_id: id,
            ordem: index + 1
          }));
      });

      const enderecoPorPoligono: Record<string, EnderecoPoligono> = {};
      polygonOrder.forEach(id => {
        enderecoPorPoligono[id] = {
          ...resolveDominantPolygonAddress(polygonSamples.get(id) || []),
          poligono_id: id
        };
      });

      const errors = buildGeocodeErrors(results);
      const payload = {
        mode: resolveGeocodeMode(results, allowMock),
        stepMeters,
        total_amostras: allSamples.length,
        trechos_por_linha: trechosPorLinha,
        endereco_por_poligono: enderecoPorPoligono,
        results,
        errors
      };

      if (errors.length > 0 && errors.length === results.length) {
        return res.status(502).json(payload);
      }

      return res.status(errors.length > 0 ? 207 : 200).json(payload);
    } catch (err: any) {
      console.error('Error geocoding line/polygon segments:', err);
      return res.status(500).json({ error: `Erro na geocodificação de trechos: ${err.message}` });
    }
  });

  // API Route: Download structured XLSX Spreadsheet
  app.post('/api/export-xlsx', (req, res) => {
    try {
      const { data, filename } = req.body;
      if (!data) {
        return res.status(400).json({ error: 'Configuração de dados ausente.' });
      }

      const wb = generateWorkbook(data as ParserResult);
      const fileBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename || 'dados-completos.xlsx'}"`);
      return res.send(fileBuffer);
    } catch (err: any) {
      console.error('Error exporting XLSX:', err);
      return res.status(500).json({ error: `Erro na exportação XLSX: ${err.message}` });
    }
  });

  // API Route: Download complete ZIP Pack Bundle
  app.post('/api/export-zip', async (req, res) => {
    try {
      const { data, filename, originalName } = req.body;
      if (!data) {
        return res.status(400).json({ error: 'Dados para empacotamento ausentes.' });
      }

      const zipBuffer = await generateDownloadZip(data as ParserResult, originalName || 'dados.kml');
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename || 'pacote-dados-completos.zip'}"`);
      return res.send(zipBuffer);
    } catch (err: any) {
      console.error('Error exporting ZIP bundle:', err);
      return res.status(500).json({ error: `Erro na geração do ZIP: ${err.message}` });
    }
  });

  // API Route: Download normalized KML
  app.post('/api/export-kml', (req, res) => {
    try {
      const { data, filename } = req.body;
      if (!data) {
        return res.status(400).json({ error: 'Dados para exportação KML ausentes.' });
      }

      const kml = generateKml(data as ParserResult);
      res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename || 'features-normalizadas.kml'}"`);
      return res.send(kml);
    } catch (err: any) {
      console.error('Error exporting KML:', err);
      return res.status(500).json({ error: `Erro na exportação KML: ${err.message}` });
    }
  });

  // Development VS Production Routing serving web assets in the background
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = resolveClientDistPath();
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    startCnefeIndexInBackground();
  });
}

startServer();
