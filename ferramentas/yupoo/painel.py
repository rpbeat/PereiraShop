"""
Painel local para escolher e descarregar álbuns do Yupoo.

    py painel.py

Abre http://127.0.0.1:47615 no browser (porta em config.PORTA_PAINEL). O servidor só aceita ligações deste PC.
Para fechar: Ctrl+C nesta janela.

Reaproveita as funções das etapas 1 e 2 (mesmos seletores do config.py,
mesmas pastas catalogo/{indice}_{titulo}/ e o mesmo .progresso.json).
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

AQUI = Path(__file__).resolve().parent
os.chdir(AQUI)
sys.path.insert(0, str(AQUI))

import comum  # noqa: E402
import config  # noqa: E402
import etapa1_listar as e1  # noqa: E402
import etapa2_baixar as e2  # noqa: E402

HTML = AQUI / "painel.html"
CACHE = AQUI / config.PASTA_CACHE_CAPAS
CACHE_CAT = AQUI / config.PASTA_CACHE_CATEGORIAS


# ---------------------------------------------------------------------------
# Trabalho em segundo plano (só um de cada vez: listar OU descarregar)
# ---------------------------------------------------------------------------

class Trabalho:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.tipo = ""          # "listar" | "baixar"
        self.ativo = False
        self.parar = False
        self.total = 0
        self.feitos = 0
        self.imagens = 0
        self.erros = 0
        self.atual = ""
        self.log: list[str] = []
        self.seq = 0            # muda sempre que um trabalho termina (o browser recarrega estados)

    def registar(self, msg: str) -> None:
        with self.lock:
            for linha in str(msg).splitlines() or [""]:
                self.log.append(f"{time.strftime('%H:%M:%S')}  {linha}")
            del self.log[:-400]

    def iniciar(self, tipo: str, total: int) -> bool:
        with self.lock:
            if self.ativo:
                return False
            self.tipo, self.ativo, self.parar = tipo, True, False
            self.total, self.feitos, self.imagens, self.erros, self.atual = total, 0, 0, 0, ""
            self.log = []
            return True

    def terminar(self) -> None:
        with self.lock:
            self.ativo = False
            self.atual = ""
            self.seq += 1

    def estado(self) -> dict:
        with self.lock:
            return {
                "tipo": self.tipo, "ativo": self.ativo, "parar": self.parar,
                "total": self.total, "feitos": self.feitos, "imagens": self.imagens,
                "erros": self.erros, "atual": self.atual, "log": self.log[-200:], "seq": self.seq,
            }


TRAB = Trabalho()


def job_listar() -> None:
    try:
        TRAB.registar("A ler a listagem do Yupoo…")
        albuns = e1.listar_todas(comum.criar_sessao(), config.MAX_PAGINAS,
                                 log=TRAB.registar, parar=lambda: TRAB.parar)
        if albuns and not TRAB.parar:
            e1.guardar_csv(albuns, config.FICHEIRO_ALBUNS)
            TRAB.registar(f"✓ {len(albuns)} álbuns gravados em {config.FICHEIRO_ALBUNS}")
        elif not albuns:
            TRAB.erros += 1
            TRAB.registar("Nenhum álbum encontrado — a listagem anterior foi mantida.")
        else:
            TRAB.registar("Listagem interrompida — a listagem anterior foi mantida.")
    except Exception as e:  # noqa: BLE001
        TRAB.erros += 1
        TRAB.registar(f"✗ Erro: {e}")
    finally:
        TRAB.terminar()


def destino_album(a: dict) -> Path | None:
    """
    Pasta de destino:
      - álbum vindo de uma categoria → catalogo/<Categoria>/<Subcategoria>/<Título>/
      - álbum da listagem geral      → None (a etapa 2 usa catalogo/<indice>_<Título>/)
    """
    cats = [comum.texto_pasta(c, 60) for c in a.get("categoria") or []]
    cats = [c for c in cats if c]
    if not cats:
        return None
    base = Path(config.PASTA_CATALOGO).joinpath(*cats)
    nome = comum.texto_pasta(a["titulo"], config.MAX_TITULO_PASTA) or f"album {a['id']}"
    pasta = base / nome
    prog = pasta / config.FICHEIRO_PROGRESSO
    if pasta.exists() and prog.exists():
        try:
            if json.loads(prog.read_text(encoding="utf-8")).get("album_id") != a["id"]:
                pasta = base / f"{nome} ({a['id']})"  # outro álbum com o mesmo título
        except (OSError, json.JSONDecodeError):
            pass
    return pasta


def job_baixar(sel: list[dict]) -> None:
    try:
        indices = {x["id"]: x["indice"] for x in ALBUNS.todos()}
        sessao = comum.criar_sessao()
        for k, a in enumerate(sel, start=1):
            if TRAB.parar:
                TRAB.registar("Interrompido. Os álbuns em falta retomam na próxima vez.")
                break
            TRAB.atual = a["titulo"]
            onde = " › ".join(a.get("categoria") or []) or "listagem geral"
            TRAB.registar(f"[{k}/{len(sel)}] {a['titulo']}  ({onde})")
            try:
                ok, erros = e2.processar_album(
                    sessao, int(indices.get(a["id"]) or 0), {"titulo": a["titulo"], "url": a["url"], "id": a["id"]},
                    False, log=TRAB.registar, parar=lambda: TRAB.parar, pasta_destino=destino_album(a))
                TRAB.imagens += ok
                TRAB.erros += erros
            except Exception as e:  # noqa: BLE001 — um álbum com erro não pára os outros
                TRAB.erros += 1
                TRAB.registar(f"  ✗ Erro no álbum: {e}")
            TRAB.feitos = k
            if k < len(sel) and not TRAB.parar:
                comum.pausa(config.PAUSA_ALBUNS)
        TRAB.registar(f"Fim: {TRAB.imagens} imagens descarregadas, {TRAB.erros} erros.")
    finally:
        TRAB.terminar()


# ---------------------------------------------------------------------------
# Dados: albuns.csv (recarregado quando o ficheiro muda) e estado dos downloads
# ---------------------------------------------------------------------------

# id do álbum → URL da capa (da listagem geral e das categorias já abertas)
CAPAS: dict[str, str] = {}


class Albuns:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._mtime = -1.0
        self._lista: list[dict] = []

    def todos(self) -> list[dict]:
        p = Path(config.FICHEIRO_ALBUNS)
        m = p.stat().st_mtime if p.exists() else 0.0
        with self._lock:
            if m != self._mtime:
                self._lista = []
                if p.exists():
                    with open(p, encoding="utf-8-sig", newline="") as f:
                        for r in csv.DictReader(f, delimiter=";"):
                            self._lista.append({
                                "indice": int(r.get("indice") or 0),
                                "titulo": r.get("titulo", ""),
                                "fotos": r.get("fotos", ""),
                                "url": r.get("url", ""),
                                "id": r.get("id", ""),
                                "capa": r.get("capa", ""),
                            })
                self._mtime = m
                for a in self._lista:
                    if a["capa"]:
                        CAPAS[a["id"]] = a["capa"]
            return list(self._lista)


ALBUNS = Albuns()


_cat_lock = threading.Lock()   # um pedido de categoria de cada vez


def carregar_categorias(atualizar: bool = False) -> dict:
    """Árvore de categorias (lida do menu do site e guardada em categorias.json)."""
    p = Path(config.FICHEIRO_CATEGORIAS)
    if p.exists() and not atualizar:
        return json.loads(p.read_text(encoding="utf-8"))
    with _cat_lock:
        html = comum.obter(comum.criar_sessao(), comum.url_pagina(1), referer=config.REFERER).text
    cats = comum.extrair_categorias(html)
    if not cats:
        Path("debug_categorias.html").write_text(html, encoding="utf-8")
        raise RuntimeError("Não encontrei categorias no menu do site (HTML gravado em debug_categorias.html).")
    dados = {"atualizado": time.strftime("%d/%m/%Y %H:%M"), "categorias": cats}
    p.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    return dados


def albuns_categoria(cat_id: str, sub: bool, atualizar: bool = False) -> dict:
    """Álbuns de uma categoria, com cache em disco (.cache_categorias/<id>.json)."""
    CACHE_CAT.mkdir(exist_ok=True)
    f = CACHE_CAT / f"{cat_id}.json"
    if f.exists() and not atualizar:
        dados = json.loads(f.read_text(encoding="utf-8"))
    else:
        with _cat_lock:
            albuns, html = comum.listar_categoria(comum.criar_sessao(), cat_id, sub, log=lambda *_: None)
        if not albuns and html:
            Path("debug_categoria.html").write_text(html, encoding="utf-8")
        dados = {"atualizado": time.strftime("%d/%m/%Y %H:%M"), "albuns": albuns}
        f.write_text(json.dumps(dados, ensure_ascii=False), encoding="utf-8")
    for a in dados["albuns"]:
        if a.get("capa"):
            CAPAS[a["id"]] = a["capa"]
    return dados


def pasta_catalogo() -> Path:
    """Pasta de destino atual, como caminho completo."""
    return Path(config.PASTA_CATALOGO).expanduser().resolve()


def mudar_pasta_catalogo(nova: str) -> Path:
    """Valida, cria e grava a nova pasta de destino (definicoes.json)."""
    nova = nova.strip().strip('"')
    if not nova:
        # vazio = voltar à predefinição
        destino = Path(config.PASTA_CATALOGO_PADRAO)
        valor = ""
    else:
        destino = Path(nova).expanduser()
        if not destino.is_absolute():
            raise ValueError("Indique o caminho completo, por exemplo D:\\Camisolas\\catalogo")
        valor = str(destino)
    destino = destino.resolve()
    if destino == destino.parent or destino == Path.home().resolve():
        raise ValueError("Escolha uma pasta própria para o catálogo (não a raiz do disco nem a pasta do utilizador).")
    destino.mkdir(parents=True, exist_ok=True)
    teste = destino / ".teste_escrita"
    teste.write_text("ok", encoding="utf-8")  # confirma que se pode escrever lá
    teste.unlink()
    try:
        defs = json.loads(Path(config.FICHEIRO_DEFINICOES).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        defs = {}
    if valor:
        defs["pasta_catalogo"] = valor
    else:
        defs.pop("pasta_catalogo", None)
    Path(config.FICHEIRO_DEFINICOES).write_text(json.dumps(defs, ensure_ascii=False, indent=2), encoding="utf-8")
    config.PASTA_CATALOGO = valor or config.PASTA_CATALOGO_PADRAO
    return destino


def estados_download() -> dict:
    """{album_id: {concluido, feitas, total, pasta}} a partir dos .progresso.json."""
    res: dict[str, dict] = {}
    for p in Path(config.PASTA_CATALOGO).rglob(config.FICHEIRO_PROGRESSO):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        aid = str(d.get("album_id") or "")
        if aid:
            res[aid] = {
                "concluido": bool(d.get("concluido")),
                "feitas": len(d.get("feitas") or {}),
                "total": len(d.get("imagens") or []),
                "pasta": p.parent.name,
            }
    return res


# ---------------------------------------------------------------------------
# Miniaturas: proxy com cache em disco (o photo.yupoo.com exige Referer)
# ---------------------------------------------------------------------------

_capas_sem = threading.Semaphore(3)   # no máximo 3 pedidos de capa em simultâneo
_tls = threading.local()


def _sessao_thread():
    if not hasattr(_tls, "s"):
        _tls.s = comum.criar_sessao()
    return _tls.s


def obter_capa(album_id: str) -> tuple[bytes, str] | None:
    if album_id not in CAPAS:
        ALBUNS.todos()  # garante que as capas da listagem geral estão registadas
    url = CAPAS.get(album_id, "")
    if not url or config.DOMINIO_IMAGENS not in url:
        return None
    CACHE.mkdir(exist_ok=True)
    ext = comum.extensao(url, None)
    f = CACHE / f"{album_id}.{ext}"
    tipo = "image/png" if ext == "png" else "image/webp" if ext == "webp" else "image/jpeg"
    if f.exists() and f.stat().st_size > 0:
        return f.read_bytes(), tipo
    with _capas_sem:
        if f.exists() and f.stat().st_size > 0:
            return f.read_bytes(), tipo
        r = _sessao_thread().get(url, headers={"Referer": config.REFERER}, timeout=config.TIMEOUT)
        if r.status_code != 200 or "image" not in r.headers.get("Content-Type", ""):
            return None
        f.write_bytes(r.content)
        time.sleep(0.3)  # gentileza com o servidor
        return r.content, r.headers.get("Content-Type", tipo)


# ---------------------------------------------------------------------------
# Servidor HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "PainelYupoo/1.0"

    def log_message(self, *_a) -> None:  # silencioso
        pass

    def _json(self, dados, status: int = 200) -> None:
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def _corpo(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return {}

    def _origem_ok(self) -> bool:
        # Só aceita pedidos POST vindos da própria página (evita que outro site acione downloads)
        origem = self.headers.get("Origin") or ""
        return origem in ("", f"http://127.0.0.1:{self.server.server_port}", f"http://localhost:{self.server.server_port}")

    def do_GET(self) -> None:  # noqa: N802
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            corpo = HTML.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(corpo)))
            self.end_headers()
            self.wfile.write(corpo)
        elif u.path == "/api/albuns":
            lista = ALBUNS.todos()
            p = Path(config.FICHEIRO_ALBUNS)
            self._json({
                "albuns": [{k: a[k] for k in ("indice", "titulo", "fotos", "url", "id")} | {"temCapa": bool(a["capa"])}
                           for a in lista],
                "estados": estados_download(),
                "atualizado": time.strftime("%d/%m/%Y %H:%M", time.localtime(p.stat().st_mtime)) if p.exists() else "",
            })
        elif u.path == "/api/estado":
            self._json(TRAB.estado())
        elif u.path == "/api/definicoes":
            self._json({"pasta_catalogo": str(pasta_catalogo()),
                        "padrao": str(Path(config.PASTA_CATALOGO_PADRAO).resolve()),
                        "personalizada": config.PASTA_CATALOGO != config.PASTA_CATALOGO_PADRAO})
        elif u.path == "/api/categorias":
            q = parse_qs(u.query)
            try:
                self._json(carregar_categorias(atualizar=q.get("atualizar") == ["1"]))
            except Exception as e:  # noqa: BLE001
                self._json({"erro": str(e)}, 502)
        elif u.path == "/api/categoria":
            q = parse_qs(u.query)
            cid = (q.get("id") or [""])[0]
            if not cid.isdigit():
                self._json({"erro": "categoria inválida"}, 400)
                return
            try:
                d = albuns_categoria(cid, q.get("sub") == ["1"], atualizar=q.get("atualizar") == ["1"])
            except Exception as e:  # noqa: BLE001
                self._json({"erro": f"Não foi possível ler a categoria: {e}"}, 502)
                return
            self._json({
                "atualizado": d["atualizado"],
                "albuns": [{"titulo": a["titulo"], "fotos": a.get("fotos", ""), "url": a["url"], "id": a["id"],
                            "temCapa": bool(a.get("capa"))} for a in d["albuns"]],
            })
        elif u.path == "/capa":
            aid = (parse_qs(u.query).get("id") or [""])[0]
            try:
                res = obter_capa(aid)
            except Exception:  # noqa: BLE001
                res = None
            if not res:
                self.send_response(404)
                self.end_headers()
                return
            dados, tipo = res
            self.send_response(200)
            self.send_header("Content-Type", tipo)
            self.send_header("Cache-Control", "max-age=86400")
            self.send_header("Content-Length", str(len(dados)))
            self.end_headers()
            self.wfile.write(dados)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:  # noqa: N802
        if not self._origem_ok():
            self._json({"erro": "origem não autorizada"}, 403)
            return
        u = urlparse(self.path)
        corpo = self._corpo()
        if u.path == "/api/listar":
            if not TRAB.iniciar("listar", 0):
                self._json({"erro": "Já há um trabalho a correr."}, 409)
                return
            threading.Thread(target=job_listar, daemon=True).start()
            self._json({"ok": True})
        elif u.path == "/api/baixar":
            url_ok = re.compile(rf"^{re.escape(config.BASE_URL)}/albums/(\d+)(\?|$)")
            sel: list[dict] = []
            vistos: set[str] = set()
            for a in corpo.get("albuns") or []:
                if not isinstance(a, dict):
                    continue
                aid, url = str(a.get("id", "")), str(a.get("url", ""))
                m = url_ok.match(url)
                if not m or m.group(1) != aid or aid in vistos:
                    continue  # só álbuns da loja configurada
                vistos.add(aid)
                cat = a.get("categoria") or []
                sel.append({"id": aid, "url": url, "titulo": str(a.get("titulo") or f"album {aid}")[:200],
                            "categoria": [str(c)[:80] for c in cat if isinstance(c, str)][:3]})
            if not sel:
                self._json({"erro": "Nenhum álbum selecionado."}, 400)
                return
            if not TRAB.iniciar("baixar", len(sel)):
                self._json({"erro": "Já há um trabalho a correr."}, 409)
                return
            threading.Thread(target=job_baixar, args=(sel,), daemon=True).start()
            self._json({"ok": True})
        elif u.path == "/api/definicoes":
            if TRAB.ativo:
                self._json({"erro": "Espere que o download termine (ou pare-o) antes de mudar a pasta."}, 409)
                return
            try:
                destino = mudar_pasta_catalogo(str(corpo.get("pasta_catalogo") or ""))
            except (ValueError, OSError) as e:
                self._json({"erro": f"Não foi possível usar essa pasta: {e}"}, 400)
                return
            self._json({"ok": True, "pasta_catalogo": str(destino)})
        elif u.path == "/api/parar":
            TRAB.parar = True
            TRAB.registar("A parar após a imagem atual…")
            self._json({"ok": True})
        elif u.path == "/api/abrir":
            raiz = Path(config.PASTA_CATALOGO).resolve()
            raiz.mkdir(exist_ok=True)
            pasta = raiz
            partes = [comum.texto_pasta(str(c), 60) for c in corpo.get("categoria") or [] if isinstance(c, str)]
            if partes and all(partes):
                alvo = raiz.joinpath(*partes).resolve()
                if alvo.is_dir() and raiz in alvo.parents:
                    pasta = alvo
            if hasattr(os, "startfile"):
                os.startfile(pasta)  # type: ignore[attr-defined]  # Windows: abre no Explorador
                self._json({"ok": True})
            else:
                self._json({"ok": False, "pasta": str(pasta)})
        else:
            self._json({"erro": "não encontrado"}, 404)


def main() -> int:
    # Usa a primeira porta livre a partir de PORTA_PAINEL (se outro programa já a estiver a usar)
    srv = None
    for porta in range(config.PORTA_PAINEL, config.PORTA_PAINEL + 30):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", porta), Handler)
            break
        except OSError:
            continue
    if srv is None:
        print(f"Não encontrei nenhuma porta livre entre {config.PORTA_PAINEL} e {config.PORTA_PAINEL + 29}.")
        return 1
    url = f"http://127.0.0.1:{srv.server_port}"
    print(f"Painel em {url}  (Ctrl+C para fechar)")
    print(f"Destino dos downloads: {pasta_catalogo()}")
    if not Path(config.FICHEIRO_ALBUNS).exists():
        print("Ainda não há albuns.csv — use o botão 'Atualizar listagem' no painel.")
    if "--sem-browser" not in sys.argv:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nA fechar…")
        TRAB.parar = True
    finally:
        srv.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
