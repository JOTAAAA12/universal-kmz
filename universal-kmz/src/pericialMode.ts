import type {
  KmlFeature as Feature,
  ParserResult,
  PointFeature as Ponto,
  PoligonoFeature as Poligono,
  TrechoFeature as Trecho,
} from './types';

export type PericialEvidenceOrigin =
  | 'ORIGINAL_KML_KMZ'
  | 'DOCUMENTO_FORNECIDO'
  | 'BASE_OFICIAL'
  | 'CALCULADO_GEOESPACIAL'
  | 'INFERIDO_DO_NOME'
  | 'INFERIDO_OPERACIONAL'
  | 'PENDENTE_DE_CAMPO'
  | 'FONTE_AUXILIAR_NAO_OFICIAL';

export type PericialConfidence = 'ALTA' | 'MEDIA' | 'BAIXA' | 'BLOQUEADO';

export interface PericialAnalysisOptions {
  projectName?: string;
  baseDate?: string;
  expectedRegion?: string;
  officialSourcesProvided?: boolean;
  generatedAt?: string;
}

export interface PericialEvidence {
  evidence_id: string;
  feature_id?: string;
  entity: 'arquivo' | 'feature' | 'ponto' | 'trecho' | 'poligono' | 'endereco' | 'auditoria';
  field: string;
  value: string | number | boolean;
  origin: PericialEvidenceOrigin;
  confidence: PericialConfidence;
  note: string;
}

export interface PericialIssue {
  code: string;
  severity: 'CRITICO' | 'ALERTA' | 'INFO';
  message: string;
  requiredAction: string;
}

export interface PericialDeclaredComparison {
  feature_id: string;
  declaredText: string;
  declaredMeters: number;
  calculatedMeters: number;
  absoluteDifferenceMeters: number;
  percentDifference: number;
  classification:
    | 'COINCIDENCIA_FORTE'
    | 'COINCIDENCIA_PARCIAL'
    | 'DIVERGENCIA'
    | 'NAO_COMPARAVEL'
    | 'SEM_VALOR_DECLARADO';
  origin: PericialEvidenceOrigin;
  note: string;
}

export interface PericialLocationRecord {
  entity_id: string;
  entity: 'ponto' | 'trecho_inicio' | 'trecho_fim' | 'poligono_centroid';
  latitude: number;
  longitude: number;
  endereco?: string;
  municipio?: string;
  uf?: string;
  origin: PericialEvidenceOrigin;
  confidence: PericialConfidence;
  note: string;
}

export interface PericialAnalysis {
  schema_version: 'pericial-kmz/v1';
  generated_at: string;
  project: {
    name: string;
    baseDate: string;
    expectedRegion: string;
  };
  resumo: {
    arquivo: string;
    hash_original: string;
    placemarks: number;
    features: number;
    pontos: number;
    trechos: number;
    poligonos: number;
    comprimento_total_m: number;
    area_total_m2: number;
    officialSourcesProvided: boolean;
  };
  evidencias: PericialEvidence[];
  comparacoesDeclaradoCalculado: PericialDeclaredComparison[];
  localizacoes: PericialLocationRecord[];
  pendenciasCriticas: PericialIssue[];
  bloqueios: PericialIssue[];
  qa: {
    errors: number;
    alerts: number;
    auditEvents: number;
    requiresHumanReview: boolean;
  };
}

function stringifyValue(value: unknown): string | number | boolean {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) {
    return '';
  }
  return JSON.stringify(value);
}

function parseExtendedData(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}

function mapLocationOrigin(ponto: Ponto): PericialEvidenceOrigin {
  if (ponto.origem_endereco === 'Original' || ponto.origem_endereco === 'Carregado') {
    return 'ORIGINAL_KML_KMZ';
  }
  if (ponto.origem_endereco === 'Geocoding API' || ponto.place_id) {
    return 'FONTE_AUXILIAR_NAO_OFICIAL';
  }
  if (ponto.origem_endereco === 'Manual') {
    return 'INFERIDO_OPERACIONAL';
  }
  return 'PENDENTE_DE_CAMPO';
}

function locationConfidence(origin: PericialEvidenceOrigin): PericialConfidence {
  if (origin === 'ORIGINAL_KML_KMZ') return 'MEDIA';
  if (origin === 'FONTE_AUXILIAR_NAO_OFICIAL') return 'BAIXA';
  if (origin === 'PENDENTE_DE_CAMPO') return 'BLOQUEADO';
  return 'BAIXA';
}

function classifyDeclaredComparison(trecho: Trecho): PericialDeclaredComparison['classification'] {
  if (!trecho.comprimento_declarado_texto && !trecho.comprimento_declarado_m) {
    return 'SEM_VALOR_DECLARADO';
  }
  if (!Number.isFinite(trecho.comprimento_declarado_m) || trecho.comprimento_declarado_m <= 0) {
    return 'NAO_COMPARAVEL';
  }
  const absPct = Math.abs(trecho.diferenca_pct);
  if (absPct <= 1) return 'COINCIDENCIA_FORTE';
  if (absPct <= 5) return 'COINCIDENCIA_PARCIAL';
  return 'DIVERGENCIA';
}

