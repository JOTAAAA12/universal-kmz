import React from 'react';

interface SourceBadgeProps {
  source?: string;
}

function sourceClass(source: string): string {
  const normalized = source.toLowerCase();
  if (normalized.includes('cnefe')) return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (normalized.includes('google')) return 'bg-indigo-50 text-indigo-700 border-indigo-200';
  if (normalized.includes('manual')) return 'bg-amber-50 text-amber-700 border-amber-200';
  if (normalized.includes('mock')) return 'bg-violet-50 text-violet-700 border-violet-200';
  if (normalized.includes('original')) return 'bg-slate-50 text-slate-600 border-slate-200';
  return 'bg-cyan-50 text-cyan-700 border-cyan-200';
}

export default function SourceBadge({ source }: SourceBadgeProps) {
  const label = source?.trim() || 'sem fonte';
  return (
    <span className={`inline-flex w-fit items-center rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${sourceClass(label)}`}>
      {label}
    </span>
  );
}
