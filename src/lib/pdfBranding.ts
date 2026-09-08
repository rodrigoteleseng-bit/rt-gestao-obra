// Identidade visual por obra nos PDFs (logo/rodapé próprios) — decide qual marca usar.
// Não desenha nenhum cabeçalho: cada gerador de PDF mantém sua própria geometria
// (são 3 diferentes hoje — ver docs/superpowers/specs/2026-09-04-marca-por-obra-pdf-design.md §2).
import type { jsPDF } from 'jspdf'
import { supabase } from './supabase'

export interface IdentidadeMarca {
  logoBase64: string | null   // null = sem logo própria, usa o texto padrão RT
  nomeMarca: string           // 'RT ENGENHARIA' por padrão; '' quando há logo (a imagem já tem o nome)
  tagline: string             // 'Inteligência Aplicada' por padrão; '' quando há logo
  rodapeTexto: string
}

const IDENTIDADE_PADRAO_RT: IdentidadeMarca = {
  logoBase64: null,
  nomeMarca: 'RT ENGENHARIA',
  tagline: 'Inteligência Aplicada',
  rodapeTexto: 'RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada',
}

async function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export async function carregarIdentidadeObra(
  obra: { logo_url: string | null; rodape_pdf: string | null } | null | undefined,
): Promise<IdentidadeMarca> {
  if (!obra?.logo_url) return IDENTIDADE_PADRAO_RT
  const { data: blob, error } = await supabase.storage.from('obras-logos').download(obra.logo_url)
  if (error || !blob) return IDENTIDADE_PADRAO_RT
  const logoBase64 = await blobParaDataUrl(blob)
  return {
    logoBase64,
    nomeMarca: '',
    tagline: '',
    rodapeTexto: obra.rodape_pdf || IDENTIDADE_PADRAO_RT.rodapeTexto,
  }
}

// Largura proporcional (mm) da logo, dada a altura desejada — evita distorcer a
// imagem quando a proporção real não é conhecida de antemão (obras diferentes podem
// ter logos com proporções diferentes da usada na ENGEFER Sudoeste).
export function larguraProporcional(pdf: jsPDF, dataUrl: string, alturaMm: number): number {
  const props = pdf.getImageProperties(dataUrl)
  return alturaMm * (props.width / props.height)
}
