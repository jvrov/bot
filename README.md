# 🤖 Price Monitor Bot

> Cole o link de um produto, defina o preço que você quer pagar e receba um email quando ele baixar.

## ✨ Funcionalidades

- 🔗 **Adicionar só com o link** — o nome e o preço atual são detectados automaticamente
- 🛒 **Lojas suportadas**: Amazon, Mercado Livre, KaBuM! e Magazine Luiza (e outras lojas que publicam dados estruturados `schema.org/Product`)
- 📈 **Histórico de preços** com gráfico, menor/maior preço e mini-gráfico em cada produto
- 🔔 **Alertas por email** (HTML) — enviados **uma vez por queda**, sem spam a cada verificação
- ✏️ Editar nome/preço alvo, verificar um produto só, buscar e ordenar a lista
- ⏰ **Verificação automática** diária via Vercel Cron (`/api/cron`)
- 🌓 Tema claro/escuro (segue o sistema) e layout responsivo
- 💻 **CLI** (`price_monitor.py`) para rodar no terminal ou em loop

## 🛠️ Tecnologias

Python (Flask, Requests, BeautifulSoup) · Redis (opcional) · Bootstrap 5 · SweetAlert2 · Font Awesome

## 🚀 Como usar

```bash
git clone https://github.com/jvrov/bot.git
cd bot
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Configure as variáveis de ambiente (veja `.env.example`):

| Variável | Para quê |
|---|---|
| `EMAIL_USER` / `EMAIL_PASSWORD` | Conta que envia os alertas. No Gmail use uma [senha de app](https://myaccount.google.com/apppasswords). |
| `REDIS_URL` | Banco Redis (ex.: Upstash). **Opcional** — sem ele os dados ficam em `data.json`. |
| `CRON_SECRET` | Protege a rota de verificação automática `/api/cron`. |

```bash
export EMAIL_USER="seu-bot@gmail.com"
export EMAIL_PASSWORD="xxxx xxxx xxxx xxxx"
python app.py
```

Abra [http://localhost:5000](http://localhost:5000).

### Linha de comando

```bash
python price_monitor.py --email voce@exemplo.com            # verifica produtos.json uma vez
python price_monitor.py --email voce@exemplo.com --loop 60  # a cada 60 min
python price_monitor.py --email voce@exemplo.com --testar-email
```

### Testes

```bash
pip install -r requirements-dev.txt
pytest
```

## ☁️ Deploy na Vercel

1. Importe o repositório na Vercel.
2. Em *Settings → Environment Variables* defina `EMAIL_USER`, `EMAIL_PASSWORD`, `REDIS_URL` e `CRON_SECRET`.
3. O `vercel.json` já agenda `/api/cron` uma vez por dia (12:00 UTC). A Vercel envia o `CRON_SECRET` automaticamente.

> ⚠️ Na Vercel o disco não é persistente: configure o `REDIS_URL` para não perder os dados.

## 📁 Estrutura

```
app.py            # rotas web + API JSON
scraper.py        # leitura de preço/nome das páginas
monitor.py        # regras de verificação, histórico e alertas
notifier.py       # envio de emails (SMTP)
storage.py        # Redis ou arquivo JSON local
price_monitor.py  # CLI
templates/ static/  # interface
tests/            # testes (pytest)
```

## 🌐 Demonstração

[bot-theta-pearl.vercel.app](https://bot-theta-pearl.vercel.app)
