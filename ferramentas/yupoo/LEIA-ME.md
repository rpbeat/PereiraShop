# Catálogo Yupoo — listar, escolher, descarregar

## Forma recomendada: o painel

**Duplo clique em `Painel.bat`** (ou `py painel.py`). Abre no browser `http://127.0.0.1:47615`:

- **Categorias à esquerda**: a árvore de categorias do site (ex.: *Primeira Liga → FC Porto, S.L. Benfica, Sporting CP…*), com pesquisa. Cada categoria é lida do Yupoo na primeira vez que a abre e fica em cache (`↻ Atualizar categoria` para voltar a ler).
- Numa categoria principal com clubes, **+ Incluir as subcategorias** junta os álbuns de todos os clubes.
- **Descarregar categoria** descarrega a categoria inteira (só o que falta) para `catalogo\<Categoria>\<Clube>\<Título>\`.
- A *Listagem geral* (página inicial do site) continua disponível no topo da árvore.
- Mostra as capas dos álbuns, com filtro por várias palavras (`26/27 home`).
- Também filtra para *ocultar já descarregados* e *só selecionados*.
- Clique numa capa para a selecionar. **Shift+clique** seleciona um intervalo, e *Selecionar visíveis* seleciona tudo o que o filtro mostra. A seleção fica guardada no browser.
- **Época:** os botões por baixo dos filtros mostram as épocas/anos dos equipamentos (lidos do título: 26/27, 2026, 99/01…). Clique para escolher uma ou várias; a escolha fica guardada e vale para todas as categorias. *Descarregar categoria* passa a descarregar só as épocas escolhidas.
- **Tipo:** filtra por peça (Camisola, Calções, Fato de treino, Casaco / corta-vento, Treino, Polo, Meias), público (Adulto, Mulher, Crianças, Bebé) e variante (Versão jogador, Retro, Guarda-redes, Manga comprida, Edição especial). Dentro do mesmo grupo basta um; entre grupos têm de bater todos (ex.: *Camisola* + *Crianças*). *Descarregar categoria* respeita também o tipo.
- **Foto principal:** a capa que aparece no painel é a foto principal do artigo. Ao descarregar fica marcada no `.progresso.json` do álbum (`"principal": "007.jpg"`), e o backoffice → Importar usa-a como 1.ª foto (etiqueta *Capa do Yupoo*), sem precisar do detetor. Os álbuns descarregados antes são marcados sozinhos quando se abre o painel.
- **Descarregar (n)** descarrega os selecionados, com barra de progresso, registo e botão **Parar**. Os álbuns ficam com a etiqueta *Descarregado* ou *Parcial x/y*. Os parciais retomam onde ficaram.
- **Atualizar listagem** volta a ler o Yupoo (≈1 min) e regrava o `albuns.csv`.
- **Abrir pasta catálogo** e **Backoffice → Importar** são os passos seguintes.

Para fechar o painel, feche a janela preta (ou Ctrl+C nela). O painel usa as mesmas funções, pastas e `.progresso.json` que os scripts abaixo. Pode alternar entre os dois.

---

## Forma manual (scripts)

Três passos separados: **listar** os álbuns, **escolher** à mão os que interessam e **descarregar** só esses.
A pasta `catalogo/` resultante entra diretamente no backoffice: *Importar → Escolher pasta*.

> Use com moderação: pausas generosas, uma execução de cada vez e só os álbuns de que precisa.
> O Yupoo pode limitar ou bloquear acessos automáticos. Se começarem a aparecer erros 403/429/567, pare e aumente as pausas em `config.py`.

## Ficheiros

| Ficheiro | Para quê |
|---|---|
| `config.py` | URL do site, pausas e **seletores**. Tudo o que depende do HTML está aqui. |
| `comum.py` | Pedidos HTTP com novas tentativas, leitura da listagem e do álbum |
| `testar.py` | Testa os seletores com 1 álbum ou 1 página de listagem, sem descarregar nada |
| `etapa1_listar.py` | Gera `albuns.csv` (indice;titulo;url;id) e não descarrega imagens |
| `painel.py` + `painel.html` + `Painel.bat` | Painel no browser para escolher e descarregar |
| `etapa2_baixar.py` | Descarrega os índices de `selecao.txt` para `catalogo/{indice}_{titulo}/001.jpg…` |

## Passo a passo (por esta ordem)

```powershell
cd ferramentas\yupoo
python -m pip install -r requirements.txt

# 1) Validar os seletores (não descarrega nada)
python testar.py listagem
python testar.py album "https://minkang.x.yupoo.com/albums/XXXXXX?uid=1"   # um URL de álbum real

# 2) Listar (pode testar primeiro com poucas páginas)
python etapa1_listar.py --paginas 2
python etapa1_listar.py                 # tudo → albuns.csv

