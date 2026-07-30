// Lógica pura de cobertura CNEFE, isolada do App.tsx para ser testável sem DOM.
// Compartilhada com o browser: proibido node:*.

export interface CnefeEstado {
  uf: string;
  estado: string;
  nome: string;
  tamanho_estimado: string | null;
}

export interface UfAusente {
  uf: string;
  nome: string;
  tamanho: string | null;
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizarEstadoCnefe = (value: unknown, ufPadrao?: string): CnefeEstado | null => {
  if (!isRecord(value) || typeof value.estado !== 'string') return null;

  const uf = typeof value.uf === 'string' ? value.uf.toUpperCase() : ufPadrao?.toUpperCase();
  if (!uf) return null;

  return {
    uf,
    estado: value.estado,
    nome: typeof value.nome === 'string' ? value.nome : uf,
    tamanho_estimado: typeof value.tamanho_estimado === 'string' ? value.tamanho_estimado : null
  };
};

/**
 * GET /api/cnefe/estados devolve o envelope { estados: [...] }, não um array puro.
 * Aceita também array puro e mapa por UF para não quebrar se a rota mudar de forma.
 */
export const normalizarEstadosCnefe = (payload: unknown): CnefeEstado[] => {
  const estados = isRecord(payload) && 'estados' in payload ? payload.estados : payload;

  if (Array.isArray(estados)) {
    return estados
      .map(estado => normalizarEstadoCnefe(estado))
      .filter((estado): estado is CnefeEstado => estado !== null);
  }

  if (!isRecord(estados)) return [];

  return Object.entries(estados)
    .map(([uf, estado]) => normalizarEstadoCnefe(estado, uf))
    .filter((estado): estado is CnefeEstado => estado !== null);
};

/** UFs detectadas cujo estado no índice não é 'pronto'. Vazio => nenhum aviso. */
export const ufsSemCobertura = (ufsDetectadas: string[], estados: CnefeEstado[]): UfAusente[] => {
  const estadosPorUf = new Map(estados.map(estado => [estado.uf, estado] as const));
  return ufsDetectadas
    .map(uf => ({ uf, estado: estadosPorUf.get(uf) }))
    .filter(({ estado }) => estado?.estado !== 'pronto')
    .map(({ uf, estado }) => ({
      uf,
      nome: estado?.nome || uf,
      tamanho: estado?.tamanho_estimado || null
    }));
};
