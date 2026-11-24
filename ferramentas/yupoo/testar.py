"""
Testes rápidos dos seletores ANTES de correr em massa.

    python testar.py album https://minkang.x.yupoo.com/albums/123456?uid=1
    python testar.py listagem            # página 1 da listagem
    python testar.py listagem --pagina 2

Acrescente --guardar-html para gravar o HTML recebido (debug_*.html) e enviar para calibração.
Não descarrega imagens.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter

from bs4 import BeautifulSoup

import comum
import config


def testar_album(url: str, guardar_html: bool = False) -> int:
    """Imprime quantas imagens os seletores encontram num álbum e mostra as primeiras."""
    sessao = comum.criar_sessao()
    r = comum.obter(sessao, url, referer=config.REFERER)
    print(f"HTTP {r.status_code} · {len(r.text):,} caracteres")
    if guardar_html:
        open("debug_album.html", "w", encoding="utf-8").write(r.text)
        print("HTML gravado em debug_album.html")

    imgs = comum.extrair_imagens(r.text)
    print(f"\nImagens encontradas: {len(imgs)}")
    for u in imgs[:5]:
        print(f"  {u}")

    if not imgs:
        diagnostico_imgs(r.text)
    return 0 if imgs else 1


def testar_listagem(pagina: int, guardar_html: bool = False) -> int:
    """Imprime quantos álbuns os seletores encontram numa página de listagem."""
    sessao = comum.criar_sessao()
    url = comum.url_pagina(pagina)
    r = comum.obter(sessao, url, referer=config.REFERER)
    print(f"{url}\nHTTP {r.status_code} · {len(r.text):,} caracteres")
    if guardar_html:
        open("debug_listagem.html", "w", encoding="utf-8").write(r.text)
        print("HTML gravado em debug_listagem.html")

    albuns = comum.extrair_albuns(r.text)
    print(f"\nÁlbuns encontrados: {len(albuns)}")
    for a in albuns[:5]:
        print(f"  [{a['id']}] {a['titulo']}\n      {a['url']}")

    if not albuns:
        diagnostico_links(r.text)
    return 0 if albuns else 1


# --- pistas para calibrar quando volta vazio -------------------------------

def diagnostico_links(html: str) -> None:
    sopa = BeautifulSoup(html, "html.parser")
    links = [a for a in sopa.find_all("a", href=True) if "/albums/" in a["href"]]
    print(f"\n[diagnóstico] <a> com '/albums/' no href: {len(links)}")
    classes = Counter(" ".join(a.get("class", [])) or "(sem classe)" for a in links)
    for c, n in classes.most_common(5):
        print(f"  classe '{c}': {n}")
    if links:
        print(f"  exemplo: {str(links[0])[:300]}")
    if len(html) < 3000 or not links:
        print("  A página parece vazia ou carregada por JavaScript → ver alternativa gallery-dl no LEIA-ME.")


def diagnostico_imgs(html: str) -> None:
    sopa = BeautifulSoup(html, "html.parser")
    imgs = sopa.find_all("img")
    print(f"\n[diagnóstico] <img> na página: {len(imgs)}")
    attrs = Counter(k for i in imgs for k, v in i.attrs.items() if isinstance(v, str) and "yupoo" in v)
    for k, n in attrs.most_common(6):
        print(f"  atributo '{k}' com URL yupoo: {n}")
    pais = Counter(" ".join(i.parent.get("class", [])) or i.parent.name for i in imgs if i.parent)
    for c, n in pais.most_common(5):
        print(f"  pai do <img> '{c}': {n}")
    exemplo = next((i for i in imgs if "photo.yupoo.com" in str(i)), None)
    if exemplo:
        print(f"  exemplo: {str(exemplo)[:400]}")


def main() -> int:
    ap = argparse.ArgumentParser(description="Testar seletores Yupoo")
    sub = ap.add_subparsers(dest="modo", required=True)
    a = sub.add_parser("album", help="testar um álbum")
    a.add_argument("url")
    a.add_argument("--guardar-html", action="store_true")
    l = sub.add_parser("listagem", help="testar a listagem")
    l.add_argument("--pagina", type=int, default=1)
    l.add_argument("--guardar-html", action="store_true")
    args = ap.parse_args()

    if args.modo == "album":
        return testar_album(args.url, args.guardar_html)
    return testar_listagem(args.pagina, args.guardar_html)


if __name__ == "__main__":
    sys.exit(main())
