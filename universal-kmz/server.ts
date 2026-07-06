import 'dotenv/config';
import express from 'express';
import path from 'path';
import * as crypto from 'crypto';
import JSZip from 'jszip';
import { createServer as createViteServer } from 'vite';

import { parseKmlStringToResult } from './src/kmlParser';
import {
  geocodeReverse,
  getGeocoderProviderStats,
  hasEnabledGeocoderProvider,
  isOperationalGeocodeFailureStatus,
  isPlaceholderGoogleKey,
  resolveGeocodeMode
} from './src/geocoder';
import { createPersistentGeocodeCache, registerGeocodeCacheShutdown } from './src/geocodeCache';
import { GeocodeJobManager, geocodeCoordinateBatch } from './src/geocodeJobs';
import {
  consolidateSegments,
  resolveDominantPolygonAddress,
  samplePolygon,
  samplePolyline
} from './src/lineSampling';
import { generateDownloadZip, generateKml, generateWorkbook } from './src/exporters';
import * as XLSX from 'xlsx';
import { Coordinate, ParserResult, EnderecoConsulta, EnderecoPoligono, TrechoEndereco } from './src/types';

function isMockGeocoderEnabled() {
  const mode = (process.env.GEOCODER_MODE || '').trim().toLowerCase();
  const allowMock = (process.env.ALLOW_MOCK_GEOCODER || '').trim().toLowerCase();
  return mode === 'mock' || allowMock === 'true' || allowMock === '1';
}

function getServerGeocodingKey() {
  return (process.env.GOOGLE_MAPS_SERVER_KEY || '').trim();
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
  await geocodeCache.load();
  registerGeocodeCacheShutdown(geocodeCache);
  const geocodeJobs = new GeocodeJobManager();

  // Set body parser margins to 50MB as requested by user instructions
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Helper to calculate SHA256 of file stream
  const calculateSha256 = (content: string): string => {
    return crypto.createHash('sha256').update(content).digest('hex');
  };

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
    return res.json({
      providers: getGeocoderProviderStats(apiKeyValue, allowMock)
    });
  });

  const buildGeocodeOperation = (apiKeyValue: string, allowMock: boolean, language: string, region: string) => (
    coord: Coordinate
  ) => geocodeReverse(
    coord.lat,
    coord.lng,
    apiKeyValue,
    language,
    region,
    { allowMock, cache: geocodeCache }
  );

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

      if (!hasEnabledGeocoderProvider(apiKeyValue, allowMock)) {
        const googleMissing = isPlaceholderGoogleKey(apiKeyValue);
        return res.status(503).json({
          error: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
          code: 'GEOCODER_PROVIDER_UNAVAILABLE',
          details: googleMissing
            ? 'Google sem chave válida foi pulado. Ajuste GEOCODER_CHAIN, configure chaves de provedores, ou habilite mock explicitamente.'
            : 'Ajuste GEOCODER_CHAIN ou configure as chaves necessárias para os provedores selecionados.',
          providers: getGeocoderProviderStats(apiKeyValue, allowMock)
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

      if (!hasEnabledGeocoderProvider(apiKeyValue, allowMock)) {
        const googleMissing = isPlaceholderGoogleKey(apiKeyValue);
        return res.status(503).json({
          error: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
          code: 'GEOCODER_PROVIDER_UNAVAILABLE',
          details: googleMissing
            ? 'Google sem chave válida foi pulado. Ajuste GEOCODER_CHAIN, configure chaves de provedores, ou habilite mock explicitamente.'
            : 'Ajuste GEOCODER_CHAIN ou configure as chaves necessárias para os provedores selecionados.',
          providers: getGeocoderProviderStats(apiKeyValue, allowMock)
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

      if (!hasEnabledGeocoderProvider(apiKeyValue, allowMock)) {
        const googleMissing = isPlaceholderGoogleKey(apiKeyValue);
        return res.status(503).json({
          error: 'Nenhum provedor de geocodificação habilitado para a cadeia configurada.',
          code: 'GEOCODER_PROVIDER_UNAVAILABLE',
          details: googleMissing
            ? 'Google sem chave válida foi pulado. Ajuste GEOCODER_CHAIN, configure chaves de provedores, ou habilite mock explicitamente.'
            : 'Ajuste GEOCODER_CHAIN ou configure as chaves necessárias para os provedores selecionados.',
          providers: getGeocoderProviderStats(apiKeyValue, allowMock)
        });
      }

      const requestedStep = Number(req.body.stepMeters);
      const stepMeters = Number.isFinite(requestedStep) && requestedStep > 0 ? requestedStep : 100;
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
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0');
}

startServer();
