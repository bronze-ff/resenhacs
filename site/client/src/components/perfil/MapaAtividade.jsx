import { Card } from '../ui'

// Mapa de calor de atividade (referência: FACEIT): 13 semanas × 7 dias, uma célula por
// dia, mais escura quanto mais Partidas. Coluna = semana (domingo em cima), a última
// coluna termina hoje.
const SEMANAS = 13
const NOMES_DIA = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.']
const ESCALA = ['bg-superficie-alta', 'bg-destaque/25', 'bg-destaque/50', 'bg-destaque/75', 'bg-destaque']

function chaveDia(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

export function montarGrade(atividade, hoje = new Date()) {
  const porDia = new Map((atividade ?? []).map((a) => [a.dia, a.partidas]))
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())
  const inicio = new Date(fim)
  inicio.setDate(fim.getDate() - fim.getDay() - (SEMANAS - 1) * 7)
  const semanas = []
  for (let s = 0; s < SEMANAS; s++) {
    const dias = []
    for (let d = 0; d < 7; d++) {
      const data = new Date(inicio)
      data.setDate(inicio.getDate() + s * 7 + d)
      const futuro = data > fim
      dias.push({ chave: chaveDia(data), data, partidas: futuro ? null : porDia.get(chaveDia(data)) ?? 0 })
    }
    semanas.push(dias)
  }
  return semanas
}

function nivel(n) {
  if (!n) return 0
  if (n === 1) return 1
  if (n === 2) return 2
  if (n <= 4) return 3
  return 4
}

export default function MapaAtividade({ atividade }) {
  const semanas = montarGrade(atividade)
  // Totais saem da grade, não da lista crua: a API manda 91 dias corridos e a grade
  // começa no domingo de 12 semanas atrás, então os dias mais velhos podem não aparecer.
  const visiveis = semanas.flat().filter((d) => d.partidas != null)
  const total = visiveis.reduce((s, d) => s + d.partidas, 0)
  const diasJogados = visiveis.filter((d) => d.partidas > 0).length
  const fmt = new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'short' })
  const meses = semanas.map((dias, i) => {
    const mes = new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(dias[0].data)
    const anterior = i > 0 ? new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(semanas[i - 1][0].data) : null
    return mes !== anterior ? mes : ''
  })

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-texto">Atividade</h3>
        <span className="text-xs text-texto-fraco">últimas 13 semanas</span>
      </div>
      <div className="mt-4 flex gap-2">
        <div className="grid grid-rows-7 gap-[3px] pt-4 text-[11px] leading-[12px] text-texto-fraco" aria-hidden="true">
          {NOMES_DIA.map((d, i) => <span key={d} className={i % 2 ? '' : 'invisible'}>{d}</span>)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="grid gap-[3px] text-[11px] leading-4 text-texto-fraco" style={{ gridTemplateColumns: `repeat(${SEMANAS}, minmax(0, 1fr))` }} aria-hidden="true">
            {meses.map((m, i) => <span key={i} className="truncate">{m}</span>)}
          </div>
          <div
            className="grid grid-flow-col gap-[3px]"
            style={{ gridTemplateColumns: `repeat(${SEMANAS}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(7, 12px)' }}
            role="img"
            aria-label={`${total} partidas em ${diasJogados} dias nas últimas 13 semanas`}
          >
            {semanas.flat().map((d) => (
              <span
                key={d.chave}
                title={d.partidas == null ? undefined : `${fmt.format(d.data)}: ${d.partidas} partida${d.partidas === 1 ? '' : 's'}`}
                className={`rounded-[3px] ${d.partidas == null ? 'invisible' : ESCALA[nivel(d.partidas)]}`}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-texto-fraco">
        <span>
          <span className="font-mono text-texto">{total}</span> partidas em <span className="font-mono text-texto">{diasJogados}</span> dias
        </span>
        <span className="flex items-center gap-1" aria-hidden="true">
          menos {ESCALA.map((c) => <span key={c} className={`h-2.5 w-2.5 rounded-[2px] ${c}`} />)} mais
        </span>
      </div>
    </Card>
  )
}
