import { useId } from 'react'
import { dataHora } from '../../lib/format.js'
import { Card, Explicacao } from '../ui'
import { METRICAS } from '../../lib/metricas.js'

// "Desempenho recente" do Perfil (referência: FACEIT): rating partida a partida das
// últimas 30, com a linha de 1.00 como referência e área preenchida embaixo. SVG à mão
// (sem lib), como o resto dos gráficos do site.
const L = 800
const A = 180
const PAD_Y = 16

export function geometria(pontos) {
  const valores = pontos.map((p) => p.rating)
  const min = Math.min(0.6, ...valores)
  const max = Math.max(1.4, ...valores)
  const y = (v) => Math.round(PAD_Y + (1 - (v - min) / (max - min)) * (A - PAD_Y * 2))
  const passo = pontos.length > 1 ? L / (pontos.length - 1) : 0
  const xy = pontos.map((p, i) => [Math.round(i * passo), y(p.rating)])
  return {
    linha: xy.map((p) => p.join(',')).join(' '),
    area: `0,${A} ${xy.map((p) => p.join(',')).join(' ')} ${L},${A}`,
    yUm: y(1),
    xy,
  }
}

function media(pontos) {
  return pontos.reduce((s, p) => s + p.rating, 0) / pontos.length
}

export default function DesempenhoRecente({ evolucao }) {
  const gradId = useId()
  if (!evolucao || evolucao.length < 2) {
    return (
      <Card className="p-5">
        <h3 className="font-display text-base font-semibold text-texto">Desempenho recente</h3>
        <p className="mt-2 text-sm text-texto-fraco">O gráfico aparece a partir da 2ª partida.</p>
      </Card>
    )
  }
  const { linha, area, yUm, xy } = geometria(evolucao)
  const vitorias = evolucao.filter((e) => e.won === true).length
  const derrotas = evolucao.filter((e) => e.won === false).length
  const metade = Math.floor(evolucao.length / 2)
  const variacao = metade > 0 ? ((media(evolucao.slice(metade)) - media(evolucao.slice(0, metade))) / media(evolucao.slice(0, metade))) * 100 : 0
  const ultima = evolucao[evolucao.length - 1]
  const primeira = evolucao[0]

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-base font-semibold text-texto">Desempenho recente</h3>
          <p className="mt-0.5 text-xs text-texto-fraco">Rating partida a partida · últimas {evolucao.length}</p>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="rounded-[var(--radius-pequeno)] border border-sucesso/40 bg-sucesso/10 px-1.5 py-0.5 text-sucesso">V {vitorias}</span>
          <span className="rounded-[var(--radius-pequeno)] border border-perigo/40 bg-perigo/10 px-1.5 py-0.5 text-perigo">D {derrotas}</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${L} ${A}`}
        preserveAspectRatio="none"
        className="mt-4 block h-44 w-full overflow-visible"
        role="img"
        aria-label={`Rating das últimas ${evolucao.length} partidas, de ${primeira.rating.toFixed(2)} até ${ultima.rating.toFixed(2)}`}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-destaque)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--color-destaque)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={L} y1={yUm} y2={yUm} stroke="var(--color-borda-forte)" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
        <polygon points={area} fill={`url(#${gradId})`} />
        <polyline points={linha} fill="none" stroke="var(--color-destaque)" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {xy.map(([x, y], i) => (
          // Traço de comprimento zero com ponta redonda = ponto que não vira elipse
          // quando o SVG estica (preserveAspectRatio="none").
          <line key={evolucao[i].matchId ?? i} x1={x} y1={y} x2={x} y2={y} stroke="var(--color-destaque)" strokeWidth="6" strokeLinecap="round" vectorEffect="non-scaling-stroke">
            <title>{`${dataHora(evolucao[i].playedAt) ?? ''} · ${evolucao[i].rating.toFixed(2)}`}</title>
          </line>
        ))}
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-texto-fraco">
        <span>{dataHora(primeira.playedAt)}</span>
        <span>linha tracejada = 1.00</span>
        <span>{dataHora(ultima.playedAt)}</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-borda pt-4 sm:grid-cols-3">
        <div>
          <div className="rotulo"><Explicacao metrica={METRICAS.mediaRecente}>Média</Explicacao></div>
          <div className="mt-1 font-mono text-xl tabular-nums text-texto">{media(evolucao).toFixed(2)}</div>
        </div>
        <div>
          <div className="rotulo"><Explicacao metrica={METRICAS.variacao}>Variação</Explicacao></div>
          <div className={`mt-1 font-mono text-xl tabular-nums ${variacao >= 0 ? 'text-sucesso' : 'text-perigo'}`}>
            {variacao >= 0 ? '+' : ''}{variacao.toFixed(1)}% <span className="text-xs">{variacao >= 0 ? '↑' : '↓'}</span>
          </div>
          <div className="text-[11px] text-texto-fraco">2ª metade vs 1ª</div>
        </div>
        <div>
          <div className="rotulo"><Explicacao metrica={METRICAS.acimaDe1}>Acima de 1.00</Explicacao></div>
          <div className="mt-1 font-mono text-xl tabular-nums text-texto">
            {Math.round((evolucao.filter((e) => e.rating >= 1).length / evolucao.length) * 100)}%
          </div>
        </div>
      </div>
    </Card>
  )
}