# 3) Escolher: abrir albuns.csv (Excel) e escrever os índices em selecao.txt
#    ex.:  3, 7, 12-15

# 4) Ver o que vai ser descarregado e depois descarregar
python etapa2_baixar.py --simular
python etapa2_baixar.py
```

- Se interromper (Ctrl+C) ou houver erros, **corra o mesmo comando outra vez**. Cada álbum tem um `.progresso.json` com a lista de imagens e as que já foram descarregadas. Só falta o que falta, e os álbuns concluídos são saltados.
- Os índices de `albuns.csv` **mudam quando o fornecedor publica álbuns novos**, porque os mais recentes ficam no topo. Por isso faça a seleção e o download com a mesma `albuns.csv`. Se voltar a listar, não há duplicados: o script reconhece cada álbum pelo seu `id`.
- No backoffice, o prefixo `003_` do nome da pasta é retirado automaticamente do título.

## Calibrar os seletores (quando o teste devolve 0)

O `testar.py` já imprime pistas (classes e atributos mais frequentes). Para confirmar à mão no Chrome:

### Listagem (`/albums`)
1. Abra `https://minkang.x.yupoo.com/albums`, clique com o botão direito numa capa de álbum e escolha **Inspecionar**.
2. Suba na árvore até ao **`<a>` cujo `href` contém `/albums/<número>`**.
3. Anote:
   - a **classe** desse `<a>` → `SELETOR_ALBUM_LINK` (ex.: `class="album__main"` → `"a.album__main"`);
   - onde está o **título**: atributo `title="…"` no `<a>` → `ATRIBUTO_TITULO`, ou um elemento lá dentro (ex.: `<div class="album__title">`) → `SELETOR_ALBUM_TITULO`.
4. Se o href tiver outro formato (ex.: `/album/123`), ajuste `PADRAO_URL_ALBUM`.

### Álbum (`/albums/<id>`)
1. Abra um álbum, clique com o botão direito numa foto e escolha **Inspecionar** → `<img …>`.
2. Anote:
   - a **classe do elemento pai** da `<img>` (ex.: `<div class="showalbum__children">`) → `SELETOR_IMAGENS` (`"div.showalbum__children img"`);
   - **que atributos têm URLs `photo.yupoo.com`** e qual é o maior. Normalmente:
     - `data-origin-src="//photo.yupoo.com/<loja>/<hash>/<nome>.jpg"`: original. É o preferido.
     - `data-src="…/<hash>/medium.jpg"` ou `src="…/small.jpg"`: reduzidas.

     Ponha-os em `ATRIBUTOS_IMAGEM`, do melhor para o pior. Quando só há versões reduzidas, o script troca `small`/`medium` por `big` (`TAMANHO_MAXIMO`).
3. Confirme abrindo um desses URLs num separador novo, a partir da página do álbum.
4. Se o álbum tiver várias páginas internas (`?page=2`), defina `SELETOR_ALBUM_PROXIMA` com o link "seguinte".

### Imagens recusadas (403 / "não é imagem")
O `photo.yupoo.com` exige o cabeçalho **Referer** do site. O script já o envia (o próprio URL do álbum). Se mesmo assim falhar, aumente as pausas: pode ser limitação temporária.

## Alternativa: descoberta com gallery-dl (se a listagem vier por JavaScript)

Se o `testar.py listagem` mostrar HTML quase vazio, sem `<a>` com `/albums/`, a grelha é montada por JavaScript e o `requests` não a vê.

1. Instale o gallery-dl e confirme que suporta o Yupoo nesta versão:
   ```powershell
   python -m pip install -U gallery-dl
   gallery-dl --list-extractors | findstr /i yupoo
   ```
2. Se aparecer, faça só a **descoberta**, sem descarregar:
   ```powershell
   gallery-dl --simulate -j "https://minkang.x.yupoo.com/albums" > descoberta.json
   gallery-dl --get-urls "https://minkang.x.yupoo.com/albums/XXXXXX?uid=1"
   ```
   O `-j` grava em JSON os metadados de cada álbum (título, URL, id). O `--get-urls` lista os URLs das imagens de um álbum sem as descarregar. A partir do JSON monta-se o `albuns.csv` e a etapa 2 continua igual.
3. Se o gallery-dl **não** tiver extrator para o Yupoo, a alternativa é renderizar a página com o Playwright e passar o HTML às mesmas funções:
   ```python
   # pip install playwright && playwright install chromium
   from playwright.sync_api import sync_playwright
   import comum
   with sync_playwright() as p:
       pag = p.chromium.launch().new_page()
       pag.goto(comum.url_pagina(1), wait_until="networkidle")
       print(comum.extrair_albuns(pag.content()))
   ```
