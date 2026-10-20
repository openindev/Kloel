import { toast } from 'sonner'
export class NotConnectedError extends Error {
  constructor() { super('Esta ação ainda não está disponível. Nenhuma alteração foi salva.'); this.name = 'NotConnectedError' }
}
export function unavailable(): never { const error = new NotConnectedError(); toast.error(error.message); throw error }
