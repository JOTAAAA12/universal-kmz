from __future__ import annotations

import csv
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1] if len(sys.argv) > 1 else "output")
required = [root / "manifesto.json", root / "inventario_mestre.csv", root / "RELATORIO_EXECUCAO.md"]
missing = [str(path) for path in required if not path.exists()]
if missing:
    raise SystemExit("Arquivos obrigatórios ausentes: " + ", ".join(missing))
manifest = json.loads((root / "manifesto.json").read_text(encoding="utf-8"))
with (root / "inventario_mestre.csv").open(encoding="utf-8-sig", newline="") as handle:
    rows = list(csv.DictReader(handle))
if not rows:
    raise SystemExit("Inventário vazio")
keys = []
for row in rows:
    urn = (row.get("urn") or "").split("@")[0].split("!")[0].lower()
    fallback = "|".join([row.get("jurisdiction", ""), row.get("act_type", ""), row.get("number", ""), row.get("year", ""), row.get("title", "")])
    keys.append(urn or fallback)
if len(keys) != len(set(keys)):
    raise SystemExit("Duplicação jurídica detectada no inventário")
for item in manifest.get("arquivos", []):
    path = root / item["path"]
    if not path.exists():
        raise SystemExit(f"Arquivo do manifesto ausente: {path}")
    if hashlib.sha256(path.read_bytes()).hexdigest() != item["sha256"]:
        raise SystemExit(f"Hash divergente: {path}")
coverage = root / "04_Inventarios" / "cobertura_nucleo_obrigatorio.csv"
if not coverage.exists():
    raise SystemExit("Cobertura do núcleo obrigatório ausente")
with coverage.open(encoding="utf-8-sig", newline="") as handle:
    core = list(csv.DictReader(handle))
if not core:
    raise SystemExit("Cobertura do núcleo obrigatório vazia")
print(json.dumps({"rows": len(rows), "files": len(manifest.get("arquivos", [])), "duplicates": 0, "hashes": "ok", "core_queries": len(core)}, ensure_ascii=False))
