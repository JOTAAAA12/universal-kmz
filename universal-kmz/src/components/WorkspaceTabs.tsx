import React from 'react';
import { Download, LayoutDashboard, Map as MapIcon, TableProperties } from 'lucide-react';

export type WorkspaceTab = 'summary' | 'map' | 'tables' | 'download';

interface WorkspaceTabsProps {
  activeTab: WorkspaceTab;
  onChange: (tab: WorkspaceTab) => void;
}

const TABS: Array<{ id: WorkspaceTab; label: string; icon: React.ElementType }> = [
  { id: 'summary', label: 'Métricas e Resumo', icon: LayoutDashboard },
  { id: 'map', label: 'Dióptica Comercial (Mapa)', icon: MapIcon },
  { id: 'tables', label: 'Planilha de Dados', icon: TableProperties },
  { id: 'download', label: 'Download dos Dados', icon: Download }
];

export default function WorkspaceTabs({ activeTab, onChange }: WorkspaceTabsProps) {
  return (
    <div className="flex border border-slate-300 bg-white rounded overflow-hidden" id="workspace-tabs-navigator">
      {TABS.map(({ id, label, icon: Icon }, index) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`flex-1 py-3 text-center transition duration-150 flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wider ${index < TABS.length - 1 ? 'border-r border-slate-300' : ''} ${
            activeTab === id
              ? 'bg-slate-50 text-indigo-600 border-b-2 border-b-indigo-600 font-bold'
              : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50/50'
          }`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </button>
      ))}
    </div>
  );
}
