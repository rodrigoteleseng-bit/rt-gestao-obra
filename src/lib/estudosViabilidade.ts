export type ModalidadeArgamassa = 'local' | 'usina'

export type ParametrosEstudo = {
  bloco9: number; bloco115: number; bloco19: number; areia: number; cimentoSaco: number
  juntaCm: number; perdaBloco: number; perdaArgamassa: number
  cimentoAssentamento: number; areiaAssentamento: number; cimentoPaulista: number; areiaPaulista: number
  cimentoChapisco: number; areiaChapisco: number; volumeChapisco: number
  custoHoraPreparo: number; produtividadePrincipal: number; produtividadeChapisco: number
  usinaPrincipal: number; usinaChapisco: number; perdaUsina: number; fretePrincipal: number; freteChapisco: number
  minimoPrincipal: number; minimoChapisco: number; recebimentoUsina: number
  modalidade: ModalidadeArgamassa
}

export type SolucaoEstudo = {
  id: string; nome: string; bloco: '9' | '11.5' | '19'; panos: number; paulistaCm: number
  maoAssentamento: number; maoChapisco: number; maoPaulista: number; observacao: string
}

export const parametrosPadrao: ParametrosEstudo = {
  bloco9: 0, bloco115: 0, bloco19: 0, areia: 0, cimentoSaco: 0,
  juntaCm: 1, perdaBloco: 5, perdaArgamassa: 10,
  cimentoAssentamento: 300, areiaAssentamento: 1.05, cimentoPaulista: 350, areiaPaulista: 1.05,
  cimentoChapisco: 3.5, areiaChapisco: 0.003, volumeChapisco: 0,
  custoHoraPreparo: 0, produtividadePrincipal: 0.21, produtividadeChapisco: 0.22,
  usinaPrincipal: 0, usinaChapisco: 0, perdaUsina: 3, fretePrincipal: 0, freteChapisco: 0,
  minimoPrincipal: 0, minimoChapisco: 0, recebimentoUsina: 0, modalidade: 'local',
}

export const solucoesPadrao: SolucaoEstudo[] = [
  { id: crypto.randomUUID(), nome: 'Bloco 11,5 cm + paulista 1,5 cm', bloco: '11.5', panos: 1, paulistaCm: 1.5, maoAssentamento: 0, maoChapisco: 0, maoPaulista: 0, observacao: '' },
  { id: crypto.randomUUID(), nome: 'Bloco 9 cm + paulista equalizado', bloco: '9', panos: 1, paulistaCm: 2.75, maoAssentamento: 0, maoChapisco: 0, maoPaulista: 0, observacao: '' },
]

const blocos = {
  '9': { espessura: .09, preco: 'bloco9' as const },
  '11.5': { espessura: .115, preco: 'bloco115' as const },
  '19': { espessura: .19, preco: 'bloco19' as const },
}

export type ResultadoSolucao = SolucaoEstudo & {
  blocosM2: number; espessuraFinalCm: number; custoBloco: number; custoArgamassa: number | null
  custoAplicacao: number; totalM2: number | null; totalArea: number | null; motivoPendente: string | null
}

export function calcularSolucao(s: SolucaoEstudo, p: ParametrosEstudo, area: number): ResultadoSolucao {
  const bloco = blocos[s.bloco]
  const modulo = (.29 + p.juntaCm / 100) * (.19 + p.juntaCm / 100)
  const blocosBase = 1 / modulo
  const blocosM2 = blocosBase * s.panos * (1 + p.perdaBloco / 100)
  const custoBloco = blocosM2 / 1000 * p[bloco.preco]
  const volumeAssentamentoLiquido = Math.max(0, bloco.espessura - blocosBase * bloco.espessura * .19 * .29) * s.panos
  const volumePaulistaLiquido = 2 * s.paulistaCm / 100
  const perdaObra = 1 + p.perdaArgamassa / 100
  const volumeAssentamento = volumeAssentamentoLiquido * perdaObra
  const volumePaulista = volumePaulistaLiquido * perdaObra
  const custoCimento = (volumeAssentamento * p.cimentoAssentamento + volumePaulista * p.cimentoPaulista + 2 * p.cimentoChapisco * perdaObra) * p.cimentoSaco / 50
  const custoAreia = (volumeAssentamento * p.areiaAssentamento + volumePaulista * p.areiaPaulista + 2 * p.areiaChapisco * perdaObra) * p.areia
  const maoAplicacao = s.maoAssentamento * s.panos + s.maoChapisco + s.maoPaulista
  let custoArgamassa: number | null = null
  let motivoPendente: string | null = null

  if (p.modalidade === 'local') {
    if (p.custoHoraPreparo <= 0 || p.produtividadePrincipal <= 0 || p.produtividadeChapisco <= 0 || p.volumeChapisco <= 0) motivoPendente = 'Informe custo-hora, produtividades e volume de chapisco.'
    else custoArgamassa = custoCimento + custoAreia + (volumeAssentamento + volumePaulista) / p.produtividadePrincipal * p.custoHoraPreparo + p.volumeChapisco * perdaObra / p.produtividadeChapisco * p.custoHoraPreparo
  } else {
    if (p.usinaPrincipal <= 0 || p.usinaChapisco <= 0 || p.volumeChapisco <= 0 || area <= 0) motivoPendente = 'Informe cotação da usina e volume de chapisco.'
    else {
      const perdaUsina = 1 + p.perdaUsina / 100
      const principal = (volumeAssentamentoLiquido + volumePaulistaLiquido) * perdaUsina
      const chapisco = p.volumeChapisco * perdaUsina
      custoArgamassa = Math.max(principal * area, p.minimoPrincipal) * p.usinaPrincipal / area + p.fretePrincipal / area + principal * p.recebimentoUsina
        + Math.max(chapisco * area, p.minimoChapisco) * p.usinaChapisco / area + p.freteChapisco / area + chapisco * p.recebimentoUsina
    }
  }
  const totalM2 = custoArgamassa === null ? null : custoBloco + custoArgamassa + maoAplicacao
  return { ...s, blocosM2, espessuraFinalCm: bloco.espessura * s.panos * 100 + 2 * s.paulistaCm, custoBloco, custoArgamassa, custoAplicacao: maoAplicacao, totalM2, totalArea: totalM2 === null ? null : totalM2 * area, motivoPendente }
}
