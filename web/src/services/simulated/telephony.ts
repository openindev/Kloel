import type { TelephonyService, LiveCallEvent } from '../types'
import { runSteps, hash, SimulatedError, consumeFailureFlag } from '../runtime'

export const simulatedTelephony: TelephonyService = {
  async requestDemoCallback(phone, onProgress) {
    const digits = phone.replace(/\D/g, '')
    if (digits.length < 10) throw new SimulatedError('Digite um número de telefone válido.', 'INVALID_PHONE')
    await runSteps(
      [{ label: 'Validando número', ms: 700 }, { label: 'Preparando assistente de demonstração', ms: 1000 }, { label: 'Ligação concluída', ms: 800 }],
      onProgress,
      { fail: digits.endsWith('0000') ? 'A operadora recusou a chamada.' : false },
    )
    return { reference: `KL-${(hash(digits) % 1e6).toString().padStart(6, '0')}` }
  },
  startTestCall(agent, knowledge, onEvent) {
    let stopped = false
    const timers: ReturnType<typeof setTimeout>[] = []
    let t0 = 0
    const elapsed = () => Math.round((Date.now() - t0) / 1000)
    const emit = (e: LiveCallEvent) => !stopped && onEvent(e)
    const fail = consumeFailureFlag()
    emit({ type: 'status', status: 'connecting' })
    timers.push(setTimeout(() => {
      if (fail) {
        emit({ type: 'ended', reason: 'A chamada não foi completada. Verifique a conexão e tente novamente.' })
        stopped = true
        return
      }
      t0 = Date.now()
      emit({ type: 'status', status: 'live' })
      emit({ type: 'line', line: { t: 0, speaker: 'assistant', text: agent.greeting } })
    }, 1400))
    const answer = (text: string) => {
      const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
      const hit = knowledge.find((k) => words.some((w) => k.question.toLowerCase().includes(w)))
      return hit ? hit.answer : 'Entendi. Posso ajudar com mais alguma coisa?'
    }
    return {
      hangup: () => {
        if (stopped) return
        emit({ type: 'ended', reason: 'Você encerrou a chamada' })
        stopped = true
        timers.forEach(clearTimeout)
      },
      say: (text: string) => {
        if (stopped || !t0) return
        emit({ type: 'line', line: { t: elapsed(), speaker: 'caller', text } })
        timers.push(setTimeout(() => emit({ type: 'line', line: { t: elapsed(), speaker: 'assistant', text: answer(text) } }), 1100))
      },
    }
  },
  async searchAvailableNumbers(countryCode) {
    const base = hash(countryCode)
    return Array.from({ length: 5 }, (_, i) => `${countryCode} 90000-${String((base + i * 37) % 10000).padStart(4, '0')}`)
  },
  async purchaseNumber(countryLabel, onProgress) {
    await runSteps([{ label: 'Reservando número', ms: 900 }, { label: 'Ativando número', ms: 900 }], onProgress)
    const code = countryLabel.match(/\(\+(\d+)\)/)?.[1] ?? '55'
    const n = (Date.now() % 10000).toString().padStart(4, '0')
    return { number: code === '55' ? `+55 11 90000-${n}` : `+${code} 0000 ${n}` }
  },
  async verifyImportedNumber(number, onProgress) {
    if (number.replace(/\D/g, '').length < 10) throw new SimulatedError('Número de telefone inválido.', 'INVALID_PHONE')
    await runSteps([{ label: 'Gerando código de verificação', ms: 700 }, { label: 'Ligando para o número', ms: 1200 }], onProgress)
    return { code: String(100000 + (hash(number) % 900000)) }
  },
  async confirmImportCode(number, code) {
    await new Promise((r) => setTimeout(r, 600))
    return String(100000 + (hash(number) % 900000)) === code.trim()
  },
}
