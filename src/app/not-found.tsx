import Link from 'next/link';

export default function NotFound() {
  return (
    <section className="wrap" style={{ padding: '80px 20px', textAlign: 'center' }}>
      <h1 className="page-title">Página não encontrada</h1>
      <p className="muted">O endereço que você abriu não existe.</p>
      <Link className="btn btn-primary" href="/buscar">Ir para a busca</Link>
    </section>
  );
}
