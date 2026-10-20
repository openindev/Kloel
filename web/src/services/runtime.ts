import { useStore } from '@/data/store'
import { sleep } from '@/lib/utils'

/**
 * Infraestrutura comum dos adaptadores SIMULADOS.
 * Toda operação que dependeria do motor (IA, telefonia, mensageria, cobrança, OAuth)
 * passa por runSteps(): emite progresso, pode falhar de forma determinística e é repetível.
 */
export class SimulatedError extends Error {
  code: string
  constructor(message: string, code = 'SIMULATED_FAILURE') {
    super(message)
    this.code = code
  }
}

export interface Step {
  label: string
  ms: number
}

export type ProgressFn = (p: { step: number; total: number; label: string; percent: number }) => void

/** Consome o interruptor "Simular falha na próxima operação" do painel de demonstração. */
export function consumeFailureFlag(): boolean {
  const st = useStore.getState()
  if (st.db.ui.failNextOperation) {
    st.setUi({ failNextOperation: false })
    return true
  }
  return false
}

/** Velocidade global das simulações (para testes automatizados: localStorage kloel-demo:speed=0.05). */
function speedFactor() {
  try {
    const v = Number(window.localStorage.getItem('kloel-demo:speed'))
    return Number.isFinite(v) && v > 0 ? v : 1
  } catch {
    return 1
  }
}

export async function runSteps(steps: Step[], onProgress?: ProgressFn, opts: { fail?: string | false; failAtStep?: number } = {}) {
  const forced = consumeFailureFlag()
  const failMessage = opts.fail || (forced ? 'Não foi possível concluir a operação. Tente novamente.' : undefined)
  const failAt = opts.failAtStep ?? Math.max(0, Math.floor(steps.length / 2))
  const f = speedFactor()
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!
    onProgress?.({ step: i, total: steps.length, label: s.label, percent: Math.round((i / steps.length) * 100) })
    await sleep(s.ms * f)
    if (failMessage && i === failAt) throw new SimulatedError(failMessage)
  }
  onProgress?.({ step: steps.length, total: steps.length, label: 'Concluído', percent: 100 })
}

/** Hash determinístico de string (FNV-1a) usado para gerar resultados reproduzíveis. */
export function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}
