"""
Configuração dos scripts de catálogo Yupoo.

TUDO o que depende do tema/HTML do site está aqui.
Se a listagem ou um álbum voltar vazio, é aqui que se ajusta (ver LEIA-ME.md, secção "Calibrar").
"""

# --------------------------------------------------------------------------
# Site
# --------------------------------------------------------------------------
BASE_URL = "https://minkang.x.yupoo.com"
LISTAGEM_PATH = "/albums"          # página de listagem dos álbuns
PARAM_PAGINA = "page"              # ?page=N
MAX_PAGINAS = 300                  # limite de segurança

# --------------------------------------------------------------------------
# Pedidos HTTP
# --------------------------------------------------------------------------
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.8",
}
# O servidor de imagens (photo.yupoo.com) recusa pedidos sem Referer do site — o browser envia-o sempre.
REFERER = BASE_URL + "/"

TIMEOUT = 30                       # segundos por pedido
TENTATIVAS = 3                     # tentativas por pedido antes de desistir

# Pausas aleatórias (mín, máx) em segundos
PAUSA_PAGINAS = (2.0, 4.0)         # entre páginas da listagem
PAUSA_ALBUNS = (3.0, 6.0)          # entre álbuns
PAUSA_IMAGENS = (0.8, 1.8)         # entre imagens

# --------------------------------------------------------------------------
# Seletores da LISTAGEM (/albums?page=N)  — confirmados com o HTML real (24/11/2026)
# --------------------------------------------------------------------------
# Cada álbum na grelha é um <a> que aponta para /albums/<id>?uid=1
SELETOR_ALBUM_LINK = "a.album__main"
# O título costuma estar no atributo title do <a>; se vier vazio usa-se o texto deste elemento dentro do <a>
ATRIBUTO_TITULO = "title"
SELETOR_ALBUM_TITULO = ".album__title"
# Número de fotos mostrado na capa (opcional; vazio se o tema não o tiver)
SELETOR_ALBUM_NFOTOS = ".album__photonumber"
# Imagem de capa do álbum na grelha (usada como miniatura no painel)
SELETOR_ALBUM_CAPA = "img.album__img"
# Filtro de segurança: só hrefs que correspondam a isto são considerados álbuns
PADRAO_URL_ALBUM = r"/albums/(\d+)"

# --------------------------------------------------------------------------
# Categorias (menu do topo do site) — confirmados com o HTML real (24/11/2026)
# --------------------------------------------------------------------------
SELETOR_CATEGORIA_ITEM = "li.showheader__category_item"     # cada categoria principal
SELETOR_CATEGORIA_LINK = "a.showheader__link"               # link da categoria principal
SELETOR_SUBCATEGORIA_LINK = "a.showheader__child_link"      # links das subcategorias (dentro do item)
PADRAO_URL_CATEGORIA = r"/categories/(\d+)"
MAX_PAGINAS_CATEGORIA = 60

# --------------------------------------------------------------------------
# Seletores do ÁLBUM (/albums/<id>)
# --------------------------------------------------------------------------
# <img> de cada foto do álbum (vírgula = alternativas, como em CSS)
SELETOR_IMAGENS = "div.showalbum__children img, div.image__imagewrap img"
# Atributos onde procurar o URL, por ordem de preferência (o primeiro que existir ganha)
ATRIBUTOS_IMAGEM = ["data-origin-src", "data-src", "src"]
# Só se aceitam imagens deste domínio (exclui logótipos, ícones, etc.)
DOMINIO_IMAGENS = "photo.yupoo.com"
# Nomes de tamanho que o Yupoo usa no fim do URL: .../<hash>/medium.jpg
SUFIXOS_TAMANHO = ("square", "small", "medium", "big", "thumb")
# Quando só houver uma versão reduzida, troca-se pelo maior tamanho público
TAMANHO_MAXIMO = "big"

# Álbuns muito grandes podem ter paginação interna (?page=2). Se for o caso,
# defina o seletor do link "seguinte"; None = álbum numa só página.
SELETOR_ALBUM_PROXIMA = None       # ex.: "a.pagination__next"

# --------------------------------------------------------------------------
# Ficheiros
# --------------------------------------------------------------------------
FICHEIRO_ALBUNS = "albuns.csv"
FICHEIRO_SELECAO = "selecao.txt"
PASTA_CATALOGO = "catalogo"         # relativo a esta pasta, ou caminho completo (ex.: r"D:\Camisolas\catalogo")
FICHEIRO_PROGRESSO = ".progresso.json"
PASTA_CACHE_CAPAS = ".cache_capas"     # miniaturas do painel
PASTA_CACHE_CATEGORIAS = ".cache_categorias"  # álbuns de cada categoria (painel)
FICHEIRO_CATEGORIAS = "categorias.json"
PORTA_PAINEL = 47615              # porta do painel (http://127.0.0.1:47615); se estiver ocupada usa a seguinte livre
MAX_TITULO_PASTA = 80              # caracteres do título no nome da pasta

# --------------------------------------------------------------------------
# Definições escolhidas no painel (definicoes.json) — sobrepõem os valores acima
# --------------------------------------------------------------------------
import json as _json  # noqa: E402
import os as _os  # noqa: E402

FICHEIRO_DEFINICOES = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "definicoes.json")
PASTA_CATALOGO_PADRAO = PASTA_CATALOGO
try:
    with open(FICHEIRO_DEFINICOES, encoding="utf-8") as _f:
        _defs = _json.load(_f)
    if isinstance(_defs.get("pasta_catalogo"), str) and _defs["pasta_catalogo"].strip():
        PASTA_CATALOGO = _defs["pasta_catalogo"].strip()
except (OSError, ValueError, AttributeError):
    pass
