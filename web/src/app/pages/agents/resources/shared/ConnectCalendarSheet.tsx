import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { CalendarConnection } from '@/domain/types'
import { SideSheet } from '@/components/app/SideSheet'
import { Button } from '@/components/ui/button'
import { GoogleIcon, MicrosoftIcon } from '@/components/brand/icons'
import { ConnectCalendarFlow } from './ConnectCalendarFlow'

/**
 * Folha empilhada "Conectar calendário" (fonio-live2 C-assistentes/50), aberta por "Adicionar novo evento" no seletor
 * "Tipo de evento" do Agendador quando ainda não há calendário: logos Google + Microsoft, texto, botão preto de largura total
 * "Conectar calendário" (abre o fluxo "Para quem é esta conexão?" → conexão OAuth simulada) e o link para as conexões da empresa.
 */
export function ConnectCalendarSheet({ open, onOpenChange, onConnected }: { open: boolean; onOpenChange: (o: boolean) => void; onConnected?: (c: CalendarConnection) => void }) {
  const [flow, setFlow] = useState(false)
  return (
    <>
      <SideSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Conectar calendário"
        footer={
          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4" data-testid="connect-calendar-sheet">
          <div className="flex items-center justify-center gap-5 pb-2 pt-2">
            <GoogleIcon className="size-9" />
            <MicrosoftIcon className="size-9" />
          </div>
          <p className="text-sm text-muted-foreground">Conecte um calendário do Google ou da Microsoft para usar nos seus agendamentos.</p>
          <Button type="button" className="w-full" onClick={() => setFlow(true)}>
            Conectar calendário
          </Button>
          <Link to="/app/company-settings?tab=connections" className="self-center text-sm font-medium text-foreground hover:underline">
            Ver todos os calendários nas configurações da empresa
          </Link>
        </div>
      </SideSheet>
      <ConnectCalendarFlow
        open={flow}
        onOpenChange={setFlow}
        onConnected={(c) => {
          onConnected?.(c)
          onOpenChange(false)
        }}
      />
    </>
  )
}
