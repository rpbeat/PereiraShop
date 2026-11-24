"""Funções partilhadas: sessão HTTP, pausas, parsing de listagem e de álbum."""

from __future__ import annotations

import random
import re
import time
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
        albuns.append({
            "id": album_id,
            "fotos": nf.get_text(strip=True) if nf else "",
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


def nome_pasta(indice: int, titulo: str) -> str:
    """'{indice}_{titulo}' seguro para Windows (sem caracteres proibidos, sem ponto final)."""
    t = _INVALIDOS.sub(" ", titulo)
    t = re.sub(r"\s+", " ", t).strip(" .")[: config.MAX_TITULO_PASTA].strip(" .")
    return f"{indice:03d}_{t or 'album'}"


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
