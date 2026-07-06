import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import { buildPericialAnalysis } from './pericialMode';
import { ParserResult } from './types';

// Convert a flat JSON array to a custom mapped array with exact Brazilian Portuguese columns
export function generateWorkbook(data: ParserResult): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  // 1. Aba RESUMO (Mapped as key-value rows for beautiful readability)
  const r = data.resumo;
  const resumoRows = [
    { 'Propriedade': 'Nome do Arquivo Original', 'Valor': r.nome_arquivo },
    { 'Propriedade': 'Hash SHA256 do Arquivo', 'Valor': r.hash_original },
    { 'Propriedade': 'Data/Hora do Processamento', 'Valor': r.data_processamento },
    { 'Propriedade': 'Quantidade de KMLs internos', 'Valor': r.quantidade_kmls },
    { 'Propriedade': 'Quantidade de Documentos KML', 'Valor': r.quantidade_documents },
    { 'Propriedade': 'Quantidade de Pastas', 'Valor': r.quantidade_folders },
    { 'Propriedade': 'Quantidade de Elementos (Placemarks)', 'Valor': r.quantidade_placemarks },
    { 'Propriedade': 'Quantidade de Pontos (Points)', 'Valor': r.quantidade_points },
    { 'Propriedade': 'Quantidade de Linhas (LineStrings)', 'Valor': r.quantidade_linestrings },
    { 'Propriedade': 'Quantidade de Polígonos (Polygons)', 'Valor': r.quantidade_polygons },
    { 'Propriedade': 'Quantidade de MultiGeometry', 'Valor': r.quantidade_multigeometry },
    { 'Propriedade': 'Quantidade de Elementos Ignorados', 'Valor': r.quantidade_nao_suportadas },
    { 'Propriedade': 'Total de Vértices Extraídos', 'Valor': r.total_vertices },
    { 'Propriedade': 'Comprimento Total Medido (metros)', 'Valor': Number(r.comprimento_total_m.toFixed(2)) },
    { 'Propriedade': 'Área Total de Polígonos (m²)', 'Valor': Number(r.area_total_m2.toFixed(2)) },
    { 'Propriedade': 'Quantidade de Coordenadas Únicas', 'Valor': r.quantidade_coordenadas_unicas },
    { 'Propriedade': 'Chamadas de API Estimadas', 'Valor': r.chamadas_estimadas },
    { 'Propriedade': 'Chamadas de API Efetuadas', 'Valor': r.chamadas_realizadas },
    { 'Propriedade': 'Resultados Completos', 'Valor': r.resultados_completos },
    { 'Propriedade': 'Resultados Parciais', 'Valor': r.resultados_parciais },
    { 'Propriedade': 'Resultados sem Endereço', 'Valor': r.resultados_sem_endereco },
    { 'Propriedade': 'Quantidade de Erros', 'Valor': r.erros },
    { 'Propriedade': 'Quantidade de Alertas', 'Valor': r.alertas },
    { 'Propriedade': 'Modo de Processamento', 'Valor': r.modo_processamento },
    { 'Propriedade': 'Parâmetros Usados', 'Valor': r.parametros_usados }
  ];
  const wsResumo = XLSX.utils.json_to_sheet(resumoRows);
  XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo');

  // 2. Aba FEATURES
  const featuresRows = data.features.map(f => ({
    'ID da Feição': f.feature_id,
    'Arquivo de Origem': f.arquivo_origem,
    'KML de Origem': f.kml_origem,
    'Documento': f.documento,
    'Caminho da Pasta': f.caminho_pasta,
    'Ordem Original': f.ordem_original,
    'Nome do Placemark': f.placemark_nome,
    'Descrição': f.placemark_descricao,
    'Tipo de Geometria': f.geometry_type,
    'Subtipo de Geometria': f.geometry_subtype,
    'URL do Estilo': f.style_url,
    'Visibilidade': f.visibility ? 'SIM' : 'NÃO',
    'Timestamp': f.time_stamp,
    'Início do Intervalo (TimeSpan)': f.time_span_inicio,
    'Fim do Intervalo (TimeSpan)': f.time_span_fim,
    'Dados Estendidos (JSON)': f.extended_data_json,
    'Quantidade de Vértices': f.quantidade_vertices,
    'Latitude Principal': f.latitude_principal,
    'Longitude Principal': f.longitude_principal,
    'Altitude Principal': f.altitude_principal || '',
    'Caixa Envolvente Mín Lat' : f.bbox.minLat,
    'Caixa Envolvente Mín Lng': f.bbox.minLng,
    'Caixa Envolvente Máx Lat': f.bbox.maxLat,
    'Caixa Envolvente Máx Lng': f.bbox.maxLng,
    'Latitude do Centroide': f.centroid_lat,
    'Longitude do Centroide': f.centroid_lng,
    'Comprimento Calculado (m)': Number(f.comprimento_m.toFixed(2)),
    'Área Calculada (m²)': Number(f.area_m2.toFixed(2)),
    'Perímetro Calculado (m)': Number(f.perimetro_m.toFixed(2)),
    'WKT (Well-Known Text)': f.wkt,
    'GeoJSON': f.geojson,
    'Status de Validação': f.status_validacao,
    'Alertas': f.alertas
  }));
  const wsFeatures = XLSX.utils.json_to_sheet(featuresRows);
  XLSX.utils.book_append_sheet(wb, wsFeatures, 'Features');

  // 3. Aba PONTOS
  const pontosRows = data.pontos.map(p => ({
    'ID do Ponto': p.point_id,
    'ID da Feição': p.feature_id,
    'Tipo de Ponto': p.tipo_ponto,
    'Origem do Ponto': p.origem_ponto,
    'Ordem no Trecho': p.ordem_no_trecho !== undefined ? p.ordem_no_trecho : '',
    'Distância Acumulada (m)': p.distancia_acumulada_m !== undefined ? Number(p.distancia_acumulada_m.toFixed(1)) : '',
    'Latitude': p.latitude,
    'Longitude': p.longitude,
    'Altitude (Metros)': p.altitude || '',
    'Endereço Formatado': p.endereco_formatado || '',
    'Logradouro': p.logradouro || '',
    'Número': p.numero || '',
    'Bairro': p.bairro || '',
    'Município': p.municipio || '',
    'UF': p.uf || '',
    'CEP': p.cep || '',
    'País': p.pais || '',
    'Place ID (Google Maps)': p.place_id || '',
    'Plus Code': p.plus_code || '',
    'Tipo de Resultado': p.tipo_resultado || '',
    'Granularidade': p.granularidade || '',
    'Status da API': p.status_api || '',
    'Origem do Endereço': p.origem_endereco || '',
    'Conflito de Endereço': p.conflito_endereco || '',
    'Necessita Revisão': p.necessita_revisao ? 'SIM' : 'NÃO',
    'Observações': p.observacoes || ''
  }));
  const wsPontos = XLSX.utils.json_to_sheet(pontosRows);
  XLSX.utils.book_append_sheet(wb, wsPontos, 'Pontos');

  // 4. Aba TRECHOS
  const trechosRows = data.trechos.map(t => ({
    'ID do Trecho': t.trecho_id,
    'ID da Feição': t.feature_id,
    'Nome do Trecho de Obra': t.nome_original,
    'Caminho de Pasta KML': t.caminho_pasta,
    'Comprimento Declarado (Texto)': t.comprimento_declarado_texto,
    'Comprimento Declarado (Metros)': t.comprimento_declarado_m,
    'Comprimento Calculado (Metros)': Number(t.comprimento_calculado_m.toFixed(2)),
    'Diferença Medida (Metros)': Number(t.diferenca_m.toFixed(2)),
    'Diferença (%)': Number(t.diferenca_pct.toFixed(2)),
    'Alerta de Desvio de Comprimento': t.alerta_comprimento ? 'SIM' : 'NÃO',
    'Latitude de Início (Onde Começa)': t.inicio_lat,
    'Longitude de Início (Onde Começa)': t.inicio_lng,
    'Endereço de Início (Onde Começa)': t.inicio_endereco || '',
    'Place ID de Início': t.inicio_place_id || '',
    'Latitude de Fim (Onde Termina)': t.fim_lat,
    'Longitude de Fim (Onde Termina)': t.fim_lng,
    'Endereço de Fim (Onde Termina)': t.fim_endereco || '',
    'Place ID de Fim': t.fim_place_id || '',
    'Quantidade de Vértices': t.quantidade_vertices,
    'Quantidade de Amostras de Altitude': t.quantidade_amostras,
    'Pontos Associados': t.pontos_associados,
    'Direção Original': t.direcao_original,
    'Direção Invertida pelo Usuário': t.inicio_fim_invertido ? 'SIM' : 'NÃO',
    'Status da Resolução': t.status,
    'Conflito de Endereço': t.conflito_endereco || '',
    'Observações': t.observacoes || ''
  }));
  const wsTrechos = XLSX.utils.json_to_sheet(trechosRows);
  XLSX.utils.book_append_sheet(wb, wsTrechos, 'Trechos');

  const trechosEnderecoRows = (data.trechos_endereco || []).map(t => ({
    linha_id: t.linha_id || '',
    ordem: t.ordem || '',
    logradouro: t.logradouro,
    numero_inicio: t.numero_inicio ?? '',
    numero_fim: t.numero_fim ?? '',
    bairro: t.bairro || '',
    municipio: t.municipio || '',
    uf: t.uf || '',
    extensao_m: Number(t.extensao_m.toFixed(2)),
    amostras: t.quantidade_amostras,
    necessita_revisao: t.necessita_revisao ? 'SIM' : 'NÃO'
  }));
  const wsTrechosEndereco = XLSX.utils.json_to_sheet(trechosEnderecoRows);
  XLSX.utils.book_append_sheet(wb, wsTrechosEndereco, 'Trechos_Enderecos');

  // 5. Aba POLIGONOS
  const poligonosRows = data.poligonos.map(p => ({
    'ID do Polígono': p.poligono_id,
    'ID da Feição': p.feature_id,
    'Nome Original': p.nome_original,
    'Caminho de Pasta KML': p.caminho_pasta,
    'Área Calculada (m²)': Number(p.area_m2.toFixed(2)),
    'Perímetro Calculado (m)': Number(p.perimetro_m.toFixed(2)),
    'Latitude do Centroide': p.centroid_lat,
    'Longitude do Centroide': p.centroid_lng,
    'Endereço do Centroide': p.centroid_endereco || '',
    'Quantidade de Anéis': p.quantidade_aneis,
    'Quantidade de Vértices': p.quantidade_vertices,
    'Polígono Válido': p.valido ? 'SIM' : 'NÃO',
    'Motivo de Invalidade': p.motivo_invalidade || '',
    'Conflito de Endereço': p.conflito_endereco || '',
    'GeoJSON': p.geojson,
    'Observações': p.observacoes || ''
  }));
  const wsPoligonos = XLSX.utils.json_to_sheet(poligonosRows);
  XLSX.utils.book_append_sheet(wb, wsPoligonos, 'Poligonos');

  // 6. Aba ENDERECOS
  const enderecosRows = data.enderecos.map(e => ({
    'ID de Consulta': e.consulta_id,
    'Latitude': e.latitude,
    'Longitude': e.longitude,
    'Coordenada Normalizada': e.coordenada_normalizada,
    'Endereço Formatado': e.endereco_formatado || '',
    'Logradouro': e.logradouro || '',
    'Número': e.numero || '',
    'Bairro': e.bairro || '',
    'Subdistrito': e.subdistrito || '',
    'Distrito': e.distrito || '',
    'Município': e.municipio || '',
    'UF': e.uf || '',
    'CEP': e.cep || '',
    'País': e.pais || '',
    'Place ID (Google Maps)': e.place_id || '',
    'Plus Code': e.plus_code || '',
    'Tipos': e.tipos || '',
    'Granularidade': e.granularidade || '',
    'Status da API': e.status_api,
    'Quantidade de Resultados': e.quantidade_resultados,
    'Fonte': e.fonte,
    'Cache Hit': e.cache_hit ? 'SIM' : 'NÃO',
    'Necessita Revisão': e.necessita_revisao ? 'SIM' : 'NÃO'
  }));
  const wsEnderecos = XLSX.utils.json_to_sheet(enderecosRows);
  XLSX.utils.book_append_sheet(wb, wsEnderecos, 'Enderecos');

  // 7. Aba ASSOCIACOES
  const associacoesRows = data.associacoes.map(a => ({
    'associacao_id': a.associacao_id,
    'tipo_associacao': a.tipo_associacao,
    'feature_a': a.feature_a,
    'feature_b': a.feature_b,
    'distancia_m': Number(a.distancia_m.toFixed(2)),
    'metodo': a.metodo,
    'confianca': a.confianca,
    'status': a.status,
    'observacoes': a.observacoes || ''
  }));
  const wsAssociacoes = XLSX.utils.json_to_sheet(associacoesRows);
  XLSX.utils.book_append_sheet(wb, wsAssociacoes, 'Associacoes');

  // 8. Aba ERROS_ALERTAS
  const errosRows = data.errosAlertas.map(e => ({
    'erro_id': e.erro_id,
    'severidade': e.severidade,
    'categoria': e.categoria,
    'etapa': e.etapa,
    'feature_id': e.feature_id || '',
    'mensagem': e.mensagem,
    'detalhe_tecnico': e.detalhe_tecnico,
    'acao_recomendada': e.acao_recomendada,
    'resolvido': e.resolvido ? 'SIM' : 'NÃO'
  }));
  const wsErros = XLSX.utils.json_to_sheet(errosRows);
  XLSX.utils.book_append_sheet(wb, wsErros, 'Erros_Alertas');

  // 9. Aba AUDITORIA
  const auditoriaRows = data.auditoria.map(a => ({
    'timestamp': a.timestamp,
    'evento': a.evento,
    'usuario': a.usuario,
    'acao': a.acao,
    'entidade': a.entidade,
    'antes': a.antes,
    'depois': a.depois,
    'origem': a.origem,
    'status': a.status
  }));
  const wsAuditoria = XLSX.utils.json_to_sheet(auditoriaRows);
  XLSX.utils.book_append_sheet(wb, wsAuditoria, 'Auditoria');

  return wb;
}

