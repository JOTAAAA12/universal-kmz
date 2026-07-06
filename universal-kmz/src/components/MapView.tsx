import React, { useEffect, useState, useRef } from 'react';
import { 
  APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useMap, useAdvancedMarkerRef 
} from '@vis.gl/react-google-maps';
import { ParserResult, KmlFeature, PointFeature } from '../types';
import { parseKmlCoordinates } from '../kmlParser';

interface MapViewProps {
  result: ParserResult;
  apiKey: string;
}

// Custom map bound fitter component inside APIProvider
function MapBoundFitter({ result }: { result: ParserResult }) {
  const map = useMap();

  useEffect(() => {
    if (!map || result.features.length === 0) return;

    try {
      const bounds = new google.maps.LatLngBounds();
      let hasPoints = false;

      for (const f of result.features) {
        // Expand bounds with all positions
        bounds.extend({ lat: f.latitude_principal, lng: f.longitude_principal });
        if (f.centroid_lat && f.centroid_lng) {
          bounds.extend({ lat: f.centroid_lat, lng: f.centroid_lng });
        }
        hasPoints = true;
      }

      if (hasPoints) {
        // Slight delay to ensure map load completes before zooming
        setTimeout(() => {
          map.fitBounds(bounds);
        }, 300);
      }
    } catch (e) {
      console.error('Bound matching failed:', e);
    }
  }, [map, result]);

  return null;
}

// React Map Polyline component leveraging standard JS SDK
function MapPolyline({ path, color = '#6366F1' }: { path: google.maps.LatLngLiteral[]; color?: string; key?: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || path.length < 2) return;
    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: 4,
    });
    polyline.setMap(map);
    return () => polyline.setMap(null);
  }, [map, path, color]);

  return null;
}

// React Map Polygon component leveraging standard JS SDK
function MapPolygon({ paths, color = '#10B981' }: { paths: google.maps.LatLngLiteral[]; color?: string; key?: string }) {
  const map = useMap();
  useEffect(() => {
    if (!map || paths.length < 3) return;
    const polygon = new google.maps.Polygon({
      paths,
      strokeColor: color,
      strokeOpacity: 0.8,
      strokeWeight: 2,
      fillColor: color,
      fillOpacity: 0.25,
    });
    polygon.setMap(map);
    return () => polygon.setMap(null);
  }, [map, paths, color]);

  return null;
}

