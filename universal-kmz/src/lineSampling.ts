import { calculateCentroid, getDistanceMeters } from './kmlParser';
import { Coordinate, EnderecoConsulta, EnderecoPoligono, TrechoEndereco } from './types';

const DEFAULT_STEP_METERS = 100;
const MIN_POINT_GAP_METERS = 10;
const UNKNOWN_LOGRADOURO = 'NÃO IDENTIFICADO';

type AddressSample = {
  coord: Coordinate;
  endereco: EnderecoConsulta;
};

function safeStep(stepMeters?: number): number {
  return Number.isFinite(stepMeters) && Number(stepMeters) > 0
    ? Number(stepMeters)
    : DEFAULT_STEP_METERS;
}

function cloneCoord(coord: Coordinate): Coordinate {
  return coord.alt === undefined
    ? { lat: coord.lat, lng: coord.lng }
    : { lat: coord.lat, lng: coord.lng, alt: coord.alt };
}

function pushDistinct(coords: Coordinate[], coord: Coordinate, preferExact = false) {
  if (coords.length === 0) {
    coords.push(cloneCoord(coord));
    return;
  }

  const duplicateIndex = coords.findIndex(existing => (
    getDistanceMeters(existing, coord) < MIN_POINT_GAP_METERS
  ));
  if (duplicateIndex >= 0) {
    if (preferExact) {
      coords[duplicateIndex] = cloneCoord(coord);
    }
    return;
  }

  coords.push(cloneCoord(coord));
}

function interpolate(a: Coordinate, b: Coordinate, ratio: number): Coordinate {
  const coord: Coordinate = {
    lat: a.lat + ((b.lat - a.lat) * ratio),
    lng: a.lng + ((b.lng - a.lng) * ratio)
  };

  if (a.alt !== undefined || b.alt !== undefined) {
    coord.alt = (a.alt || 0) + (((b.alt || 0) - (a.alt || 0)) * ratio);
  }

  return coord;
}

export function samplePolyline(coords: Coordinate[], stepMeters = DEFAULT_STEP_METERS): Coordinate[] {
  if (coords.length === 0) return [];
  if (coords.length === 1) return [cloneCoord(coords[0])];

  const step = safeStep(stepMeters);
  const samples: Coordinate[] = [];

  for (let i = 0; i < coords.length - 1; i++) {
    const start = coords[i];
    const end = coords[i + 1];
    const distance = getDistanceMeters(start, end);

    pushDistinct(samples, start, true);

    if (distance >= MIN_POINT_GAP_METERS) {
      for (let travelled = step; travelled < distance; travelled += step) {
        if (distance - travelled < MIN_POINT_GAP_METERS) break;
        pushDistinct(samples, interpolate(start, end, travelled / distance));
      }
    }

    pushDistinct(samples, end, true);
  }

  return samples;
}

