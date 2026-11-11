# PereiraShop

Loja de camisolas com área de cliente e backoffice, alojada no Firebase.

- **Loja** (`/`): registo/entrada com email e palavra-passe, catálogo, escolha de tamanho, nome, número e patches, carrinho e registo de encomenda (sem pagamento online), histórico de encomendas.
- **Backoffice** (`/admin`): encomendas com estados, **fila do fornecedor** com cópia da imagem + texto para o WhatsApp, gestão de artigos e de patches.

Stack: Vite + TypeScript, Firebase Auth, Firestore, Storage e Hosting.

## Estrutura

```
index.html / admin.html      páginas (loja / backoffice)
src/shop/main.ts             loja
src/admin/main.ts            backoffice
src/lib/types.ts             modelos (Product, Patch, Order…)
src/lib/whatsapp.ts          formato da mensagem ao fornecedor + cópia para a área de transferência
src/lib/storage.ts           redimensionar e enviar imagens
firestore.rules              regras de segurança da base de dados
storage.rules                regras de segurança das imagens
cors.json                    CORS do Storage (necessário para copiar imagens)
```

## Configuração (uma vez)

1. **Firebase Console**
   - *Authentication* → Métodos de início de sessão → ativar **Email/palavra-passe**.
   - *Firestore Database* → criar (modo produção, região `europe-west`).
   - *Storage* → criar. Os projetos novos precisam do plano **Blaze** para usar Storage; para este volume os custos ficam na prática dentro do escalão gratuito. Convém definir um alerta de orçamento.
   - *Definições do projeto* → adicionar uma **App Web** e copiar a configuração.

2. **Projeto local**
   ```powershell
   npm install
   copy .env.example .env.local     # preencher com a configuração da App Web
   npm install -g firebase-tools
   firebase login
   firebase use --add               # escolher o projeto
   firebase deploy --only firestore:rules,storage
   ```

3. **CORS do Storage** (para o botão "Copiar imagem" funcionar)
   Editar `cors.json` com o domínio real (`SEU-PROJETO.web.app` / domínio próprio) e aplicar:
   ```powershell
   gcloud storage buckets update gs://SEU-BUCKET --cors-file=cors.json
   ```
   (alternativa: `gsutil cors set cors.json gs://SEU-BUCKET`). O nome do bucket é o valor de `VITE_FIREBASE_STORAGE_BUCKET`.

4. **Primeiro administrador**
   - Criar a sua conta pela loja (`/` → Criar conta) ou em *Authentication → Adicionar utilizador*.
   - Abrir `/admin` e entrar: aparece "Sem acesso" com o caminho `admins/<UID>`.
   - Em *Firestore* criar a coleção `admins` com um documento cujo ID é esse UID (um campo qualquer, ex.: `role: "owner"`).
   - Recarregar `/admin`.

## Desenvolvimento e publicação

```powershell
npm run dev      # http://localhost:5173  e  http://localhost:5173/admin.html
npm run deploy   # build + firebase deploy (hosting, regras)
```

## Fluxo de trabalho

1. O cliente regista a encomenda → estado **Pendente**.
2. Recebe o pagamento (MB Way/transferência) → muda para **Paga** no backoffice.
3. Em **Fila fornecedor** aparecem os artigos pagos ainda não enviados. Para cada um:
   **Copiar imagem + texto** → colar na conversa do fornecedor no WhatsApp Web → **Marcar como enviado**.
   Quando todos os artigos estão marcados, a encomenda passa a **Encomendada ao fornecedor**.
4. Depois: **Enviada** → **Entregue**.

Formato da mensagem (linhas vazias são omitidas):

```
SIZE: S
NAME: QUARESMA
NUMBER: 23
PATCH: LIGA PORTUGAL
QTY: 2
```

**Nota sobre a cópia:** "Copiar imagem + texto" coloca as duas coisas na área de transferência ao mesmo tempo. O WhatsApp Web normalmente aceita a imagem e ignora o texto, ou o contrário. Se isso acontecer, use **Só imagem** → colar → no campo de legenda **Só texto** → colar → enviar.
A cópia de imagens funciona no Chrome/Edge em computador. Precisa do CORS configurado (passo 3).

## Modelo de dados (Firestore)

| Coleção | Conteúdo |
|---|---|
| `products/{id}` | `title, category, images[], sizes[], allowNameNumber, patchIds[], active, supplierRef, createdAt` |
| `patches/{id}` | `name, imageUrl, active, order` |
| `orders/{id}` | `uid, email, customer{name,phone,address,postalCode,city}, items[], notes, status, createdAt` |
| `users/{uid}` | perfil do cliente |
| `admins/{uid}` | contas com acesso ao backoffice |

Cada linha de `items` guarda `title, imageUrl, size, name, number, patches[] (nomes), qty, notes, supplierSent`. É uma cópia, por isso alterar ou apagar um artigo não altera as encomendas antigas.

## Decisões a rever

- **Catálogo só com sessão iniciada.** Para o tornar público, ver o comentário em `firestore.rules`. Também é preciso tirar o ecrã de login do arranque em `src/shop/main.ts`.
- **Sem preços** no site.
- **Importação de artigos/categorias**: por fazer. De momento os artigos criam-se em *Artigos → Novo artigo*, com upload de várias imagens de uma vez. As imagens são redimensionadas para 1600 px antes do envio.

## Publicação automática (GitHub Actions)

Cada `git push` para `main` corre `.github/workflows/deploy.yml`: instala, compila e publica
**Hosting + regras do Firestore + regras do Storage** no projeto `pereirashop-966ed`.
Também se pode correr à mão em GitHub → Actions → "Publicar no Firebase" → Run workflow.

- A configuração do site para o build vem de `.env.production` (pública por natureza).
  Localmente, `.env.local` continua a mandar no `npm run dev`.
- A autenticação usa o secret `FIREBASE_SERVICE_ACCOUNT` (JSON de uma conta de serviço
  com os papéis *Firebase Admin* e *Service Usage Consumer*).
- O CORS do Storage não é tocado pelo deploy. Se mudar de domínio, volte a aplicá-lo no Cloud Shell.
