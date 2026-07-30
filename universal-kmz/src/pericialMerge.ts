import {
  buildExistingAddressConflict,
  mergeExternalAddressRecord,
  mergePointWithGeocodedAddress,
} from './addressConfidence';
import { EnderecoConsulta, ParserResult } from './types';

export function mergeGeocodedBatch(
  result: ParserResult,
  freshAddresses: EnderecoConsulta[]
): ParserResult {
  if (freshAddresses.length === 0) return result;

  const safeAddresses: EnderecoConsulta[] = freshAddresses.map(addr => ({
    ...addr,
    endereco_formatado: addr.endereco_formatado || '',
    logradouro: addr.logradouro || '',
    numero: addr.numero || '',
    bairro: addr.bairro || '',
    subdistrito: addr.subdistrito || '',
    distrito: addr.distrito || '',
    municipio: addr.municipio || '',
    uf: addr.uf || '',
    cep: addr.cep || '',
    pais: addr.pais || '',
    place_id: addr.place_id || '',
    plus_code: addr.plus_code || '',
    status_api: addr.status_api || 'SUCESSO',
    fonte: addr.fonte || 'Geocoding API',
  }));
  const coordinateKey = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`;
  const addressesByCoordinate = new Map<string, { address: EnderecoConsulta; index: number }[]>();

  safeAddresses.forEach((address, index) => {
    const coordinate = coordinateKey(address.latitude, address.longitude);
    addressesByCoordinate.set(coordinate, [...(addressesByCoordinate.get(coordinate) || []), { address, index }]);
  });

  const updateTrecho = (
    trecho: typeof result.trechos[number],
    safeAddr: EnderecoConsulta,
    startMatch: boolean,
    endMatch: boolean
  ) => {
    if (!startMatch && !endMatch) return trecho;

    let initAddr = trecho.inicio_endereco;
    let initPlaceId = trecho.inicio_place_id;
    let finalAddr = trecho.fim_endereco;
    let finalPlaceId = trecho.fim_place_id;
    let conflict = trecho.conflito_endereco || '';

    if (startMatch) {
      const startConflict = buildExistingAddressConflict(trecho.inicio_endereco, safeAddr, `inicio do trecho ${trecho.trecho_id}`);
      if (startConflict) {
        conflict = conflict ? `${conflict} ${startConflict}` : startConflict;
      } else {
        initAddr = safeAddr.endereco_formatado || trecho.inicio_endereco;
      }
      initPlaceId = safeAddr.place_id || trecho.inicio_place_id;
    }
    if (endMatch) {
      const endConflict = buildExistingAddressConflict(trecho.fim_endereco, safeAddr, `fim do trecho ${trecho.trecho_id}`);
      if (endConflict) {
        conflict = conflict ? `${conflict} ${endConflict}` : endConflict;
      } else {
        finalAddr = safeAddr.endereco_formatado || trecho.fim_endereco;
      }
      finalPlaceId = safeAddr.place_id || trecho.fim_place_id;
    }

    return {
      ...trecho,
      inicio_endereco: initAddr,
      inicio_place_id: initPlaceId,
      fim_endereco: finalAddr,
      fim_place_id: finalPlaceId,
      status: conflict ? 'Conflito de Endereço' : 'Endereço Resolvido',
      conflito_endereco: conflict || undefined,
      observacoes: conflict && !trecho.observacoes.includes(conflict) ? `${trecho.observacoes ? `${trecho.observacoes} ` : ''}${conflict}` : trecho.observacoes
    };
  };

  const updatedPontos = result.pontos.map(point =>
    (addressesByCoordinate.get(coordinateKey(point.latitude, point.longitude)) || [])
      .reduce((updatedPoint, { address }) => mergePointWithGeocodedAddress(updatedPoint, address), point)
  );

  const updatedTrechos = result.trechos.map(trecho => {
    const matchesByIndex = new Map<number, { address: EnderecoConsulta; startMatch: boolean; endMatch: boolean }>();
    for (const { address, index } of addressesByCoordinate.get(coordinateKey(trecho.inicio_lat, trecho.inicio_lng)) || []) {
      matchesByIndex.set(index, { address, startMatch: true, endMatch: false });
    }
    for (const { address, index } of addressesByCoordinate.get(coordinateKey(trecho.fim_lat, trecho.fim_lng)) || []) {
      const existing = matchesByIndex.get(index);
      matchesByIndex.set(index, { address, startMatch: existing?.startMatch || false, endMatch: true });
    }
    return [...matchesByIndex.entries()]
      .sort(([left], [right]) => left - right)
      .reduce((updatedTrecho, [, match]) => updateTrecho(updatedTrecho, match.address, match.startMatch, match.endMatch), trecho);
  });

  const updatedPoligonos = result.poligonos.map(poligono =>
    (addressesByCoordinate.get(coordinateKey(poligono.centroid_lat, poligono.centroid_lng)) || [])
      .reduce((updatedPoligono, { address }) => {
        const conflict = buildExistingAddressConflict(updatedPoligono.centroid_endereco, address, `centroide do poligono ${updatedPoligono.poligono_id}`);
        return {
          ...updatedPoligono,
          centroid_endereco: conflict ? updatedPoligono.centroid_endereco : address.endereco_formatado || updatedPoligono.centroid_endereco,
          conflito_endereco: conflict || updatedPoligono.conflito_endereco,
          observacoes: conflict && !updatedPoligono.observacoes.includes(conflict) ? `${updatedPoligono.observacoes ? `${updatedPoligono.observacoes} ` : ''}${conflict}` : updatedPoligono.observacoes
        };
      }, poligono)
  );

  // mergeExternalAddressRecord decide por `coordenada_normalizada` sobre a lista
  // COMPLETA (é assim que detecta o registro `fonte: 'Original'` do KML e desvia o
  // endereço externo para um registro `-GEO`/`-MOCK` separado). Dobrar o lote em
  // sequência sobre a lista inteira mantém exatamente a semântica por item do
  // merge antigo, agora numa única passada de estado.
  const updatedEnderecos = safeAddresses.reduce(
    (enderecos, address) => mergeExternalAddressRecord(enderecos, address),
    result.enderecos
  );

  const geocodedRecords = updatedEnderecos.filter(item => item.fonte !== 'Original');
  const completedCount = updatedEnderecos.filter(item => item.endereco_formatado && item.status_api === 'SUCESSO').length;

  return {
    ...result,
    pontos: updatedPontos,
    trechos: updatedTrechos,
    poligonos: updatedPoligonos,
    enderecos: updatedEnderecos,
    resumo: {
      ...result.resumo,
      resultados_completos: completedCount,
      chamadas_realizadas: geocodedRecords.length
    }
  };
}
