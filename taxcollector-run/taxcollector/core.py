from __future__ import annotations

import hashlib
import io
import re
import unicodedata
from dataclasses import asdict, dataclass
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from lxml import etree
from markdownify import markdownify as markdownify
from pypdf import PdfReader

from .config import JURISDICTION_DIR, OFFICIAL_DOMAINS, TAX_TERMS, THEMES


@dataclass
class Record:
    urn: str = ""
    title: str = ""
    description: str = ""
    subject: str = ""
    date: str = ""
    act_type: str = ""
    number: str = ""
    year: str = ""
    jurisdiction: str = ""
    issuer: str = ""
    discovered_by: str = ""
    resolver_url: str = ""
    source_url: str = ""
    status: str = "DESCOBERTO"
    integrity_status: str = "NAO_AVALIADO"
    integrity_score: float = 0.0
    sha256_original: str = ""
    sha256_markdown: str = ""
    original_path: str = ""
    markdown_path: str = ""
    error: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def fold(value: str) -> str:
    return unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()


def slug(value: str) -> str:
    value = re.sub(r"(?i)n[º°]", "n", value or "")
    return re.sub(r"[^a-z0-9]+", "-", fold(value)).strip("-")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def domain_priority(url: str) -> int:
    host = (urlparse(url).hostname or "").lower()
    for index, domain in enumerate(OFFICIAL_DOMAINS):
        if host == domain or host.endswith("." + domain):
            return index
    return 10000


def is_official(url: str) -> bool:
    return domain_priority(url) < 10000


def jurisdiction_from_urn(urn: str) -> str:
    value = urn.lower()
    if ":federal:" in value:
        return "BR-FED"
    if "br;rio.de.janeiro;rio.de.janeiro:municipal:" in value:
        return "RJ-MUN-RIO"
    if "br;rio.de.janeiro:estadual:" in value:
        return "RJ-EST"
    if "br;sao.paulo;sao.paulo:municipal:" in value:
        return "SP-MUN-SP"
    if "br;sao.paulo:estadual:" in value:
        return "SP-EST"
    return ""


def identity_from_urn(urn: str) -> dict[str, str]:
    result = {"act_type": "", "number": "", "year": "", "date": "", "jurisdiction": jurisdiction_from_urn(urn)}
    if not urn.startswith("urn:lex:"):
        return result
    parts = urn.split(":")
    result["act_type"] = parts[-2] if len(parts) > 2 else ""
    tail = parts[-1]
    if ";" in tail:
        date_part, number = tail.split(";", 1)
        result["date"] = date_part
        result["year"] = date_part[:4] if re.match(r"\d{4}", date_part) else ""
        result["number"] = number.split("@")[0].split("!")[0]
    return result


def legal_key(record: Record) -> str:
    if record.urn:
        return record.urn.lower().split("@")[0].split("!")[0]
    return "|".join([record.jurisdiction, slug(record.act_type), slug(record.number), record.year, slug(record.title)])


def tax_relevant(text: str) -> bool:
    value = fold(text)
    return any(fold(term) in value for term in TAX_TERMS)


def classify_theme(text: str) -> str:
    value = fold(text)
    scores = {theme: sum(1 for term in terms if fold(term) in value) for theme, terms in THEMES.items()}
    theme, score = max(scores.items(), key=lambda item: item[1])
    return theme if score else "99_Outros_Tributarios"


def filename(record: Record) -> str:
    act = slug(record.act_type) or "norma"
    number = slug(record.number) or slug(record.title)[:70] or hashlib.sha1(legal_key(record).encode()).hexdigest()[:12]
    year = record.year or (record.date[:4] if record.date else "s-ano")
    return f"{act}-{number}-{year}.md"


def folder_for(record: Record) -> str:
    return JURISDICTION_DIR.get(record.jurisdiction, "14_Quarentena")


