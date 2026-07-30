import { XMLParser } from 'fast-xml-parser';
import * as crypto from 'crypto';
import { 
  ParserResult, 
  KmlFeature, 
  PointFeature, 
  TrechoFeature, 
  PoligonoFeature, 
  Coordinate,
  GeometryType,
  ErroAlerta,
  Associacao,
  AuditoriaLog
} from './types';
import {
  calculateBoundingBox,
  calculateCentroid,
  calculatePolygonRingsAreaAndPerimeter,
  distancePointToSegment,
  getDistanceMeters,
  parseDeclaredLength,
  parseKmlCoordinates
} from './kmlGeometry';
import { extractAddressFromPlacemark } from './kmlAddress';
import { extractExtendedData, extractFromHtmlOrText } from './kmlMetadata';

export {
  calculateBoundingBox,
  calculateCentroid,
  calculatePlanarPolygonAreaAndPerimeter,
  calculatePolygonRingsAreaAndPerimeter,
  distancePointToSegment,
  getDistanceMeters,
  parseDeclaredLength,
  parseKmlCoordinates
} from './kmlGeometry';
export { extractAddressFromPlacemark } from './kmlAddress';
export { cleanHtmlText, extractExtendedData, extractFromHtmlOrText } from './kmlMetadata';

// Helper to ensure lists are arrays (fast-xml-parser can return object instead of array of length 1)
function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

// Recursive parser to collect placemarks with full path folders
interface KmlFolderState {
  currentPath: string;
  documentName: string;
}

interface CollectedPlacemark {
  placemark: any;
  caminhoPath: string;
  documento: string;
}

interface ParseKmlOptions {
  sourceKmlName?: string;
  idSeed?: string;
  quantidadeKmls?: number;
  parametrosUsados?: string;
}

function recursiveCollectPlacemarks(
  node: any, 
  state: KmlFolderState, 
  placemarks: CollectedPlacemark[]
) {
  if (!node) return;

  // Resolve Document Name
  let documentName = state.documentName;
  if (node.Document) {
    const docList = ensureArray(node.Document);
    for (const doc of docList) {
      const docName = doc.name ? String(doc.name) : 'Sem Nome';
      recursiveCollectPlacemarks(doc, { currentPath: state.currentPath, documentName: docName }, placemarks);
    }
  }

  // Resolve Folders
  if (node.Folder) {
    const folderList = ensureArray(node.Folder);
    for (const folder of folderList) {
      const folderName = folder.name ? String(folder.name) : 'Pasta Sem Nome';
      const newPath = state.currentPath ? `${state.currentPath} > ${folderName}` : folderName;
      recursiveCollectPlacemarks(folder, { currentPath: newPath, documentName }, placemarks);
    }
  }

  // Collect Placemarks
  if (node.Placemark) {
    const placemarkList = ensureArray(node.Placemark);
    for (const pl of placemarkList) {
      placemarks.push({
        placemark: pl,
        caminhoPath: state.currentPath || 'Raiz',
        documento: documentName || 'Principal'
      });
    }
  }
}

function parsePolygonRings(poly: any): Coordinate[][] {
  const rings: Coordinate[][] = [];

  if (poly.outerBoundaryIs && poly.outerBoundaryIs.LinearRing) {
    const outer = parseKmlCoordinates(poly.outerBoundaryIs.LinearRing.coordinates);
    if (outer.length > 0) rings.push(outer);
  }

  const innerBoundaries = ensureArray(poly.innerBoundaryIs);
  for (const inner of innerBoundaries) {
    if (inner?.LinearRing?.coordinates) {
      const innerRing = parseKmlCoordinates(inner.LinearRing.coordinates);
      if (innerRing.length > 0) rings.push(innerRing);
    }
  }

  return rings;
}

function formatWktRing(coords: Coordinate[]): string {
  return `(${coords.map(c => `${c.lng} ${c.lat}`).join(', ')})`;
}

function formatGeoJsonRing(coords: Coordinate[]): number[][] {
  return coords.map(c => [c.lng, c.lat]);
}

