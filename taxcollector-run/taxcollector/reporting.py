from __future__ import annotations

import csv
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from .core import Record

FIELDS = list(Record().__dict__.keys())


def write_csv(path: Path, rows: Iterable[dict], fields: list[str] = FIELDS) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_scope(output: Path) -> None:
    text = """# Escopo executado - Cérebro Tributário RJ/SP

Territórios: União; Estado do Rio de Janeiro; Município do Rio de Janeiro; Estado de São Paulo; Município de São Paulo.

Camadas: fundamentos; renda e lucro; consumo e circulação; importação/exportação/aduaneiro; folha e previdenciário; patrimônio e transmissão; operações financeiras e tributos especiais; regimes e benefícios; obrigações acessórias e compliance; fiscalização e processo administrativo; dívida ativa, transação e execução fiscal; jurisprudência/integração; reforma tributária 2023-2033+.

Regra documental: um diploma por arquivo e por versão. Artigos são indexados, não duplicados como novas normas.

A execução não declara cobertura universal por mera quantidade. Cada item recebe fonte, hash, status de extração e status de integridade. Pendências e erros permanecem explícitos.
"""
    path = output / "00_Governanca" / "ESCOPO_PROMPT.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def write_report(output: Path, records: list[Record], started: datetime, version: str) -> None:
    statuses = Counter(record.status for record in records)
    integrities = Counter(record.integrity_status for record in records)
    jurisdictions = Counter(record.jurisdiction or "NAO_IDENTIFICADO" for record in records)
    lines = [
        "# Relatório de execução - Cérebro Tributário RJ/SP", "",
        f"- Versão do coletor: `{version}`",
        f"- Início UTC: `{started.isoformat()}`",
        f"- Fim UTC: `{datetime.now(timezone.utc).isoformat()}`",
        f"- Diplomas/registros deduplicados: **{len(records)}**", "",
        "## Resultado por status", "",
    ]
    lines.extend(f"- `{key}`: {value}" for key, value in sorted(statuses.items()))
    lines.extend(["", "## Integridade", ""])
    lines.extend(f"- `{key}`: {value}" for key, value in sorted(integrities.items()))
    lines.extend(["", "## Cobertura por ente", ""])
    lines.extend(f"- `{key}`: {value}" for key, value in sorted(jurisdictions.items()))
    lines.extend([
        "", "## Limites e pendências", "",
        "`PROVAVELMENTE_INTEGRAL` representa validação estrutural automatizada, não certificação jurídica definitiva. A certificação final exige confronto com publicação oficial, anexos, retificações, versões e vigência. Nenhuma pendência é ocultada.", "",
    ])
    (output / "RELATORIO_EXECUCAO.md").write_text("\n".join(lines), encoding="utf-8")


def write_manifest(output: Path, records: list[Record], started: datetime, version: str) -> None:
    files = []
    for path in sorted(item for item in output.rglob("*") if item.is_file() and item.name != "manifesto.json"):
        data = path.read_bytes()
        files.append({"path": str(path.relative_to(output)), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    payload = {
        "versao_coletor": version,
        "inicio": started.isoformat(),
        "fim": datetime.now(timezone.utc).isoformat(),
        "registros": len(records),
        "status": dict(Counter(record.status for record in records)),
        "integridade": dict(Counter(record.integrity_status for record in records)),
        "entes": dict(Counter(record.jurisdiction or "NAO_IDENTIFICADO" for record in records)),
        "arquivos": files,
    }
    (output / "manifesto.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
