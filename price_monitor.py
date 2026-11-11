"""Monitor de preços pela linha de comando.

Lê os produtos de ``produtos.json`` e envia alertas para o email informado em
``--email`` (ou na variável ``ALERT_EMAIL``).

Exemplos:
    python price_monitor.py                       # verifica uma vez
    python price_monitor.py --loop 60             # verifica a cada 60 minutos
    python price_monitor.py --testar-email        # envia um email de teste
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import monitor
import notifier

STATUS_LABEL = {
    "alerta_enviado": "🔔 ALERTA ENVIADO",
    "abaixo_do_alvo": "✅ abaixo do alvo",
    "monitorado": "👀 acima do alvo",
    "erro": "❌ erro",
}


def load(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        print(f"Arquivo {path} não encontrado.")
        return []
    return [monitor.normalize_product(p) for p in data]


def save(path: Path, products: list[dict]) -> None:
    path.write_text(json.dumps(products, ensure_ascii=False, indent=4), encoding="utf-8")


def run_once(path: Path, email: str | None) -> None:
    products = load(path)
    if not products:
        print("Nenhum produto para monitorar.")
        return
    print(f"\n=== Verificando {len(products)} produto(s) ===")
    for r in monitor.check_products(products, email):
        linha = f"{STATUS_LABEL[r['status']]:<20} {r['nome'][:60]}"
        if "preco_atual" in r:
            linha += (f"  |  atual {notifier.brl(r['preco_atual'])}"
                      f"  |  alvo {notifier.brl(r['preco_desejado'])}")
        if r.get("mensagem"):
            linha += f"  |  {r['mensagem']}"
        print(linha)
    save(path, products)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Monitor de preços (CLI)")
    parser.add_argument("--arquivo", default="produtos.json", type=Path)
    parser.add_argument("--email", default=os.getenv("ALERT_EMAIL"))
    parser.add_argument("--loop", type=int, metavar="MINUTOS",
                        help="Repete a verificação a cada N minutos")
    parser.add_argument("--testar-email", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.WARNING)

    if args.testar_email:
        if not args.email:
            print("Informe o destinatário com --email ou ALERT_EMAIL.")
            return 1
        ok = notifier.send_test_email(args.email)
        print("Email de teste enviado!" if ok else "Falha ao enviar (veja EMAIL_USER/EMAIL_PASSWORD).")
        return 0 if ok else 1

    if not args.email:
        print("Aviso: nenhum email informado (--email); os alertas não serão enviados.")

    while True:
        run_once(args.arquivo, args.email)
        if not args.loop:
            return 0
        print(f"Próxima verificação em {args.loop} minuto(s). Ctrl+C para sair.")
        try:
            time.sleep(args.loop * 60)
        except KeyboardInterrupt:
            return 0


if __name__ == "__main__":
    sys.exit(main())
