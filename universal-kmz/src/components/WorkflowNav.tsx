import React from 'react';
import { ArrowLeft, Upload, TableProperties, Download } from 'lucide-react';

type WorkspaceTab = 'summary' | 'map' | 'tables' | 'download';

interface WorkflowNavProps {
  activeTab: WorkspaceTab;
  onBackToUpload: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
}

function previousTab(activeTab: WorkspaceTab): WorkspaceTab | 'upload' {
  if (activeTab === 'download') return 'tables';
  return 'upload';
}

export default function WorkflowNav({ activeTab, onBackToUpload, onNavigate }: WorkflowNavProps) {
  const target = previousTab(activeTab);
  const backLabel = target === 'upload' ? 'Voltar ao upload' : 'Voltar para tabela';

  return (
    <div className="flex flex-col gap-3 rounded border border-slate-300 bg-white p-3 shadow-xs md:flex-row md:items-center md:justify-between">
      <button
        type="button"
        onClick={() => target === 'upload' ? onBackToUpload() : onNavigate(target)}
        className="inline-flex w-fit items-center gap-2 rounded border border-slate-300 bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-700 transition hover:bg-slate-100"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {backLabel}
      </button>

      <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
        <button type="button" onClick={onBackToUpload} className="inline-flex items-center gap-1 hover:text-indigo-700">
          <Upload className="h-3.5 w-3.5" />
          Upload
        </button>
        <span className="text-slate-300">/</span>
        <button
          type="button"
          onClick={() => onNavigate('tables')}
          className={`inline-flex items-center gap-1 hover:text-indigo-700 ${activeTab === 'tables' ? 'text-indigo-700' : ''}`}
        >
          <TableProperties className="h-3.5 w-3.5" />
          Tabela
        </button>
        <span className="text-slate-300">/</span>
        <button
          type="button"
          onClick={() => onNavigate('download')}
          className={`inline-flex items-center gap-1 hover:text-indigo-700 ${activeTab === 'download' ? 'text-indigo-700' : ''}`}
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </button>
      </div>
    </div>
  );
}
