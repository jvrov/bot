import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { AppProvider } from '@/components/AppState';
import { Header } from '@/components/Header';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Price Monitor', template: '%s · Price Monitor' },
  description: 'Diga o que você quer comprar. O Price Monitor encontra nas lojas e avisa quando o preço baixar.',
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%234f46e5'/><path d='M7 11l6 6 4-4 8 8' stroke='white' stroke-width='3' fill='none' stroke-linecap='round' stroke-linejoin='round'/></svg>",
  },
};

export const viewport: Viewport = { themeColor: '#4f46e5', width: 'device-width', initialScale: 1 };

// Aplica o tema antes de pintar a tela (evita "piscar").
const temaInicial = `(function(){var t=null;try{t=localStorage.getItem('theme')}catch(e){}if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=t})()`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppProvider>
          <Header />
          <main>{children}</main>
          <footer className="wrap footer">
            <span>Price Monitor · 100% gratuito · preços lidos direto das lojas, podem variar.</span>
            <a href="https://github.com/jvrov/bot" target="_blank" rel="noopener noreferrer">Código no GitHub</a>
          </footer>
        </AppProvider>
      </body>
    </html>
  );
}
