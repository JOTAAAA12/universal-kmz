import { XMLParser } from 'fast-xml-parser';
import * as crypto from 'crypto';
import { 
  ParserResult, 
  KmlFeature, 
  PointFeature, 
  TrechoFeature, 
  PoligonoFeature, 
  BoundingBox, 
  Coordinate,
  GeometryType,
  ErroAlerta,
  Associacao,
  AuditoriaLog
} from './types';

// Helper to ensure lists are arrays (fast-xml-parser can return object instead of array of length 1)
function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val;
  return [val];
}

// Earth Radius in meters
const R_EARTH = 6371000;

// Haversine formula for distance in meters
export function getDistanceMeters(c1: Coordinate, c2: Coordinate): number {
  const lat1Rad = (c1.lat * Math.PI) / 180;
  const lat2Rad = (c2.lat * Math.PI) / 180;
  const deltaLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const deltaLng = ((c2.lng - c1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1Rad) *
      Math.cos(lat2Rad) *
      Math.sin(deltaLng / 2) *
      Math.sin(deltaLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_EARTH * c;
}

// Distance from a point P to a line segment AB in meters
export function distancePointToSegment(P: Coordinate, A: Coordinate, B: Coordinate): number {
  const dAB = getDistanceMeters(A, B);
  if (dAB < 0.1) return getDistanceMeters(P, A);

  // Simple local flat projection centering at Segment midpoint to calculate closest point
  const midLat = (A.lat + B.lat) / 2;
  const midLatRad = (midLat * Math.PI) / 180;

  const toMetersX = (lng: number) => (lng * Math.PI / 180) * R_EARTH * Math.cos(midLatRad);
  const toMetersY = (lat: number) => (lat * Math.PI / 180) * R_EARTH;

  const ax = toMetersX(A.lng);
  const ay = toMetersY(A.lat);
  const bx = toMetersX(B.lng);
  const by = toMetersY(B.lat);
  const px = toMetersX(P.lng);
  const py = toMetersY(P.lat);

  // Segment vector
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  // Projection t
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t)); // clamp to segment

  // Closest point in meters
  const cx = ax + t * (bx - ax);
  const cy = ay + t * (by - ay);

  // Conversion back to LatLng to be precise, or just return Euclidean distance
  return Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
}

// Calculate bounding box for coordinates
export function calculateBoundingBox(coords: Coordinate[]): BoundingBox {
  if (coords.length === 0) return { minLat: 0, minLng: 0, maxLat: 0, maxLng: 0 };
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;

  for (const c of coords) {
    if (c.lat < minLat) minLat = c.lat;
    if (c.lng < minLng) minLng = c.lng;
    if (c.lat > maxLat) maxLat = c.lat;
    if (c.lng > maxLng) maxLng = c.lng;
  }

  return { minLat, minLng, maxLat, maxLng };
}

// Calculate centroid of coordinates
export function calculateCentroid(coords: Coordinate[]): Coordinate {
  if (coords.length === 0) return { lat: 0, lng: 0 };
  let sumLat = 0;
  let sumLng = 0;
  for (const c of coords) {
    sumLat += c.lat;
    sumLng += c.lng;
  }
  return { lat: sumLat / coords.length, lng: sumLng / coords.length };
}

// Calculate planar area in square meters and perimeter of a polygon using local sinusoidal projection
export function calculatePlanarPolygonAreaAndPerimeter(coords: Coordinate[]): { area: number; perimeter: number } {
  if (coords.length < 3) return { area: 0, perimeter: 0 };

  // If the polygon is not closed, close it for calculations
  const localCoords = [...coords];
  const first = localCoords[0];
  const last = localCoords[localCoords.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) {
    localCoords.push(first);
  }

  const centroid = calculateCentroid(localCoords);
  const midLatRad = (centroid.lat * Math.PI) / 180;

  // Project points
  const points = localCoords.map(c => {
    const x = ((c.lng - centroid.lng) * Math.PI / 180) * R_EARTH * Math.cos(midLatRad);
    const y = ((c.lat - centroid.lat) * Math.PI / 180) * R_EARTH;
    return { x, y };
  });

  // Green's theorem / Shoelace formula for area
  let doubleArea = 0;
  let perimeter = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    doubleArea += (p1.x * p2.y - p2.x * p1.y);
    perimeter += Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  }

  return {
    area: Math.abs(doubleArea) / 2,
    perimeter
  };
}

