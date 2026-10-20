/** Marcador temporário usado apenas durante a construção (nenhuma tela final deve usá-lo). */
export function ModulePending({ title }: { title: string }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-10">
      <div className="rounded-xl border border-dashed p-8 text-center">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">Módulo em construção.</p>
      </div>
    </div>
  )
}
