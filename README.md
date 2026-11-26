# PereiraShop

Loja de camisolas com área de cliente e backoffice, alojada no Firebase.

- **Loja** (`/`): registo/entrada com email e palavra-passe, catálogo, escolha de tamanho, nome, número e patches, carrinho e registo de encomenda (sem pagamento online), histórico de encomendas.
- **Backoffice** (`/admin`): encomendas com estados, **fila do fornecedor** com cópia da imagem com o texto para o WhatsApp, gestão de artigos e de patches.

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
   **Copiar imagem com texto** → colar na conversa do fornecedor no WhatsApp Web → **Marcar como enviado**.
   No telemóvel, **Partilhar…** envia a foto com o texto como legenda.
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

**Nota sobre a cópia:** o WhatsApp Web só aceita uma coisa por colagem (imagem ou texto). Por isso "Copiar imagem com texto" gera uma única imagem com a foto e, por baixo, SIZE / NAME / NUMBER / PATCH. Se o fornecedor precisar do texto como texto, use "Só imagem", cole, e depois "Só texto" na legenda.
A cópia de imagens funciona no Chrome/Edge em computador e precisa do CORS do Storage configurado.

## Modelo de dados (Firestore)

| Coleção | Conteúdo |
|---|---|
| `products/{id}` | `title, category, images[], sizes[], allowNameNumber, patchIds[], active, supplierRef, createdAt` |
| `patches/{id}` | `name, imageUrl, active, order` |
| `orders/{id}` | `uid, email, customer{name,phone,address,postalCode,city}, items[], notes, status, createdAt` |
| `users/{uid}` | perfil do cliente |
| `admins/{uid}` | contas com acesso ao backoffice |
| `aprovados/{uid}` | contas aprovadas no backoffice (*Contas*). Só estas entram na loja |
| `mail/{id}` | pedidos de email para a extensão *Trigger Email* (ex.: conta aprovada) |
| `bloqueados/{uid}` | contas bloqueadas no backoffice (*Contas*): deixam de ver o catálogo e de encomendar |
| `config/precos` | preços base da calculadora (`semPers`, `comPers`), editáveis em *Encomendas → Preços base* |

Cada linha de `items` guarda `title, imageUrl, size, name, number, patches[] (nomes), qty, notes, supplierSent` e, depois de definido o preço, `price` (unitário). A encomenda guarda também `extra` (portes/ajuste) e `total` (`null` enquanto não houver preço). É uma cópia, por isso alterar ou apagar um artigo não altera as encomendas antigas.

## Decisões a rever

- **Catálogo só com sessão iniciada.** Para o tornar público, ver o comentário em `firestore.rules`. Também é preciso tirar o ecrã de login do arranque em `src/shop/main.ts`.
- **Sem preços** no site.
- **Importação de artigos/categorias**: por fazer. De momento os artigos criam-se em *Artigos → Novo artigo*, com upload de várias imagens de uma vez. As imagens são redimensionadas para 1600 px antes do envio.

## Aprovação de contas e emails

As contas novas ficam **por aprovar**: o cliente regista-se, recebe o email de confirmação do endereço (Firebase) e vê
"Conta criada! Agora só falta seres aprovado". Enquanto não for aprovada, não entra na loja (e as regras do Firestore
recusam o catálogo e as encomendas). No backoffice → **Contas** aparecem primeiro as *Por aprovar*, com contador no menu.

**Contas que já existiam** antes desta mudança também ficam por aprovar: usar *Aprovar todas* uma vez
(responder *Cancelar* à pergunta do email para as aprovar sem enviar email).

Ao aprovar, o backoffice cria um documento em `mail/` e a extensão **Trigger Email from Firestore** envia-o.
Instalar uma vez (Firebase Console → *Extensions* → *Trigger Email from Firestore* → *Install*):

- **Collection**: `mail`
- **SMTP**: a conta que envia. Com Gmail: ativar a verificação em 2 passos na conta Google, criar uma
  *palavra-passe de aplicação* e usar `smtps://O_TEU_EMAIL%40gmail.com@smtp.gmail.com:465` (o `@` do email escreve-se `%40`) como URI e a palavra-passe
  de aplicação no campo da palavra-passe SMTP. Outros fornecedores (Brevo, SendGrid, Mailgun…) dão um URI SMTP equivalente.
- **Default FROM**: `Pé de Chumbo <O_TEU_EMAIL@gmail.com>`
- Região: a mesma da base de dados.

Depois de aprovar uma conta, o backoffice acompanha o envio e avisa "Email enviado" ou o erro. Se a extensão
não estiver instalada, avisa ao fim de ~45 s e o pedido fica guardado em `mail/` (é enviado quando a extensão for instalada).


**Emails das encomendas** (pela mesma extensão):

| Quando | Email ao cliente |
|---|---|
| O cliente regista a encomenda | "Recebemos a tua encomenda" (em processamento) |
| No backoffice muda o estado para Em análise, Paga, Encomendada, Enviada, Entregue ou Cancelada | Um email próprio de cada estado, com os artigos e o total (se já tiver preço) |
| Todos os artigos marcados como enviados ao fornecedor (passa sozinha a Encomendada) | "Já foi pedida ao fornecedor" |

Os textos estão em `src/lib/emailTemplates.ts`. O cliente só pode pedir o email "encomenda recebida" de uma encomenda sua,
para o próprio email e uma única vez (regras em `firestore.rules`, coleção `mail`).
## Publicação automática (GitHub Actions)

Cada `git push` para `main` corre `.github/workflows/deploy.yml`: instala, compila e publica
**Hosting + regras do Firestore + regras do Storage** no projeto `pereirashop-966ed`.
Também se pode correr à mão em GitHub → Actions → "Publicar no Firebase" → Run workflow.

- A configuração do site para o build vem de `.env.production` (pública por natureza).
  Localmente, `.env.local` continua a mandar no `npm run dev`.
- A autenticação usa o secret `FIREBASE_SERVICE_ACCOUNT` (JSON de uma conta de serviço
  com os papéis *Firebase Admin* e *Service Usage Consumer*).
- O CORS do Storage não é tocado pelo deploy. Se mudar de domínio, volte a aplicá-lo no Cloud Shell.
