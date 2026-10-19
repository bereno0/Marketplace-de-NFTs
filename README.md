# KURIO — Mercado de NFTs

Mercado demonstrativo feito com React, TypeScript, Vite, TanStack Router, TanStack Query, Axios e MSW. A interface responsiva usa uma identidade visual em tons de carvão, espresso e cobre, com tipografia monoespaçada para computadores e celulares.

## Executar localmente

```sh
npm install
npm run dev
```

O modo de desenvolvimento usa uma API simulada pelo MSW. O service worker fica em `public/mockServiceWorker.js`; se o MSW for atualizado, regenere-o com:

```sh
npx msw init public --save
```

Para validar a compilação, os testes e o lint:

```sh
npm run build
npm run lint
npm test
```

## Publicar a demonstração

O projeto pode ser publicado como site estático em modo demonstrativo, sem configurar um projeto Supabase. A simulação é executada no navegador e não oferece persistência compartilhada nem segurança de backend para uso comercial.

Configure a plataforma de hospedagem com:

- **Comando de build:** `npm run build:demo`
- **Pasta de publicação:** `dist`
- **Node.js:** versão 20.19+ ou 22.12+

O comando de build usa o arquivo `.env.demo`, que seleciona explicitamente o backend simulado. A publicação não cobra pagamentos e não envia transações para a blockchain. O arquivo `public/_redirects` inclui a regra de fallback de rotas para plataformas compatíveis, como Netlify e Cloudflare Pages. Em outras plataformas, configure o redirecionamento de rotas desconhecidas para `/index.html` (status 200), para que páginas internas continuem funcionando ao atualizar o navegador.

Antes de divulgar o endereço, teste a versão compilada localmente:

```sh
npm run build:demo
npm run preview
```

Abra o endereço local mostrado no terminal e valide navegação, catálogo, login, sacola e checkout. A demonstração pode ser usada por qualquer visitante; os dados simulados ficam no armazenamento local do navegador e podem ser alterados pelo próprio visitante. Não use este modo para contas, dados pessoais ou compras reais.

## Conta demonstrativa

- **E-mail:** `collector@pixelvault.io`
- **Senha:** `demo-pass`
- **Nome exibido:** `Breno Rossi`

No modo simulado, qualquer e-mail válido e senha com pelo menos oito caracteres é aceita. O cadastro aplica os mesmos requisitos e não permite reutilizar o e-mail da conta de demonstração. As senhas são enviadas somente ao endpoint simulado e não são salvas no armazenamento do navegador.

## Backend Supabase opcional

O app também pode usar Supabase Auth e PostgreSQL para contas, catálogo, favoritos, perfis, carteiras e cotações de pedidos:

1. Crie um projeto Supabase.
2. Execute os arquivos de `supabase/migrations` em ordem cronológica no SQL Editor do Supabase: [`20261018000000_marketplace.sql`](./supabase/migrations/20261018000000_marketplace.sql), [`20261018010000_original_demo_collection.sql`](./supabase/migrations/20261018010000_original_demo_collection.sql) e [`20261018020000_google_profile_name_no_avatar.sql`](./supabase/migrations/20261018020000_google_profile_name_no_avatar.sql). A segunda migração atualiza o catálogo de demonstração; a terceira usa o nome recebido do Google ao criar o perfil e deixa a foto vazia.
3. Copie `.env.example` para `.env.local`, configure `VITE_BACKEND_MODE=supabase` e informe a URL do projeto e a chave pública anon/publishable:

   ```dotenv
   VITE_BACKEND_MODE=supabase
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-publica
   ```

4. Configure a URL do site e os endereços de redirecionamento permitidos no Supabase Auth. Se a confirmação por e-mail estiver ativada, o cadastro pedirá que a pessoa confirme o e-mail antes de entrar.

### Ativar o acesso com Google

1. No Google Cloud Console, crie um cliente OAuth do tipo **Aplicativo da Web**. Adicione como origens JavaScript autorizadas os domínios do app, por exemplo `http://localhost:5173` e o domínio publicado.
2. Copie a URL de callback exibida na configuração do provedor Google no Supabase. Normalmente, ela tem o formato `https://<referência-do-projeto>.supabase.co/auth/v1/callback`; adicione-a como URI de redirecionamento autorizado no cliente OAuth do Google.
3. No painel do Supabase, abra **Authentication → Sign In / Providers → Google**, habilite o provedor e informe o ID e o segredo do cliente OAuth do Google. Mantenha o segredo somente no painel do Supabase — nunca no código do frontend.
4. Em **Authentication → URL Configuration**, defina a URL do site e permita os endereços de retorno do app, por exemplo `http://localhost:5173/login` e `https://seu-dominio/login`.
5. Inicie o app no modo Supabase, usando as variáveis `VITE_BACKEND_MODE=supabase`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. O botão **Continuar com Google** fica habilitado nesse modo. No modo `mock`/`build:demo`, o login Google fica desabilitado e não simula uma autenticação.

