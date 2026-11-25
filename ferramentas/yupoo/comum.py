"""Funções partilhadas: sessão HTTP, pausas, parsing de listagem e de álbum."""

from __future__ import annotations

import random
import re
import time
import unicodedata
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

import config


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def criar_sessao() -> requests.Session:
    """Sessão com cabeçalhos de browser (reaproveita ligações e cookies)."""
    s = requests.Session()
    s.headers.update(config.HEADERS)
    return s


def pausa(intervalo: tuple[float, float]) -> None:
    """Dorme um tempo aleatório dentro do intervalo, para não martelar o servidor."""
    time.sleep(random.uniform(*intervalo))


def obter(sessao: requests.Session, url: str, referer: str | None = None,
          stream: bool = False) -> requests.Response:
    """
    GET com novas tentativas e espera progressiva.
    Levanta exceção se todas as tentativas falharem.
    """
    headers = {"Referer": referer} if referer else {}
    ultimo_erro: Exception | None = None
    for tentativa in range(1, config.TENTATIVAS + 1):
        try:
            r = sessao.get(url, headers=headers, timeout=config.TIMEOUT, stream=stream)
            # 429 = demasiados pedidos; 5xx = erro do servidor → esperar e repetir
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}", response=r)
            r.raise_for_status()
            return r
        except requests.RequestException as e:
            ultimo_erro = e
            espera = 5 * tentativa + random.uniform(0, 3)
            print(f"    ! {e} — tentativa {tentativa}/{config.TENTATIVAS}, a aguardar {espera:.0f}s")
            time.sleep(espera)
    raise RuntimeError(f"Falhou após {config.TENTATIVAS} tentativas: {url}") from ultimo_erro


def url_pagina(n: int) -> str:
    return f"{config.BASE_URL}{config.LISTAGEM_PATH}?{config.PARAM_PAGINA}={n}"


def url_categoria(cat_id: str, sub: bool, n: int) -> str:
    extra = "isSubCate=true&" if sub else ""
    return f"{config.BASE_URL}/categories/{cat_id}?{extra}{config.PARAM_PAGINA}={n}"


# ---------------------------------------------------------------------------
# Categorias
# ---------------------------------------------------------------------------

def extrair_categorias(html: str) -> list[dict]:
    """
    Árvore de categorias do menu do site:
      [{'id', 'nome', 'filhos': [{'id', 'nome'}, …]}, …]
    """
    sopa = BeautifulSoup(html, "html.parser")
    padrao = re.compile(config.PADRAO_URL_CATEGORIA)
    cats: list[dict] = []
    vistos: set[str] = set()
    for li in sopa.select(config.SELETOR_CATEGORIA_ITEM):
        a = li.select_one(config.SELETOR_CATEGORIA_LINK)
        m = padrao.search(a.get("href") or "") if a else None
        if not m or m.group(1) in vistos:
            continue
        vistos.add(m.group(1))
        filhos: list[dict] = []
        f_vistos: set[str] = set()
        for fa in li.select(config.SELETOR_SUBCATEGORIA_LINK):
            fm = padrao.search(fa.get("href") or "")
            if fm and fm.group(1) not in f_vistos:
                f_vistos.add(fm.group(1))
                filhos.append({"id": fm.group(1), "nome": fa.get_text(" ", strip=True)})
        cats.append({"id": m.group(1), "nome": a.get_text(" ", strip=True), "filhos": filhos})
    return cats


def listar_categoria(sessao: requests.Session, cat_id: str, sub: bool,
                     log=print, parar=lambda: False) -> tuple[list[dict], str]:
    """
    Todos os álbuns de uma categoria (percorre ?page=N até não haver novos).
    Devolve (albuns, html_da_primeira_pagina) — o HTML serve para diagnóstico se vier vazio.
    """
    albuns: list[dict] = []
    vistos: set[str] = set()
    primeiro_html = ""
    for n in range(1, config.MAX_PAGINAS_CATEGORIA + 1):
        if parar():
            break
        html = obter(sessao, url_categoria(cat_id, sub, n), referer=config.REFERER).text
        if n == 1:
            primeiro_html = html
        novos = [a for a in extrair_albuns(html) if a["id"] not in vistos]
        if not novos:
            break
        for a in novos:
            vistos.add(a["id"])
            albuns.append(a)
        log(f"  página {n}: +{len(novos)} (total {len(albuns)})")
        pausa(config.PAUSA_PAGINAS)
    return albuns, primeiro_html


