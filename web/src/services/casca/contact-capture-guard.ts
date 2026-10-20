import type { ContactSettings } from '@/domain/types'
import type { CaptureState } from '../engine/crm-capture'

/** Preferences alone do not prove that automatic capture/filling is authorized and running. */
export function assertAutomaticContactSettings(input: Pick<ContactSettings, 'autoCapture' | 'smartFields'>, state: CaptureState) {
  const grant = state.grant
  const automatic = state.schedulerRunning && grant?.effective && grant.automaticApplication && grant.policy.mode === 'auto_create_fill_empty'
  if (input.autoCapture && !(automatic && grant?.captureEffective && grant.policy.captureContacts)) {
    throw Error('A captura automática ainda não foi autorizada para esta configuração. Salve as configurações de contatos (ou use “Reativar”) para autorizá-la; as propostas existentes podem ser revisadas em Conversas.')
  }
  const fields = input.smartFields.filter(field => field.aiFill)
  if (fields.length && !(automatic && grant?.aiFillEffective && fields.every(field => grant.policy.allowedFieldIds.includes(field.id)))) {
    throw Error('O preenchimento automático ainda não foi autorizado para estes campos. Salve as configurações de contatos (ou use “Reativar”) para autorizá-lo; as propostas existentes podem ser revisadas em Conversas.')
  }
}
