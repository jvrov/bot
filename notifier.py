"""Envio de alertas de preço por email (SMTP).

As credenciais vêm SEMPRE de variáveis de ambiente — nunca coloque senhas no
código. Para Gmail, gere uma "senha de app" em
https://myaccount.google.com/apppasswords
"""

from __future__ import annotations

import html
import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


def _config():
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com"),
        "port": int(os.getenv("SMTP_PORT", "465")),
        "user": os.getenv("EMAIL_USER"),
        "password": os.getenv("EMAIL_PASSWORD"),
        "sender": os.getenv("EMAIL_FROM") or os.getenv("EMAIL_USER"),
    }


def is_configured() -> bool:
    cfg = _config()
    return bool(cfg["user"] and cfg["password"])


def brl(value: float) -> str:
    """Formata um número como moeda brasileira: 1234.5 -> 'R$ 1.234,50'."""
    formatted = f"{value:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"R$ {formatted}"


def build_alert(destinatario: str, produto: dict, preco_atual: float) -> EmailMessage:
    nome = produto["nome"]
    alvo = produto["preco_desejado"]
    url = produto["url"]
    economia = max(alvo - preco_atual, 0)

    msg = EmailMessage()
    msg["Subject"] = f"🔔 Alerta de preço: {nome[:80]}"
    msg["From"] = _config()["sender"] or "price-monitor@localhost"
    msg["To"] = destinatario
    msg.set_content(
        f"Olá! O produto que você está monitorando atingiu o preço desejado!\n\n"
        f"Produto: {nome}\n"
        f"Preço atual: {brl(preco_atual)}\n"
        f"Preço desejado: {brl(alvo)}\n"
        f"Link: {url}\n\n"
        f"Aproveite!\n— Price Monitor Bot"
    )
    msg.add_alternative(
        f"""\
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;
            border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="color:#2563eb;margin-top:0">🔔 Seu preço chegou!</h2>
  <p style="font-size:16px"><strong>{html.escape(nome)}</strong></p>
  <table style="font-size:15px;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0">Preço atual:</td>
        <td><strong style="color:#059669;font-size:20px">{brl(preco_atual)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0">Preço desejado:</td><td>{brl(alvo)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0">Abaixo do alvo:</td><td>{brl(economia)}</td></tr>
  </table>
  <a href="{html.escape(url, quote=True)}"
     style="display:inline-block;background:#2563eb;color:#fff;padding:12px 20px;
            border-radius:8px;text-decoration:none">Ver produto</a>
  <p style="color:#6b7280;font-size:12px;margin-top:24px">Enviado pelo Price Monitor Bot</p>
</div>""",
        subtype="html",
    )
    return msg


def send_message(msg: EmailMessage) -> bool:
    cfg = _config()
    if not is_configured():
        logger.warning("Email não configurado (defina EMAIL_USER e EMAIL_PASSWORD)")
        return False
    try:
        if cfg["port"] == 465:
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], timeout=15) as smtp:
                smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=15) as smtp:
                smtp.starttls()
                smtp.login(cfg["user"], cfg["password"])
                smtp.send_message(msg)
        return True
    except (smtplib.SMTPException, OSError) as exc:
        logger.error("Erro ao enviar email: %s", exc)
        return False


def send_price_alert(destinatario: str, produto: dict, preco_atual: float) -> bool:
    return send_message(build_alert(destinatario, produto, preco_atual))


def send_test_email(destinatario: str) -> bool:
    msg = EmailMessage()
    msg["Subject"] = "✅ Teste do Price Monitor Bot"
    msg["From"] = _config()["sender"] or "price-monitor@localhost"
    msg["To"] = destinatario
    msg.set_content(
        "Este é um email de teste do Price Monitor Bot.\n"
        "Se você recebeu esta mensagem, os alertas estão funcionando!"
    )
    return send_message(msg)
