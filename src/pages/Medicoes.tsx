import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type ProducaoMedicao, type StatusContrato, type Trabalhador } from '../lib/supabase'
import { STATUS_LABEL as STATUS_CONTRATO_LABEL } from './Contratos'
import { formatarMoeda } from '../lib/formato'
import styles from './Medicoes.module.css'

// Um card por contrato/empreiteiro (não mais um card por medição) — clicar
// abre /contratos/:id, que já tem a seção "Medições" com "+ Nova medição"
// e os cards de cada medição individual. Contratos em rascunho não entram
// aqui (não dá pra medir um contrato que ainda não foi ativado).
interface ContratoLista{id:string;numero:string;status:StatusContrato;empreiteiroNome:string;qtdMedicoes:number;totalLiquido:number}
const STATUS_PROD:Record<string,string>={rascunho:'Rascunho',aprovada:'Aprovada',paga:'Paga',cancelada:'Cancelada'}

export default function Medicoes(){
 const {perfil}=useAuth(),{obraAtiva}=useObra(),navigate=useNavigate(); const [aba,setAba]=useState<'contratos'|'producao'>('contratos'),[contratos,setContratos]=useState<ContratoLista[]>([]),[producao,setProducao]=useState<ProducaoMedicao[]>([]),[trabalhadores,setTrabalhadores]=useState<Trabalhador[]>([]),[carregando,setCarregando]=useState(true)
 useEffect(()=>{if(!obraAtiva)return;setCarregando(true);Promise.all([
  supabase.from('contratos').select('id, numero, status, empreiteiros(nome)').eq('obra_id',obraAtiva.id).eq('ativo',true).in('status',['ativo','encerrado']).order('numero',{ascending:false}),
  supabase.from('medicoes').select('contrato_id, status, valor_liquido, contratos!inner(obra_id)').eq('ativo',true).eq('contratos.obra_id',obraAtiva.id),
  supabase.from('producao_medicoes').select('*').eq('obra_id',obraAtiva.id).eq('ativo',true).order('criado_em',{ascending:false}),
  supabase.from('trabalhadores').select('*').eq('obra_id',obraAtiva.id).order('nome')]).then(([c,m,p,t])=>{
   const medicoesPorContrato=(m.data??[]) as unknown as {contrato_id:string;status:string;valor_liquido:number}[]
   setContratos(((c.data??[]) as unknown as {id:string;numero:string;status:StatusContrato;empreiteiros:{nome:string}|null}[]).map(ct=>{
    const daContrato=medicoesPorContrato.filter(med=>med.contrato_id===ct.id)
    return {
     id:ct.id,numero:ct.numero,status:ct.status,empreiteiroNome:ct.empreiteiros?.nome??'—',
     qtdMedicoes:daContrato.length,
     totalLiquido:daContrato.filter(med=>med.status==='aprovada').reduce((s,med)=>s+med.valor_liquido,0),
    }
   }));
   setProducao(p.data??[]);setTrabalhadores(t.data??[]);setCarregando(false)})},[obraAtiva])
 if(perfil?.papel==='cliente')return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
 return <div className={styles.page}><div className={styles.header}><div><h1>Medições</h1><p className={styles.sub}>Empreiteiros por contrato e produção de profissionais próprios.</p></div>{aba==='producao'&&<button className={styles.btnPrincipal} onClick={()=>navigate('/medicoes/producao/nova')}>+ Nova medição</button>}</div><div className={styles.abas}><button className={`${styles.aba} ${aba==='contratos'?styles.abaAtiva:''}`} onClick={()=>setAba('contratos')}>Empreiteiros</button><button className={`${styles.aba} ${aba==='producao'?styles.abaAtiva:''}`} onClick={()=>setAba('producao')}>Produção própria</button></div>{carregando&&<p className={styles.vazio}>Carregando…</p>}{!carregando&&aba==='contratos'&&<>{contratos.map(ct=><button key={ct.id} className={styles.card} onClick={()=>navigate(`/contratos/${ct.id}`)}><div className={styles.cardTopo}><span className={styles.cardNumero}>{ct.numero}</span><span className={`${styles.chip} ${styles[`chip_${ct.status}`]}`}>{STATUS_CONTRATO_LABEL[ct.status]}</span></div><div className={styles.cardDesc}>{ct.empreiteiroNome}</div><div className={styles.cardRodape}><span>{ct.qtdMedicoes} {ct.qtdMedicoes===1?'medição':'medições'}</span><strong>Total líquido R$ {formatarMoeda(ct.totalLiquido)}</strong></div></button>)}{!contratos.length&&<p className={styles.vazio}>Nenhum contrato ativo ou encerrado nesta obra.</p>}</>}{!carregando&&aba==='producao'&&<>{producao.map(m=><button key={m.id} className={styles.card} onClick={()=>navigate(`/medicoes/producao/${m.id}`)}><div className={styles.cardTopo}><span className={styles.cardNumero}>MP-{String(m.numero).padStart(3,'0')}</span><span className={`${styles.chip} ${styles[`chip_${m.status}`]??''}`}>{STATUS_PROD[m.status]}</span></div><div className={styles.cardDesc}>{trabalhadores.find(t=>t.id===m.trabalhador_id)?.nome??'Profissional'} · {m.data_inicio} a {m.data_fim}</div><div className={styles.cardRodape}><span>Produção R$ {formatarMoeda(m.valor_producao)}</span><span>Salário R$ {formatarMoeda(m.valor_salarial)}</span><strong>Total R$ {formatarMoeda(m.valor_total)}</strong></div></button>)}{!producao.length&&<p className={styles.vazio}>Nenhuma medição de produção própria.</p>}</>}</div>
}
