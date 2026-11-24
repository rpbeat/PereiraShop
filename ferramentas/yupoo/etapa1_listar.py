"""
ETAPA 1 — Lista todos os álbuns da loja para albuns.csv. NÃO descarrega imagens.

Uso:
    python etapa1_listar.py               # percorre todas as páginas
    python etapa1_listar.py --paginas 3   # só as 3 primeiras (para testar)

Saída: albuns.csv  (indice;titulo;fotos;url;id) — abre bem no Excel.
"""

from __future__ import annotations

import argparse
import csv
import sys

import comum
import config


def listar_todas(sessao, max_paginas: int) -> list[dict]:
    """Percorre ?page=1,2,3… até uma página não trazer álbuns novos."""
    albuns: list[dict] = []
    vistos: set[str] = set()
    for n in range(1, max_paginas + 1):
        url = comum.url_pagina(n)
        print(f"Página {n}: {url}")
        try:
            html = comum.obter(sessao, url, referer=config.REFERER).text
        except Exception as e:  # noqa: BLE001
            print(f"  ✗ Erro, a parar a listagem aqui: {e}")
            break

        novos = [a for a in comum.extrair_albuns(html) if a["id"] not in vistos]
        if not novos:
            # Página vazia ou repetida (o Yupoo devolve a última página para N alto) → fim
            print("  Sem álbuns novos — fim da listagem.")
            if n == 1:
                print("  ⚠ A PRIMEIRA página veio vazia: os seletores precisam de calibração.\n"
                      "    Corra:  python testar.py listagem --guardar-html   e veja o LEIA-ME.")
            break
        for a in novos:
            vistos.add(a["id"])
            albuns.append(a)
        print(f"  +{len(novos)} álbuns (total {len(albuns)})")
        comum.pausa(config.PAUSA_PAGINAS)
    return albuns


def guardar_csv(albuns: list[dict], caminho: str) -> None:
    # utf-8-sig + ';' para o Excel português abrir com acentos e colunas certas
    with open(caminho, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f, delimiter=";")
        w.writerow(["indice", "titulo", "fotos", "url", "id"])
        for i, a in enumerate(albuns, start=1):
            w.writerow([i, a["titulo"], a.get("fotos", ""), a["url"], a["id"]])


def main() -> int:
    ap = argparse.ArgumentParser(description="Etapa 1: listar álbuns para seleção")
    ap.add_argument("--paginas", type=int, default=config.MAX_PAGINAS, help="máximo de páginas a ler")
    args = ap.parse_args()

    sessao = comum.criar_sessao()
    albuns = listar_todas(sessao, args.paginas)
    if not albuns:
        print("Nenhum álbum encontrado. Nada gravado.")
        return 1
    guardar_csv(albuns, config.FICHEIRO_ALBUNS)
    print(f"\n✓ {len(albuns)} álbuns gravados em {config.FICHEIRO_ALBUNS}")
    print(f"  Próximo passo: escreva os índices que quer em {config.FICHEIRO_SELECAO} "
          f"(ex.: 3, 7, 12-15) e corra  python etapa2_baixar.py")
    return 0


if __name__ == "__main__":
    sys.exit(main())
