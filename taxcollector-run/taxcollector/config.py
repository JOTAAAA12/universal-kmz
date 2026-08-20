from __future__ import annotations

LEXML_SRU = "https://www.lexml.gov.br/busca/SRU"
USER_AGENT = "CerebroTributarioRJSP/0.4 (+coleta normativa auditavel)"

OFFICIAL_DOMAINS = [
    "planalto.gov.br", "normas.leg.br", "senado.leg.br", "camara.leg.br",
    "in.gov.br", "gov.br", "receita.fazenda.gov.br", "confaz.fazenda.gov.br",
    "alerj.rj.gov.br", "fazenda.rj.gov.br", "legislacao.fazenda.rj.gov.br",
    "pge.rj.gov.br", "ioerj.com.br", "camara.rio", "rio.rj.gov.br",
    "prefeitura.rio", "doweb.rio.rj.gov.br", "al.sp.gov.br",
    "fazenda.sp.gov.br", "pge.sp.gov.br", "imprensaoficial.com.br",
    "legislacao.prefeitura.sp.gov.br", "prefeitura.sp.gov.br",
    "saopaulo.sp.leg.br", "diariooficial.prefeitura.sp.gov.br", "lexml.gov.br",
]

JURISDICTION_DIR = {
    "BR-FED": "05_Uniao",
    "RJ-EST": "06_RJ_Estado",
    "RJ-MUN-RIO": "07_RJ_Municipio_Rio_de_Janeiro",
    "SP-EST": "08_SP_Estado",
    "SP-MUN-SP": "09_SP_Municipio_Sao_Paulo",
}

SCOPE_FILTERS = {
    "BR-FED": "federal",
    "RJ-EST": "rio.de.janeiro estadual",
    "RJ-MUN-RIO": "rio.de.janeiro municipal",
    "SP-EST": "sao.paulo estadual",
    "SP-MUN-SP": "sao.paulo municipal",
}

TAX_TERMS = [x.strip() for x in """
tributário
tributaria
tributo
imposto
taxa
contribuição
crédito tributário
obrigação tributária
lançamento tributário
fiscalização tributária
dívida ativa
execução fiscal
transação tributária
parcelamento tributário
imunidade tributária
isenção fiscal
benefício fiscal
incentivo fiscal
IRPJ
IRPF
IRRF
CSLL
IPI
IOF
ITR
CIDE
PIS
COFINS
PIS-Importação
COFINS-Importação
Imposto de Importação
Imposto de Exportação
preços de transferência
aduaneiro
drawback
ICMS
IPVA
ITCMD
ITD
FECP
DIFAL
substituição tributária
ISS
IPTU
ITBI
COSIP
NFS-e
Simples Nacional
MEI
IBS
CBS
Imposto Seletivo
Reforma Tributária
CONFAZ
SINIEF
SPED
ECD
ECF
EFD
EFD-Reinf
DCTFWeb
eSocial
NF-e
NFC-e
CT-e
MDF-e
nota fiscal eletrônica
processo administrativo fiscal
auto de infração
compensação tributária
restituição tributária
""".splitlines() if x.strip()]

