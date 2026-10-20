import '@/domain/ext/billing'
import type { BillingProfile, Invoice, Organization } from '@/domain/types'
import { fmtDateLong, money, stateName } from './lib'

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Fatura DEMONSTRATIVA em HTML (sem valor fiscal) para download ou impressão local. */
export function invoiceHtml(inv: Invoice, profile: BillingProfile | undefined, org: Organization | undefined) {
  const lines = inv.lines?.length ? inv.lines : [{ label: inv.description || 'Assinatura Kloel', amount: inv.amount }]
  const addr = profile
    ? [profile.line1, profile.line2, [profile.city, profile.state ? stateName(profile.state) : ''].filter(Boolean).join(' – '), profile.postalCode, profile.country].filter(Boolean)
    : []
  const status = inv.status === 'paid' ? 'Paga' : inv.status === 'open' ? 'Em aberto' : 'Anulada'
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Fatura ${esc(inv.number)} — Kloel AI (demonstrativa)</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f0f14;margin:40px;max-width:760px}
h1{font-size:22px;margin:0}.muted{color:#6b7280}.brand{color:#585dfe}
.banner{border:1px dashed #f59e0b;background:#fffbeb;color:#92400e;padding:10px 14px;border-radius:10px;font-size:13px;margin:20px 0}
table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td,th{padding:10px 0;border-bottom:1px solid #e5e7eb;text-align:left}
td.r,th.r{text-align:right}.total td{font-weight:700;border-bottom:none}.pill{display:inline-block;padding:2px 8px;border-radius:6px;background:#dcfce7;color:#166534;font-size:12px}
.grid{display:flex;gap:40px;margin-top:24px;font-size:14px}
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start">
<div><div style="font-weight:700;font-size:24px;letter-spacing:-.04em">kloel<span class="brand">.ai</span></div><div class="muted" style="font-size:13px">Fatura demonstrativa</div></div>
<div style="text-align:right"><h1>Fatura ${esc(inv.number)}</h1><div class="muted">${esc(fmtDateLong(inv.date))}</div><div style="margin-top:6px"><span class="pill">${status}</span></div></div>
</div>
<div class="banner">DOCUMENTO DEMONSTRATIVO — sem valor fiscal. Gerado localmente pela casca Kloel AI; nenhuma cobrança real foi realizada.</div>
<div class="grid">
<div><div class="muted">Cobrado de</div><div><strong>${esc(profile?.organizationName || org?.name || '')}</strong></div>${addr.map((l) => `<div>${esc(String(l))}</div>`).join('')}${profile?.taxId ? `<div>CNPJ ${esc(profile.taxId)}</div>` : ''}${profile?.email ? `<div>${esc(profile.email)}</div>` : ''}</div>
<div><div class="muted">Forma de pagamento</div><div>${esc(inv.cardLabel || (profile?.card ? `${profile.card.brand} •••• ${profile.card.last4}` : '—'))}</div></div>
</div>
<table><thead><tr><th>Descrição</th><th class="r">Valor</th></tr></thead><tbody>
${lines.map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${esc(money(l.amount))}</td></tr>`).join('\n')}
<tr class="total"><td>Total</td><td class="r">${esc(money(inv.amount))}</td></tr>
</tbody></table>
</body></html>`
}

export function downloadInvoice(inv: Invoice, profile: BillingProfile | undefined, org: Organization | undefined) {
  const blob = new Blob([invoiceHtml(inv, profile, org)], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `fatura-${inv.number}-demonstrativa.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Abre a impressão (salvar como PDF pelo navegador) usando um iframe oculto. */
export function printInvoice(inv: Invoice, profile: BillingProfile | undefined, org: Organization | undefined) {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) return iframe.remove()
  doc.open()
  doc.write(invoiceHtml(inv, profile, org))
  doc.close()
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
    } finally {
      setTimeout(() => iframe.remove(), 1500)
    }
  }, 150)
}
