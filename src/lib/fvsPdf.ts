// Geração do PDF da FVS com identidade RT Engenharia (jsPDF, client-side).
// Documento de qualidade: cabeçalho, identificação, critérios, e cada
// rodada de verificação com respostas C/NC/NA por item. Fotos ao final.
import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import type {
  Fvs, FvsModelo, FvsModeloItem, FvsVerificacao, FvsResposta, FvsFoto, StatusFvs, RespostaFvs,
} from './supabase'
import { fmtCoord } from './rdo'

const NAVY = '#1B2A4A'
const TERRACOTA = '#C0603B'
const CINZA = '#6c757d'

const STATUS_LABEL: Record<StatusFvs, string> = {
  em_andamento: 'Em andamento',
  aprovada: 'Aprovada',
  aprovada_restricao: 'Aprovada com restrição',
  reprovada: 'Reprovada',
}
const RESP_LABEL: Record<RespostaFvs, string> = { c: 'C', nc: 'NC', na: 'NA' }
const RESP_COR: Record<RespostaFvs, string> = { c: '#1e6b2e', nc: '#a33030', na: '#6c757d' }

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

async function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export interface DadosPdfFvs {
  fvs: Fvs
  modelo: FvsModelo
  itens: FvsModeloItem[]
  verificacoes: FvsVerificacao[]
  obraNome: string
  unidadeNome: string
  tarefaNome?: string | null
  autores: Map<string, string>   // id -> nome
  fotos: FvsFoto[]
}