# ---------------------------------------------------------------------------
# Listagem
# ---------------------------------------------------------------------------

def extrair_albuns(html: str) -> list[dict]:
    """
    Devolve [{'id', 'titulo', 'url'}] de uma página de listagem.
    Usa SELETOR_ALBUM_LINK + PADRAO_URL_ALBUM do config.
    """
    sopa = BeautifulSoup(html, "html.parser")
    padrao = re.compile(config.PADRAO_URL_ALBUM)
    albuns: list[dict] = []
    vistos: set[str] = set()
    for a in sopa.select(config.SELETOR_ALBUM_LINK):
        href = a.get("href") or ""
        m = padrao.search(href)
        if not m:
            continue
        album_id = m.group(1)
        if album_id in vistos:
            continue
        vistos.add(album_id)
        titulo = (a.get(config.ATRIBUTO_TITULO) or "").strip()
        if not titulo:
            el = a.select_one(config.SELETOR_ALBUM_TITULO)
            titulo = el.get_text(" ", strip=True) if el else a.get_text(" ", strip=True)
        nf = a.select_one(config.SELETOR_ALBUM_NFOTOS) if config.SELETOR_ALBUM_NFOTOS else None
        img = a.select_one(config.SELETOR_ALBUM_CAPA) if config.SELETOR_ALBUM_CAPA else None
        capa = next((img.get(k) for k in config.ATRIBUTOS_IMAGEM if img is not None and img.get(k)), "") or ""
        albuns.append({
            "id": album_id,
            "fotos": nf.get_text(strip=True) if nf else "",
            "capa": normalizar_url(capa) if capa else "",
            "titulo": titulo or f"album_{album_id}",
            "url": f"{config.BASE_URL}/albums/{album_id}?uid=1",
        })
    return albuns


# ---------------------------------------------------------------------------
# Álbum
# ---------------------------------------------------------------------------

def normalizar_url(u: str) -> str:
    """'//photo.yupoo.com/...' → 'https://photo.yupoo.com/...'"""
    u = u.strip()
    if u.startswith("//"):
        return "https:" + u
    return u


def chave_foto(u: str) -> str:
    """Identificador de uma foto do Yupoo, igual em todos os tamanhos:
       https://photo.yupoo.com/<loja>/<hash>/medium.jpg → '<hash>'"""
    partes = [x for x in urlparse(normalizar_url(u)).path.split("/") if x]
    return partes[1].lower() if len(partes) >= 3 else ""


def indice_capa(imagens: list[str], capa: str) -> int | None:
    """Posição (0…) da foto de capa do álbum na lista de imagens, ou None se não estiver lá."""
    chave = chave_foto(capa) if capa else ""
    if not chave:
        return None
    return next((k for k, u in enumerate(imagens) if chave_foto(u) == chave), None)


def marcar_principal(prog: dict, capa: str) -> bool:
    """Grava no progresso do álbum qual é a foto principal (a capa do Yupoo).
       'principal' = nome do ficheiro (ex.: '007.jpg'). Devolve True se mudou alguma coisa."""
    k = indice_capa(prog.get("imagens") or [], capa)
    if k is None:
        return False
    num = f"{k + 1:03d}"
    ficheiro = (prog.get("feitas") or {}).get(num, "")
    novo = {"capa_url": capa, "principal_num": num, "principal": ficheiro}
    if all(prog.get(c) == v for c, v in novo.items()):
        return False
    prog.update(novo)
    return True