function expandMultiGeometryItem(item: CollectedPlacemark): CollectedPlacemark[] {
  const multi = item.placemark.MultiGeometry ? ensureArray(item.placemark.MultiGeometry)[0] : null;
  if (!multi) return [item];

  const expanded: CollectedPlacemark[] = [];
  const baseName = item.placemark.name ? String(item.placemark.name).trim() : 'MultiGeometry';

  const addGeometry = (geometryKey: 'Point' | 'LineString' | 'Polygon', geometry: any, index: number) => {
    const { Point, LineString, Polygon, MultiGeometry, ...rest } = item.placemark;
    const clonedPlacemark = {
      ...rest,
      name: `${baseName} [${geometryKey} ${index}]`,
      [geometryKey]: geometry
    };
    expanded.push({
      ...item,
      placemark: clonedPlacemark
    });
  };

  ensureArray(multi.Point).forEach((geom, idx) => addGeometry('Point', geom, idx + 1));
  ensureArray(multi.LineString).forEach((geom, idx) => addGeometry('LineString', geom, idx + 1));
  ensureArray(multi.Polygon).forEach((geom, idx) => addGeometry('Polygon', geom, idx + 1));

  return expanded.length > 0 ? expanded : [item];
}

function hasAddressMetadata(addrData: any): boolean {
  return Boolean(
    addrData.endereco_formatado ||
    addrData.logradouro ||
    addrData.numero ||
    addrData.bairro ||
    addrData.municipio ||
    addrData.uf ||
    addrData.cep
  );
}

