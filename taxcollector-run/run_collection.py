from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

from taxcollector.core import Record
from taxcollector.discovery import discover, make_session
from taxcollector.materialize import materialize
from taxcollector.reporting import write_csv, write_manifest, write_report, write_scope

VERSION = "0.3.0"


def main() -> int:
    parser = argparse.ArgumentParser(description="Coletor auditável do Cérebro Tributário RJ/SP")
    parser.add_argument("--output", default="output")
    args = parser.parse_args()
    output = Path(args.output)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)
    for folder in [
        "00_Governanca", "03_Fontes", "04_Inventarios", "05_Uniao", "06_RJ_Estado",
        "07_RJ_Municipio_Rio_de_Janeiro", "08_SP_Estado", "09_SP_Municipio_Sao_Paulo",
        "10_Originais", "11_Normalizados_MD", "13_Versoes_Revogadas", "14_Quarentena",
        "99_Logs_Auditoria", "logs",
    ]:
        (output / folder).mkdir(parents=True, exist_ok=True)
    write_scope(output)
    started = datetime.now(timezone.utc)
    records, core_coverage, query_log = discover(make_session())
    write_csv(output / "04_Inventarios" / "descoberta_lexml.csv", [record.to_dict() for record in records])
    write_csv(output / "04_Inventarios" / "cobertura_nucleo_obrigatorio.csv", core_coverage, ["jurisdiction", "seed_query", "matches", "selected"])
    write_csv(output / "99_Logs_Auditoria" / "consultas_lexml.csv", query_log, ["kind", "jurisdiction", "query", "returned", "accepted"])

    completed: list[Record] = []
    workers = int(os.getenv("FETCH_WORKERS", "12"))
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_map = {executor.submit(materialize, record, output): record for record in records}
        for index, future in enumerate(concurrent.futures.as_completed(future_map), 1):
            try:
                result = future.result()
            except Exception as exc:
                result = future_map[future]
                result.status = "ERRO_INTERNO"
                result.error = repr(exc)
            completed.append(result)
            if index % 50 == 0:
                print(f"processados: {index}/{len(records)}", flush=True)

    completed.sort(key=lambda item: (item.jurisdiction, item.act_type, item.year, item.number, item.title))
    write_csv(output / "inventario_mestre.csv", [record.to_dict() for record in completed])
    pending = [record.to_dict() for record in completed if record.status != "MATERIALIZADO" or record.integrity_status != "PROVAVELMENTE_INTEGRAL"]
    write_csv(output / "04_Inventarios" / "pendencias.csv", pending)
    errors = [record.to_dict() for record in completed if record.error]
    (output / "logs" / "erros.json").write_text(json.dumps(errors, ensure_ascii=False, indent=2), encoding="utf-8")
    write_report(output, completed, started, VERSION)
    write_manifest(output, completed, started, VERSION)
    print(json.dumps({"records": len(completed), "pending": len(pending), "errors": len(errors)}, ensure_ascii=False))
    return 0 if completed else 2


if __name__ == "__main__":
    raise SystemExit(main())