def para_original(u: str) -> str:
    """
    Converte um URL de tamanho reduzido no maior disponível.
      https://photo.yupoo.com/<loja>/<hash>/medium.jpg → .../<hash>/big.jpg
    URLs que já não terminem num sufixo de tamanho (ex.: data-origin-src) ficam iguais.
    """
    p = urlparse(u)
    partes = p.path.rsplit("/", 1)
    if len(partes) == 2:
        nome, _, ext = partes[1].partition(".")
        if nome.lower() in config.SUFIXOS_TAMANHO:
            novo = f"{partes[0]}/{config.TAMANHO_MAXIMO}.{ext or 'jpg'}"
            return urlunparse(p._replace(path=novo, query=""))
    return u


def extrair_imagens(html: str) -> list[str]:
    """
    Devolve os URLs (tamanho original) das fotos de um álbum, pela ordem da página.
    Para cada <img> de SELETOR_IMAGENS usa o primeiro atributo de ATRIBUTOS_IMAGEM que exista.
    """
    sopa = BeautifulSoup(html, "html.parser")
    urls: list[str] = []
    vistos: set[str] = set()
    for img in sopa.select(config.SELETOR_IMAGENS):
        bruto = next((img.get(a) for a in config.ATRIBUTOS_IMAGEM if img.get(a)), None)
        if not bruto:
            continue
        u = para_original(normalizar_url(bruto))
        if config.DOMINIO_IMAGENS not in u:
            continue
        # Chave sem o nome do ficheiro: evita a mesma foto em dois tamanhos
        chave = u.rsplit("/", 1)[0]
        if chave in vistos:
            continue
        vistos.add(chave)
        urls.append(u)
    return urls


def proxima_pagina_album(html: str, url_atual: str) -> str | None:
    """Se o álbum tiver paginação interna (SELETOR_ALBUM_PROXIMA), devolve o URL seguinte."""
    if not config.SELETOR_ALBUM_PROXIMA:
        return None
    a = BeautifulSoup(html, "html.parser").select_one(config.SELETOR_ALBUM_PROXIMA)
    href = a.get("href") if a else None
    return urljoin(url_atual, href) if href else None


def imagens_do_album(sessao: requests.Session, url: str) -> list[str]:
    """Lê o álbum (incluindo páginas internas, se configuradas) e devolve todas as imagens."""
    todas: list[str] = []
    atual: str | None = url
    paginas = 0
    while atual and paginas < 50:
        html = obter(sessao, atual, referer=config.REFERER).text
        for u in extrair_imagens(html):
            if u not in todas:
                todas.append(u)
        atual = proxima_pagina_album(html, atual)
        paginas += 1
        if atual:
            pausa(config.PAUSA_PAGINAS)
    return todas


# ---------------------------------------------------------------------------
# Utilitários
# ---------------------------------------------------------------------------

_INVALIDOS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def texto_pasta(texto: str, maximo: int = 0) -> str:
    """Texto seguro para nome de pasta no Windows: sem emojis/símbolos, sem caracteres proibidos."""
    t = unicodedata.normalize("NFC", texto)  # acentos compostos, para não se perderem a seguir
    # remove símbolos/emojis (S*), controlo/ZWJ (C*) e seletores de variante de emoji (Mn)
    t = "".join(c for c in t if c == " " or not unicodedata.category(c).startswith(("S", "C", "Mn")))
    t = _INVALIDOS.sub(" ", t)
    t = re.sub(r"\s+", " ", t).strip(" .")
    if maximo:
        t = t[:maximo].strip(" .")
    return t


def nome_pasta(indice: int, titulo: str) -> str:
    """'{indice}_{titulo}' seguro para Windows."""
    return f"{indice:03d}_{texto_pasta(titulo, config.MAX_TITULO_PASTA) or 'album'}"


def extensao(url: str, content_type: str | None) -> str:
    """Extensão a partir do URL ou, em último caso, do Content-Type."""
    m = re.search(r"\.(jpe?g|png|webp|gif)$", urlparse(url).path, re.I)
    if m:
        e = m.group(1).lower()
        return "jpg" if e == "jpeg" else e
    ct = (content_type or "").lower()
    for k, v in (("png", "png"), ("webp", "webp"), ("gif", "gif")):
        if k in ct:
            return v
    return "jpg"
