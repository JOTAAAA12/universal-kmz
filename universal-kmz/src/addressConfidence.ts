import { EnderecoConsulta, PointFeature } from './types';

type AddressOrigin = NonNullable<PointFeature['origem_endereco']>;

const EXTERNAL_GEOCODER_SOURCES = new Set([
  'Google API',
  'google',
  'nominatim',
  'photon',
  'locationiq',
  'geoapify',
  'bigdatacloud',
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

export function normalizeAddressValue(value?: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function appendObservation(current: string, addition: string): string {
  if (!addition) return current;
  if (current.includes(addition)) return current;
  return current ? `${current} ${addition}` : addition;
}

function isExternalOrigin(origin: AddressOrigin): boolean {
  return origin === 'Geocoding API' || origin === 'Mocked';
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
    point.municipio &&
    incomingMunicipio &&
    normalizeAddressValue(point.municipio) !== normalizeAddressValue(incomingMunicipio)
  ) {
    conflicts.push(`municipio KML "${point.municipio}" x ${incomingOrigin} "${incomingMunicipio}"`);
  }

  if (
    point.uf &&
    incomingUf &&
    normalizeAddressValue(point.uf) !== normalizeAddressValue(incomingUf)
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
  if (normalizeAddressValue(currentAddress) === normalizeAddressValue(incomingAddress)) return '';

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