export function calculatePolygonRingsAreaAndPerimeter(rings: Coordinate[][]): { area: number; perimeter: number } {
  if (rings.length === 0) return { area: 0, perimeter: 0 };

  const [outer, ...holes] = rings;
  const outerStats = calculatePlanarPolygonAreaAndPerimeter(outer);
  const holesStats = holes.map(hole => calculatePlanarPolygonAreaAndPerimeter(hole));
  const holesArea = holesStats.reduce((sum, item) => sum + item.area, 0);
  const holesPerimeter = holesStats.reduce((sum, item) => sum + item.perimeter, 0);

  return {
    area: Math.max(outerStats.area - holesArea, 0),
    perimeter: outerStats.perimeter + holesPerimeter
  };
}

// Regex to extract length declaration from placemark name (e.g. "Cabo 150m", "Fibra 3.5km", "Trecho 250 Metros")
export function parseDeclaredLength(name: string): { text: string; m: number } {
  if (!name) return { text: '', m: 0 };
  
  // Regex to look for patterns like "100m", "100 m", "3.5km", "3,5 km", "50 metros", "50m"
  const regex = /(\d+(?:[.,]\d+)?)\s*(m|meters|metros|km|kilometers|kilometros|quilometros|quilômetros)/gi;
  const match = regex.exec(name);
  if (match) {
    const numStr = match[1].replace(',', '.');
    const unit = match[2].toLowerCase();
    const value = parseFloat(numStr);
    
    if (isNaN(value)) return { text: '', m: 0 };

    if (unit.startsWith('k')) {
      return { text: match[0], m: value * 1000 };
    } else {
      return { text: match[0], m: value };
    }
  }
  return { text: '', m: 0 };
}

// Parser for KML style Coordinates string "lng,lat,alt lng,lat,alt ..."
export function parseKmlCoordinates(coordStr: string): Coordinate[] {
  if (!coordStr) return [];
  const coords: Coordinate[] = [];
  const tuples = coordStr.trim().split(/\s+/);

  for (const t of tuples) {
    const parts = t.split(',');
    if (parts.length >= 2) {
      const lng = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length >= 3 ? parseFloat(parts[2]) : undefined;
      if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        coords.push({ lat, lng, alt: isNaN(alt as any) ? undefined : alt });
      }
    }
  }

  return coords;
}

// Process Placemark ExtendedData
export function extractExtendedData(extendedData: any): Record<string, string> {
  const result: Record<string, string> = {};
  if (!extendedData) return result;

  // Case 1: Simple <Data name="key"><value>val</value></Data>
  if (extendedData.Data) {
    const dataList = ensureArray(extendedData.Data);
    for (const d of dataList) {
      if (d['@_name']) {
        const key = d['@_name'];
        const val = d.value !== undefined ? String(d.value) : '';
        result[key] = val;
      }
    }
  }

  // Case 2: SchemaData with <SimpleData name="key">val</SimpleData>
  if (extendedData.SchemaData) {
    const schemaList = ensureArray(extendedData.SchemaData);
    for (const sd of schemaList) {
      if (sd.SimpleData) {
        const simpleList = ensureArray(sd.SimpleData);
        for (const s of simpleList) {
          if (s['@_name']) {
            const key = s['@_name'];
            const val = s['#text'] !== undefined ? String(s['#text']) : (s !== null ? String(s) : '');
            result[key] = val;
          }
        }
      }
    }
  }

  // Case 3: Direct arbitrary child tags of ExtendedData
  for (const [key, val] of Object.entries(extendedData)) {
    if (key !== 'Data' && key !== 'SchemaData' && !key.startsWith('@_')) {
      if (typeof val === 'string' || typeof val === 'number') {
        result[key] = String(val);
      } else if (val && typeof val === 'object' && (val as any)['#text'] !== undefined) {
        result[key] = String((val as any)['#text']);
      }
    }
  }

  return result;
}