export default function MapView({ result, apiKey }: MapViewProps) {
  const [selectedItem, setSelectedItem] = useState<{ lat: number; lng: number; nome: string; des: string; extra: any } | null>(null);
  const [mapLoadError, setMapLoadError] = useState('');

  // Fallback API Key check
  const actualKey = apiKey || process.env.GOOGLE_MAPS_BROWSER_KEY || '';
  const mapId = process.env.GOOGLE_MAPS_MAP_ID || '';
  const isKeyEmpty = !actualKey || actualKey === 'YOUR_API_KEY';

  useEffect(() => {
    const previousAuthFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      setMapLoadError('Chave pública do Google Maps inválida, bloqueada ou sem permissão para Maps JavaScript API.');
      if (typeof previousAuthFailure === 'function') {
        previousAuthFailure();
      }
    };

    return () => {
      (window as any).gm_authFailure = previousAuthFailure;
    };
  }, []);

  if (isKeyEmpty) {
    return (
      <div className="bg-slate-50 border border-dashed border-slate-200 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4 my-8" id="empty-key-splash">
        <h3 className="text-lg font-semibold text-slate-850">Visualização de Mapa Desativada</h3>
        <p className="text-sm text-slate-500 leading-relaxed">
          Para ver as feições do seu KML carregadas no mapa dinâmico do Google Maps, salve sua chave pública da plataforma em 
          <b> Configurações Adicionais</b> ou adicione um segredo com o nome <code>GOOGLE_MAPS_BROWSER_KEY</code> no painel superior de Secrets.
        </p>
        <div className="bg-slate-100 p-3 rounded-lg text-xs text-slate-400 font-mono text-left">
          Modo offline ativo: todos os dados seguem salvos e o download e auditoria funcionam normalmente!
        </div>
      </div>
    );
  }

  if (mapLoadError) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-2xl p-8 text-center max-w-lg mx-auto space-y-4 my-8" id="map-key-error-splash">
        <h3 className="text-lg font-semibold text-rose-900">Mapa indisponível</h3>
        <p className="text-sm text-rose-800 leading-relaxed">
          {mapLoadError}
        </p>
        <div className="bg-white/70 p-3 rounded-lg text-xs text-rose-700 font-mono text-left border border-rose-100">
          Os dados extraídos, tabelas e downloads continuam disponíveis sem carregar o mapa.
        </div>
      </div>
    );
  }

  // Pre-mapping features for rendering vectors
  const renderPolylines: { id: string; points: google.maps.LatLngLiteral[] }[] = [];
  const renderPolygons: { id: string; points: google.maps.LatLngLiteral[] }[] = [];

  for (const f of result.features) {
    if (f.geometry_type === 'LineString') {
      try {
        const parsedGeom = JSON.parse(f.geojson);
        if (parsedGeom && parsedGeom.coordinates) {
          const path = parsedGeom.coordinates.map(([lng, lat]: [number, number]) => ({ lat, lng }));
          renderPolylines.push({ id: f.feature_id, points: path });
        }
      } catch (e) {
        // fallback
      }
    } else if (f.geometry_type === 'Polygon') {
      try {
        const parsedGeom = JSON.parse(f.geojson);
        if (parsedGeom && parsedGeom.coordinates && parsedGeom.coordinates[0]) {
          const path = parsedGeom.coordinates[0].map(([lng, lat]: [number, number]) => ({ lat, lng }));
          renderPolygons.push({ id: f.feature_id, points: path });
        }
      } catch (e) {
        // fallback
      }
    }
  }

  return (
    <div className="space-y-4 animate-fade-in" id="workspace-maps-canvas">
      {/* Legend Indicators banner */}
      <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm flex flex-wrap gap-4 text-xs font-semibold text-slate-600 justify-center">
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full bg-indigo-500 inline-block border-2 border-white shadow-xs" />
          <span>Pontos</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-10 h-1.5 rounded-full bg-indigo-600 inline-block" />
          <span>Trechos Lineares (Cabo)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-4 h-4 rounded-sm bg-emerald-500/25 border-2 border-emerald-500 inline-block" />
          <span>Polígonos</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 inline-block border-2 border-white shadow-xs" />
          <span>Início do Cabo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-full bg-rose-500 inline-block border-2 border-white shadow-xs" />
          <span>Fim do Cabo</span>
        </div>
      </div>

      {/* Actual Map frame wrapper */}
      <div className="w-full h-[520px] rounded-2xl overflow-hidden shadow-sm relative border border-slate-100" id="google-maps-frame-wrapper">
        <APIProvider
          apiKey={actualKey}
          version="weekly"
          onError={() => setMapLoadError('Falha ao carregar a Maps JavaScript API. Verifique a chave pública, restrições de HTTP referrer e APIs habilitadas.')}
        >
          <Map
            defaultCenter={{ lat: -23.55052, lng: -46.633308 }} // São Paulo default center coords
            defaultZoom={11}
            mapId={mapId || 'DEMO_MAP_ID'}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            {/* Auto-Zoom Fitter */}
            <MapBoundFitter result={result} />

            {/* Render Point placemarks */}
            {result.features.filter(f => f.geometry_type === 'Point').map(f => (
              <AdvancedMarker
                key={f.feature_id}
                position={{ lat: f.latitude_principal, lng: f.longitude_principal }}
                onClick={() => setSelectedItem({
                  lat: f.latitude_principal,
                  lng: f.longitude_principal,
                  nome: f.placemark_nome,
                  des: f.placemark_descricao,
                  extra: f
                })}
              >
                <Pin background="#6366F1" glyphColor="#fff" borderColor="#4F46E5" />
              </AdvancedMarker>
            ))}

            {/* Render start/end node markers of LineStrings */}
            {result.trechos.map(t => (
              <React.Fragment key={`extremities-${t.trecho_id}`}>
                {/* Start node => Green point */}
                <AdvancedMarker
                  position={{ lat: t.inicio_lat, lng: t.inicio_lng }}
                  onClick={() => setSelectedItem({
                    lat: t.inicio_lat,
                    lng: t.inicio_lng,
                    nome: `Início: ${t.nome_original}`,
                    des: t.inicio_endereco || 'Não geocodificado',
                    extra: t
                  })}
                >
                  <Pin background="#10B981" glyphColor="#fff" scale={0.7} />
                </AdvancedMarker>

                {/* End node => Red point */}
                <AdvancedMarker
                  position={{ lat: t.fim_lat, lng: t.fim_lng }}
                  onClick={() => setSelectedItem({
                    lat: t.fim_lat,
                    lng: t.fim_lng,
                    nome: `Fim: ${t.nome_original}`,
                    des: t.fim_endereco || 'Não geocodificado',
                    extra: t
                  })}
                >
                  <Pin background="#EF4444" glyphColor="#fff" scale={0.7} />
                </AdvancedMarker>
              </React.Fragment>
            ))}

            {/* Render Lines Polylines using standard SDK overlays */}
            {renderPolylines.map(line => (
              <MapPolyline key={line.id} path={line.points} color="#4F46E5" />
            ))}

            {/* Render Polygons using standard SDK overlays */}
            {renderPolygons.map(poly => (
              <MapPolygon key={poly.id} paths={poly.points} color="#10B981" />
            ))}

            {/* Active Selected InfoWindow popups */}
            {selectedItem && (
              <InfoWindow
                position={{ lat: selectedItem.lat, lng: selectedItem.lng }}
                onCloseClick={() => setSelectedItem(null)}
              >
                <div className="p-1 space-y-1.5 text-xs text-slate-800 max-w-[200px]" id="infowindow-body">
                  <h4 className="font-bold border-b border-b-slate-100 pb-1 pr-6 truncate">{selectedItem.nome}</h4>
                  <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                    {selectedItem.des || 'Sem informações cadastrais.'}
                  </p>
                  <div className="font-mono text-[9px] text-slate-400">
                    Coords: ({selectedItem.lat.toFixed(5)}, {selectedItem.lng.toFixed(5)})
                  </div>
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>
      </div>
    </div>
  );
}
