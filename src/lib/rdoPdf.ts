// Geração do PDF do RDO com identidade RT Engenharia (jsPDF, client-side).
import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import type { Rdo, RdoAtividade, RdoEfetivo, RdoMaquinario, SituacaoMaquinario, RdoFoto, RdoAudio, Unidade, AvancoFisico } from './supabase'
import { fmtCoord, fmtDuracao } from './rdo'
import { carregarIdentidadeObra, larguraProporcional, type IdentidadeMarca } from './pdfBranding'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const AZUL_MEDIO = '#3A7CA5'
const CINZA = '#6c757d'
const SITUACAO_MAQUINARIO_LABEL: Record<SituacaoMaquinario, string> = {
  em_operacao: 'Em operação',
  parada: 'Parada',
  manutencao: 'Manutenção',
}

interface AvancoDoDia extends AvancoFisico { tarefaNome: string; unidadeNome: string }
export interface FvsDoDiaPdf { codigo: string; nome: string; unidadeNome: string; resultado: string }
const RESULTADO_FVS: Record<string, string> = { aprovada: 'Aprovada', aprovada_restricao: 'Aprovada c/ restricao', reprovada: 'Reprovada' }

export interface DadosPdfRdo {
  rdo: Rdo
  obraNome: string
  obraDataInicio: string | null
  obraDataFimPrevista: string | null
  identidade: IdentidadeMarca
  atividades: RdoAtividade[]
  efetivo: RdoEfetivo[]
  maquinarios: RdoMaquinario[]
  fotos: RdoFoto[]
  audios: RdoAudio[]
  avancosDia: AvancoDoDia[]
  fvsDia?: FvsDoDiaPdf[]
  unidades: Unidade[]
}

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const CLIMA_ROTULO: Record<string, string> = { claro: 'Claro', nublado: 'Nublado', chuvoso: 'Chuvoso' }