// Generate a unified GeoJSON FeatureCollection with points, lines, polylines etc
export function generateGeoJson(data: ParserResult): string {
  const geojsonFeatures = data.features.map(f => {
    let rawGeom = { type: 'Point', coordinates: [f.longitude_principal, f.latitude_principal] };
    try {
      if (f.geojson) {
        rawGeom = JSON.parse(f.geojson);
      }
    } catch (e) {
      // fallback
    }

    const properties: Record<string, any> = {
      nome: f.placemark_nome,
      descricao: f.placemark_descricao,
      documento: f.documento,
      caminho_pasta: f.caminho_pasta,
      tipo_geometria: f.geometry_type,
      subtipo_geometria: f.geometry_subtype,
      comprimento_m: f.comprimento_m,
      area_m2: f.area_m2,
      status_validacao: f.status_validacao,
      alertas: f.alertas
    };

    // Find if there is an associated trecho (line segment) to enrich this feature's properties with its endpoints!
    const associatedTrecho = data.trechos.find(t => t.feature_id === f.feature_id);
    if (associatedTrecho) {
      const addressSegments = (data.trechos_endereco || [])
        .filter(t => t.linha_id === associatedTrecho.trecho_id);
      properties.inicio_latitude = associatedTrecho.inicio_lat;
      properties.inicio_longitude = associatedTrecho.inicio_lng;
      properties.inicio_endereco = associatedTrecho.inicio_endereco || '';
      properties.inicio_place_id = associatedTrecho.inicio_place_id || '';
      properties.fim_latitude = associatedTrecho.fim_lat;
      properties.fim_longitude = associatedTrecho.fim_lng;
      properties.fim_endereco = associatedTrecho.fim_endereco || '';
      properties.fim_place_id = associatedTrecho.fim_place_id || '';
      properties.comprimento_calculado_m = associatedTrecho.comprimento_calculado_m;
      properties.alerta_comprimento = associatedTrecho.alerta_comprimento ? 'SIM' : 'NÃO';
      properties.inicio_fim_invertido = associatedTrecho.inicio_fim_invertido ? 'SIM' : 'NÃO';
      properties.status_trecho = associatedTrecho.status;
      properties.trechos_endereco = addressSegments.map(t => ({
        ordem: t.ordem,
        logradouro: t.logradouro,
        numero_inicio: t.numero_inicio ?? null,
        numero_fim: t.numero_fim ?? null,
        bairro: t.bairro || '',
        municipio: t.municipio || '',
        uf: t.uf || '',
        extensao_m: Number(t.extensao_m.toFixed(2)),
        amostras: t.quantidade_amostras,
        necessita_revisao: t.necessita_revisao
      }));
      properties.trechos_endereco_resumo = addressSegments
        .map(t => `${t.logradouro}${t.numero_inicio !== undefined ? ` ${t.numero_inicio}${t.numero_fim !== undefined && t.numero_fim !== t.numero_inicio ? `-${t.numero_fim}` : ''}` : ''} (${t.extensao_m.toFixed(0)}m)`)
        .join(' -> ');
    }

    const associatedPolygon = data.poligonos.find(p => p.feature_id === f.feature_id);
    if (associatedPolygon) {
      const polygonAddress = (data.enderecos_poligono || []).find(p => p.poligono_id === associatedPolygon.poligono_id);
      if (polygonAddress) {
        properties.poligono_logradouro_dominante = polygonAddress.logradouro;
        properties.poligono_bairro = polygonAddress.bairro || '';
        properties.poligono_municipio = polygonAddress.municipio || '';
        properties.poligono_uf = polygonAddress.uf || '';
        properties.poligono_confrontantes = polygonAddress.confrontantes;
        properties.poligono_necessita_revisao = polygonAddress.necessita_revisao;
      }
    }

    return {
      type: 'Feature',
      id: f.feature_id,
      geometry: rawGeom,
      properties
    };
  });

  return JSON.stringify({
    type: 'FeatureCollection',
    features: geojsonFeatures
  }, null, 2);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatKmlCoordinates(coords: number[][]): string {
  return coords.map(([lng, lat, alt]) => `${lng},${lat}${alt !== undefined ? `,${alt}` : ''}`).join(' ');
}

export function generateKml(data: ParserResult): string {
  const placemarks = data.features.map(feature => {
    let geometryXml = '';
    try {
      const geometry = JSON.parse(feature.geojson);

      if (geometry.type === 'Point') {
        geometryXml = `<Point><coordinates>${formatKmlCoordinates([geometry.coordinates])}</coordinates></Point>`;
      } else if (geometry.type === 'LineString') {
        geometryXml = `<LineString><coordinates>${formatKmlCoordinates(geometry.coordinates)}</coordinates></LineString>`;
      } else if (geometry.type === 'Polygon') {
        const [outer, ...inners] = geometry.coordinates || [];
        const innerXml = inners.map((ring: number[][]) =>
          `<innerBoundaryIs><LinearRing><coordinates>${formatKmlCoordinates(ring)}</coordinates></LinearRing></innerBoundaryIs>`
        ).join('');
        geometryXml = [
          '<Polygon>',
          `<outerBoundaryIs><LinearRing><coordinates>${formatKmlCoordinates(outer || [])}</coordinates></LinearRing></outerBoundaryIs>`,
          innerXml,
          '</Polygon>'
        ].join('');
      }
    } catch {
      geometryXml = `<Point><coordinates>${feature.longitude_principal},${feature.latitude_principal}</coordinates></Point>`;
    }

    return [
      '<Placemark>',
      `<name>${escapeXml(feature.placemark_nome)}</name>`,
      feature.placemark_descricao ? `<description>${escapeXml(feature.placemark_descricao)}</description>` : '',
      geometryXml,
      '</Placemark>'
    ].join('');
  }).join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    '<Document>',
    `<name>${escapeXml(data.resumo.nome_arquivo)}</name>`,
    placemarks,
    '</Document>',
    '</kml>'
  ].join('\n');
}

