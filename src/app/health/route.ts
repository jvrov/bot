import { NextResponse } from 'next/server';
import { emailConfigurado } from '@/lib/notifier';
import { tipoBanco } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** Diagnóstico: mostra o que está configurado (nunca os valores). */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    email_configurado: emailConfigurado(),
    email_user_definido: !!process.env.EMAIL_USER,
    email_password_definido: !!process.env.EMAIL_PASSWORD,
    banco: tipoBanco(),
    cron_configurado: !!process.env.CRON_SECRET,
    ambiente: process.env.VERCEL_ENV ?? 'local',
  });
}
