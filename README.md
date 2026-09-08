# Image Processing Service

API REST para upload, armazenamento e processamento de imagens, construída com TypeScript, Fastify, PostgreSQL, Drizzle ORM e Sharp.

## Objetivo

O serviço permite que usuários autenticados enviem imagens, consultem seus metadados e gerem versões transformadas. A primeira implementação utiliza filesystem local para armazenar os arquivos e PostgreSQL para armazenar os metadados.

O storage foi isolado atrás de uma interface para permitir uma futura implementação com Cloudflare R2 ou AWS S3.

## Status

Implementação incremental:

- [x] estrutura TypeScript com compilação strict;
- [x] Fastify com logs estruturados;
- [x] configuração validada com Zod;
- [x] PostgreSQL via Docker Compose;
- [x] schema Drizzle para usuários, imagens e variantes;
- [x] migration inicial;
- [x] endpoint `/health`;
- [x] Swagger/OpenAPI inicial em `/docs`;
- [x] cadastro e login com Argon2;
- [x] autenticação JWT e rota `/auth/me`;
- [x] upload multipart com validação de conteúdo;
- [x] storage local com limpeza compensatória;
- [x] listagem, recuperação e exclusão de imagens;
- [x] transformações combináveis com Sharp;
- [x] testes automatizados das rotas, storage e pipeline de imagens.

## Tecnologias

- Node.js 22;
- TypeScript;
- Fastify;
- PostgreSQL;
- Drizzle ORM e Drizzle Kit;
- Zod;
- Sharp;
- JWT;
- Vitest;
- Docker e Docker Compose;
- Swagger/OpenAPI.

## Arquitetura

O código será organizado por módulos e responsabilidades:

```text
src/
├── config/                    # Variáveis de ambiente e configuração
├── infrastructure/
│   └── database/              # Pool, Drizzle, schema e migrations
├── modules/
│   ├── auth/                  # Cadastro, login e autenticação
│   ├── images/                # Upload, metadados e transformações
│   └── health/               # Health check
├── plugins/                  # Plugins e handlers do Fastify
└── shared/                   # Erros e tipos compartilhados
```

O filesystem não será acessado diretamente pelos módulos de negócio. A aplicação terá uma porta de storage e uma implementação local. As chaves persistidas no banco serão relativas, por exemplo `originals/{userId}/{imageId}.png`, e nunca caminhos absolutos da máquina.

## Executando localmente

### Pré-requisitos

- Node.js 22 ou superior;
- npm;
- Docker e Docker Compose.

### Instalação

```bash
cp .env.example .env
npm install
docker compose up -d postgres
npm run db:migrate
npm run dev
```

A API ficará disponível em `http://localhost:3000`.

- Health check: `GET http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/docs`

Para executar a API e o banco em containers:

```bash
docker compose up --build
```

## Variáveis de ambiente

| Variável | Descrição | Padrão |
| --- | --- | --- |
| `NODE_ENV` | Ambiente de execução | `development` |
| `HOST` | Host HTTP | `0.0.0.0` |
| `PORT` | Porta HTTP | `3000` |
| `LOG_LEVEL` | Nível do logger | `info` |
| `DATABASE_URL` | Connection string do PostgreSQL | obrigatório |
| `JWT_SECRET` | Chave usada para assinar tokens | mínimo de 32 caracteres |
| `JWT_ISSUER` | Emissor do token | `image-processing-service` |
| `JWT_AUDIENCE` | Audiência do token | `image-processing-client` |
| `JWT_EXPIRES_IN` | Expiração do JWT | `15m` |
| `STORAGE_ROOT` | Diretório do storage local | `./storage` |
| `MAX_UPLOAD_SIZE_BYTES` | Tamanho máximo do upload | `10485760` |
| `MAX_IMAGE_WIDTH` | Largura máxima | `10000` |
| `MAX_IMAGE_HEIGHT` | Altura máxima | `10000` |
| `MAX_IMAGE_PIXELS` | Total máximo de pixels | `40000000` |

Nunca versionar o arquivo `.env`.

## Banco de dados e migrations

Gerar uma migration após alterar o schema:

```bash
npm run db:generate
```

Executar migrations:

```bash
npm run db:migrate
```

Abrir o Drizzle Studio:

```bash
npm run db:studio
```

## Testes e validações

```bash
npm run typecheck
npm test
```

Os testes de integração utilizarão PostgreSQL isolado e o Fastify `inject`, evitando a necessidade de subir um servidor HTTP real durante os testes.

