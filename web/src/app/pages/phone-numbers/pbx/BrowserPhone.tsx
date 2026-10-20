/**
 * Telefone do navegador da central PBX — REMOVIDO da interface (2026-10-19): a conta Fonio ao vivo (plano completo,
 * fonio-live2/E-numeros) não tem números PBX nem telefone no navegador; o menu "Adicionar número de telefone" tem só
 * Adicionar número de telefone · Criar número SIP · Importar número.
 * O componente continua exportado (vazio) porque a casca do app (AppShell) ainda o monta; a implementação anterior
 * fica preservada fora do projeto (backup da sessão). O modelo de dados (`./model`) segue em uso por outras telas.
 */
export function BrowserPhone() {
  return null
}
