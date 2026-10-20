/**
 * Vagas e valores da página Carreiras — conteúdo ilustrativo (a referência [229]–[232] traz vagas,
 * salários em euro e números de crescimento da Fonio, que não podem ser atribuídos à Kloel).
 */
export interface Job {
  slug: string
  title: string
  department: 'Engenharia' | 'Vendas' | 'Sucesso do cliente' | 'Marketing'
  team: string
  location: 'São Paulo' | 'Belo Horizonte' | 'Curitiba' | 'Remoto (Brasil)'
  type: 'CLT' | 'PJ' | 'Estágio'
  mode: 'Presencial' | 'Híbrido' | 'Remoto'
  salary: string
  equity?: boolean
  summary: string
  responsibilities: string[]
  requirements: string[]
}

/** Vagas abertas publicadas. Sem vagas no momento: a página oferece a candidatura espontânea (enviada ao time por e-mail). */
export const JOBS: Job[] = []

export const VALUES = [
  { title: 'Dono do resultado', text: 'Você cuida da sua área como se fosse a sua empresa.' },
  { title: 'Feedback direto', text: 'Ser direto aumenta a velocidade.' },
  { title: 'Simplicidade', text: 'Menos estrutura, mais entregas.' },
  { title: 'Sem reuniões recorrentes', text: 'Assíncrono e focado por padrão. Síncrono só quando realmente faz sentido.' },
]