function pushFeatureEvidence(target: PericialEvidence[], feature: Feature) {
  const base = `EV-FEAT-${feature.feature_id}`;
  const originalFields: Array<[string, unknown]> = [
    ['arquivo_origem', feature.arquivo_origem],
    ['kml_origem', feature.kml_origem],
    ['documento', feature.documento],
    ['caminho_pasta', feature.caminho_pasta],
    ['placemark_nome', feature.placemark_nome],
    ['placemark_descricao', feature.placemark_descricao],
  ];

  for (const [field, value] of originalFields) {
    if (value === '' || value === undefined || value === null) continue;
    target.push({
      evidence_id: `${base}-${field}`,
      feature_id: feature.feature_id,
      entity: 'feature',
      field,
      value: stringifyValue(value),
      origin: 'ORIGINAL_KML_KMZ',
      confidence: 'ALTA',
      note: 'Campo preservado a partir do KML/KMZ.'
    });
  }

  for (const [key, value] of Object.entries(parseExtendedData(feature.extended_data_json))) {
    target.push({
      evidence_id: `${base}-extended-${key}`,
      feature_id: feature.feature_id,
      entity: 'feature',
      field: `extended_data.${key}`,
      value: stringifyValue(value),
      origin: 'ORIGINAL_KML_KMZ',
      confidence: 'ALTA',
      note: 'Dado vindo de ExtendedData; nao comprova fonte oficial por si so.'
    });
  }

  const calculatedFields: Array<[string, unknown]> = [
    ['geometry_type', feature.geometry_type],
    ['quantidade_vertices', feature.quantidade_vertices],
    ['latitude_principal', feature.latitude_principal],
    ['longitude_principal', feature.longitude_principal],
    ['comprimento_m', Number(feature.comprimento_m.toFixed(3))],
    ['area_m2', Number(feature.area_m2.toFixed(3))],
    ['perimetro_m', Number(feature.perimetro_m.toFixed(3))],
  ];

  for (const [field, value] of calculatedFields) {
    target.push({
      evidence_id: `${base}-calc-${field}`,
      feature_id: feature.feature_id,
      entity: 'feature',
      field,
      value: stringifyValue(value),
      origin: 'CALCULADO_GEOESPACIAL',
      confidence: 'MEDIA',
      note: 'Metrica calculada pelo parser local; nao substitui recorte oficial.'
    });
  }
}

function buildDeclaredComparisons(trechos: Trecho[]): PericialDeclaredComparison[] {
  return trechos.map((trecho) => ({
    feature_id: trecho.feature_id,
    declaredText: trecho.comprimento_declarado_texto || '',
    declaredMeters: trecho.comprimento_declarado_m || 0,
    calculatedMeters: trecho.comprimento_calculado_m,
    absoluteDifferenceMeters: trecho.diferenca_m,
    percentDifference: trecho.diferenca_pct,
    classification: classifyDeclaredComparison(trecho),
    origin: trecho.comprimento_declarado_texto ? 'INFERIDO_DO_NOME' : 'PENDENTE_DE_CAMPO',
    note: trecho.comprimento_declarado_texto
      ? 'Valor declarado extraido do texto/nome; nao e prova documental isolada.'
      : 'Sem valor declarado compativel para comparacao.'
  }));
}

function pointLocations(pontos: Ponto[]): PericialLocationRecord[] {
  return pontos.map((ponto) => {
    const origin = mapLocationOrigin(ponto);
    return {
      entity_id: ponto.point_id,
      entity: 'ponto',
      latitude: ponto.latitude,
      longitude: ponto.longitude,
      endereco: ponto.endereco_formatado,
      municipio: ponto.municipio,
      uf: ponto.uf,
      origin,
      confidence: locationConfidence(origin),
      note: origin === 'PENDENTE_DE_CAMPO'
        ? 'Sem endereco oficial completo identificado; usar coordenadas para diligencia.'
        : 'Localizacao carregada ou enriquecida; conferir origem antes de uso pericial.'
    };
  });
}

function trechoLocations(trechos: Trecho[]): PericialLocationRecord[] {
  return trechos.flatMap((trecho) => ([
    {
      entity_id: `${trecho.trecho_id}:inicio`,
      entity: 'trecho_inicio' as const,
      latitude: trecho.inicio_lat,
      longitude: trecho.inicio_lng,
      endereco: trecho.inicio_endereco,
      origin: trecho.inicio_endereco ? 'FONTE_AUXILIAR_NAO_OFICIAL' as const : 'PENDENTE_DE_CAMPO' as const,
      confidence: trecho.inicio_endereco ? 'BAIXA' as const : 'BLOQUEADO' as const,
      note: trecho.inicio_endereco ? 'Endereco auxiliar no inicio do trecho.' : 'Inicio do trecho sem endereco oficial.'
    },
    {
      entity_id: `${trecho.trecho_id}:fim`,
      entity: 'trecho_fim' as const,
      latitude: trecho.fim_lat,
      longitude: trecho.fim_lng,
      endereco: trecho.fim_endereco,
      origin: trecho.fim_endereco ? 'FONTE_AUXILIAR_NAO_OFICIAL' as const : 'PENDENTE_DE_CAMPO' as const,
      confidence: trecho.fim_endereco ? 'BAIXA' as const : 'BLOQUEADO' as const,
      note: trecho.fim_endereco ? 'Endereco auxiliar no fim do trecho.' : 'Fim do trecho sem endereco oficial.'
    }
  ]));
}

