import styles from './EmConstrucao.module.css'

interface Props {
  modulo: string
  fase: number
}

export default function EmConstrucao({ modulo, fase }: Props) {
  return (
    <div className={styles.page}>
      <div className={styles.icon}>🚧</div>
      <h1>{modulo}</h1>
      <p>Este módulo será entregue na <strong>Fase {fase}</strong>.</p>
      <p className={styles.sub}>A fundação do sistema está pronta. Os módulos serão ativados em ordem conforme o plano de desenvolvimento.</p>
    </div>
  )
}