def extract_official_links(html: str, base_url: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    links = []
    for anchor in soup.find_all("a", href=True):
        url = urljoin(base_url, anchor["href"].strip())
        if not url.startswith("http") or not is_official(url):
            continue
        label = fold(anchor.get_text(" ", strip=True))
        useful = any(token in label for token in ("texto", "integra", "publicacao", "compil", "norma", "lei", "decreto", "resolucao", "pdf"))
        if useful or url.lower().endswith((".pdf", ".htm", ".html", ".xml")):
            links.append(url)
    return sorted(set(links), key=lambda value: (domain_priority(value), len(value)))


def html_to_markdown(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form"]):
        tag.decompose()
    root = soup.find("main") or soup.find("article") or soup.find(id=re.compile("conteudo|content|texto", re.I)) or soup.body or soup
    for tag in root.find_all(True):
        attrs = " ".join([str(tag.get("id", "")), " ".join(tag.get("class", []))]).lower()
        if any(term in attrs for term in ("menu", "breadcrumb", "cookie", "share", "social", "rodape", "cabecalho", "sidebar")):
            tag.decompose()
    text = markdownify(str(root), heading_style="ATX", bullets="-")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return re.sub(r"[ \t]+\n", "\n", text).strip()


def pdf_to_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages).strip()


def xml_to_text(data: bytes) -> str:
    root = etree.fromstring(data)
    return "\n".join(" ".join(text.split()) for text in root.itertext() if " ".join(text.split())).strip()


def integrity(text: str) -> tuple[str, float, list[str]]:
    reasons: list[str] = []
    score = 0.0
    length = len(text)
    if length >= 5000:
        score += 0.25
    elif length >= 1500:
        score += 0.12
    else:
        reasons.append("texto curto")
    articles = len(re.findall(r"(?im)^\s*art\.?\s*\d+", text))
    if articles >= 5:
        score += 0.25
    elif articles:
        score += 0.10
    else:
        reasons.append("sem artigos detectados")
    if re.search(r"(?im)^\s*(lei|decreto|resolução|resolucao|instrução normativa|instrucao normativa|emenda constitucional|lei complementar)\s+n", text):
        score += 0.15
    if re.search(r"(?i)(entra em vigor|vigência|vigencia)", text):
        score += 0.15
    else:
        reasons.append("sem cláusula de vigência detectada")
    if re.search(r"(?i)(brasília|palácio|governador|prefeito|presidente da república|assinado|secretário)", text):
        score += 0.10
    score += 0.10 if re.search(r"(?i)(anexo|tabela|lista de serviços)", text) else 0.05
    if re.search(r"(?i)(captura parcial|trecho|excerto|apenas o art|resumo)", text):
        score -= 0.35
        reasons.append("marca explícita de parcialidade")
    score = max(0.0, min(1.0, score))
    if score >= 0.65 and articles >= 2:
        return "PROVAVELMENTE_INTEGRAL", score, reasons
    if length >= 500:
        return "EXTRAIDO_NAO_CERTIFICADO", score, reasons
    return "FRAGMENTO_OU_INCOMPLETO", score, reasons


def frontmatter(record: Record, theme: str, accessed: str, reasons: list[str]) -> str:
    values = {
        "titulo": record.title,
        "urn_lexml": record.urn,
        "ente": record.jurisdiction,
        "tipo": record.act_type,
        "numero": record.number,
        "ano": record.year,
        "data": record.date,
        "orgao_emissor": record.issuer,
        "tema": theme,
        "fonte": record.source_url,
        "acesso_em": accessed,
        "status_integridade": record.integrity_status,
        "score_integridade": f"{record.integrity_score:.2f}",
        "sha256_original": record.sha256_original,
        "observacoes_integridade": "; ".join(reasons),
    }
    lines = ["---"]
    for key, value in values.items():
        safe = str(value or "").replace("\n", " ").replace('"', "'")
        lines.append(f'{key}: "{safe}"')
    return "\n".join(lines + ["---", ""])
