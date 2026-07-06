export interface Coordinate {
  lat: number;
  lng: number;
  alt?: number;
}

export type GeometryType = 'Point' | 'LineString' | 'Polygon' | 'MultiGeometry' | 'Unknown';

export interface BoundingBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface KmlFeature {
  feature_id: string;
  arquivo_origem: string;
  kml_origem: string;
  documento: string;
  caminho_pasta: string;
  ordem_original: number;
  placemark_nome: string;
  placemark_descricao: string;
  geometry_type: GeometryType;
  geometry_subtype: string;
  style_url: string;
  visibility: boolean;
  time_stamp: string;
  time_span_inicio: string;
  time_span_fim: string;
  extended_data_json: string; // JSON String of simple key-value pairs
  quantidade_vertices: number;
  latitude_principal: number;
  longitude_principal: number;
  altitude_principal?: number;
  bbox: BoundingBox;
  centroid_lat?: number;
  centroid_lng?: number;
  comprimento_m: number;
  area_m2: number;
  perimetro_m: number;
  wkt: string;
  geojson: string;
  status_validacao: 'Válido' | 'Inválido' | 'Incompleto' | 'Atenção';
  alertas: string;
}

export interface PointFeature {
  point_id: string; // feature_id if individual, or unique generated if derived
  feature_id: string;
  tipo_ponto: 'Original' | 'Início' | 'Fim' | 'Amostra' | 'Centroid';
  origem_ponto: string; // "Point Placemark", "Line Extremity", "Line Sample", "Polygon Centroid"
  ordem_no_trecho?: number;
  distancia_acumulada_m?: number;
  latitude: number;
  longitude: number;
  altitude?: number;
  endereco_formatado?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  pais?: string;
  place_id?: string;
  plus_code?: string;
  tipo_resultado?: string;
  granularidade?: string;
  status_api?: 'PENDENTE' | 'SUCESSO' | 'ZERO_RESULTS' | 'FALHA' | 'Mocked' | 'CONFIG_ERROR' | 'INVALID_COORDINATE' | 'REQUEST_DENIED' | 'OVER_DAILY_LIMIT' | 'OVER_QUERY_LIMIT' | 'INVALID_REQUEST' | 'UNKNOWN_ERROR';
  origem_endereco?: 'Original' | 'Geocoding API' | 'Manual' | 'Carregado' | 'Indisponível' | 'Mocked' | 'Offline';
  conflito_endereco?: string;
  necessita_revisao: boolean;
  observacoes: string;
}

export interface TrechoFeature {
  trecho_id: string; // and feature_id are same if direct
  feature_id: string;
  nome_original: string;
  caminho_pasta: string;
  comprimento_declarado_texto: string;
  comprimento_declarado_m: number;
  comprimento_calculado_m: number;
  diferenca_m: number;
  diferenca_pct: number;
  alerta_comprimento: boolean;
  inicio_lat: number;
  inicio_lng: number;
  inicio_endereco?: string;
  inicio_place_id?: string;
  fim_lat: number;
  fim_lng: number;
  fim_endereco?: string;
  fim_place_id?: string;
  quantidade_vertices: number;
  quantidade_amostras: number;
  pontos_associados: string; // comma-separated descriptions/IDs or counts
  direcao_original: 'Normal' | 'Invertida';
  inicio_fim_invertido: boolean;
  status: string; // "Revisado", "Verificar Extremidades", "Ok"
  conflito_endereco?: string;
  observacoes: string;
}

export interface PoligonoFeature {
  poligono_id: string;
  feature_id: string;
  nome_original: string;
  caminho_pasta: string;
  area_m2: number;
  perimetro_m: number;
  centroid_lat: number;
  centroid_lng: number;
  centroid_endereco?: string;
  quantidade_aneis: number;
  quantidade_vertices: number;
  valido: boolean;
  motivo_invalidade?: string;
  geojson: string;
  conflito_endereco?: string;
  observacoes: string;
}

export interface EnderecoConsulta {
  consulta_id: string;
  latitude: number;
  longitude: number;
  coordenada_normalizada: string; // "lat,lng" rounded
  endereco_formatado?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  subdistrito?: string;
  distrito?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  pais?: string;
  place_id?: string;
  plus_code?: string;
  tipos?: string; // comma separated
  granularidade?: string;
  status_api: string;
  provider_status?: string;
  provider_error_message?: string;
  http_status?: number;
  retryable?: boolean;
  quantidade_resultados: number;
  fonte: string; // "Google API" or "Mock" or "Manual"
  cache_hit: boolean;
  necessita_revisao: boolean;
}

export interface Associacao {
  associacao_id: string;
  tipo_associacao: string; // "Ponto próximo de trecho", "Ponto na extremidade", etc.
  feature_a: string; // ID of A
  feature_b: string; // ID of B
  distancia_m: number;
  metodo: string; // "Cálculo euclidiano", "Projeção ortogonal" etc.
  confianca: 'Alta' | 'Média' | 'Baixa';
  status: 'Pendente' | 'Confirmada' | 'Rejeitada';
  observacoes: string;
}

export interface ErroAlerta {
  erro_id: string;
  severidade: 'CRÍTICO' | 'ALERTA' | 'INFO';
  categoria: string; // "Validation", "API", "Parsing", "Math"
  etapa: 'Upload' | 'Parsing' | 'Geocodificação' | 'Associação' | 'Exportação';
  feature_id?: string;
  mensagem: string;
  detalhe_tecnico: string;
  acao_recomendada: string;
  resolvido: boolean;
}

export interface AuditoriaLog {
  timestamp: string;
  evento: string;
  usuario: string;
  acao: string; // "EDIT", "INVERT_TRECHO", "IMPORT_KML", "GEOCODE_RUN"
  entidade: string; // type of entity: Points, Trechos, Features
  antes: string;
  depois: string;
  origem: string;
  status: 'SUCESSO' | 'ALERTA' | 'ERRO';
}

export interface ParserResult {
  resumo: {
    nome_arquivo: string;
    hash_original: string;
    data_processamento: string;
    quantidade_kmls: number;
    quantidade_documents: number;
    quantidade_folders: number;
    quantidade_placemarks: number;
    quantidade_points: number;
    quantidade_linestrings: number;
    quantidade_polygons: number;
    quantidade_multigeometry: number;
    quantidade_nao_suportadas: number;
    total_vertices: number;
    comprimento_total_m: number;
    area_total_m2: number;
    quantidade_coordenadas_unicas: number;
    chamadas_estimadas: number; // cost calculation indicator
    chamadas_realizadas: number;
    resultados_completos: number;
    resultados_parciais: number;
    resultados_sem_endereco: number;
    erros: number;
    alertas: number;
    modo_processamento: string;
    parametros_usados: string;
  };
  features: KmlFeature[];
  pontos: PointFeature[];
  trechos: TrechoFeature[];
  poligonos: PoligonoFeature[];
  enderecos: EnderecoConsulta[];
  associacoes: Associacao[];
  errosAlertas: ErroAlerta[];
  auditoria: AuditoriaLog[];
}