CORE_QUERIES = {
    "BR-FED": [x.strip() for x in """
Constituição Federal 1988
ADCT Constituição Federal
Emenda Constitucional 132 2023
Lei 5172 1966 Código Tributário Nacional
Lei Complementar 24 1975 CONFAZ
Lei Complementar 87 1996 ICMS Lei Kandir
Lei Complementar 104 2001 CTN
Lei Complementar 105 2001 sigilo bancário
Lei Complementar 116 2003 ISS
Lei Complementar 118 2005 CTN
Lei Complementar 123 2006 Simples Nacional
Lei Complementar 160 2017 benefícios fiscais ICMS
Lei Complementar 190 2022 DIFAL
Lei Complementar 192 2022 ICMS combustíveis
Lei Complementar 214 2025 IBS CBS Imposto Seletivo
Lei Complementar 227 2026 IBS CBS
Decreto-Lei 37 1966 imposto de importação
Decreto-Lei 1455 1976 aduaneiro
Decreto-Lei 1598 1977 imposto de renda pessoa jurídica
Lei 4502 1964 IPI
Lei 6830 1980 execução fiscal
Lei 7713 1988 imposto de renda pessoa física
Lei 8137 1990 crimes contra ordem tributária
Lei 8212 1991 custeio seguridade social
Lei 8383 1991 tributária
Lei 8541 1992 imposto de renda
Lei 8981 1995 tributária
Lei 9065 1995 tributária
Lei 9249 1995 imposto de renda pessoa jurídica
Lei 9250 1995 imposto de renda pessoa física
Lei 9430 1996 legislação tributária federal
Lei 9532 1997 legislação tributária federal
Lei 9718 1998 PIS COFINS
Lei 9779 1999 legislação tributária
Lei 10147 2000 PIS COFINS monofásico
Lei 10336 2001 CIDE combustíveis
Lei 10637 2002 PIS não cumulativo
Lei 10833 2003 COFINS não cumulativo
Lei 10865 2004 PIS COFINS importação
Lei 11033 2004 tributária
Lei 11196 2005 Lei do Bem
Lei 11457 2007 Receita Federal
Lei 11941 2009 tributária
Lei 12249 2010 tributária
Lei 12546 2011 CPRB
Lei 12973 2014 tributária
Lei 13254 2016 RERCT
Lei 13988 2020 transação tributária
Lei 14375 2022 transação tributária
Lei 14596 2023 preços de transferência
Lei 14689 2023 CARF
Lei 14754 2023 fundos offshore
Lei 14973 2024 desoneração folha
Decreto 70235 1972 processo administrativo fiscal
Decreto 6306 2007 IOF
Decreto 6759 2009 Regulamento Aduaneiro
Decreto 7212 2010 RIPI
Decreto 8426 2015 PIS COFINS receitas financeiras
Decreto 9580 2018 Regulamento Imposto de Renda
Decreto 11158 2022 TIPI
Instrução Normativa RFB 1500 2014 imposto de renda
Instrução Normativa RFB 1700 2017 IRPJ CSLL
Instrução Normativa RFB 2055 2021 restituição compensação
Instrução Normativa RFB 2110 2022 contribuições previdenciárias
Instrução Normativa RFB 2121 2022 PIS COFINS
Lei 13043 2014 eSocial
Decreto 8373 2014 eSocial
Lei 12350 2010 EFD Reinf
""".splitlines() if x.strip()],
    "RJ-EST": [x.strip() for x in """
Constituição Estado Rio de Janeiro
Decreto-Lei 5 1975 Código Tributário Estado Rio de Janeiro
Lei 2657 1996 ICMS Rio de Janeiro
Decreto 27427 2000 RICMS Rio de Janeiro
Lei 2877 1997 IPVA Rio de Janeiro
Lei 4056 2002 FECP Rio de Janeiro
Lei 7174 2015 ITD Rio de Janeiro
Lei 5427 2009 processo administrativo Rio de Janeiro
Lei 7495 2016 transação tributária Rio de Janeiro
Resolução SEFAZ Rio EFD ICMS IPI
""".splitlines() if x.strip()],
    "RJ-MUN-RIO": [x.strip() for x in """
Lei Orgânica Município Rio de Janeiro
Lei 691 1984 Código Tributário Município Rio de Janeiro
Decreto 10514 1991 ISS Rio de Janeiro
Lei 1364 1988 ITBI Rio de Janeiro
Lei 5098 2009 Nota Fiscal Serviços eletrônica Rio de Janeiro
Decreto Nota Carioca Rio de Janeiro
IPTU Município Rio de Janeiro legislação
COSIP Município Rio de Janeiro legislação
processo administrativo tributário Município Rio de Janeiro
transação tributária Município Rio de Janeiro
""".splitlines() if x.strip()],
    "SP-EST": [x.strip() for x in """
Constituição Estado São Paulo
Lei 6374 1989 ICMS São Paulo
Decreto 45490 2000 RICMS São Paulo
Lei 13296 2008 IPVA São Paulo
Lei 10705 2000 ITCMD São Paulo
Lei 10177 1998 processo administrativo São Paulo
Lei 13457 2009 processo administrativo tributário São Paulo
Decreto 54486 2009 Tribunal de Impostos e Taxas
Lei 17293 2020 benefícios fiscais São Paulo
Portaria CAT EFD ICMS IPI São Paulo
Portaria SRE ICMS São Paulo
""".splitlines() if x.strip()],
    "SP-MUN-SP": [x.strip() for x in """
Lei Orgânica Município São Paulo
Lei 6989 1966 Código Tributário Município São Paulo
Lei 13701 2003 ISS São Paulo
Decreto 53151 2012 ISS São Paulo
Lei 11154 1991 ITBI São Paulo
Lei 10235 1986 IPTU São Paulo
Lei 14097 2005 Nota Fiscal Serviços eletrônica São Paulo
Lei 14107 2005 processo administrativo fiscal São Paulo
COSIP Município São Paulo legislação
transação tributária Município São Paulo legislação
""".splitlines() if x.strip()],
}

THEMES = {
    "00_Fundamentos": ["constitui", "adct", "código tributário nacional", "ctn", "obrigação tributária", "crédito tributário"],
    "01_Renda_Lucro": ["irpj", "irpf", "irrf", "imposto de renda", "csll", "lucro real", "lucro presumido", "preços de transferência"],
    "02_Consumo_Circulacao": ["icms", "iss", "ipi", "pis", "cofins", "ibs", "cbs", "imposto seletivo", "sinief", "confaz", "substituição tributária", "difal"],
    "03_Aduaneiro": ["aduaneir", "importação", "exportação", "drawback", "imposto de importação", "imposto de exportação"],
    "04_Folha_Previdenciario": ["previdenci", "custeio", "cprb", "rat", "fap", "esocial", "efd-reinf", "dctfweb"],
    "05_Patrimonio_Transmissao": ["iptu", "ipva", "itbi", "itcmd", "itd", "itr", "herança", "doação"],
    "06_Financeiros_Especiais": ["iof", "cide", "câmbio", "seguro", "operações de crédito"],
    "07_Regimes_Beneficios": ["simples nacional", "mei", "benefício fiscal", "incentivo fiscal", "isenção", "crédito presumido"],
    "08_Obrigacoes_Compliance": ["sped", "ecd", "ecf", "efd", "nota fiscal", "nf-e", "nfs-e", "obrigação acessória"],
    "09_Processo_Fiscalizacao": ["processo administrativo", "auto de infração", "fiscalização", "carf", "tribunal de impostos"],
    "10_Divida_Execucao_Transacao": ["dívida ativa", "execução fiscal", "transação", "parcelamento", "cda", "certidão"],
    "12_Reforma_Tributaria": ["reforma tributária", "ibs", "cbs", "imposto seletivo", "emenda constitucional 132", "lei complementar 214", "lei complementar 227"],
}