// Dias corridos entre duas datas 'YYYY-MM-DD' (UTC, sem hora — evita
// desvio de fuso horário na subtração de dias corridos).
function diffDias(a: string, b: string): number {
  const da = new Date(`${a}T00:00:00Z`).getTime()
  const db = new Date(`${b}T00:00:00Z`).getTime()
  return Math.round((db - da) / 86400000)
}

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
      pdf.text(d.identidade.rodapeTexto, ML, 290)
      pdf.text(`Página ${i} de ${total}`, W - MR, 290, { align: 'right' })
      if (d.rdo.status === 'rascunho') {
        pdf.setFontSize(60)
        pdf.setTextColor('#D9BDA9')
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
  // Barra navy de largura inteira (mesmo padrão do quadro "Dados para
  // Emissão de Nota Fiscal" do PDF de Medição) — substitui o traço fino
  // + texto que era usado antes, aplicado uniformemente a todos os
  // títulos de seção do RDO.
  function titulo(txt: string) {
    precisa(16)
    y += 4
    const alturaBarra = 7
    pdf.setFillColor(NAVY)
    pdf.rect(ML, y, LARG, alturaBarra, 'F')
    pdf.setFillColor(TERRACOTA)
    pdf.rect(ML, y + alturaBarra - 0.8, LARG, 0.8, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor('#ffffff')
    pdf.text(txt.toUpperCase(), ML + 5, y + 5)
    y += alturaBarra + 5
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
  // Altura maior que antes (38mm, era 30mm) pra caber as 3 linhas de
  // prazo abaixo do número do RDO. Prazo Contratual/Decorrido/Restante
  // vêm de obraDataInicio/obraDataFimPrevista (Dados da Obra) — quando
  // a obra não tem essas datas cadastradas, mostra "—" em vez de
  // inventar um número.
  const ALTURA_CABECALHO = 38
  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, ALTURA_CABECALHO, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, ALTURA_CABECALHO, W, 1.4, 'F')
  pdf.setTextColor('#ffffff')
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text('Inteligência Aplicada', ML, 18.5)
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor('#ffffff')
  pdf.text('RELATÓRIO DIÁRIO DE OBRA', W - MR, 12, { align: 'right' })
  pdf.setFontSize(10)
  pdf.setTextColor('#D0AE95')
  pdf.text(`RDO Nº ${String(d.rdo.numero).padStart(3, '0')} · ${fmtData(d.rdo.data)}`, W - MR, 18.5, { align: 'right' })

  const prazoContratual = d.obraDataInicio && d.obraDataFimPrevista ? diffDias(d.obraDataInicio, d.obraDataFimPrevista) : null
  const prazoDecorrido = d.obraDataInicio ? diffDias(d.obraDataInicio, d.rdo.data) : null
  const prazoRestante = d.obraDataFimPrevista ? diffDias(d.rdo.data, d.obraDataFimPrevista) : null
  const fmtPrazo = (dias: number | null) => dias === null ? '—' : `${dias} dias`
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.setTextColor('#ffffff')
  pdf.text(`Prazo Contratual: ${fmtPrazo(prazoContratual)}`, W - MR, 24, { align: 'right' })
  pdf.text(`Prazo Decorrido: ${fmtPrazo(prazoDecorrido)}`, W - MR, 28.5, { align: 'right' })
  pdf.text(`Prazo Restante: ${fmtPrazo(prazoRestante)}`, W - MR, 33, { align: 'right' })

  y = ALTURA_CABECALHO + 9

  // ---------- identificação ----------
  texto(`Obra: ${d.obraNome}`, { negrito: true, tamanho: 11 })
  texto(`Data: ${fmtData(d.rdo.data)}${d.rdo.horario_inicio ? ` · Início dos trabalhos: ${d.rdo.horario_inicio.slice(0, 5)}` : ''}`)
  if (d.rdo.status === 'assinado') {
    texto(`Assinado por ${d.rdo.assinado_por_nome} em ${new Date(d.rdo.assinado_em!).toLocaleString('pt-BR')} · Local da assinatura: ${fmtCoord(d.rdo.assinatura_lat, d.rdo.assinatura_lng, d.rdo.assinatura_precisao_m)}`, { cor: CINZA, tamanho: 8.5 })
  }

  // ---------- clima ----------
  // Tabela (era texto corrido) — Período/Tempo/Condição em colunas
  // bordadas, igual ao modelo que o Rodrigo pediu pra seguir. Sem ícone
  // de clima aqui: o emoji força jsPDF a codificar a string inteira em
  // 2 bytes/caractere (a fonte helvetica padrão só cobre WinAnsi de 1
  // byte), corrompendo o texto — mesmo bug já corrigido no PDF de
  // Pedido de Compra ("⚡ SIM" virando lixo).
  titulo('Condições climáticas')
  const colPeriodo = 30
  const colTempo = 76
  function linhaClima(periodoLabel: string, c: string | null, t: boolean | null) {
    const alturaLinha = 7
    precisa(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.rect(ML, y, LARG, alturaLinha, 'S')
    pdf.line(ML + colPeriodo, y, ML + colPeriodo, y + alturaLinha)
    pdf.line(ML + colPeriodo + colTempo, y, ML + colPeriodo + colTempo, y + alturaLinha)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.setTextColor(NAVY)
    pdf.text(periodoLabel, ML + 3, y + 4.7)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor('#222222')
    pdf.text(c ? CLIMA_ROTULO[c] : 'não informado', ML + colPeriodo + 3, y + 4.7)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor(t === null ? CINZA : t ? '#1e6b2e' : '#a33030')
    pdf.text(t === null ? 'Não informado' : t ? 'Praticável' : 'Não praticável', ML + colPeriodo + colTempo + 3, y + 4.7)
    y += alturaLinha
  }
  precisa(6)
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 6, 'F')
  pdf.setDrawColor('#E0DAD0')
  pdf.setLineWidth(0.2)
  pdf.rect(ML, y, LARG, 6, 'S')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('TEMPO', ML + colPeriodo + 3, y + 4.2)
  pdf.text('CONDIÇÃO', ML + colPeriodo + colTempo + 3, y + 4.2)
  y += 6
  linhaClima('Manhã', d.rdo.clima_manha, d.rdo.clima_manha_trabalhavel)
  linhaClima('Tarde', d.rdo.clima_tarde, d.rdo.clima_tarde_trabalhavel)
  y += 5

  // ---------- efetivo ----------
  // Grade de caixas agrupada em Mão de Obra Própria / Terceirizado (a
  // distinção vem do campo Empresa: vazio = própria, preenchido =
  // terceirizado) — cada caixa tem a largura do próprio texto (nunca
  // precisa quebrar linha) e "empacota" numa fileira até não caber mais,
  // começando fileira nova — o traço entre fileiras sai de graça porque
  // a borda de baixo de uma caixa e a de cima da próxima coincidem.
  titulo('Efetivo do dia')
  if (d.efetivo.length === 0) texto('Não informado.', { cor: CINZA })
  else {
    function grupoEfetivo(rotulo: string, entradas: RdoEfetivo[]) {
      if (entradas.length === 0) return
      const total = entradas.reduce((s, e) => s + e.quantidade, 0)
      precisa(6)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.5)
      pdf.setTextColor(TERRACOTA)
      pdf.text(`${rotulo.toUpperCase()} (${total})`, ML, y)
      y += 4.5

      const comEmpresa = entradas.some(e => e.empresa)
      const alturaBox = comEmpresa ? 13 : 10
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.5)
      const caixas = entradas.map(e => {
        const largFuncao = pdf.getTextWidth(e.funcao.toUpperCase())
        const largEmpresa = e.empresa ? pdf.getTextWidth(e.empresa) : 0
        return { e, largura: Math.max(largFuncao, largEmpresa, 18) + 8 }
      })
      const fileiras: typeof caixas[] = []
      let atual: typeof caixas = []
      let largAtual = 0
      for (const cx of caixas) {
        if (largAtual + cx.largura > LARG && atual.length > 0) {
          fileiras.push(atual)
          atual = []
          largAtual = 0
        }
        atual.push(cx)
        largAtual += cx.largura
      }
      if (atual.length > 0) fileiras.push(atual)

      for (const fileira of fileiras) {
        precisa(alturaBox)
        let x = ML
        for (const cx of fileira) {
          pdf.setDrawColor('#E0DAD0')
          pdf.setLineWidth(0.2)
          pdf.rect(x, y, cx.largura, alturaBox, 'S')
          const centro = x + cx.largura / 2
          pdf.setFont('helvetica', 'normal')
          pdf.setFontSize(6.5)
          pdf.setTextColor(CINZA)
          pdf.text(cx.e.funcao.toUpperCase(), centro, y + 4, { align: 'center' })
          pdf.setFont('helvetica', 'bold')
          pdf.setFontSize(11)
          pdf.setTextColor(NAVY)
          pdf.text(String(cx.e.quantidade), centro, y + 8.5, { align: 'center' })
          if (cx.e.empresa) {
            pdf.setFont('helvetica', 'normal')
            pdf.setFontSize(5.8)
            pdf.setTextColor(AZUL_MEDIO)
            pdf.text(cx.e.empresa, centro, y + 11.5, { align: 'center' })
          }
          x += cx.largura
        }
        y += alturaBox
      }
      y += 4
    }
    grupoEfetivo('Mão de Obra Própria', d.efetivo.filter(e => !e.empresa))
    grupoEfetivo('Terceirizado', d.efetivo.filter(e => e.empresa))
    precisa(6)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(NAVY)
    pdf.text(`Total do dia: ${d.efetivo.reduce((a, e) => a + e.quantidade, 0)} pessoas`, ML, y)
    y += 8
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

  // ---------- maquinário ----------
  titulo('Maquinário')
  if (d.maquinarios.length === 0) texto('Nenhum maquinário registrado.', { cor: CINZA })
  else {
    const colMaquina = 70
    const colPeriodoMaq = 50
    precisa(6)
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 6, 'F')
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.rect(ML, y, LARG, 6, 'S')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(NAVY)
    pdf.text('MÁQUINA', ML + 3, y + 4.2)
    pdf.text('PERÍODO', ML + colMaquina + 3, y + 4.2)
    pdf.text('SITUAÇÃO', ML + colMaquina + colPeriodoMaq + 3, y + 4.2)
    y += 6
    for (const m of d.maquinarios) {
      const alturaLinha = 7
      precisa(alturaLinha)
      pdf.setDrawColor('#E0DAD0')
      pdf.setLineWidth(0.2)
      pdf.rect(ML, y, LARG, alturaLinha, 'S')
      pdf.line(ML + colMaquina, y, ML + colMaquina, y + alturaLinha)
      pdf.line(ML + colMaquina + colPeriodoMaq, y, ML + colMaquina + colPeriodoMaq, y + alturaLinha)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      pdf.setTextColor('#222222')
      pdf.text(m.maquina, ML + 3, y + 4.7)
      pdf.text(m.periodo, ML + colMaquina + 3, y + 4.7)
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(m.situacao === 'em_operacao' ? '#1e6b2e' : m.situacao === 'manutencao' ? '#a3701f' : CINZA)
      pdf.text(SITUACAO_MAQUINARIO_LABEL[m.situacao], ML + colMaquina + colPeriodoMaq + 3, y + 4.7)
      y += alturaLinha
    }
    y += 5
  }

  // ---------- FVS do dia ----------
  if (d.fvsDia && d.fvsDia.length > 0) {
    titulo('Qualidade — FVS concluídas no dia')
    for (const f of d.fvsDia) {
      texto(`• ${f.codigo} ${f.nome} — ${f.unidadeNome}: ${RESULTADO_FVS[f.resultado] ?? f.resultado}`, { indent: 2 })
    }
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