function normalizeText(value?: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function streetKey(endereco: EnderecoConsulta): string {
  const normalized = normalizeText(endereco.logradouro);
  return normalized || UNKNOWN_LOGRADOURO;
}

function displayStreet(endereco: EnderecoConsulta): string {
  const value = endereco.logradouro?.trim();
  return value || UNKNOWN_LOGRADOURO;
}

function parseStreetNumber(value?: string): number | undefined {
  const match = (value || '').match(/\d+(?:[.,]\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0].replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fillAddressFields(target: TrechoEndereco, endereco: EnderecoConsulta) {
  target.bairro = target.bairro || endereco.bairro || undefined;
  target.municipio = target.municipio || endereco.municipio || undefined;
  target.uf = target.uf || endereco.uf || undefined;

  const numero = parseStreetNumber(endereco.numero);
  if (numero !== undefined) {
    target.numero_inicio = target.numero_inicio === undefined
      ? numero
      : Math.min(target.numero_inicio, numero);
    target.numero_fim = target.numero_fim === undefined
      ? numero
      : Math.max(target.numero_fim, numero);
  }
}

function createSegment(sample: AddressSample): TrechoEndereco {
  const segment: TrechoEndereco = {
    logradouro: displayStreet(sample.endereco),
    extensao_m: 0,
    quantidade_amostras: 0,
    necessita_revisao: false
  };
  return addSampleToSegment(segment, sample, undefined);
}

function addSampleToSegment(
  segment: TrechoEndereco,
  sample: AddressSample,
  previousCoord: Coordinate | undefined
): TrechoEndereco {
  if (previousCoord) {
    segment.extensao_m += getDistanceMeters(previousCoord, sample.coord);
  }
  segment.quantidade_amostras++;
  segment.necessita_revisao = segment.necessita_revisao
    || !sample.endereco.logradouro
    || sample.endereco.necessita_revisao;
  fillAddressFields(segment, sample.endereco);
  return segment;
}

export function consolidateSegments(samples: AddressSample[]): TrechoEndereco[] {
  const segments: TrechoEndereco[] = [];
  let current: TrechoEndereco | null = null;
  let currentKey = '';
  let previousCoord: Coordinate | undefined;

  for (const sample of samples) {
    const key = streetKey(sample.endereco);
    if (!current || key !== currentKey) {
      if (current) segments.push(current);
      current = createSegment(sample);
      currentKey = key;
      previousCoord = sample.coord;
      continue;
    }

    addSampleToSegment(current, sample, previousCoord);
    previousCoord = sample.coord;
  }

  if (current) segments.push(current);
  return segments;
}

function removeClosingDuplicate(coords: Coordinate[]): Coordinate[] {
  if (coords.length < 2) return coords.map(cloneCoord);
  const first = coords[0];
  const last = coords[coords.length - 1];
  const open = getDistanceMeters(first, last) < MIN_POINT_GAP_METERS
    ? coords.slice(0, -1)
    : coords;
  return open.map(cloneCoord);
}

export function samplePolygon(anelExterno: Coordinate[]): Coordinate[] {
  const vertices = removeClosingDuplicate(anelExterno);
  if (vertices.length === 0) return [];

  const samples: Coordinate[] = [];
  pushDistinct(samples, calculateCentroid(vertices), true);
  vertices.forEach(vertex => pushDistinct(samples, vertex, true));
  return samples;
}

type PolygonMode = {
  key: string;
  logradouro: string;
  municipio: string;
  count: number;
  firstIndex: number;
  endereco: EnderecoConsulta;
};

export function resolveDominantPolygonAddress(samples: AddressSample[]): EnderecoPoligono {
  const modes = new Map<string, PolygonMode>();
  const confrontantes = new Map<string, string>();
  let dominant: PolygonMode | undefined;
  let needsReview = false;

  samples.forEach((sample, index) => {
    const logradouroKey = streetKey(sample.endereco);
    const municipioKey = normalizeText(sample.endereco.municipio);
    const key = `${logradouroKey}|${municipioKey}`;
    const existing = modes.get(key);

    needsReview = needsReview || !sample.endereco.logradouro || sample.endereco.necessita_revisao;

    if (existing) {
      existing.count++;
    } else {
      modes.set(key, {
        key,
        logradouro: displayStreet(sample.endereco),
        municipio: sample.endereco.municipio || '',
        count: 1,
        firstIndex: index,
        endereco: sample.endereco
      });
    }
  });

  for (const mode of modes.values()) {
    if (
      !dominant
      || mode.count > dominant.count
      || (mode.count === dominant.count && mode.firstIndex < dominant.firstIndex)
    ) {
      dominant = mode;
    }
  }

  samples.forEach(sample => {
    const normalized = streetKey(sample.endereco);
    if (!sample.endereco.logradouro || normalized === streetKey(dominant?.endereco || sample.endereco)) {
      return;
    }
    if (!confrontantes.has(normalized)) {
      confrontantes.set(normalized, sample.endereco.logradouro.trim());
    }
  });

  const endereco = dominant?.endereco;
  return {
    logradouro: dominant?.logradouro || UNKNOWN_LOGRADOURO,
    bairro: endereco?.bairro || undefined,
    municipio: endereco?.municipio || dominant?.municipio || undefined,
    uf: endereco?.uf || undefined,
    endereco_formatado: endereco?.endereco_formatado || undefined,
    confrontantes: [...confrontantes.values()],
    quantidade_amostras: samples.length,
    necessita_revisao: needsReview || !dominant || dominant.logradouro === UNKNOWN_LOGRADOURO
  };
}
