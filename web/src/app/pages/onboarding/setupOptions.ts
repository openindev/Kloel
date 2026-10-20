import type { LucideIcon } from 'lucide-react'
import {
  ShoppingBag, Stethoscope, Building, Hammer, FileText, Car, BedDouble, Workflow, UtensilsCrossed, ShieldCheck, PersonStanding, MonitorSmartphone,
  Store, Wrench, Factory, School, Landmark, Users, Ellipsis, Handshake, Facebook, Search, Newspaper, Mic, Youtube, Linkedin, Video, Instagram,
  CalendarDays, User,
} from 'lucide-react'

/**
 * Opções do assistente de configuração (referências [454]–[457]).
 * Rótulos truncados na tela original foram completados (INFERIDO): "Consultório médico", "Administração de imóveis",
 * "Consultoria tributária", "Escritório de advocacia", "Corretora de seguros", "Energia e meio ambiente",
 * "Empresa de serviços", "Fornecedor de software", "Instituição de ensino".
 */
export const SECTORS: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'ecommerce', label: 'E-commerce', icon: ShoppingBag },
  { value: 'medical_office', label: 'Consultório médico', icon: Stethoscope },
  { value: 'property_management', label: 'Administração de imóveis', icon: Building },
  { value: 'technical_services', label: 'Serviços técnicos', icon: Hammer },
  { value: 'tax_consulting', label: 'Consultoria tributária', icon: FileText },
  { value: 'law_firm', label: 'Escritório de advocacia', icon: FileText },
  { value: 'car_dealership', label: 'Concessionária', icon: Car },
  { value: 'hotel', label: 'Hotel', icon: BedDouble },
  { value: 'freelancer', label: 'Autônomo', icon: Workflow },
  { value: 'gastronomy', label: 'Gastronomia', icon: UtensilsCrossed },
  { value: 'insurance_broker', label: 'Corretora de seguros', icon: ShieldCheck },
  { value: 'recruiting', label: 'Recrutamento', icon: PersonStanding },
  { value: 'outbound_sales', label: 'Vendas (outbound)', icon: MonitorSmartphone },
  { value: 'consulting', label: 'Consultoria', icon: Workflow },
  { value: 'retail', label: 'Varejo', icon: Store },
  { value: 'energy', label: 'Energia e meio ambiente', icon: Wrench },
  { value: 'manufacturing', label: 'Produção', icon: Factory },
  { value: 'service_company', label: 'Empresa de serviços', icon: MonitorSmartphone },
  { value: 'software_vendor', label: 'Fornecedor de software', icon: MonitorSmartphone },
  { value: 'hospital', label: 'Hospital', icon: BedDouble },
  { value: 'education', label: 'Instituição de ensino', icon: School },
  { value: 'government', label: 'Governo', icon: Landmark },
  { value: 'association', label: 'Associação', icon: Users },
  { value: 'other', label: 'Outro', icon: Ellipsis },
]

export const COMPANY_SIZES: { value: string; label: string }[] = [
  { value: 'solo', label: 'Só eu' },
  { value: '1-5', label: '1–5' },
  { value: '5-25', label: '5–25' },
  { value: '25-100', label: '25–100' },
  { value: '100-500', label: '100–500' },
  { value: '500-2000', label: '500–2000' },
  { value: '2000+', label: 'mais de 2000' },
]

export const REFERRAL_SOURCES: { value: string; label: string; icon: LucideIcon }[] = [
  { value: 'partner_agency', label: 'Agência parceira', icon: Handshake },
  { value: 'facebook', label: 'Facebook', icon: Facebook },
  { value: 'google', label: 'Google', icon: Search },
  { value: 'press', label: 'Imprensa', icon: Newspaper },
  { value: 'other', label: 'Outro', icon: Ellipsis },
  { value: 'podcast', label: 'Podcast', icon: Mic },
  { value: 'youtube', label: 'YouTube', icon: Youtube },
  { value: 'linkedin', label: 'LinkedIn', icon: Linkedin },
  { value: 'tiktok', label: 'TikTok', icon: Video },
  { value: 'instagram', label: 'Instagram', icon: Instagram },
  { value: 'event', label: 'Evento / webinar', icon: CalendarDays },
  { value: 'friend', label: 'Amigo / colega', icon: User },
]

export const labelOf = (list: { value: string; label: string }[], v?: string) => list.find((o) => o.value === v)?.label
