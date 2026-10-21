import { Card, Explicacao, SectionHeader } from '../ui'
import { METRICAS, METRICAS_PONTO_FORTE } from '../../lib/metricas.js'

// "Pontos fortes" do Perfil (referência: Leetify "Top stats"): os stats em que o
// Jogador está mais acima do resto do grupo nos últimos 90 dias. O servidor já manda
// ordenado e com o percentil calculado (site/server/src/pontosFortes.js).
export function formatarValor(valor, formato) {
  if (valor == null) return '–'
  switch (formato) {
    case 'pct': return `${Math.round(valor * 100)}%`
    case 'pct100': return `${Math.round(valor)}%`
    case 'decimal1': return valor.toFixed(1)
    case 'decimal2': return valor.toFixed(2)
    default: return String(Math.round(valor))
  }
}

export default function PontosFortes({ pontos, proprio }) {
  if (!pontos || pontos.length === 0) return null
  return (
    <section>
      <SectionHeader
        titulo={proprio ? 'Seus pontos fortes' : 'Pontos fortes'}
        subtitulo="Comparado com o grupo nos últimos 90 dias"
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {pontos.map((p, i) => (
          <Card key={p.chave} className="flex flex-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs text-texto-fraco">#{i + 1}</span>
              <span className="rounded-[var(--radius-pequeno)] border border-borda-forte bg-superficie-alta px-1.5 py-px text-[11px] font-medium text-texto-fraco">{p.area}</span>
            </div>
            <div className="min-h-10 text-sm font-medium leading-snug text-texto">
              <Explicacao metrica={METRICAS_PONTO_FORTE[p.nome]}>{p.nome}</Explicacao>
            </div>
            <div className="flex items-end justify-between gap-2">
              <div>
                <div className="font-mono text-2xl tabular-nums text-texto">{formatarValor(p.valor, p.formato)}</div>
                <div className="font-mono text-xs text-texto-fraco">
                  <Explicacao metrica={METRICAS.grupoMedia}>grupo</Explicacao>: {formatarValor(p.mediaGrupo, p.formato)}
                </div>
              </div>
              <div className={`text-right text-xs ${p.percentil >= 50 ? 'text-sucesso' : 'text-texto-fraco'}`}>
                <Explicacao metrica={METRICAS.percentil}>
                  {/* text-right aqui: o botão do Explicacao força text-left. */}
                  <span className="text-right">
                    {p.percentil >= 50 && <span aria-hidden="true">↑ </span>}
                    melhor que <span className="font-mono">{p.percentil}%</span>
                    <br />do grupo
                  </span>
                </Explicacao>
              </div>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-superficie-alta" aria-hidden="true">
              <div className="h-full rounded-full bg-sucesso" style={{ width: `${Math.max(4, p.percentil)}%` }} />
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
}
