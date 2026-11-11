import type { Metadata } from 'next';
import { BuscarPage } from '@/components/BuscarPage';

export const metadata: Metadata = { title: 'Buscar' };

export default function Page() {
  return <BuscarPage />;
}
