import { EnderecoConsulta, PointFeature } from './types';
import { addressesLikelyEqual, normalizeStreetTokens, normalizeUf } from './addressNormalize';

type AddressOrigin = NonNullable<PointFeature['origem_endereco']>;

const EXTERNAL_GEOCODER_SOURCES = new Set([
  'Google API',
  'google',
  'nominatim',
  'photon',
  'locationiq',
  'geoapify',
  'bigdatacloud',
  'cnefe',
  'geocoder-chain'
]);

export function resolveAddressOrigin(
  addr: EnderecoConsulta,
  fallback?: PointFeature['origem_endereco']
): AddressOrigin {
  if (addr.fonte === 'Mock' || addr.fonte === 'mock' || addr.status_api === 'Mocked') return 'Mocked';
  if (EXTERNAL_GEOCODER_SOURCES.has(addr.fonte)) return 'Geocoding API';
  if (addr.fonte === 'Original') return 'Original';
  if (addr.fonte === 'Manual') return 'Manual';
  return fallback || 'Geocoding API';
}

function appendObservation(current: string, addition: string): string {
  if (!addition) return current;
  if (current.includes(addition)) return current;
  return current ? `${current} ${addition}` : addition;
}

function isExternalOrigin(origin: AddressOrigin): boolean {
  return origin === 'Geocoding API' || origin === 'Mocked';
}

type FormattedAddressTerritory = {
  municipio?: string;
  uf?: string;
};

function extractFormattedAddressTerritory(value: string): FormattedAddressTerritory {
  const withoutCountry = value.replace(/(?:,\s*)?(?:brasil|brazil)\s*$/iu, '').trim();
  const commaParts = withoutCountry.split(',').map(part => part.trim()).filter(Boolean);
  const finalPart = commaParts[commaParts.length - 1] || '';
  const dashParts = finalPart.split(/\s*[-–/]\s*/u).map(part => part.trim()).filter(Boolean);
  const uf = normalizeUf(dashParts[dashParts.length - 1] || '');

  if (!/^[A-Z]{2}$/.test(uf)) return {};

  const municipio = dashParts.length > 1
    ? dashParts[dashParts.length - 2]
    : commaParts[commaParts.length - 2];
  return { municipio, uf };
}

// Compara dois enderecos formatados apos canonizar a UF final (nome completo -> sigla) e
// remover o pais. O resultado alimenta uma comparacao de equivalencia TOTAL de tokens: aqui
// o endereco do KML e a unica copia do dado (trechos/poligonos nao guardam registro
// "Original" separado), logo qualquer divergencia substantiva - numero, bairro, CEP,
// municipio - precisa virar conflito em vez de ser absorvida por similaridade parcial.
function canonicalAddressTokens(value: string): string[] {
  const withoutCountry = value.replace(/(?:,\s*)?(?:brasil|brazil)\s*$/iu, '').trim();
  const { uf } = extractFormattedAddressTerritory(value);
  if (!uf) return normalizeStreetTokens(withoutCountry);

  const separatorIndex = Math.max(
    withoutCountry.lastIndexOf('-'),
    withoutCountry.lastIndexOf('–'),
    withoutCountry.lastIndexOf('/'),
    withoutCountry.lastIndexOf(',')
  );
  const head = separatorIndex >= 0 ? withoutCountry.slice(0, separatorIndex) : withoutCountry;
  return [...normalizeStreetTokens(head), uf.toLowerCase()];
}

function sameAddressTokens(left: string[], right: string[]): boolean {
  const leftTokens = new Set(left);
  const rightTokens = new Set(right);
  return leftTokens.size === rightTokens.size && [...leftTokens].every(token => rightTokens.has(token));
}

function formattedAddressTerritoryConflicts(currentAddress: string, incoming: EnderecoConsulta): boolean {
  const currentTerritory = extractFormattedAddressTerritory(currentAddress);
  return Boolean(
    currentTerritory.municipio
    && incoming.municipio
    && !addressesLikelyEqual(currentTerritory.municipio, incoming.municipio, 1)
  ) || Boolean(
    currentTerritory.uf
    && incoming.uf
    && currentTerritory.uf !== normalizeUf(incoming.uf)
  );
}

