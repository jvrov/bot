/** Envio de alertas por email (SMTP – Gmail com senha de app, gratuito). */
import nodemailer from 'nodemailer';
import { brl } from './preco';
import type { Produto } from './types';

const cfg = () => ({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  user: process.env.EMAIL_USER,
  pass: process.env.EMAIL_PASSWORD,
  from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
});

export const emailConfigurado = () => !!(cfg().user && cfg().pass);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function montarAlerta(destinatario: string, produto: Produto, precoAtual: number) {
  const alvo = produto.preco_desejado;
  const oferta = produto.tipo === 'busca' ? produto.melhor_oferta : null;
  const url = produto.url;
  const text = [
    'Olá! Um alerta seu atingiu o preço desejado!',
    '',
    `Alerta: ${produto.nome}`,
    oferta ? `Oferta encontrada: ${oferta.titulo}` : null,
    `Preço atual: ${brl(precoAtual)}`,
    `Preço desejado: ${brl(alvo)}`,
    `Link: ${url}`,
    '',
    'Aproveite!',
    '— Price Monitor',
  ].filter((l) => l !== null).join('\n');

  const html = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="color:#4f46e5;margin-top:0">🔔 Seu preço chegou!</h2>
  <p style="font-size:16px"><strong>${esc(produto.nome)}</strong></p>
  ${oferta ? `<p style="font-size:14px;color:#374151">Oferta encontrada: ${esc(oferta.titulo)}</p>` : ''}
  <table style="font-size:15px;margin:16px 0">
    <tr><td style="padding:4px 12px 4px 0">Preço atual:</td><td><strong style="color:#059669;font-size:20px">${brl(precoAtual)}</strong></td></tr>
    <tr><td style="padding:4px 12px 4px 0">Preço desejado:</td><td>${brl(alvo)}</td></tr>
    <tr><td style="padding:4px 12px 4px 0">Abaixo do alvo:</td><td>${brl(Math.max(alvo - precoAtual, 0))}</td></tr>
  </table>
  <a href="${esc(url)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none">Ver oferta</a>
  <p style="color:#6b7280;font-size:12px;margin-top:24px">Enviado pelo Price Monitor</p>
</div>`;

  return {
    from: cfg().from || 'price-monitor@localhost',
    to: destinatario,
    subject: `🔔 Alerta de preço: ${produto.nome.slice(0, 80)}`,
    text,
    html,
  };
}

async function enviar(msg: nodemailer.SendMailOptions): Promise<boolean> {
  const c = cfg();
  if (!c.user || !c.pass) {
    console.warn('Email não configurado (EMAIL_USER / EMAIL_PASSWORD)');
    return false;
  }
  try {
    const transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.port === 465,
      auth: { user: c.user, pass: c.pass },
      connectionTimeout: 15_000,
    });
    await transport.sendMail(msg);
    return true;
  } catch (e) {
    console.error('Erro ao enviar email:', (e as Error).message);
    return false;
  }
}

export const enviarAlerta = (destinatario: string, produto: Produto, preco: number) =>
  enviar(montarAlerta(destinatario, produto, preco));

export const enviarTeste = (destinatario: string) =>
  enviar({
    from: cfg().from,
    to: destinatario,
    subject: '✅ Teste do Price Monitor',
    text: 'Este é um email de teste do Price Monitor.\nSe você recebeu esta mensagem, os alertas estão funcionando!',
  });
