# Image Processing Service

[![CI](https://github.com/pegruk/image-processing-service/actions/workflows/ci.yml/badge.svg)](https://github.com/pegruk/image-processing-service/actions/workflows/ci.yml)

API REST para armazenar imagens e gerar variantes com transformações combináveis. Autenticação JWT, autorização por proprietário, validação do conteúdo e reserva atômica de cota no PostgreSQL acompanham o fluxo de upload e processamento.

Construído com TypeScript, Fastify, PostgreSQL, Drizzle ORM e Sharp.

## Recursos

- Cadastro, login e autenticação JWT com Argon2id.
- Upload multipart de JPEG, PNG e WebP com validação pelos bytes do arquivo.
- Metadados, checksum SHA-256 e arquivos originais separados das variantes.
- Resize, crop, rotação, espelhamento, filtros, watermark, conversão e qualidade.
- Isolamento por usuário: recursos de outros usuários respondem `404`.
- Limites para upload, dimensões, pixels, armazenamento por usuário e transformações simultâneas.
- OpenAPI em `/docs`, migrations versionadas, Docker Compose e CI.

## Arquitetura

```text
HTTP routes → services → repositories → PostgreSQL
                     └→ ObjectStorage → filesystem local
```

As rotas recebem as requisições; services coordenam validação, processamento e persistência; repositories concentram as consultas ao banco. Schemas Zod validam entradas de negócio e schemas das rotas descrevem a API.

O PostgreSQL armazena proprietário, chave relativa, nome original sanitizado, MIME type, tamanho, dimensões, checksum SHA-256 e datas. Variantes também registram os parâmetros de transformação. Os binários ficam sob `STORAGE_ROOT`:

```text
originals/{userId}/{imageId}.{extension}
variants/{imageId}/{variantId}.{extension}
```

UUIDs compõem os nomes físicos; o nome fornecido pelo cliente não determina o caminho no disco. A interface `ObjectStorage` permite implementar S3/R2. O upload ainda usa arquivos temporários locais durante a validação.

```text
src/
├── config/          # Configuração validada a partir do ambiente
├── infrastructure/  # Banco, migrations e storage
├── modules/
│   ├── auth/        # Cadastro e login
│   ├── images/      # Upload, consulta, exclusão e transformações
│   └── health/      # Disponibilidade da API e do banco
├── plugins/         # Autenticação e tratamento de erros
└── shared/          # Erros da aplicação
```

## Executar localmente

Pré-requisitos: Node.js 22+, npm e Docker Compose.

```bash
git clone https://github.com/pegruk/image-processing-service.git
cd image-processing-service
cp .env.example .env
npm ci
docker compose up -d postgres
npm run db:migrate
npm run dev
```

A API estará em `http://localhost:3000`.

- Health check: `GET /health`
- Documentação interativa: `GET /docs`

Para subir API e banco juntos:

```bash
openssl rand -hex 32
# Salve o valor gerado em JWT_SECRET no .env.
docker compose up --build
```

O Compose exige que `JWT_SECRET` esteja definido. Antes de um ambiente público, substitua todos os valores de exemplo no `.env`, principalmente as credenciais do banco e o segredo JWT.

O container aplica as migrations antes de iniciar. No [Swagger UI](http://localhost:3000/docs), faça o cadastro, copie o `token` da resposta e clique em **Authorize**. Depois selecione uma imagem em `POST /images` e teste as transformações.

Se a porta `5432` estiver ocupada por outro PostgreSQL, ajuste o mapeamento do Compose e `DATABASE_URL` para apontar à mesma instância.

## Fluxo de uso

Cadastre um usuário e guarde o token retornado:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"user1","password":"password123"}'
```

Envie uma imagem:

```bash
curl -X POST http://localhost:3000/images \
  -H "Authorization: Bearer <token>" \
  -F "file=@./foto.png"
```

Crie uma variante:

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
    "watermark": {"text":"Image Service","position":"southeast"}
  }'
```

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/health` | Saúde da API e conexão com o banco |
| `POST` | `/auth/register` | Cria um usuário e retorna JWT |
| `POST` | `/auth/login` | Autentica e retorna JWT |
| `GET` | `/auth/me` | Usuário autenticado |
| `POST` | `/images` | Upload de imagem |
| `GET` | `/images` | Lista imagens do usuário |
| `GET` | `/images/:id` | Retorna o original |
| `DELETE` | `/images/:id` | Exclui original e variantes |
| `POST` | `/images/:id/transform` | Cria uma variante |
| `GET` | `/images/:id/variants/:variantId` | Retorna uma variante |

As rotas de imagem exigem `Authorization: Bearer <token>`.

O multipart transporta os bytes e os campos do arquivo em partes delimitadas. O servidor consome o stream e valida seu conteúdo; o MIME informado pelo cliente não é suficiente para aceitar o upload. O processamento com Sharp é síncrono e cada requisição de transformação preserva o original.

### Respostas e erros

Cadastro, upload e transformação retornam `201`; exclusão concluída retorna `204`. A API usa `400` para entrada inválida, `401` para autenticação, `404` para recurso indisponível, `409` para cadastro duplicado, `413` para limites, `415` para formato não aceito e `422` para transformações inválidas. Falhas internas retornam `500`; saturação do processamento retorna `503`.

Erros possuem `error.code`, `error.message` e `error.requestId`, permitindo correlacionar a requisição com os logs.

## Configuração e limites

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `DATABASE_URL` | obrigatório | Conexão PostgreSQL |
| `NODE_ENV` | `development` | Ambiente de execução |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Endereço HTTP |
| `LOG_LEVEL` | `info` | Nível dos logs |
| `STORAGE_ROOT` | `./storage` | Diretório dos arquivos |
| `JWT_ISSUER` | `image-processing-service` | Emissor do token |
| `JWT_AUDIENCE` | `image-processing-client` | Audiência do token |
| `JWT_EXPIRES_IN` | `15m` | Validade do token |
| `DRIZZLE_MIGRATIONS_DIR` | `./drizzle` | Diretório das migrations |
| `JWT_SECRET` | obrigatório | Segredo de assinatura; mínimo de 32 caracteres |
| `API_BASE_URL` | `http://localhost:3000` | URL exibida no OpenAPI |
| `MAX_UPLOAD_SIZE_BYTES` | `10485760` | Tamanho máximo por upload |
| `MAX_IMAGE_WIDTH` / `MAX_IMAGE_HEIGHT` | `10000` | Dimensões máximas |
| `MAX_IMAGE_PIXELS` | `40000000` | Pixels máximos de entrada e saída |
| `MAX_STORAGE_BYTES_PER_USER` | `524288000` | Cota total por usuário |
| `MAX_CONCURRENT_TRANSFORMS` | `2` | Processamentos simultâneos por instância |

Em produção, a aplicação recusa o segredo JWT de desenvolvimento. O limite de concorrência é local à instância; para múltiplas instâncias, use uma fila de processamento compartilhada.

### Consistência e decisões técnicas

A exclusão marca a imagem como `pending` antes da limpeza. Originais e variantes pendentes deixam de ser disponibilizados. Uma nova chamada de exclusão pode retomar a operação; a conclusão remove metadados e desconta a cota em transação.

A cota é reservada por um `UPDATE` condicional atômico no PostgreSQL. Reservas concorrentes são serializadas pelo banco. Falhas de gravação ou persistência acionam a liberação da reserva.

Filesystem e banco não compartilham uma transação. Falhas de compensação são registradas; interrupções do processo podem deixar arquivos órfãos ou reservas pendentes. Não existe reconciliação automática nesta versão. Transformações já em andamento podem concorrer com exclusões e exigem coordenação adicional para garantias fortes de consistência.

## Banco e testes

```bash
npm run typecheck
npm test
npm run build
```

Os testes de rotas usam `Fastify.inject`, repositórios em memória e imagens geradas com Sharp. Testes de storage exercitam o filesystem temporário. Para integração, use um PostgreSQL exclusivo para testes:

```bash
export DATABASE_URL='postgres://usuario:senha@localhost:5432/image_service_test'
npm run db:migrate
npm run test:integration
```

Para alterar o schema, gere uma migration com `npm run db:generate` e aplique com `npm run db:migrate`.

Baseado no desafio [Image Processing Service](https://roadmap.sh/projects/image-processing-service).
