import type { Metadata } from 'next';
import { AlertasPage } from '@/components/AlertasPage';

export const metadata: Metadata = { title: 'Meus alertas' };

export default function Page() {
  return <AlertasPage />;
}
