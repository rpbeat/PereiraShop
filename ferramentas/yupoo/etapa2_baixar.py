"""
ETAPA 2 — Descarrega APENAS os álbuns escolhidos em selecao.txt.

selecao.txt aceita índices de albuns.csv separados por vírgulas, espaços ou linhas,
e intervalos:   3, 7, 12-15
Linhas começadas por # são ignoradas.

Uso:
    python etapa2_baixar.py
    python etapa2_baixar.py --simular     # mostra o que faria, sem descarregar

Saída: catalogo/{indice}_{titulo}/001.jpg, 002.jpg …  + .progresso.json por álbum.
Pode ser interrompido (Ctrl+C) e corrido de novo: retoma onde parou.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from pathlib import Path

import comum
import config


# ---------------------------------------------------------------------------
# Leitura de ficheiros
# ---------------------------------------------------------------------------

def ler_albuns(caminho: str) -> dict[int, dict]:
    """albuns.csv → {indice: {'titulo', 'url', 'id'}}"""
    if not os.path.exists(caminho):
        sys.exit(f"Não encontrei {caminho}. Corra primeiro: python etapa1_listar.py")
    albuns: dict[int, dict] = {}
    with open(caminho, encoding="utf-8-sig", newline="") as f:
        for linha in csv.DictReader(f, delimiter=";"):
            albuns[int(linha["indice"])] = {"titulo": linha["titulo"], "url": linha["url"], "id": linha["id"],
                                            "capa": linha.get("capa", "")}
    return albuns


def ler_selecao(caminho: str) -> list[int]:
    """'3, 7, 12-15' → [3, 7, 12, 13, 14, 15] (sem repetidos, pela ordem escrita)."""
    if not os.path.exists(caminho):
        sys.exit(f"Não encontrei {caminho}. Crie-o com os índices a descarregar (ex.: 3, 7, 12-15).")
    texto = "\n".join(l.split("#", 1)[0] for l in Path(caminho).read_text(encoding="utf-8-sig").splitlines())
    indices: list[int] = []
    for parte in re.split(r"[,\s;]+", texto):
        if not parte:
            continue
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", parte) or re.fullmatch(r"(\d+)-(\d+)", parte)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            gama = range(a, b + 1) if a <= b else range(a, b - 1, -1)
        elif parte.isdigit():
            gama = [int(parte)]
        else:
            print(f"  ! Ignorado em {caminho}: '{parte}'")
            continue
        for i in gama:
            if i not in indices:
                indices.append(i)
    return indices


# ---------------------------------------------------------------------------
# Progresso por álbum
# ---------------------------------------------------------------------------

def pasta_existente(album_id: str) -> Path | None:
    """
    Procura uma pasta já criada para este álbum (pelo id guardado no .progresso.json).
    Assim, se os índices mudarem numa nova listagem, não se cria uma pasta duplicada.
    """
    raiz = Path(config.PASTA_CATALOGO)
    if not raiz.exists():
        return None
    for prog in raiz.rglob(config.FICHEIRO_PROGRESSO):
        try:
            if json.loads(prog.read_text(encoding="utf-8")).get("album_id") == album_id:
                return prog.parent
        except (OSError, json.JSONDecodeError):
            continue
    return None


def ler_progresso(pasta: Path) -> dict:
    p = pasta / config.FICHEIRO_PROGRESSO
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass
    return {}


def gravar_progresso(pasta: Path, dados: dict) -> None:
    p = pasta / config.FICHEIRO_PROGRESSO
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, p)  # escrita atómica: nunca fica um JSON a meio


# ---------------------------------------------------------------------------
# Download
# ---------------------------------------------------------------------------

def descarregar_imagem(sessao, url: str, destino_sem_ext: Path, referer: str) -> Path:
    """Descarrega para um .part e só no fim renomeia — um ficheiro final está sempre completo."""
    r = comum.obter(sessao, url, referer=referer, stream=True)
    ct = r.headers.get("Content-Type", "")
    if "image" not in ct:
        r.close()
        raise RuntimeError(f"resposta não é imagem ({ct or 'sem Content-Type'})")
    destino = destino_sem_ext.with_suffix("." + comum.extensao(url, ct))
    parcial = destino.with_suffix(destino.suffix + ".part")
    with open(parcial, "wb") as f:
        for bloco in r.iter_content(64 * 1024):
            f.write(bloco)
    if parcial.stat().st_size == 0:
        parcial.unlink(missing_ok=True)
        raise RuntimeError("ficheiro vazio")
    os.replace(parcial, destino)
    return destino


def processar_album(sessao, indice: int, album: dict, simular: bool,
                    log=print, parar=lambda: False, pasta_destino: Path | None = None) -> tuple[int, int]:
    """Descarrega um álbum. Devolve (imagens_ok, imagens_com_erro).
    log/parar permitem usar a função a partir do painel."""
    # Se o álbum já foi (parcialmente) descarregado, continua na mesma pasta, esteja onde estiver
    pasta = (pasta_existente(album["id"]) or pasta_destino
             or Path(config.PASTA_CATALOGO) / comum.nome_pasta(indice, album["titulo"]))
    prog = ler_progresso(pasta) if pasta.exists() else {}

    if prog.get("concluido"):
        if album.get("capa") and comum.marcar_principal(prog, album["capa"]):
            gravar_progresso(pasta, prog)
        log(f"  ✓ já concluído em {pasta.name} — a saltar")
        return 0, 0

    # Lista de imagens: reutiliza a guardada (mantém a numeração estável ao retomar)
    imagens: list[str] = prog.get("imagens") or []
    if not imagens:
        imagens = comum.imagens_do_album(sessao, album["url"])
    log(f"  {len(imagens)} imagens → {pasta}")
    if not imagens:
        log("  ⚠ 0 imagens: verifique os seletores com  python testar.py album <url>")
        return 0, 1
    if simular:
        for u in imagens[:3]:
            log(f"    {u}")
        return 0, 0

    pasta.mkdir(parents=True, exist_ok=True)
    feitas: dict[str, str] = prog.get("feitas", {})
    prog.update({"album_id": album["id"], "indice": indice, "titulo": album["titulo"],
                 "url": album["url"], "imagens": imagens, "feitas": feitas})
    gravar_progresso(pasta, prog)

    ok = erros = 0
    for n, url in enumerate(imagens, start=1):
        if parar():
            log("  Interrompido — retoma na próxima vez.")
            break
        num = f"{n:03d}"
        ficheiro = feitas.get(num)
        if ficheiro and (pasta / ficheiro).exists() and (pasta / ficheiro).stat().st_size > 0:
            continue  # já descarregada
        try:
            destino = descarregar_imagem(sessao, url, pasta / num, referer=album["url"])
            feitas[num] = destino.name
            gravar_progresso(pasta, prog)
            ok += 1
            log(f"    {num} ✓")
        except Exception as e:  # noqa: BLE001 — uma imagem com erro não pára o álbum
            erros += 1
            log(f"    {num} ✗ {e}")
        comum.pausa(config.PAUSA_IMAGENS)

    prog["concluido"] = len(feitas) == len(imagens)
    # a capa do álbum no Yupoo é a foto principal: fica marcada para a importação no backoffice
    if album.get("capa") and comum.marcar_principal(prog, album["capa"]):
        log(f"    ★ foto principal (capa do Yupoo): {prog['principal'] or prog['principal_num']}")
    gravar_progresso(pasta, prog)
    return ok, erros


def main() -> int:
    ap = argparse.ArgumentParser(description="Etapa 2: descarregar os álbuns selecionados")
    ap.add_argument("--simular", action="store_true", help="lista o que faria sem descarregar")
    args = ap.parse_args()

    albuns = ler_albuns(config.FICHEIRO_ALBUNS)
    selecao = ler_selecao(config.FICHEIRO_SELECAO)
    validos = [i for i in selecao if i in albuns]
    for i in selecao:
        if i not in albuns:
            print(f"! Índice {i} não existe em {config.FICHEIRO_ALBUNS}")
    if not validos:
        print("Nada para descarregar.")
        return 1

    print(f"{len(validos)} álbuns selecionados.\n")
    sessao = comum.criar_sessao()
    total_ok = total_erros = 0
    try:
        for k, i in enumerate(validos, start=1):
            a = albuns[i]
            print(f"[{k}/{len(validos)}] #{i} {a['titulo']}")
            try:
                ok, erros = processar_album(sessao, i, a, args.simular)
                total_ok += ok
                total_erros += erros
            except Exception as e:  # noqa: BLE001 — um álbum com erro não pára os outros
                total_erros += 1
                print(f"  ✗ Erro no álbum: {e}")
            if k < len(validos):
                comum.pausa(config.PAUSA_ALBUNS)
    except KeyboardInterrupt:
        print("\nInterrompido. Corra de novo para retomar.")
        return 130

    print(f"\nFim: {total_ok} imagens descarregadas, {total_erros} erros.")
    if total_erros:
        print("Corra de novo para tentar só o que falhou.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
