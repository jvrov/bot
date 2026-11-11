# 🤖 Price Monitor

> Diga o que você quer comprar (ex.: *"quero um monitor de 280Hz de 25 polegadas até R$ 1.500"*). O Price Monitor procura nas lojas, mostra só o que combina com o pedido e avisa por email quando o preço baixar.

**100% gratuito**: nenhuma API paga. Roda no plano grátis da Vercel, com banco grátis do Upstash e envio de email pelo Gmail.

## ✨ Funcionalidades

**Tela de busca (`/buscar`)**
- 💬 Busca em linguagem natural: entende tipo de produto (com sinônimos), medidas (Hz, polegadas, GB, TB…), modelos (RTX 4060), características (Bluetooth, NVMe, IPS, 4K…) e preço máximo
- 🛒 Procura na KaBuM!, Mercado Livre, Amazon e Magazine Luiza ao mesmo tempo, mostrando o andamento de cada loja
- 🎯 Mostra só os anúncios compatíveis (sem acessórios, modelos ou medidas erradas)
- ↕️ Ordenar por relevância, menor/maior preço, **anúncios mais recentes**, loja ou nome
- 🧰 Filtros por loja, faixa de preço, "só até meu preço" e compatibilidade
- 🔔 Vigiar um produto específico ou **a busca inteira** (avisa quando *qualquer* produto compatível ficar abaixo do seu preço)
- 🔗 Também aceita o link de um produto

**Tela de alertas (`/alertas`)**
- 📈 Preço atual, queda desde o início, menor preço, mini-gráfico e histórico completo
- ↕️ Ordenar por proximidade do alvo, preço, maior queda, ofertas novas, criação, última verificação ou nome
- 🆕 Alertas de busca marcam as **ofertas novas** que apareceram desde a última verificação
- ⏰ Verificação automática diária (Vercel Cron) + botão "Verificar agora"
- 🔑 Código de acesso para abrir os mesmos alertas em outro aparelho

> **Sobre "anúncios mais recentes":** as lojas não mostram a data do anúncio na busca. A ordem é estimada pelo número do anúncio (KaBuM! e Mercado Livre numeram em sequência). Amazon e Magalu ficam por último.

## 🛠️ Tecnologias

- **Next.js 15** (React 19 + Node.js) com TypeScript
- Rotas de API do Next.js (Node.js) para busca, alertas e cron
- **cheerio** para ler as páginas das lojas, **nodemailer** para os emails
- **Upstash Redis** (opcional) para guardar os dados
- **Vitest** para os testes, **lucide-react** para os ícones

## 🚀 Rodando localmente

Precisa do [Node.js](https://nodejs.org) 20 ou mais novo.

```bash
git clone https://github.com/jvrov/bot.git
cd bot
npm install
```

```bash
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). Sem configurar nada, os dados ficam em `data.json`.

Para enviar emails, crie um arquivo `.env.local` com base no `.env.example`.

### Testes

```bash
npm test
```

## ☁️ Deploy na Vercel

1. Importe o repositório na Vercel (o `vercel.json` já define o framework Next.js).
2. Em **Storage**, crie um banco **Upstash for Redis** (Free) e conecte ao projeto.
3. Em **Settings → Environment Variables**, defina `EMAIL_USER`, `EMAIL_PASSWORD` e `CRON_SECRET`.
4. A verificação automática roda todo dia às 12:00 UTC (9h de Brasília).

## 📁 Estrutura

```
src/app/                 páginas (/buscar, /alertas) e rotas de API (/api/...)
src/components/          componentes React (telas, cards, diálogos)
src/lib/pedido.ts        entende o pedido e filtra os anúncios compatíveis
src/lib/search.ts        busca por termo em cada loja
src/lib/scraper.ts       lê preço/nome da página de um produto
src/lib/monitor.ts       histórico, alertas e alertas de busca
src/lib/notifier.ts      envio de emails
src/lib/storage.ts       Upstash Redis ou arquivo local
tests/                   testes (Vitest)
```

## 🌐 Demonstração

[bot-theta-pearl.vercel.app](https://bot-theta-pearl.vercel.app)
