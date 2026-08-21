from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

from .core import (
    Record,
    classify_theme,
    domain_priority,
    extract_official_links,
    filename,
    folder_for,
    frontmatter,
    html_to_markdown,
    integrity,
    pdf_to_text,
    sha256,
    xml_to_text,
)
from .discovery import make_session


def fetch(session: requests.Session, url: str) -> requests.Response:
    response = session.get(url, timeout=float(os.getenv("HTTP_TIMEOUT", "45")), allow_redirects=True)
    response.raise_for_status()
    return response


def extract_response(response: requests.Response) -> tuple[str, list[str]]:
    data = response.content
    mime = (response.headers.get("content-type") or "").split(";")[0].lower()
    links: list[str] = []
    if "html" in mime or data[:20].lower().lstrip().startswith((b"<!doctype", b"<html")):
        text = html_to_markdown(response.text)
        if "lexml.gov.br" in (urlparse(response.url).hostname or ""):
            links = extract_official_links(response.text, response.url)
        return text, links
    if "pdf" in mime or data.startswith(b"%PDF"):
        return pdf_to_text(data), links
    if "xml" in mime or data.lstrip().startswith(b"<?xml"):
        return xml_to_text(data), links
    if mime.startswith("text/"):
        return response.text.strip(), links
    return "", links


def materialize(record: Record, output: Path) -> Record:
    session = make_session()
    candidates = [url for url in (record.source_url, record.resolver_url) if url]
    tried: set[str] = set()
    official_links: list[str] = []
    best: tuple[int, requests.Response, str] | None = None

    def evaluate(url: str) -> None:
        nonlocal best
        if url in tried:
            return
        tried.add(url)
        try:
            response = fetch(session, url)
            text, links = extract_response(response)
            official_links.extend(links)
            _, score, _ = integrity(text)
            rank = int(score * 1000) - domain_priority(response.url)
            if best is None or rank > best[0]:
                best = (rank, response, text)
        except Exception as exc:
            record.error += f"{url}: {exc}; "

    for url in candidates:
        evaluate(url)
    for url in sorted(set(official_links), key=domain_priority)[:8]:
        evaluate(url)

    if best is None:
        record.status = "ERRO_SEM_FONTE_MATERIALIZADA"
        return record

    _, response, text = best
    data = response.content
    mime = (response.headers.get("content-type") or "").split(";")[0].lower()
    record.source_url = response.url
    record.sha256_original = sha256(data)
    record.integrity_status, record.integrity_score, reasons = integrity(text)
    theme = classify_theme(" ".join([record.title, record.description, record.subject, text[:6000]]))
    jurisdiction = folder_for(record)
    extension = (
        ".pdf" if ("pdf" in mime or data.startswith(b"%PDF"))
        else ".html" if "html" in mime
        else ".xml" if "xml" in mime
        else ".bin"
    )
    original = output / "10_Originais" / jurisdiction / theme / (Path(filename(record)).stem + extension)
    original.parent.mkdir(parents=True, exist_ok=True)
    original.write_bytes(data)
    record.original_path = str(original.relative_to(output))

    if not text.strip():
        record.status = "ORIGINAL_PRESERVADO_EXTRACAO_PENDENTE"
        return record

    accessed = datetime.now(timezone.utc).isoformat()
    markdown = frontmatter(record, theme, accessed, reasons)
    markdown += f"# {record.title or filename(record)}\n\n{text.strip()}\n"
    destination = output / "11_Normalizados_MD" / jurisdiction / theme / filename(record)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(markdown, encoding="utf-8")
    record.markdown_path = str(destination.relative_to(output))
    record.sha256_markdown = sha256(markdown.encode("utf-8"))
    record.status = "MATERIALIZADO"
    return record