export async function gerarPdfFvs(d: DadosPdfFvs): Promise<void> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

  const naoConcluida = d.fvs.status === 'em_andamento'

  function rodape() {
    const total = pdf.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i)
      pdf.setDrawColor(TERRACOTA)
      pdf.setLineWidth(0.5)
      pdf.line(ML, 285, W - MR, 285)
      pdf.setFontSize(7.5)
      pdf.setTextColor(CINZA)
      pdf.setFont('helvetica', 'normal')
      pdf.text('RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, 290)
      pdf.text(`Página ${i} de ${total}`, W - MR, 290, { align: 'right' })
      if (naoConcluida) {
        pdf.setFontSize(58)
        pdf.setTextColor('#e9b8a5')
        pdf.text('EM ANDAMENTO', W / 2, 165, { align: 'center', angle: 40 })
      }
    }
  }

  function novaPagina() { pdf.addPage(); y = 16 }
  function precisa(mm: number) { if (y + mm > 280) novaPagina() }

  function titulo(txt: string) {
    precisa(14)
    y += 3
    pdf.setFillColor(NAVY)
    pdf.rect(ML, y, 2.2, 5.6, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor(NAVY)
    pdf.text(txt.toUpperCase(), ML + 4.5, y + 4.4)
    y += 9
  }

  function texto(txt: string, opts: { negrito?: boolean; cor?: string; tamanho?: number; indent?: number } = {}) {
    pdf.setFont('helvetica', opts.negrito ? 'bold' : 'normal')
    pdf.setFontSize(opts.tamanho ?? 9.5)
    pdf.setTextColor(opts.cor ?? '#222222')
    const indent = opts.indent ?? 0
    const linhas = pdf.splitTextToSize(txt, LARG - indent) as string[]
    for (const l of linhas) {
      precisa(5)
      pdf.text(l, ML + indent, y)
      y += 4.6
    }
  }

  // ---------- cabeçalho ----------
  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor('#c9d2e3')
  pdf.text('Inteligência Aplicada', ML, 18.5)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#ffffff')
  pdf.text('FICHA DE VERIFICAÇÃO DE SERVIÇO', W - MR, 12, { align: 'right' })
  pdf.setFontSize(10)
  pdf.setTextColor('#e8c4b3')
  pdf.text(`${d.modelo.codigo} · ${d.modelo.nome}`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  texto(`Obra: ${d.obraNome}`, { negrito: true, tamanho: 11 })
  texto(`Unidade: ${d.unidadeNome}${d.fvs.local_ambiente ? ` · Local: ${d.fvs.local_ambiente}` : ''}`)
  if (d.tarefaNome) texto(`Tarefa do cronograma: ${d.tarefaNome}`)
  if (d.fvs.equipe_empreiteiro) texto(`Equipe / empreiteiro: ${d.fvs.equipe_empreiteiro}`)

  // status atual em destaque
  const corStatus = d.fvs.status === 'aprovada' ? '#1e6b2e'
    : d.fvs.status === 'reprovada' ? '#a33030'
    : d.fvs.status === 'aprovada_restricao' ? '#8a6d1a' : '#1c4f8a'
  texto(`Situação atual: ${STATUS_LABEL[d.fvs.status]}`, { negrito: true, cor: corStatus, tamanho: 10.5 })

  if (d.modelo.objetivo) { titulo('Objetivo'); texto(d.modelo.objetivo) }
  if (d.modelo.normas) { titulo('Normas de referência'); texto(d.modelo.normas, { cor: CINZA, tamanho: 8.5 }) }
  if (d.modelo.criterios_aceitacao) { titulo('Critérios de aceitação'); texto(d.modelo.criterios_aceitacao) }

  // ---------- respostas por rodada ----------
  // busca respostas de todas as verificações
  const respPorVerif = new Map<string, Map<string, FvsResposta>>()
  const ids = d.verificacoes.map(v => v.id)
  if (ids.length > 0) {
    const { data: resps } = await supabase.from('fvs_respostas').select('*').in('verificacao_id', ids)
    for (const r of resps ?? []) {
      if (!respPorVerif.has(r.verificacao_id)) respPorVerif.set(r.verificacao_id, new Map())
      respPorVerif.get(r.verificacao_id)!.set(r.item_id, r)
    }
  }

  const secoes = [...new Set(d.itens.map(i => i.secao))]

  for (const v of d.verificacoes) {
    const resp = respPorVerif.get(v.id) ?? new Map<string, FvsResposta>()
    const rotuloResultado = v.resultado ? STATUS_LABEL[v.resultado] : 'em andamento'
    const autor = v.concluida_por ? d.autores.get(v.concluida_por) : null
    const quando = v.concluida_em ? new Date(v.concluida_em).toLocaleString('pt-BR') : null

    titulo(`Verificação nº ${v.numero} — ${rotuloResultado}`)
    if (autor && quando) texto(`Concluída por ${autor} em ${quando}`, { cor: CINZA, tamanho: 8.5 })
    if (v.observacao) texto(`Observação: ${v.observacao}`, { cor: CINZA, tamanho: 8.5 })

    for (const secao of secoes) {
      const itensSecao = d.itens.filter(i => i.secao === secao)
      if (itensSecao.length === 0) continue
      precisa(8)
      y += 1
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.setTextColor(NAVY)
      pdf.text(secao, ML + 2, y)
      y += 5

      for (const item of itensSecao) {
        const r = resp.get(item.id)
        precisa(6)
        // marcador de resposta
        pdf.setFont('helvetica', 'bold')
        pdf.setFontSize(8.5)
        pdf.setTextColor(r ? RESP_COR[r.resposta] : '#bbbbbb')
        pdf.text(r ? RESP_LABEL[r.resposta] : '—', ML + 2, y)
        // texto do item
        pdf.setFont('helvetica', 'normal')
        pdf.setFontSize(9)
        pdf.setTextColor('#222222')
        const txtItem = item.texto + (item.criterio ? ` (${item.criterio})` : '')
        const linhas = pdf.splitTextToSize(txtItem, LARG - 14) as string[]
        pdf.text(linhas, ML + 14, y)
        y += linhas.length * 4.3
        // observação do item NC
        if (r?.resposta === 'nc' && r.observacao) {
          precisa(5)
          pdf.setFont('helvetica', 'italic')
          pdf.setFontSize(8)
          pdf.setTextColor('#a33030')
          const obsL = pdf.splitTextToSize(`↳ ${r.observacao}`, LARG - 16) as string[]
          pdf.text(obsL, ML + 16, y)
          y += obsL.length * 3.8
        }
        y += 1
      }
    }

    // assinatura da rodada concluída
    if (v.assinatura_imagem && v.assinado_por_nome) {
      precisa(34)
      y += 3
      try { pdf.addImage(v.assinatura_imagem, 'PNG', ML + 2, y, 52, 17) } catch { /* ignora imagem inválida */ }
      y += 19
      pdf.setDrawColor('#222222')
      pdf.setLineWidth(0.3)
      pdf.line(ML + 2, y, ML + 62, y)
      y += 4
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(8.5)
      pdf.setTextColor('#222222')
      pdf.text(v.assinado_por_nome, ML + 2, y)
      y += 3.8
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(7.5)
      pdf.setTextColor(CINZA)
      const geoAssin = v.assinatura_lat != null ? ` · ${fmtCoord(v.assinatura_lat, v.assinatura_lng, v.assinatura_precisao_m)}` : ''
      pdf.text(`Assinado digitalmente${v.concluida_em ? ` em ${new Date(v.concluida_em).toLocaleString('pt-BR')}` : ''}${geoAssin}`, ML + 2, y)
      y += 4
    }
  }

  // ---------- fotos ----------
  if (d.fotos.length > 0) {
    titulo(`Registro fotográfico (${d.fotos.length})`)
    texto('Fotos carimbadas na captura com data, hora e coordenadas GPS; hash SHA-256 registrado para integridade.', { cor: CINZA, tamanho: 8 })
    const FW = (LARG - 6) / 2
    const FH = FW * 0.75
    let col = 0
    for (const f of d.fotos) {
      try {
        const { data: blob } = await supabase.storage.from('fvs').download(f.path)
        if (!blob) continue
        const dataUrl = await blobParaDataUrl(blob)
        if (col === 0) precisa(FH + 14)
        const x = ML + col * (FW + 6)
        pdf.addImage(dataUrl, 'JPEG', x, y, FW, FH, undefined, 'FAST')
        pdf.setFontSize(7)
        pdf.setTextColor(CINZA)
        const cap = `${new Date(f.capturada_em).toLocaleString('pt-BR')} · ${fmtCoord(f.lat, f.lng, f.precisao_m)}${f.legenda ? ` — ${f.legenda}` : ''}`
        pdf.text(pdf.splitTextToSize(cap, FW) as string[], x, y + FH + 3.2)
        col = 1 - col
        if (col === 0) y += FH + 12
      } catch { /* foto indisponível — segue */ }
    }
    if (col === 1) y += FH + 12
  }

  rodape()
  pdf.save(`FVS_${d.modelo.codigo}_${d.unidadeNome.replace(/\s+/g, '')}_${fmtData(d.fvs.criado_em).replace(/\//g, '-')}.pdf`)
}
