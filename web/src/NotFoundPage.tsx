import { Link } from 'react-router-dom'
import { KloelLogo } from '@/components/brand/KloelLogo'
import { useNoIndex } from '@/lib/useNoIndex'

export default function NotFoundPage() {
  useNoIndex()
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-white p-8 text-center">
      <KloelLogo size="lg" />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">O endereço acessado não existe.</p>
      </div>
      <div className="flex gap-2">
        <Link to="/" className="rounded-md border px-4 py-2 text-sm hover:bg-accent">Ir para o site</Link>
        <Link to="/app" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Abrir o aplicativo</Link>
      </div>
    </div>
  )
}
