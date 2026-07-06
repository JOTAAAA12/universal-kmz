import React from 'react';
import { CheckCircle2 } from 'lucide-react';
import { EnderecoConsulta, PointFeature } from '../types';

const EXTERNAL_SOURCES = ['google', 'locationiq', 'geoapify', 'nominatim', 'photon', 'bigdatacloud', 'cnefe', 'geocoder'];

function normalizeGranularity(value?: string): 'ROOFTOP' | 'STREET' | 'APPROXIMATE' | string {
  const normalized = (value || '').toUpperCase();
  if (normalized.includes('ROOFTOP') || normalized.includes('PREMISE')) return 'ROOFTOP';
  if (normalized.includes('STREET') || normalized.includes('ROUTE')) return 'STREET';
  if (normalized.includes('APPROXIMATE') || normalized.includes('MEDIA') || normalized.includes('LOW')) return 'APPROXIMATE';
  return normalized || 'SEM GRANULARIDADE';
}

function granularityClass(label: string): string {
  if (label === 'ROOFTOP') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (label === 'STREET') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (label === 'APPROXIMATE') return 'border-orange-200 bg-orange-50 text-orange-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function hasExternalSource(source?: string): boolean {
  const normalized = (source || '').toLowerCase();
  return EXTERNAL_SOURCES.some(item => normalized.includes(item));
}

export function isCrosscheckVerified(item: Pick<PointFeature | EnderecoConsulta, 'necessita_revisao'> & { fonte?: string; origem_endereco?: string }): boolean {
  return !item.necessita_revisao && (hasExternalSource(item.fonte) || hasExternalSource(item.origem_endereco));
}

export function AccuracyBadges({ item }: { item: PointFeature | EnderecoConsulta }) {
  const label = normalizeGranularity(item.granularidade);
  const verified = isCrosscheckVerified(item);

  return (
    <div className="flex flex-wrap items-center justify-center gap-1">
      <span
        className={`inline-flex rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${granularityClass(label)}`}
        title="Granularidade retornada pelo provedor de geocodificação."
      >
        {label}
      </span>
      {verified && (
        <span
          className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700"
          title="Verificado: sem divergência de cross-check e com fonte externa registrada."
        >
          <CheckCircle2 className="h-3 w-3" />
          verificado
        </span>
      )}
    </div>
  );
}
