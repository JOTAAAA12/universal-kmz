import { buildGeocodeRecord, GeocodeProvider } from './types';

interface CnefeAddressRecord {
  lat: number;
  lng: number;
  logradouro: string;
  numero: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  municipioResolvido?: boolean;
}

interface CnefeNeighbor {
  record: CnefeAddressRecord;
  distanceMeters: number;
}

interface CnefeLookupIndex {
  stats: {
    indexedRows: number;
    partial: boolean;
    messages: string[];
  };
  lookupNearest(lat: number, lng: number, maxDistanceMeters?: number): CnefeNeighbor[];
}

let activeIndex: CnefeLookupIndex | null = null;

function formatCep(cep: string): string {
  const digits = cep.replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : cep;
}

function formatAddress(record: CnefeAddressRecord): string {
  const parts = [
    [record.logradouro, record.numero].filter(Boolean).join(', '),
    record.bairro,
    record.municipio,
    record.uf,
    formatCep(record.cep)
  ].filter(Boolean);
  return parts.join(' - ');
}

function isMissingNumber(numero: string): boolean {
  const normalized = numero.trim().toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, '');
  return !normalized || normalized === 'SN';
}

function normalizeLogradouro(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('pt-BR');
}

// Só há ambiguidade entre vizinhos que de fato disputam o mesmo ponto. Um logradouro
// diferente a 90 m não torna incerto um acerto exato, e tratá-lo como divergência
// rebaixaria praticamente toda consulta urbana — dentro do raio de busca de 150 m há
// sempre outra rua. A margem cobre largura de via + recuo do lote.
const AMBIGUITY_MARGIN_METERS = 20;

function hasDivergentLogradouros(matches: CnefeNeighbor[]): boolean {
  const best = matches[0];
  if (!best) return false;

  const bestLogradouro = normalizeLogradouro(best.record.logradouro);
  if (!bestLogradouro) return false;

  return matches.some(match => {
    const logradouro = normalizeLogradouro(match.record.logradouro);
    return Boolean(logradouro)
      && logradouro !== bestLogradouro
      && match.distanceMeters <= best.distanceMeters + AMBIGUITY_MARGIN_METERS;
  });
}

function granularityForDistance(
  distanceMeters: number,
  record: CnefeAddressRecord,
  matches: CnefeNeighbor[]
) {
  if (record.municipioResolvido === false || isMissingNumber(record.numero) || hasDivergentLogradouros(matches)) {
    return { granularidade: 'CNEFE_MEDIA', necessita_revisao: true };
  }
  if (distanceMeters <= 30) {
    return { granularidade: 'CNEFE_ALTA', necessita_revisao: false };
  }
  return { granularidade: 'CNEFE_MEDIA', necessita_revisao: true };
}

export function setCnefeIndex(index: CnefeLookupIndex | null) {
  activeIndex = index;
}

export function createCnefeProvider(index: CnefeLookupIndex): GeocodeProvider {
  return {
    name: 'cnefe',
    isEnabled: () => index.stats.indexedRows > 0,
    reverse: async request => {
      const matches = index.lookupNearest(request.lat, request.lng, 150);
      const match = matches[0];
      if (!match) {
        return buildGeocodeRecord(request.lat, request.lng, {
          status_api: 'ZERO_RESULTADOS',
          provider_status: 'ZERO_RESULTADOS',
          quantidade_resultados: 0,
          fonte: 'cnefe',
          endereco_formatado: 'Sem endereço CNEFE em até 150 m.',
          retryable: false
        });
      }

      const { record, distanceMeters } = match;
      return buildGeocodeRecord(request.lat, request.lng, {
        status_api: 'SUCESSO',
        provider_status: 'OK',
        quantidade_resultados: matches.length,
        fonte: 'cnefe',
        endereco_formatado: formatAddress(record),
        logradouro: record.logradouro,
        numero: record.numero,
        bairro: record.bairro,
        municipio: record.municipio,
        uf: record.uf,
        cep: record.cep,
        pais: 'Brasil',
        tipos: `cnefe_nearest_${Math.round(distanceMeters)}m`,
        ...granularityForDistance(distanceMeters, record, matches)
      });
    },
    getStatus: () => ({
      linhas_indexadas: index.stats.indexedRows,
      indice_parcial: index.stats.partial,
      mensagens: index.stats.messages
    })
  };
}

export const cnefeProvider: GeocodeProvider = {
  name: 'cnefe',
  isEnabled: request => Boolean(activeIndex && createCnefeProvider(activeIndex).isEnabled(request)),
  reverse: request => activeIndex
    ? createCnefeProvider(activeIndex).reverse(request)
    : Promise.resolve(buildGeocodeRecord(request.lat, request.lng, {
      status_api: 'CONFIG_ERROR',
      provider_status: 'NO_CNEFE_INDEX',
      fonte: 'cnefe',
      endereco_formatado: 'Índice CNEFE não carregado.',
      retryable: false
    })),
  getStatus: () => activeIndex ? {
    linhas_indexadas: activeIndex.stats.indexedRows,
    indice_parcial: activeIndex.stats.partial,
    mensagens: activeIndex.stats.messages
  } : {
    linhas_indexadas: 0,
    indice_parcial: false,
    mensagens: ['Índice CNEFE não carregado.']
  }
};