function polygonLocations(poligonos: Poligono[]): PericialLocationRecord[] {
  return poligonos.map((poligono) => ({
    entity_id: `${poligono.poligono_id}:centroid`,
    entity: 'poligono_centroid',
    latitude: poligono.centroid_lat,
    longitude: poligono.centroid_lng,
    endereco: poligono.centroid_endereco,
    origin: poligono.centroid_endereco ? 'FONTE_AUXILIAR_NAO_OFICIAL' : 'PENDENTE_DE_CAMPO',
    confidence: poligono.centroid_endereco ? 'BAIXA' : 'BLOQUEADO',
    note: poligono.centroid_endereco ? 'Centroide com endereco auxiliar.' : 'Poligono sem endereco oficial.'
  }));
}

export function buildPericialAnalysis(
  result: ParserResult,
  options: PericialAnalysisOptions = {}
): PericialAnalysis {
  const officialSourcesProvided = options.officialSourcesProvided === true;
  const evidencias: PericialEvidence[] = [];

  evidencias.push({
    evidence_id: 'EV-ARQUIVO-NOME',
    entity: 'arquivo',
    field: 'resumo.nome_arquivo',
    value: result.resumo.nome_arquivo,
    origin: 'ORIGINAL_KML_KMZ',
    confidence: 'ALTA',
    note: 'Nome fisico recebido pelo parser.'
  });
  evidencias.push({
    evidence_id: 'EV-ARQUIVO-HASH',
    entity: 'arquivo',
    field: 'resumo.hash_original',
    value: result.resumo.hash_original,
    origin: 'ORIGINAL_KML_KMZ',
    confidence: 'ALTA',
    note: 'Hash SHA-256 calculado antes da analise pericial.'
  });

  result.features.forEach((feature) => pushFeatureEvidence(evidencias, feature));

  const localizacoes = [
    ...pointLocations(result.pontos),
    ...trechoLocations(result.trechos),
    ...polygonLocations(result.poligonos),
  ];

  const pendenciasCriticas: PericialIssue[] = [];
  const bloqueios: PericialIssue[] = [];

  if (!officialSourcesProvided && result.features.length > 0) {
    pendenciasCriticas.push({
      code: 'OFFICIAL_MUNICIPAL_BOUNDARIES_MISSING',
      severity: 'CRITICO',
      message: 'Base oficial de limites municipais nao foi fornecida.',
      requiredAction: 'Fornecer camada oficial ou aprovar loader oficial antes de atribuir municipio pericial.'
    });
    bloqueios.push({
      code: 'OFFICIAL_MUNICIPAL_OVERLAY_BLOCKED',
      severity: 'CRITICO',
      message: 'Municipio oficial, recortes transmunicipais e percentuais por municipio estao bloqueados.',
      requiredAction: 'Executar overlay com base oficial antes de liberar resultado pericial final.'
    });
  }

  if (localizacoes.some((loc) => loc.origin === 'PENDENTE_DE_CAMPO')) {
    pendenciasCriticas.push({
      code: 'FIELD_LOCATION_REVIEW_REQUIRED',
      severity: 'ALERTA',
      message: 'Ha pontos ou extremidades sem endereco oficial completo.',
      requiredAction: 'Usar coordenadas e referencia territorial para diligencia, sem inventar CEP, numero ou bairro.'
    });
  }

  return {
    schema_version: 'pericial-kmz/v1',
    generated_at: options.generatedAt || new Date().toISOString(),
    project: {
      name: options.projectName || 'Projeto sem nome informado',
      baseDate: options.baseDate || 'DATA_BASE_NAO_INFORMADA',
      expectedRegion: options.expectedRegion || 'UF_REGIAO_NAO_INFORMADA',
    },
    resumo: {
      arquivo: result.resumo.nome_arquivo,
      hash_original: result.resumo.hash_original,
      placemarks: result.resumo.quantidade_placemarks,
      features: result.features.length,
      pontos: result.pontos.length,
      trechos: result.trechos.length,
      poligonos: result.poligonos.length,
      comprimento_total_m: result.resumo.comprimento_total_m,
      area_total_m2: result.resumo.area_total_m2,
      officialSourcesProvided,
    },
    evidencias,
    comparacoesDeclaradoCalculado: buildDeclaredComparisons(result.trechos),
    localizacoes,
    pendenciasCriticas,
    bloqueios,
    qa: {
      errors: result.errosAlertas.filter((item) => item.severidade === 'CRÍTICO').length,
      alerts: result.errosAlertas.filter((item) => item.severidade === 'ALERTA').length,
      auditEvents: result.auditoria.length,
      requiresHumanReview: pendenciasCriticas.length > 0 || bloqueios.length > 0,
    }
  };
}