export function buildPointAddressConflict(
  point: PointFeature,
  incoming: EnderecoConsulta
): string {
  const incomingOrigin = resolveAddressOrigin(incoming, point.origem_endereco);
  if (!isExternalOrigin(incomingOrigin)) return '';

  const conflicts: string[] = [];
  const incomingMunicipio = incoming.municipio || '';
  const incomingUf = incoming.uf || '';

  if (
    point.logradouro
    && incoming.logradouro
    && !addressesLikelyEqual(point.logradouro, incoming.logradouro)
  ) {
    conflicts.push(`logradouro KML "${point.logradouro}" x ${incomingOrigin} "${incoming.logradouro}"`);
  }

  if (
    point.bairro
    && incoming.bairro
    && !addressesLikelyEqual(point.bairro, incoming.bairro)
  ) {
    conflicts.push(`bairro KML "${point.bairro}" x ${incomingOrigin} "${incoming.bairro}"`);
  }

  if (
    point.municipio &&
    incomingMunicipio &&
    !addressesLikelyEqual(point.municipio, incomingMunicipio, 1)
  ) {
    conflicts.push(`municipio KML "${point.municipio}" x ${incomingOrigin} "${incomingMunicipio}"`);
  }

  if (
    point.uf &&
    incomingUf &&
    normalizeUf(point.uf) !== normalizeUf(incomingUf)
  ) {
    conflicts.push(`UF KML "${point.uf}" x ${incomingOrigin} "${incomingUf}"`);
  }

  if (conflicts.length === 0) return '';
  return `Conflito de endereco: ${conflicts.join('; ')}. Dado do KML preservado; revisar geocodificacao.`;
}

export function buildExistingAddressConflict(
  currentAddress: string | undefined,
  incoming: EnderecoConsulta,
  label: string
): string {
  const incomingOrigin = resolveAddressOrigin(incoming);
  const incomingAddress = incoming.endereco_formatado || '';
  if (!currentAddress || !incomingAddress || !isExternalOrigin(incomingOrigin)) return '';
  if (!formattedAddressTerritoryConflicts(currentAddress, incoming)
    && sameAddressTokens(canonicalAddressTokens(currentAddress), canonicalAddressTokens(incomingAddress))) return '';

  return `Conflito de endereco em ${label}: KML "${currentAddress}" x ${incomingOrigin} "${incomingAddress}". Dado do KML preservado; revisar geocodificacao.`;
}

export function mergePointWithGeocodedAddress(
  point: PointFeature,
  incoming: EnderecoConsulta
): PointFeature {
  const incomingOrigin = resolveAddressOrigin(incoming, point.origem_endereco);
  const conflict = buildPointAddressConflict(point, incoming);
  const shouldPreserveOriginalLocation = Boolean(conflict);

  return {
    ...point,
    endereco_formatado: shouldPreserveOriginalLocation ? point.endereco_formatado : incoming.endereco_formatado || point.endereco_formatado || '',
    logradouro: shouldPreserveOriginalLocation ? point.logradouro : incoming.logradouro || point.logradouro || '',
    numero: shouldPreserveOriginalLocation ? point.numero : incoming.numero || point.numero || '',
    bairro: shouldPreserveOriginalLocation ? point.bairro : incoming.bairro || point.bairro || '',
    municipio: shouldPreserveOriginalLocation ? point.municipio : incoming.municipio || point.municipio || '',
    uf: shouldPreserveOriginalLocation ? point.uf : incoming.uf || point.uf || '',
    cep: shouldPreserveOriginalLocation ? point.cep : incoming.cep || point.cep || '',
    pais: shouldPreserveOriginalLocation ? point.pais : incoming.pais || point.pais || '',
    place_id: incoming.place_id || point.place_id || '',
    plus_code: incoming.plus_code || point.plus_code || '',
    status_api: (incoming.status_api || point.status_api || 'SUCESSO') as PointFeature['status_api'],
    origem_endereco: shouldPreserveOriginalLocation ? point.origem_endereco : incomingOrigin,
    necessita_revisao: shouldPreserveOriginalLocation || incomingOrigin === 'Mocked' || incoming.necessita_revisao || point.necessita_revisao,
    conflito_endereco: conflict || point.conflito_endereco,
    observacoes: conflict ? appendObservation(point.observacoes, conflict) : point.observacoes
  };
}

export function mergeExternalAddressRecord(
  current: EnderecoConsulta[],
  incoming: EnderecoConsulta
): EnderecoConsulta[] {
  const incomingOrigin = resolveAddressOrigin(incoming);
  const existingOriginal = current.find(
    item => item.coordenada_normalizada === incoming.coordenada_normalizada && item.fonte === 'Original'
  );

  if (existingOriginal && isExternalOrigin(incomingOrigin)) {
    const externalRecord: EnderecoConsulta = {
      ...incoming,
      consulta_id: `${incoming.consulta_id}-${incomingOrigin === 'Mocked' ? 'MOCK' : 'GEO'}`,
      necessita_revisao: true
    };
    const existingExternal = current.find(
      item => item.consulta_id === externalRecord.consulta_id
    );
    return existingExternal
      ? current.map(item => item.consulta_id === externalRecord.consulta_id ? externalRecord : item)
      : [...current, externalRecord];
  }

  const hasSameCoordinate = current.some(item => item.coordenada_normalizada === incoming.coordenada_normalizada);
  return hasSameCoordinate
    ? current.map(item => item.coordenada_normalizada === incoming.coordenada_normalizada ? { ...item, ...incoming } : item)
    : [...current, incoming];
}