// Generate the complete download ZIP containing excel files, separated CSV lists, raw JSON models, maps and audit summaries
export async function generateDownloadZip(data: ParserResult, originalName: string): Promise<Buffer> {
  const zip = new JSZip();
  const fileBaseName = originalName.replace(/\.[^/.]+$/, '');

  // 1. XLSX WorkBook file
  const wb = generateWorkbook(data);
  const xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  zip.file(`${fileBaseName}-dados-completos.xlsx`, xlsxBuffer);

  // 2. CSV files mapped directly using SheetJS utils (ensures 100% equivalence)
  const sheets = wb.SheetNames;
  for (const sheetName of sheets) {
    const ws = wb.Sheets[sheetName];
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    // Use lowercase with underscores for CSV file names
    const csvFileName = `${sheetName.toLowerCase().replace('_', '-')}.csv`;
    zip.file(`csv/${csvFileName}`, csvContent);
  }

  // 3. Normalized JSON data model
  zip.file('dados-normalizados.json', JSON.stringify(data, null, 2));
  zip.file(
    'pericial/manifesto-pericial.json',
    JSON.stringify(
      buildPericialAnalysis(data, {
        projectName: fileBaseName,
        baseDate: new Date().toISOString().slice(0, 10),
        expectedRegion: 'UF_REGIAO_NAO_INFORMADA',
        officialSourcesProvided: false
      }),
      null,
      2
    )
  );

  // 4. GeoJSON spatial files
  zip.file('features.geojson', generateGeoJson(data));
  zip.file('features.kml', generateKml(data));

  // 5. Config/Manifest files used
  const exportMeta = {
    versao_app: '1.0.0',
    data_geracao: new Date().toISOString(),
    arquivo_original: data.resumo.nome_arquivo,
    hash_original: data.resumo.hash_original,
    modo_processamento: data.resumo.modo_processamento,
    parametros_usados: data.resumo.parametros_usados
  };
  zip.file('processamento-config.json', JSON.stringify(exportMeta, null, 2));

  // Create zipped array buffer
  const nodeZipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return nodeZipBuffer;
}