// Extract properties from HTML tables or raw description texts
export function extractFromHtmlOrText(text: string): Record<string, string> {
  const dict: Record<string, string> = {};
  if (!text) return dict;

  // Regex to match HTML table row variations (like <tr><td>Key</td><td>Value</td></tr>)
  const htmlRowRegex = /<tr[^>]*>\s*<t[dh][^>]*>(.*?)<\/t[dh]>\s*<t[dh][^>]*>(.*?)<\/t[dh]>\s*<\/tr>/gi;
  let match;
  let hasHtmlTable = false;

  while ((match = htmlRowRegex.exec(text)) !== null) {
    hasHtmlTable = true;
    const key = cleanHtmlText(match[1]);
    const val = cleanHtmlText(match[2]);
    if (key && val) {
      dict[key] = val;
    }
  }

  // If no HTML table is found, parse as clean text lines with ":" or "=" separators
  if (!hasHtmlTable) {
    // replace <br> with newlines, clean up HTML tags
    const cleanText = text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+(>|$)/g, '')
      .trim();

    const lines = cleanText.split('\n');
    for (const line of lines) {
      const parts = line.split(/[:=]/);
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join(':').trim();
        if (key && val) {
          dict[key] = val;
        }
      }
    }
  }

  return dict;
}

export function cleanHtmlText(s: string): string {
  if (!s) return '';
  return s
    .replace(/<\/?[^>]+(>|$)/g, '') // remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// Extract address components from KML properties, description, or address tag
export function extractAddressFromPlacemark(pl: any, name: string): {
  endereco_formatado?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  pais?: string;
  origem_endereco?: 'Original' | 'Geocoding API' | 'Manual' | 'Carregado' | 'Indisponível';
  status_api?: 'PENDENTE' | 'SUCESSO' | 'ZERO_RESULTS' | 'FALHA' | 'Mocked';
} {
  const extDict = extractExtendedData(pl.ExtendedData);
  
  // Also collect fields from description if it contains HTML or text table
  let descDict: Record<string, string> = {};
  if (pl.description) {
    descDict = extractFromHtmlOrText(String(pl.description));
  }

  // Combine both dictionaries, priority to ExtendedData
  const combinedDict: Record<string, string> = { ...descDict, ...extDict };

  // Helper clean keys
  const cleanKey = (k: string): string => {
    return k.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9_]/g, "")
      .trim();
  };

  const normDict: Record<string, string> = {};
  for (const [k, v] of Object.entries(combinedDict)) {
    normDict[cleanKey(k)] = String(v).trim();
  }

  // Common geographic synonym arrays (normalized keys)
  const logradouroKeys = [
    'logradouro', 'logr', 'rua', 'avenida', 'street', 'streetname', 'street_name', 'nomederua', 'nome_rua', 'via', 'nomelogr', 'nome_logr', 'enderecologradouro', 'endereco_logradouro'
  ];
  const numeroKeys = [
    'numero', 'nro', 'nr', 'number', 'streetnum', 'street_num', 'numimovel', 'num_imovel', 'num'
  ];
  const bairroKeys = [
    'bairro', 'sublocality', 'neighborhood', 'barr', 'bair', 'bairronome', 'bairro_nome', 'subloc'
  ];
  const municipioKeys = [
    'municipio', 'cidade', 'city', 'localidade', 'mun', 'cidadenome', 'cidade_nome', 'municipios'
  ];
  const ufKeys = [
    'uf', 'estado', 'state', 'siglauf', 'sigla_uf', 'est', 'estnome', 'est_nome'
  ];
  const cepKeys = [
    'cep', 'zip', 'postalcode', 'postal_code', 'zipcode', 'zip_code'
  ];
  const fullAddrKeys = [
    'endereco', 'endereço', 'address', 'enderecocompleto', 'endereco_completo', 'fulladdress', 'full_address', 'ender', 'descr_completa', 'endereco_completo_original'
  ];

  let logradouro = '';
  let numero = '';
  let bairro = '';
  let municipio = '';
  let uf = '';
  let cep = '';
  let endereco_formatado = '';
  let pais = 'Brasil';

  for (const k of logradouroKeys) {
    if (normDict[k]) { logradouro = normDict[k]; break; }
  }
  for (const k of numeroKeys) {
    if (normDict[k]) { numero = normDict[k]; break; }
  }
  for (const k of bairroKeys) {
    if (normDict[k]) { bairro = normDict[k]; break; }
  }
  for (const k of municipioKeys) {
    if (normDict[k]) { municipio = normDict[k]; break; }
  }
  for (const k of ufKeys) {
    if (normDict[k]) { uf = normDict[k]; break; }
  }
  for (const k of cepKeys) {
    if (normDict[k]) { cep = normDict[k]; break; }
  }
  for (const k of fullAddrKeys) {
    if (normDict[k]) { endereco_formatado = normDict[k]; break; }
  }

  // Wildcard fallback search if not matched
  for (const [k, v] of Object.entries(normDict)) {
    if (!logradouro && (k.includes('rua') || k.includes('logradouro') || k.includes('avenida') || k.includes('street') || k.includes('logr'))) {
      logradouro = String(v);
    }
    if (!numero && (k.includes('numero') || k === 'num' || k === 'nro' || k === 'nr' || k === 'number' || k.includes('num_'))) {
      numero = String(v);
    }
    if (!bairro && (k.includes('bairro') || k.includes('neighborhood') || k.includes('bair'))) {
      bairro = String(v);
    }
    if (!municipio && (k.includes('municipio') || k.includes('cidade') || k.includes('city') || k === 'mun')) {
      municipio = String(v);
    }
    if (!uf && (k === 'uf' || k.includes('estado') || k === 'state')) {
      uf = String(v);
    }
    if (!cep && (k === 'cep' || k.includes('zip') || k.includes('postal'))) {
      cep = String(v);
    }
    if (!endereco_formatado && (k.includes('endereco') || k.includes('address') || k === 'ender')) {
      endereco_formatado = String(v);
    }
  }

  // If pl.address exists, it has highest priority for full address
  if (pl.address) {
    endereco_formatado = String(pl.address).trim();
  }

  // If name has street type, parse as potential address
  if (name && !logradouro) {
    const prefixRegex = /^(Rua|Avenida|Travessa|Alameda|Estrada|Rodovia|Praça|Viela|Av\.?|R\.?|Al\.?|Trv\.?|Pç\.?|Rod\.?|Estr\.?)\s+([^,]+)(?:,\s*(\d+|s\/n|S\/N))?(?:\s*-\s*(.+))?$/i;
    const match = prefixRegex.exec(name.trim());
    if (match) {
      logradouro = `${match[1]} ${match[2]}`.trim();
      if (match[3]) {
        numero = match[3].trim();
      }
      if (match[4]) {
        const rest = match[4].trim();
        const parts = rest.split(/[,-]/);
        if (parts.length > 0) {
          bairro = parts[0].trim();
        }
        if (parts.length > 1) {
          municipio = parts[1].trim();
        }
      }
    }
  }

  // Build formatted address if not set but we have pieces
  if (!endereco_formatado && (logradouro || bairro || cep)) {
    const parts = [];
    if (logradouro) {
      parts.push(numero ? `${logradouro}, ${numero}` : logradouro);
    }
    if (bairro) parts.push(bairro);
    if (municipio) {
      parts.push(uf ? `${municipio} - ${uf}` : municipio);
    } else if (uf) {
      parts.push(uf);
    }
    if (cep) parts.push(cep);
    endereco_formatado = parts.join(' - ');
  }

  const hasAddressDetail = Boolean(endereco_formatado || logradouro || numero || bairro || cep);
  const hasAnyAddressMetadata = Boolean(hasAddressDetail || municipio || uf);

  // Check if any attribute was successfully pre-loaded. City/UF alone is kept as
  // original metadata, but it is not promoted to a complete address.
  if (hasAnyAddressMetadata) {
    return {
      endereco_formatado: hasAddressDetail ? endereco_formatado || undefined : undefined,
      logradouro: logradouro || undefined,
      numero: numero || undefined,
      bairro: bairro || undefined,
      municipio: municipio || undefined,
      uf: uf || undefined,
      cep: cep || undefined,
      pais: pais,
      origem_endereco: hasAddressDetail ? 'Carregado' : 'Original',
      status_api: hasAddressDetail ? 'SUCESSO' : 'PENDENTE'
    };
  }

  return {};
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
    textNodeName: '#text'
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
  const pontos: PointFeature[] = [];
  const trechos: TrechoFeature[] = [];
  const poligonos: PoligonoFeature[] = [];
  const errosAlertas: ErroAlerta[] = [];
  const associacoes: Associacao[] = [];
  const auditoria: AuditoriaLog[] = [];
  const enderecos: any[] = [];
  const uniqueEnderecosMap: Record<string, boolean> = {};

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
  for (const pt of pontos) {
    let closestTrecho: TrechoFeature | null = null;
    let minDistance = Infinity;

    for (const tr of trechos) {
      // Find parent KmlFeature coordinates
      const kf = features.find(f => f.feature_id === tr.feature_id);
      if (kf) {
        const polylineCoords = parseKmlCoordinates(JSON.parse(kf.geojson).coordinates ? 
          JSON.parse(kf.geojson).coordinates.map(([lng, lat]: [number, number]) => `${lng},${lat}`).join(' ') : '');
        
        if (polylineCoords.length > 1) {
          for (let i = 0; i < polylineCoords.length - 1; i++) {
            const dist = distancePointToSegment(
              { lat: pt.latitude, lng: pt.longitude },
              polylineCoords[i],
              polylineCoords[i+1]
            );
            if (dist < minDistance) {
              minDistance = dist;
              closestTrecho = tr;
            }
          }
        }
      }
    }

    if (closestTrecho && minDistance <= 30) {
      const currentObs = pt.observacoes ? `${pt.observacoes} ` : '';
      pt.observacoes = `${currentObs}Associado a '${closestTrecho.nome_original}' a ${minDistance.toFixed(1)}m.`;
      associacoes.push({
        associacao_id: `AS-${pt.point_id}-${closestTrecho.trecho_id}`,
        tipo_associacao: minDistance <= 5 ? 'Ponto na extremidade do trecho' : 'Ponto próximo ao traçado',
        feature_a: pt.point_id,
        feature_b: closestTrecho.trecho_id,
        distancia_m: minDistance,
        metodo: 'Projeção ortogonal',
        confianca: minDistance <= 5 ? 'Alta' : 'Média',
        status: 'Pendente',
        observacoes: `Proximidade automática detectada.`
      });

      // Append point ID reference to closestTrecho
      const currentAssoc = closestTrecho.pontos_associados;
      closestTrecho.pontos_associados = currentAssoc === 'Nenhum' ? pt.point_id : `${currentAssoc}, ${pt.point_id}`;
    } else {
      const currentObs = pt.observacoes ? `${pt.observacoes} ` : '';
      pt.observacoes = `${currentObs}Ponto isolado (sem trechos próximos em 30 metros).`;
    }
  }

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