O perfil demonstrativo é chamado Breno Rossi. No login Google real, o nome exibido vem do perfil Google e pode ser atualizado na tela de perfil. O app não exibe fotos de perfil.

Nunca inclua uma chave `service_role` no frontend. O navegador deve usar somente a chave pública; as políticas de segurança em nível de linha (RLS) restringem registros privados às pessoas autenticadas. O arquivo `.env.local` é ignorado pelo Git.

No modo Supabase, o resumo e a cotação do checkout usam preços do banco. A criação de pedidos permanece desabilitada até existir integração de verificação de pagamentos. Não configure chaves Supabase no deploy da demonstração: use `npm run build:demo`.

## API simulada

O adaptador de frontend em `src/api.ts` usa Axios e MSW na demonstração local ou o cliente Supabase e funções SQL quando o backend real está configurado. Os handlers do MSW estão em `src/mocks/handlers.ts`.

| Método | Caminho | Finalidade |
| --- | --- | --- |
| `GET` | `/api/nfts` | Buscar, filtrar, ordenar e paginar o catálogo |
| `GET` | `/api/nfts/:id` | Consultar um NFT |
| `POST` | `/api/login` | Validar o acesso demonstrativo e retornar uma sessão |
| `POST` | `/api/signup` | Validar e criar uma conta simulada |
| `GET` | `/api/favorites` | Consultar os favoritos da conta |
| `POST` | `/api/favorites` | Adicionar um NFT aos favoritos |
| `DELETE` | `/api/favorites/:nftId` | Remover um NFT dos favoritos |
| `GET` / `PATCH` | `/api/profile` | Consultar ou atualizar o nome de exibição |
| `GET` | `/api/wallets` | Consultar as carteiras da conta |
| `PUT` | `/api/wallets/primary` | Atualizar a carteira principal |
| `POST` | `/api/orders/quote` | Calcular preços, descontos, taxas e estoque atuais |
| `POST` | `/api/orders` | Validar estoque/cupom e criar um comprovante simulado idempotente |

O checkout consulta uma cotação atualizada e a envia ao confirmar. A API simula a validação de preços e disponibilidade; se os valores mudarem, a confirmação é recusada para que a pessoa revise a nova cotação. Os itens repetidos são agregados antes da validação de estoque, e os preços enviados pelo cliente não são usados no cálculo. As solicitações de pedido usam uma chave de idempotência no cabeçalho e no corpo: repetir a mesma solicitação retorna o mesmo pedido; alterar o conteúdo com a mesma chave resulta em `409`. Informe a carteira `0xdecline` no checkout para simular uma recusa. Erros de estoque ou cupom preservam a sacola.

Os comprovantes e identificadores de transação da simulação são fictícios. Nenhum valor é cobrado e nenhuma transação de blockchain é enviada.

O catálogo aceita os parâmetros `query`, `category`, `sort` (`popular`, `price-low`, `price-high` ou `newest`) e `page`. A resposta tem o formato `{ items, total, page, pageSize }`; cada página contém até quatro NFTs. Filtros e paginação aparecem na URL; mudar a busca, categoria ou ordenação volta à primeira página.

## Estado e recuperação

- As consultas do catálogo usam TanStack Query, com cache de 30 segundos e uma tentativa de repetição. Erros de API são exibidos em vez de substituídos por dados falsos.
- O catálogo demonstrativo contém seis ilustrações originais locais da coleção Clube da Copa, com descrições em português.
- Na primeira visita em modo simulado, a sacola começa com três NFTs de exemplo. Depois de alterada ou esvaziada, ela não é preenchida novamente automaticamente.
- Sacola e cupom sobrevivem à atualização da página pelo armazenamento local. Sessões demonstrativas expiram após 30 minutos.
- A sacola de visitante é preservada ao entrar ou sair da conta. Ao sair, os dados privados em cache e recibos de pedidos são removidos.
- O MSW simula usuários, favoritos, carteiras e pedidos idempotentes no navegador. Esses dados não são sincronizados entre visitantes ou dispositivos.

## Identidade visual e responsividade

- Fundo quase preto, superfícies espresso, detalhes em cobre e tipografia monoespaçada do sistema; não há download de fontes externas.
- Os filtros do catálogo ficam em uma barra lateral em telas grandes e acima dos resultados em telas menores.
- Os cards usam três colunas em telas grandes e duas em celulares. A navegação móvel fica junto à borda inferior e respeita a área segura do aparelho.
- Detalhes dos NFTs, sacola, formulários e resumo do checkout se reorganizam em uma coluna em telas estreitas.

O projeto está pronto para demonstração visual e funcional. O modo simulado não é um backend de produção. Pagamentos, verificação on-chain e criação de pedidos no Supabase ainda não estão implementados.
#   M a r k e t p l a c e - d e - N F T s  
 