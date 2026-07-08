// Geração do PDF do RDO com identidade RT Engenharia (jsPDF, client-side).
import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import type { Rdo, RdoAtividade, RdoEfetivo, RdoFoto, RdoAudio, Unidade, AvancoFisico } from './supabase'
import { fmtCoord, fmtDuracao } from './rdo'

const NAVY = '#1B2A4A'
const TERRACOTA = '#C0603B'
const CINZA = '#6c757d'

interface AvancoDoDia extends AvancoFisico { tarefaNome: string; unidadeNome: string }

export interface DadosPdfRdo {
  rdo: Rdo
  obraNome: string
  atividades: RdoAtividade[]
  efetivo: RdoEfetivo[]
  fotos: RdoFoto[]
  audios: RdoAudio[]
  avancosDia: AvancoDoDia[]
  unidades: Unidade[]
}

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const CLIMA_ROTULO: Record<string, string> = { claro: 'Claro', nublado: 'Nublado', chuvoso: 'Chuvoso' }

async function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export async function gerarPdfRdo(d: DadosPdfRdo): Promise<void> {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

  const nomeUnidade = (uid: string | null) => d.unidades.find(u => u.id === uid)?.nome ?? '—'

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
      if (d.rdo.status === 'rascunho') {
        pdf.setFontSize(60)
        pdf.setTextColor('#e9b8a5')
        pdf.text('RASCUNHO', W / 2, 160, { align: 'center', angle: 40 })
      }
    }
  }

  function novaPagina() {
    pdf.addPage()
    y = 16
  }
  function precisa(mm: number) {
    if (y + mm > 280) novaPagina()
  }
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
  pdf.setFontSize(12)
  pdf.setTextColor('#ffffff')
  pdf.text('RELATÓRIO DIÁRIO DE OBRA', W - MR, 12, { align: 'right' })
  pdf.setFontSize(10)
  pdf.setTextColor('#e8c4b3')
  pdf.text(`RDO Nº ${String(d.rdo.numero).padStart(3, '0')} · ${fmtData(d.rdo.data)}`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  texto(`Obra: ${d.obraNome}`, { negrito: true, tamanho: 11 })
  texto(`Data: ${fmtData(d.rdo.data)}${d.rdo.horario_inicio ? ` · Início dos trabalhos: ${d.rdo.horario_inicio.slice(0, 5)}` : ''}`)
  if (d.rdo.status === 'assinado') {
    texto(`Assinado por ${d.rdo.assinado_por_nome} em ${new Date(d.rdo.assinado_em!).toLocaleString('pt-BR')} · Local da assinatura: ${fmtCoord(d.rdo.assinatura_lat, d.rdo.assinatura_lng, d.rdo.assinatura_precisao_m)}`, { cor: CINZA, tamanho: 8.5 })
  }

  // ---------- clima ----------
  titulo('Condições climáticas')
  const clima = (rot: string, c: string | null, t: boolean | null) =>
    `${rot}: ${c ? CLIMA_ROTULO[c] : 'não informado'} · ${t === null ? 'trabalhável não informado' : t ? 'trabalhável' : 'NÃO trabalhável'}`
  texto(clima('Manhã', d.rdo.clima_manha, d.rdo.clima_manha_trabalhavel))
  texto(clima('Tarde', d.rdo.clima_tarde, d.rdo.clima_tarde_trabalhavel))

  // ---------- efetivo ----------
  titulo('Efetivo do dia')
  if (d.efetivo.length === 0) texto('Não informado.', { cor: CINZA })
  else {
    for (const e of d.efetivo) texto(`• ${e.quantidade}× ${e.funcao}${e.empresa ? ` — ${e.empresa}` : ''}`, { indent: 2 })
    texto(`Total: ${d.efetivo.reduce((a, e) => a + e.quantidade, 0)} pessoas`, { negrito: true })
  }

  // ---------- serviços ----------
  titulo('Serviços executados')
  if (d.avancosDia.length === 0 && d.atividades.length === 0) texto('Nenhum serviço registrado.', { cor: CINZA })
  for (const a of d.avancosDia) {
    texto(`• ${a.unidadeNome} — ${a.tarefaNome}: ${a.quantidade !== null ? `${a.quantidade} · ` : ''}${a.percentual}% (avanço físico)`, { indent: 2 })
  }
  for (const a of d.atividades) {
    texto(`• ${nomeUnidade(a.unidade_id)} — ${a.descricao}`, { indent: 2 })
  }

  // ---------- acidentes ----------
  titulo('Acidentes')
  if (d.rdo.acidente) {
    texto('HOUVE ACIDENTE:', { negrito: true, cor: '#a33030' })
    texto(d.rdo.acidente_descricao ?? '(sem descrição)', { indent: 2 })
  } else texto('Sem acidentes no dia.')

  // ---------- observações ----------
  if (d.rdo.observacoes || d.audios.length > 0) {
    titulo('Observações')
    if (d.rdo.observacoes) texto(d.rdo.observacoes)
    d.audios.forEach((a, i) => {
      texto(`🎙 Áudio ${i + 1} — duração ${fmtDuracao(a.duracao_seg)} · gravado às ${new Date(a.gravado_em).toLocaleTimeString('pt-BR').slice(0, 5)} · SHA-256 ${a.hash_sha256.slice(0, 16)}… (arquivo no aplicativo)`, { cor: CINZA, tamanho: 8.5 })
    })
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
        const { data: blob } = await supabase.storage.from('rdo').download(f.path)
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

  // ---------- assinatura ----------
  if (d.rdo.status === 'assinado' && d.rdo.assinatura_imagem) {
    precisa(50)
    y += 6
    pdf.addImage(d.rdo.assinatura_imagem, 'PNG', W / 2 - 35, y, 70, 23)
    y += 25
    pdf.setDrawColor('#222222')
    pdf.setLineWidth(0.3)
    pdf.line(W / 2 - 45, y, W / 2 + 45, y)
    y += 4.5
    pdf.setFontSize(9.5)
    pdf.setTextColor('#222222')
    pdf.setFont('helvetica', 'bold')
    pdf.text(d.rdo.assinado_por_nome ?? '', W / 2, y, { align: 'center' })
    y += 4.5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(CINZA)
    pdf.text(`Assinado digitalmente em ${new Date(d.rdo.assinado_em!).toLocaleString('pt-BR')}`, W / 2, y, { align: 'center' })
  }

  rodape()
  pdf.save(`RDO_${String(d.rdo.numero).padStart(3, '0')}_${d.rdo.data}.pdf`)
}
