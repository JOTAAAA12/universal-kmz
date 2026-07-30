import React, { useEffect, useState } from 'react';

interface UfAusente {
  uf: string;
  nome: string;
  tamanho: string | null;
}

interface CoberturaAvisoProps {
  ufsAusentes: UfAusente[];
  espacoLivre: string;
  statusPorUf?: Readonly<Record<string, string>>;
  onBaixar: (uf: string) => Promise<void> | void;
  onDispensar: () => void;
}

const descricaoStatus = (status: string) => {
  const descricoes: Record<string, string> = {
    enfileirado: 'Aguardando início do download.',
    baixando: 'Baixando arquivo.',
    extraindo: 'Extraindo arquivo.',
    ingerindo: 'Indexando endereços.'
  };

  return descricoes[status] || `Processamento em andamento: ${status}.`;
};

export default function CoberturaAviso({
  ufsAusentes,
  espacoLivre,
  statusPorUf = {},
  onBaixar,
  onDispensar
}: CoberturaAvisoProps) {
  const [solicitacoesEmCurso, setSolicitacoesEmCurso] = useState<Readonly<Record<string, boolean>>>({});
  const [errosPorUf, setErrosPorUf] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    const dispensarComEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDispensar();
    };

    document.addEventListener('keydown', dispensarComEscape);
    return () => document.removeEventListener('keydown', dispensarComEscape);
  }, [onDispensar]);

  const handleBaixar = async (uf: string) => {
    setSolicitacoesEmCurso(atuais => ({ ...atuais, [uf]: true }));
    setErrosPorUf(atuais => {
      const { [uf]: _, ...restantes } = atuais;
      return restantes;
    });

    try {
      await onBaixar(uf);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : 'Não foi possível iniciar o download.';
      setErrosPorUf(atuais => ({ ...atuais, [uf]: mensagem }));
    } finally {
      setSolicitacoesEmCurso(atuais => {
        const { [uf]: _, ...restantes } = atuais;
        return restantes;
      });
    }
  };

  if (ufsAusentes.length === 0) return null;

  return (
    <section
      role="status"
      aria-live="polite"
      aria-label="Aviso de cobertura CNEFE"
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-sm"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">Há pontos em UFs sem cobertura CNEFE</h2>
          <p className="mt-1 text-sm text-amber-900">
            A análise continua normalmente. Você pode baixar somente as bases necessárias ou dispensar este aviso.
          </p>
          <p className="mt-2 text-sm font-medium">Espaço livre em disco: {espacoLivre}</p>
        </div>
        <button
          type="button"
          onClick={onDispensar}
          className="rounded-md border border-amber-400 bg-white px-3 py-2 text-sm font-medium text-amber-950 transition hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2"
        >
          Dispensar
        </button>
      </div>

      <ul className="mt-4 space-y-3" aria-label="UFs sem cobertura CNEFE">
        {ufsAusentes.map(({ uf, nome, tamanho }) => {
          const status = statusPorUf[uf];
          const solicitacaoEmCurso = Boolean(solicitacoesEmCurso[uf]);
          const emProcessamento = Boolean(status && status !== 'erro');

          return (
            <li key={uf} className="flex flex-col gap-3 rounded-md border border-amber-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-medium">{nome} ({uf})</p>
                <p className="text-sm text-slate-700">Tamanho do arquivo: {tamanho || 'não informado'}</p>
                {status && status !== 'erro' && <p className="mt-1 text-sm text-amber-900">{descricaoStatus(status)}</p>}
                {errosPorUf[uf] && <p className="mt-1 text-sm text-red-700" role="alert">{errosPorUf[uf]}</p>}
              </div>
              <button
                type="button"
                onClick={() => void handleBaixar(uf)}
                disabled={solicitacaoEmCurso || emProcessamento}
                className="rounded-md bg-amber-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-amber-300"
              >
                {solicitacaoEmCurso ? 'Enfileirando download...' : emProcessamento ? 'Download em andamento' : `Baixar base de ${nome}`}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
