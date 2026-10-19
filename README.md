KURIO — Marketplace de NFTs

1. Sobre o projeto

O KURIO é um marketplace demonstrativo de NFTs desenvolvido com React, TypeScript e Vite. A plataforma permite explorar coleções digitais, visualizar detalhes, favoritar itens, gerenciar uma sacola e simular um checkout.

2. Tecnologias utilizadas

Frontend: React, TypeScript e Vite.

Rotas: TanStack Router.

Requisições e cache: TanStack Query e Axios.

API simulada: MSW.

Backend opcional: Supabase Auth e PostgreSQL.

3. Funcionalidades

Catálogo de NFTs com busca, filtros, ordenação e paginação.

Páginas de detalhes dos NFTs.

Cadastro, login e autenticação com Google via Supabase.

Favoritos, perfil e gerenciamento de carteiras.

Sacola de compras com cupons e cálculo de taxas.

Checkout com validação de preços e estoque.

Interface responsiva para computadores e celulares.

4. Identidade visual

A interface utiliza tons de carvão, espresso e cobre, com tipografia monoespaçada. O layout se adapta a diferentes tamanhos de tela, priorizando uma experiência moderna e consistente.

5. Como executar

Pré-requisitos: Node.js 20.19+ ou 22.12+.

npm install
npm run dev

Para validar o projeto:

npm run build
npm run lint
npm test

6. Publicação

O projeto pode ser publicado como site estático no modo demonstrativo, sem necessidade de configurar um backend real.

Build: npm run build:demo

Diretório de publicação: dist

Pré-visualização: npm run preview

É necessário configurar o redirecionamento das rotas para index.html na plataforma de hospedagem, quando aplicável.

7. Backend opcional

O Supabase pode ser configurado para autenticação e armazenamento de dados, incluindo perfis, catálogo, favoritos e carteiras. A configuração exige um projeto Supabase, execução das migrações SQL e definição das variáveis de ambiente.

As chaves privadas nunca devem ser expostas no frontend.

8. Limitações

O modo demonstrativo utiliza dados simulados no navegador e não oferece persistência compartilhada. O checkout não realiza cobranças reais, não envia transações para a blockchain e não possui integração completa de pagamentos.

9. Status do projeto

O KURIO está preparado para demonstração visual e funcional, com navegação, catálogo, autenticação simulada e fluxo de compra demonstrativo. A implementação de pagamentos reais e a integração completa de pedidos com o backend ainda são etapas futuras.
