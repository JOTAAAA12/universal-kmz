from taxcollector.core import (
    Record,
    extract_official_links,
    identity_from_urn,
    integrity,
    jurisdiction_from_urn,
    legal_key,
    slug,
    tax_relevant,
)
from taxcollector.discovery import parse_sru


def test_urn_identity_and_jurisdiction():
    urn = "urn:lex:br:federal:lei:1966-10-25;5172"
    assert jurisdiction_from_urn(urn) == "BR-FED"
    identity = identity_from_urn(urn)
    assert identity["number"] == "5172"
    assert identity["year"] == "1966"
    assert identity["act_type"] == "lei"


def test_one_diploma_key_ignores_article_suffix():
    first = Record(urn="urn:lex:br:federal:lei:1966-10-25;5172!art1")
    second = Record(urn="urn:lex:br:federal:lei:1966-10-25;5172!art218")
    assert legal_key(first) == legal_key(second)


def test_tax_relevance():
    assert tax_relevant("Institui o ICMS e disciplina o crédito tributário")
    assert not tax_relevant("Altera a jornada de trabalho dos empregados")


def test_integrity_rejects_fragment_and_accepts_structured_text():
    assert integrity("Art. 1º trecho isolado")[0] == "FRAGMENTO_OU_INCOMPLETO"
    text = "LEI Nº 1\n" + "\n".join(f"Art. {number}. Conteúdo normativo." for number in range(1, 20))
    text += "\nEsta Lei entra em vigor.\nBrasília. Presidente da República."
    assert integrity(text)[0] == "PROVAVELMENTE_INTEGRAL"


def test_sru_parse_dublin_core():
    xml = b'''<?xml version="1.0"?><searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/" xmlns:srw_dc="info:srw/schema/1/dc-schema" xmlns:dc="http://purl.org/dc/elements/1.1/"><numberOfRecords>1</numberOfRecords><records><record><recordData><srw_dc:dc><dc:title>Lei n. 5.172</dc:title><dc:identifier>urn:lex:br:federal:lei:1966-10-25;5172</dc:identifier><dc:description>Sistema Tributario Nacional</dc:description></srw_dc:dc></recordData></record></records></searchRetrieveResponse>'''
    rows, count = parse_sru(xml, "teste")
    assert count == 1
    assert rows[0].number == "5172"
    assert rows[0].jurisdiction == "BR-FED"


def test_official_links_are_filtered():
    html = '<a href="https://blog.example/resumo">x</a><a href="https://www.planalto.gov.br/lei.htm">Texto da lei</a>'
    assert extract_official_links(html, "https://www.lexml.gov.br") == ["https://www.planalto.gov.br/lei.htm"]


def test_slug():
    assert slug("Lei Complementar nº 123") == "lei-complementar-n-123"
