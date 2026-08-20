from __future__ import annotations

import os
import sys
import time
from collections import defaultdict
from urllib.parse import quote

import requests
from lxml import etree
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .config import CORE_QUERIES, LEXML_SRU, SCOPE_FILTERS, TAX_TERMS, USER_AGENT
from .core import Record, domain_priority, identity_from_urn, legal_key, tax_relevant


def make_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(total=5, connect=5, read=5, backoff_factor=1.0, status_forcelist=(429, 500, 502, 503, 504), allowed_methods=("GET", "HEAD"))
    adapter = HTTPAdapter(max_retries=retry, pool_connections=32, pool_maxsize=32)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update({"User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.5"})
    return session


def parse_sru(data: bytes, discovered_by: str = "") -> tuple[list[Record], int]:
    root = etree.fromstring(data)
    total = 0
    for element in root.iter():
        if etree.QName(element).localname == "numberOfRecords":
            raw = (element.text or "").strip()
            total = int(raw) if raw.isdigit() else 0
            break
    records: list[Record] = []
    for dc in root.xpath("//*[local-name()='recordData']//*[local-name()='dc']"):
        values: dict[str, list[str]] = defaultdict(list)
        for child in dc.iterchildren():
            key = etree.QName(child).localname
            value = " ".join("".join(child.itertext()).split())
            if value:
                values[key].append(value)
        identifiers = values.get("identifier", [])
        urns = [value for value in identifiers if value.startswith("urn:lex:")]
        urn = urns[0] if urns else ""
        ident = identity_from_urn(urn)
        urls = [value for value in identifiers if value.startswith("http")]
        source_url = sorted(urls, key=domain_priority)[0] if urls else ""
        records.append(Record(
            urn=urn,
            title=(values.get("title") or [""])[0],
            description=" | ".join(values.get("description", [])),
            subject=" | ".join(values.get("subject", [])),
            date=(values.get("date") or [ident["date"]])[0],
            act_type=(values.get("type") or [ident["act_type"]])[0],
            number=ident["number"],
            year=ident["year"],
            jurisdiction=ident["jurisdiction"],
            issuer=(values.get("creator") or values.get("publisher") or [""])[0],
            discovered_by=discovered_by,
            resolver_url=f"https://www.lexml.gov.br/urn/{quote(urn, safe=':;.@![],-')}" if urn else "",
            source_url=source_url,
        ))
    return records, total


def sru_query(session: requests.Session, query: str, max_pages: int | None = None) -> list[Record]:
    page_size = int(os.getenv("LEXML_PAGE_SIZE", "250"))
    pages = max_pages or int(os.getenv("LEXML_MAX_PAGES", "8"))
    delay = float(os.getenv("REQUEST_DELAY", "0.10"))
    timeout = float(os.getenv("HTTP_TIMEOUT", "45"))
    found: list[Record] = []
    start = 1
    total: int | None = None
    for _ in range(pages):
        params = {"operation": "searchRetrieve", "version": "1.1", "query": query, "maximumRecords": page_size, "startRecord": start}
        try:
            response = session.get(LEXML_SRU, params=params, timeout=timeout)
            response.raise_for_status()
            rows, count = parse_sru(response.content, query)
        except Exception as exc:
            sys.stderr.write(f"SRU_ERROR query={query!r} start={start}: {exc}\n")
            break
        if total is None:
            total = count
        if not rows:
            break
        found.extend(rows)
        start += len(rows)
        if total and start > total:
            break
        time.sleep(delay)
    return found


def query_with_fallbacks(session: requests.Session, term: str, scope: str, pages: int | None = None) -> list[Record]:
    clean = term.replace('"', " ").strip()
    variants = [
        f'cql.serverChoice any "{clean}" and urn += "{scope}"',
        f'"{clean}" and urn += "{scope}"',
        f'cql.serverChoice all "{clean}"',
        f'cql.serverChoice any "{clean}"',
    ]
    for query in variants:
        rows = sru_query(session, query, max_pages=pages)
        if rows:
            return rows
    return []


def discover(session: requests.Session) -> tuple[list[Record], list[dict], list[dict]]:
    candidates: list[Record] = []
    query_log: list[dict] = []
    core_coverage: list[dict] = []
    for jurisdiction, scope in SCOPE_FILTERS.items():
        for term in TAX_TERMS:
            rows = query_with_fallbacks(session, term, scope)
            accepted = 0
            for record in rows:
                if record.jurisdiction and record.jurisdiction != jurisdiction:
                    continue
                record.jurisdiction = record.jurisdiction or jurisdiction
                if tax_relevant(" ".join([record.title, record.description, record.subject])):
                    candidates.append(record)
                    accepted += 1
            query_log.append({"kind": "THEMATIC", "jurisdiction": jurisdiction, "query": term, "returned": len(rows), "accepted": accepted})
    for jurisdiction, queries in CORE_QUERIES.items():
        scope = SCOPE_FILTERS[jurisdiction]
        for text in queries:
            rows = query_with_fallbacks(session, text, scope, pages=2)
            selected = []
            for record in rows:
                if record.jurisdiction and record.jurisdiction != jurisdiction:
                    continue
                record.jurisdiction = record.jurisdiction or jurisdiction
                record.discovered_by = "CORE: " + text
                candidates.append(record)
                selected.append(record.urn or record.title)
            core_coverage.append({"jurisdiction": jurisdiction, "seed_query": text, "matches": len(selected), "selected": " | ".join(selected[:20])})
    deduplicated: dict[str, Record] = {}
    for record in candidates:
        key = legal_key(record)
        if not key:
            continue
        current = deduplicated.get(key)
        if current is None:
            deduplicated[key] = record
            continue
        current_rank = (0 if current.discovered_by.startswith("CORE:") else 1, domain_priority(current.source_url), -len(current.description))
        new_rank = (0 if record.discovered_by.startswith("CORE:") else 1, domain_priority(record.source_url), -len(record.description))
        if new_rank < current_rank:
            deduplicated[key] = record
    return list(deduplicated.values()), core_coverage, query_log
