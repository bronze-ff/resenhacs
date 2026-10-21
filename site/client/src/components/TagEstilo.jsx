import { METRICAS_ESTILO } from '../lib/metricas.js'
import { Explicacao } from './ui'

const CORES = {
  entry: 'border-perigo/40 text-perigo',
  suporte: 'border-time-b/40 text-time-b',
  clutch: 'border-destaque/40 text-destaque',
  mira: 'border-sucesso/40 text-sucesso',
  rifler: 'border-borda text-texto-fraco',
}

// Tag de estilo de jogo, calculado no server em relação à média do grupo (analise.js).
export default function TagEstilo({ estilo }) {
  if (!estilo) return null
  return (
    <Explicacao
      metrica={METRICAS_ESTILO[estilo.tag] ?? METRICAS_ESTILO.rifler}
      className={`panel-cut-sm border px-1.5 py-0.5 font-mono text-[11px] ${CORES[estilo.tag] ?? CORES.rifler}`}
    >
      {estilo.label}
    </Explicacao>
  )
}
