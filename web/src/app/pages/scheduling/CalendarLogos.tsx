/** Logo estilizado do Google Agenda (diálogo "Conectar calendário" — na captura ao vivo: logos Google Calendar + Microsoft). */
export function GoogleCalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#fff" d="M12 12h24v24H12z" />
      <path fill="#4285F4" d="M9 6h30a3 3 0 0 1 3 3v3H6V9a3 3 0 0 1 3-3z" />
      <path fill="#1967D2" d="M36 12h6v24h-6z" />
      <path fill="#FBBC04" d="M6 12h6v24H6z" />
      <path fill="#34A853" d="M6 36h30v6H9a3 3 0 0 1-3-3z" />
      <path fill="#EA4335" d="M36 36h6l-6 6z" />
      <path fill="#188038" d="M36 42v-6h6z" opacity=".35" />
      <text x="24" y="30.5" textAnchor="middle" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="13" fill="#4285F4">
        31
      </text>
    </svg>
  )
}