## Endpoints planejados

### Autenticação

```text
POST /auth/register
POST /auth/login
GET  /auth/me
```

Cadastro:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"password123"}'
```

Login:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"password123"}'
```

As respostas de cadastro e login contêm um JWT. Utilize o token nas rotas protegidas:

```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer <token>"
```

O username é normalizado para lowercase. Senhas nunca são retornadas pela API e são armazenadas somente como hashes Argon2id. Credenciais inválidas retornam uma mensagem genérica para não revelar se o username existe.

### Imagens

```text
POST   /images
GET    /images?page=1&limit=10
GET    /images/:id
DELETE /images/:id
POST   /images/:id/transform
GET    /images/:id/variants/:variantId
```

Upload de uma imagem:

```bash
curl -X POST http://localhost:3000/images \
  -H "Authorization: Bearer <token>" \
  -F "file=@./foto.png"
```

O upload aceita JPEG, PNG e WebP. O MIME type informado pelo cliente não é considerado suficiente: o serviço inspeciona os bytes reais do arquivo, valida as dimensões com Sharp, calcula um checksum SHA-256 e grava os metadados no PostgreSQL.

Durante esta etapa, o arquivo original é salvo em uma chave como:

```text
storage/originals/{userId}/{imageId}.png
```

O nome físico não utiliza o nome enviado pelo cliente. O nome original é sanitizado e armazenado apenas como metadado.

Transformação combinada:

```bash
curl -X POST http://localhost:3000/images/<image-id>/transform \
  -H "Authorization: Bearer <token>" \
  -H 'Content-Type: application/json' \
  -d '{
    "resize": {"width": 1200, "height": 800, "fit": "cover"},
    "rotate": 90,
    "format": "webp",
    "quality": 80,
    "filters": {"grayscale": true},
    "watermark": {
      "text": "Meu portfólio",
      "position": "southeast",
      "opacity": 0.5,
      "fontSize": 32
    }
  }'
```

As transformações são executadas nesta ordem: rotação, flip/mirror, resize, crop, filtros, watermark e formato/compressão. O original é preservado e cada execução gera uma variante independente em `variants/{imageId}/{variantId}.{extension}`.

Os endpoints de imagem sempre filtram o recurso pelo usuário autenticado. Um usuário não recebe `403` ou detalhes sobre a existência de imagens de terceiros; nesses casos a API responde `404`.

As rotas de imagem exigirão `Authorization: Bearer <token>` e só permitirão acesso a imagens pertencentes ao usuário autenticado.

## Armazenamento e deploy

Durante o desenvolvimento, as imagens ficam no filesystem local. Isso é simples e facilita entender o fluxo completo, mas muitos serviços gratuitos utilizam filesystem efêmero: arquivos podem ser perdidos após restart, redeploy ou troca de instância.

Por isso, antes de um deploy público persistente, a implementação `LocalStorage` deverá ser substituída por uma implementação compatível com Cloudflare R2 ou AWS S3. A API de negócio não precisará conhecer essa troca.

O PostgreSQL também deverá ser fornecido por um serviço gerenciado ou container persistente no ambiente de deploy.

## Decisões técnicas

- O arquivo original nunca será sobrescrito por uma transformação.
- Metadados ficam no PostgreSQL; conteúdo binário fica no storage.
- IDs físicos serão UUIDs, evitando nomes previsíveis.
- MIME type será validado pelo conteúdo do arquivo, não apenas pelo header multipart.
- Erros terão códigos estáveis e respostas HTTP consistentes.
- Falhas entre filesystem e banco serão tratadas com ações compensatórias e logs estruturados.
- A autorização será aplicada nas consultas por `user_id`, evitando que um usuário consulte ou modifique recursos de outro.

## Melhorias futuras

- Cloudflare R2 ou AWS S3;
- URLs assinadas;
- Redis para cache de variantes;
- BullMQ e workers;
- processamento assíncrono;
- rate limiting;
- limpeza automática de arquivos órfãos;
- métricas e tracing;
- antivírus para uploads;
- suporte a múltiplas instâncias da API.

## Convenção de commits

O projeto utiliza Conventional Commits:

```text
feat(images): add multipart upload
fix(images): cleanup file after database failure
test(auth): cover login errors
docs: update local setup instructions
chore: update dependencies
```

Cada commit deve representar uma mudança coerente e executável, evitando commits genéricos como `wip` ou `final`.
