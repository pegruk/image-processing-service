# Image Processing Service

API REST para upload, armazenamento e transformação de imagens. O projeto demonstra um fluxo de arquivos completo: autenticação, autorização por proprietário, validação do conteúdo, persistência de metadados e criação de variantes.

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

Os módulos de negócio dependem da porta `ObjectStorage`, não do filesystem. Assim, a implementação local pode ser trocada por S3 ou R2 sem alterar rotas e serviços. O PostgreSQL armazena metadados; os binários ficam em chaves relativas, como `originals/{userId}/{imageId}.png`.

## Executar localmente

Pré-requisitos: Node.js 22+, npm e Docker Compose.

```bash
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
JWT_SECRET="$(openssl rand -hex 32)" docker compose up --build
```

O Compose exige que `JWT_SECRET` esteja definido. Antes de um ambiente público, substitua todos os valores de exemplo no `.env`, principalmente as credenciais do banco e o segredo JWT.

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
    "watermark": {"text":"Meu portfólio","position":"southeast"}
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

## Configuração e limites

| Variável | Padrão | Finalidade |
| --- | --- | --- |
| `DATABASE_URL` | obrigatório | Conexão PostgreSQL |
| `JWT_SECRET` | obrigatório | Segredo de assinatura; mínimo de 32 caracteres |
| `API_BASE_URL` | `http://localhost:3000` | URL exibida no OpenAPI |
| `MAX_UPLOAD_SIZE_BYTES` | `10485760` | Tamanho máximo por upload |
| `MAX_IMAGE_WIDTH` / `MAX_IMAGE_HEIGHT` | `10000` | Dimensões máximas |
| `MAX_IMAGE_PIXELS` | `40000000` | Pixels máximos de entrada e saída |
| `MAX_STORAGE_BYTES_PER_USER` | `524288000` | Cota total por usuário |
| `MAX_CONCURRENT_TRANSFORMS` | `2` | Processamentos simultâneos por instância |

Em produção, a aplicação recusa o segredo JWT de desenvolvimento. O limite de concorrência é local à instância; para múltiplas instâncias, use uma fila de processamento compartilhada.

### Limitações conhecidas

A exclusão remove os arquivos antes dos metadados. Se a exclusão no banco falhar após a limpeza do storage, o registro continuará existindo e apontará para um arquivo indisponível. Se a limpeza do storage falhar, os metadados são preservados para que uma nova tentativa de exclusão possa concluí-la. Uma implementação com status de exclusão, tarefas persistentes de limpeza ou reconciliação periódica elimina essa janela de inconsistência.

A cota de armazenamento é verificada antes da gravação, mas não é reservada em transação. Uploads ou transformações simultâneas do mesmo usuário podem ultrapassar a cota. Em um cenário com múltiplas instâncias, a solução é reservar a cota no banco dentro de uma transação ou usar um contador distribuído.

## Banco e testes

```bash
npm run typecheck
npm test
npm run build
```

Os testes unitários e de rotas usam repositórios em memória. Os testes de integração do repositório validam consultas, autorização e cálculo de cota contra PostgreSQL:

```bash
docker compose up -d postgres
npm run db:migrate
npm run test:integration
```

Para alterar o schema, gere uma migration com `npm run db:generate` e aplique com `npm run db:migrate`.

## Deploy

O Compose usa volumes nomeados para PostgreSQL e imagens. Isso permite um deploy simples em uma única máquina com disco persistente e backup. Em ambientes sem volume persistente ou com múltiplas instâncias, substitua `LocalStorage` por um adaptador de armazenamento de objetos e mantenha PostgreSQL em uma instância persistente.

O projeto ainda não inclui filas distribuídas, antivírus, métricas/tracing ou URLs assinadas. Essas são extensões naturais quando o volume e o perfil de risco justificarem a complexidade.