// Generate unique feature & sub-feature IDs to avoid duplicates
export function getSha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function parseKmlStringToResult(
  kmlString: string, 
  fileName: string, 
  fileHash: string,
  processingType: string = 'AUTO',
  preferenceRegion: string = 'BRASIL',
  options: ParseKmlOptions = {}
): ParserResult {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: true,
    textNodeName: '#text',
    removeNSPrefix: true
  });

  const parsedJson = parser.parse(kmlString);
  const kmlNode = parsedJson.kml;
  
  if (!kmlNode) {
    throw new Error('Formato KML inválido: elemento <kml> não encontrado na raiz.');
  }

  const collectedRaw: CollectedPlacemark[] = [];
  recursiveCollectPlacemarks(kmlNode, { currentPath: '', documentName: '' }, collectedRaw);
  const expandedRaw = collectedRaw.flatMap(expandMultiGeometryItem);
  const sourceKmlName = options.sourceKmlName || (fileName.endsWith('.kmz') ? 'doc.kml' : fileName);
  const idSeed = options.idSeed || fileHash;

  const features: KmlFeature[] = [];
  let pontos: PointFeature[] = [];
  let trechos: TrechoFeature[] = [];
  const poligonos: PoligonoFeature[] = [];
  const errosAlertas: ErroAlerta[] = [];
  const associacoes: Associacao[] = [];
  const auditoria: AuditoriaLog[] = [];
  const enderecos: any[] = [];
  const uniqueEnderecosMap: Record<string, boolean> = {};
  const featureCoordinatesById = new Map<string, Coordinate[]>();
  const featureBoundingBoxById = new Map<string, ReturnType<typeof calculateBoundingBox>>();

  if (/<\s*gx:Track\b/i.test(kmlString)) {
    errosAlertas.push({
      erro_id: 'ERR-GX-TRACK',
      severidade: 'ALERTA',
      categoria: 'Parsing',
      etapa: 'Parsing',
      mensagem: 'Geometria gx:Track detectada e não suportada; o traçado foi ignorado.',
      detalhe_tecnico: 'O parser normaliza prefixos de namespace, mas não interpreta amostras temporais de gx:Track.',
      acao_recomendada: 'Converta gx:Track para LineString antes do envio, se o traçado for necessário.',
      resolvido: false
    });
  }

  const addParsedEndereco = (lat: number, lng: number, addrData: any) => {
    if (!addrData.endereco_formatado) return;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    if (uniqueEnderecosMap[key]) return;
    uniqueEnderecosMap[key] = true;

    enderecos.push({
      consulta_id: `KML-${lat.toFixed(5).replace('.', '_')}-${lng.toFixed(5).replace('.', '_')}`,
      latitude: lat,
      longitude: lng,
      coordenada_normalizada: key,
      endereco_formatado: addrData.endereco_formatado,
      logradouro: addrData.logradouro || '',
      numero: addrData.numero || '',
      bairro: addrData.bairro || '',
      municipio: addrData.municipio || '',
      uf: addrData.uf || '',
      cep: addrData.cep || '',
      pais: addrData.pais || 'Brasil',
      status_api: 'SUCESSO',
      quantidade_resultados: 1,
      fonte: 'Original',
      cache_hit: false,
      necessita_revisao: false
    });
  };

  let orderCount = 1;
  let skippedCount = 0;
  let verticesTotal = 0;
  let totalMeters = 0;
  let totalArea = 0;

  for (const item of expandedRaw) {
    const pl = item.placemark;
    const folderPath = item.caminhoPath;
    const documentName = item.documento;

    const placemarkNome = pl.name ? String(pl.name).trim() : `Placemark #${orderCount}`;
    const placemarkDescricao = pl.description ? String(pl.description).trim() : '';
    const styleUrl = pl.styleUrl ? String(pl.styleUrl) : '';
    const visibility = pl.visibility !== undefined ? Boolean(pl.visibility) : true;

    // TimeStamp and TimeSpans
    let timeStamp = '';
    let timeSpanInicio = '';
    let timeSpanFim = '';
    if (pl.TimeStamp && pl.TimeStamp.when) {
      timeStamp = String(pl.TimeStamp.when);
    }
    if (pl.TimeSpan) {
      if (pl.TimeSpan.begin) timeSpanInicio = String(pl.TimeSpan.begin);
      if (pl.TimeSpan.end) timeSpanFim = String(pl.TimeSpan.end);
    }

    // ExtendedData
    const extDict = extractExtendedData(pl.ExtendedData);
    const extendedJson = JSON.stringify(extDict);

    // Geometry Resolve
    let type: GeometryType = 'Unknown';
    let subType = 'Desconhecido';
    let coordinates: Coordinate[] = [];
    let polygonRings: Coordinate[][] = [];

    // Detect internal geometry type inside Placemark
    if (pl.Point) {
      type = 'Point';
      subType = 'Ponto';
      const pointObj = ensureArray(pl.Point)[0];
      coordinates = parseKmlCoordinates(pointObj.coordinates);
    } else if (pl.LineString) {
      type = 'LineString';
      subType = 'Trecho Linear';
      const lineObj = ensureArray(pl.LineString)[0];
      coordinates = parseKmlCoordinates(lineObj.coordinates);
    } else if (pl.Polygon) {
      type = 'Polygon';
      subType = 'Área/Polígono';
      const poly = ensureArray(pl.Polygon)[0];
      polygonRings = parsePolygonRings(poly);
      coordinates = polygonRings[0] || [];
    } else if (pl.MultiGeometry) {
      type = 'Unknown';
      subType = 'MultiGeometry sem geometria suportada';
    }

    // Skip element if coordinates are empty
    if (coordinates.length === 0) {
      skippedCount++;
      errosAlertas.push({
        erro_id: `ERR-PARS-${orderCount}`,
        severidade: 'ALERTA',
        categoria: 'Parsing',
        etapa: 'Parsing',
        mensagem: `Elemento '${placemarkNome}' não possui coordenadas válidas e foi ignorado.`,
        detalhe_tecnico: `Placemark JSON: ${JSON.stringify(pl).slice(0, 150)}...`,
        acao_recomendada: 'Verifique se o elemento está vazio no Google Earth.',
        resolvido: false
      });
      continue;
    }

    // Deduplicate/validate coordinate sequences
    const geometryCoordinates = type === 'Polygon' && polygonRings.length > 0 ? polygonRings.flat() : coordinates;
    const vertexCount = geometryCoordinates.length;
    verticesTotal += vertexCount;
    const baseId = getSha256(`${idSeed}-${sourceKmlName}-${orderCount}-${placemarkNome}`);
    const feature_id = `F-${baseId.slice(0, 12)}`;

    // Calculate GIS attributes
    const bbox = calculateBoundingBox(geometryCoordinates);
    const centroid = calculateCentroid(coordinates);
    const firstCoord = coordinates[0];

    let length_m = 0;
    let area_m2 = 0;
    let perimeter_m = 0;

    if (type === 'LineString') {
      for (let i = 0; i < coordinates.length - 1; i++) {
        length_m += getDistanceMeters(coordinates[i], coordinates[i+1]);
      }
      totalMeters += length_m;
    }

    if (type === 'Polygon') {
      const polygonStats = calculatePolygonRingsAreaAndPerimeter(polygonRings);
      area_m2 = polygonStats.area;
      perimeter_m = polygonStats.perimeter;
      totalArea += area_m2;
    }

    // Build WKT and GeoJSON representations
    let wkt = '';
    let geojsonGeom = '';

    if (type === 'Point') {
      wkt = `POINT (${firstCoord.lng} ${firstCoord.lat})`;
      geojsonGeom = JSON.stringify({ type: 'Point', coordinates: [firstCoord.lng, firstCoord.lat] });
    } else if (type === 'LineString') {
      wkt = `LINESTRING (${coordinates.map(c => `${c.lng} ${c.lat}`).join(', ')})`;
      geojsonGeom = JSON.stringify({ type: 'LineString', coordinates: coordinates.map(c => [c.lng, c.lat]) });
    } else if (type === 'Polygon') {
      wkt = `POLYGON (${polygonRings.map(formatWktRing).join(', ')})`;
      geojsonGeom = JSON.stringify({ type: 'Polygon', coordinates: polygonRings.map(formatGeoJsonRing) });
    } else {
      wkt = `GEOMETRYCOLLECTION (${coordinates.map(c => `POINT (${c.lng} ${c.lat})`).join(', ')})`;
      geojsonGeom = JSON.stringify({ type: 'GeometryCollection', geometries: coordinates.map(c => ({ type: 'Point', coordinates: [c.lng, c.lat] })) });
    }

    // Check status_validation
    let status_validacao: 'Válido' | 'Inválido' | 'Incompleto' | 'Atenção' = 'Válido';
    let alertasFeature = '';

    if (type === 'Polygon' && area_m2 <= 0) {
      status_validacao = 'Inválido';
      alertasFeature = 'Área do polígono calculada como zero. Verificar auto-interseções.';
      errosAlertas.push({
        erro_id: `ERR-POLY-${feature_id}`,
        severidade: 'ALERTA',
        categoria: 'Validation',
        etapa: 'Parsing',
        feature_id,
        mensagem: `Polígono '${placemarkNome}' possui área nula.`,
        detalhe_tecnico: `Coordenadas: ${coordinates.length} vértices. Área: ${area_m2}`,
        acao_recomendada: 'Certifique-se de que o polígono não possui auto-interseções e que os anéis não se sobrepõem.',
        resolvido: false
      });
    }

    // Build the KmlFeature object
    const kf: KmlFeature = {
      feature_id,
      arquivo_origem: fileName,
      kml_origem: sourceKmlName,
      documento: documentName,
      caminho_pasta: folderPath,
      ordem_original: orderCount,
      placemark_nome: placemarkNome,
      placemark_descricao: placemarkDescricao,
      geometry_type: type,
      geometry_subtype: subType,
      style_url: styleUrl,
      visibility,
      time_stamp: timeStamp,
      time_span_inicio: timeSpanInicio,
      time_span_fim: timeSpanFim,
      extended_data_json: extendedJson,
      quantidade_vertices: vertexCount,
      latitude_principal: firstCoord.lat,
      longitude_principal: firstCoord.lng,
      altitude_principal: firstCoord.alt,
      bbox,
      centroid_lat: centroid.lat,
      centroid_lng: centroid.lng,
      comprimento_m: length_m,
      area_m2,
      perimetro_m: perimeter_m,
      wkt,
      geojson: geojsonGeom,
      status_validacao,
      alertas: alertasFeature
    };

    features.push(kf);
    featureCoordinatesById.set(feature_id, geometryCoordinates);
    featureBoundingBoxById.set(feature_id, bbox);

    // Extract address components from KML element attributes or descriptions (if any exist)
    const rawExtractedAddr = extractAddressFromPlacemark(pl, placemarkNome);
    const hasOriginalAddress = Boolean(rawExtractedAddr.endereco_formatado);
    const hasOriginalAddressData = hasAddressMetadata(rawExtractedAddr);
    const addressMissingNote = hasOriginalAddressData
      ? 'Endereço parcial informado no KML; geocodificação/revisão ainda necessária.'
      : 'Endereço não informado no KML.';

    // If Pt style, generate point feature row
    if (type === 'Point') {
      const extractedAddr = hasOriginalAddressData
        ? rawExtractedAddr
        : {
            origem_endereco: 'Indisponível' as const,
            status_api: 'PENDENTE' as const
          };

      if (hasOriginalAddress) {
        addParsedEndereco(firstCoord.lat, firstCoord.lng, extractedAddr);
      }
      pontos.push({
        point_id: `PT-${feature_id}`,
        feature_id,
        tipo_ponto: 'Original',
        origem_ponto: 'Point Placemark',
        latitude: firstCoord.lat,
        longitude: firstCoord.lng,
        altitude: firstCoord.alt,
        necessita_revisao: !hasOriginalAddress,
        observacoes: hasOriginalAddress ? '' : addressMissingNote,
        ...extractedAddr
      });
    }

    // If LineString style, generate trecho features row
    if (type === 'LineString') {
      const declared = parseDeclaredLength(placemarkNome);
      const diff_m = declared.m > 0 ? Math.abs(length_m - declared.m) : 0;
      const diff_pct = declared.m > 0 ? (diff_m / declared.m) * 100 : 0;
      const alerta_comprimento = declared.m > 0 && diff_pct > 10; // diff more than 10%

      if (alerta_comprimento) {
        errosAlertas.push({
          erro_id: `ERR-LEN-${feature_id}`,
          severidade: 'ALERTA',
          categoria: 'Math',
          etapa: 'Parsing',
          feature_id,
          mensagem: `Trecho '${placemarkNome}' possui comprimento medido (${length_m.toFixed(1)}m) diferente do declarado (${declared.m}m - variação ${diff_pct.toFixed(1)}%).`,
          detalhe_tecnico: `Comprimento Calculado: ${length_m}. Declarado: ${declared.m}`,
          acao_recomendada: 'Verifique se o nome do elemento possui informações antigas de metragem ou se o traçado foi alterado.',
          resolvido: false
        });
      }

      const startAddrObj = hasOriginalAddress ? rawExtractedAddr : undefined;
      const endAddrObj = hasOriginalAddress ? rawExtractedAddr : undefined;

      if (hasOriginalAddress) {
        addParsedEndereco(firstCoord.lat, firstCoord.lng, rawExtractedAddr);
        addParsedEndereco(coordinates[coordinates.length - 1].lat, coordinates[coordinates.length - 1].lng, rawExtractedAddr);
      }

      trechos.push({
        trecho_id: `TR-${feature_id}`,
        feature_id,
        nome_original: placemarkNome,
        caminho_pasta: folderPath,
        comprimento_declarado_texto: declared.text,
        comprimento_declarado_m: declared.m,
        comprimento_calculado_m: length_m,
        diferenca_m: diff_m,
        diferenca_pct: diff_pct,
        alerta_comprimento,
        inicio_lat: firstCoord.lat,
        inicio_lng: firstCoord.lng,
        inicio_endereco: startAddrObj?.endereco_formatado || '',
        fim_lat: coordinates[coordinates.length - 1].lat,
        fim_lng: coordinates[coordinates.length - 1].lng,
        fim_endereco: endAddrObj?.endereco_formatado || '',
        quantidade_vertices: vertexCount,
        quantidade_amostras: 0,
        pontos_associados: 'Nenhum',
        direcao_original: 'Normal',
        inicio_fim_invertido: false,
        status: hasOriginalAddress ? 'Endereço KML Carregado' : 'Endereço Pendente',
        observacoes: hasOriginalAddress ? '' : addressMissingNote
      });
    }

    // If Polygon style, generate poligono features row
    if (type === 'Polygon') {
      const centroidAddrObj = hasOriginalAddress ? rawExtractedAddr : undefined;

      if (hasOriginalAddress) {
        addParsedEndereco(centroid.lat, centroid.lng, rawExtractedAddr);
      }

      poligonos.push({
        poligono_id: `PL-${feature_id}`,
        feature_id,
        nome_original: placemarkNome,
        caminho_pasta: folderPath,
        area_m2,
        perimetro_m: perimeter_m,
        centroid_lat: centroid.lat,
        centroid_lng: centroid.lng,
        centroid_endereco: centroidAddrObj?.endereco_formatado || '',
        quantidade_aneis: polygonRings.length,
        quantidade_vertices: vertexCount,
        valido: area_m2 > 0,
        motivo_invalidade: area_m2 <= 0 ? 'Área calculada como zero/interseções' : undefined,
        geojson: geojsonGeom,
        observacoes: hasOriginalAddress ? '' : (hasOriginalAddressData ? 'Endereço parcial informado no KML; centroide pendente de revisão.' : 'Endereço do centroide não informado no KML.')
      });
    }

    orderCount++;
  }

  // Cross-associations checks: Point close to LineStrings or Line extremities
  // Tolerances configured by default: 30m for point to trecho, 5m for clustering endpoints
  const associationThresholdMeters = 30;
  const endpointThresholdMeters = 5;
  // Limite INFERIOR de metros por grau (o valor real é ~111.195 m com o R_EARTH de
  // 6.371 km usado em distancePointToSegment). Usar um denominador menor que o real
  // torna a margem do prefiltro maior que o limiar, garantindo que a bbox expandida
  // nunca descarte um ponto que a distância exata ainda consideraria dentro de 30 m.
  const metersPerDegreeLowerBound = 110_000;
  const trechoBboxIndex: Array<{
    trecho: TrechoFeature;
    coordinates: Coordinate[];
    bbox: ReturnType<typeof calculateBoundingBox>;
  }> = [];

  for (const trecho of trechos) {
    const coordinates = featureCoordinatesById.get(trecho.feature_id);
    const bbox = featureBoundingBoxById.get(trecho.feature_id);
    if (coordinates && coordinates.length > 1 && bbox) {
      trechoBboxIndex.push({ trecho, coordinates, bbox });
    }
  }

  const pointIdsByTrechoId = new Map<string, string[]>();
  pontos = pontos.map(pt => {
    let closestTrecho: TrechoFeature | null = null;
    let minDistance = Infinity;
    const latMargin = associationThresholdMeters / metersPerDegreeLowerBound;
    const lngMargin = associationThresholdMeters /
      (metersPerDegreeLowerBound * Math.max(Math.cos((pt.latitude * Math.PI) / 180), 0.01));

    for (const { trecho, coordinates, bbox } of trechoBboxIndex) {
      const isOutsideExpandedBbox =
        pt.latitude < bbox.minLat - latMargin ||
        pt.latitude > bbox.maxLat + latMargin ||
        pt.longitude < bbox.minLng - lngMargin ||
        pt.longitude > bbox.maxLng + lngMargin;
      if (isOutsideExpandedBbox) continue;

      for (let i = 0; i < coordinates.length - 1; i++) {
        const dist = distancePointToSegment(
          { lat: pt.latitude, lng: pt.longitude },
          coordinates[i],
          coordinates[i + 1]
        );
        if (dist < minDistance) {
          minDistance = dist;
          closestTrecho = trecho;
        }
      }
    }

    if (closestTrecho && minDistance <= associationThresholdMeters) {
      const currentObs = pt.observacoes ? `${pt.observacoes} ` : '';
      const observacoes = `${currentObs}Associado a '${closestTrecho.nome_original}' a ${minDistance.toFixed(1)}m.`;
      associacoes.push({
        associacao_id: `AS-${pt.point_id}-${closestTrecho.trecho_id}`,
        tipo_associacao: minDistance <= endpointThresholdMeters ? 'Ponto na extremidade do trecho' : 'Ponto próximo ao traçado',
        feature_a: pt.point_id,
        feature_b: closestTrecho.trecho_id,
        distancia_m: minDistance,
        metodo: 'Projeção ortogonal',
        confianca: minDistance <= endpointThresholdMeters ? 'Alta' : 'Média',
        status: 'Pendente',
        observacoes: `Proximidade automática detectada.`
      });

      const pointIds = pointIdsByTrechoId.get(closestTrecho.trecho_id) || [];
      pointIds.push(pt.point_id);
      pointIdsByTrechoId.set(closestTrecho.trecho_id, pointIds);
      return { ...pt, observacoes };
    }

    const currentObs = pt.observacoes ? `${pt.observacoes} ` : '';
    return { ...pt, observacoes: `${currentObs}Ponto isolado (sem trechos próximos em 30 metros).` };
  });

  trechos = trechos.map(trecho => {
    const pointIds = pointIdsByTrechoId.get(trecho.trecho_id);
    if (!pointIds || pointIds.length === 0) return { ...trecho };

    const currentAssoc = trecho.pontos_associados === 'Nenhum' ? '' : trecho.pontos_associados;
    return {
      ...trecho,
      pontos_associados: [currentAssoc, ...pointIds].filter(Boolean).join(', ')
    };
  });

  // Calculate unique coordinates (estimating calls)
  const uniqueCoordinatesMap: Record<string, boolean> = {};
  const addCoord = (lat: number, lng: number) => {
    // Round to 5 decimal places (~1.1 meter grid) for grouping
    const groupKey = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    uniqueCoordinatesMap[groupKey] = true;
  };

  // Add all geocoding targets used by the default complete mode.
  pontos.forEach(p => addCoord(p.latitude, p.longitude));
  trechos.forEach(t => {
    addCoord(t.inicio_lat, t.inicio_lng);
    addCoord(t.fim_lat, t.fim_lng);
  });
  poligonos.forEach(p => addCoord(p.centroid_lat, p.centroid_lng));

  const totalPoints = pontos.length;
  const totalLineEnds = trechos.length * 2;
  const totalPolyCentroids = poligonos.length;

  const countUniqueCoords = Object.keys(uniqueCoordinatesMap).length;
  const pointAddressesMissing = pontos.filter(p => !p.endereco_formatado).length;
  const trechoAddressesMissing = trechos.reduce((count, t) => count + (t.inicio_endereco ? 0 : 1) + (t.fim_endereco ? 0 : 1), 0);
  const polygonAddressesMissing = poligonos.filter(p => !p.centroid_endereco).length;

  // Build Resumo Object
  const resumo = {
    nome_arquivo: fileName,
    hash_original: fileHash,
    data_processamento: new Date().toISOString(),
    quantidade_kmls: options.quantidadeKmls || 1,
    quantidade_documents: collectedRaw.length > 0 ? 1 : 0,
    quantidade_folders: folderPathCount(collectedRaw),
    quantidade_placemarks: collectedRaw.length,
    quantidade_points: totalPoints,
    quantidade_linestrings: trechos.length,
    quantidade_polygons: poligonos.length,
    quantidade_multigeometry: collectedRaw.filter(i => i.placemark.MultiGeometry).length,
    quantidade_nao_suportadas: skippedCount,
    total_vertices: verticesTotal,
    comprimento_total_m: totalMeters,
    area_total_m2: totalArea,
    quantidade_coordenadas_unicas: countUniqueCoords,
    chamadas_estimadas: countUniqueCoords, // Standard default logic: geocode all points mode is countUniqueCoords
    chamadas_realizadas: 0,
    resultados_completos: enderecos.length,
    resultados_parciais: 0,
    resultados_sem_endereco: pointAddressesMissing + trechoAddressesMissing + polygonAddressesMissing,
    erros: errosAlertas.filter(e => e.severidade === 'CRÍTICO').length,
    alertas: errosAlertas.filter(e => e.severidade === 'ALERTA').length,
    modo_processamento: processingType,
    parametros_usados: options.parametrosUsados || `Tolerância de agrupamento: 5m, Tolerância proximidade: 30m, Região: ${preferenceRegion}`
  };

  auditoria.push({
    timestamp: new Date().toISOString(),
    evento: 'Upload e Parsing de KML',
    usuario: 'Sistema',
    acao: 'IMPORT_KML',
    entidade: 'Arquivo',
    antes: '-',
    depois: fileName,
    origem: 'kmlParser',
    status: 'SUCESSO'
  });

  return {
    resumo,
    features,
    pontos,
    trechos,
    poligonos,
    trechos_endereco: [],
    enderecos_poligono: [],
    enderecos, // filled during parsing AND geocoding API phases
    associacoes,
    errosAlertas,
    auditoria
  };
}

function folderPathCount(items: { placemark: any; caminhoPath: string; documento: string }[]): number {
  const folders = new Set<string>();
  for (const item of items) {
    if (item.caminhoPath && item.caminhoPath !== 'Raiz') {
      folders.add(item.caminhoPath);
    }
  }
  return folders.size;
}
