import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataHora, origemPartida } from '../lib/format.js'

function Placar({ a, b }) {
  const venceuA = a > b
  return (
    <div className="flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums">
      <span className={venceuA ? 'text-sucesso' : 'text-perigo'}>{a ?? '–'}</span>
      <span className="text-texto-fraco">:</span>
      <span className={!venceuA ? 'text-sucesso' : 'text-perigo'}>{b ?? '–'}</span>
    </div>
  )
}

function CardPartida({ m }) {
  return (
    <Link
      to={`/partida/${m.id}`}
      className="panel-cut relative flex items-center justify-between border border-borda bg-superficie p-4 transition-colors hover:border-destaque/50 hover:bg-superficie-alta"
    >
      <div className="absolute left-0 top-0 h-full w-[3px] bg-destaque/0 transition-colors group-hover:bg-destaque" />
      <div className="flex items-center gap-4">
        <div className="panel-cut-sm flex h-12 w-12 items-center justify-center border border-borda bg-fundo font-mono text-xs font-bold uppercase text-destaque">
          {nomeMapa(m.map).slice(0, 3)}
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold uppercase tracking-wide text-texto">{nomeMapa(m.map)}</span>
            <span
              title={origemPartida(m.source).title}
              className="panel-cut-sm border border-borda bg-fundo px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-texto-fraco"
            >
              {origemPartida(m.source).label}
            </span>
          </div>
          <div className="font-mono text-xs text-texto-fraco">
            {dataHora(m.playedAt)}
            {m.tracked?.length > 0 && (
              <span> · {m.tracked.map((t) => t.nick).join(', ')}</span>
            )}
          </div>
        </div>
      </div>
      <Placar a={m.scoreA} b={m.scoreB} />
    </Link>
  )
}

export default function Feed() {
  const [partidas, setPartidas] = useState(null)

  useEffect(() => {
    fetch('/api/matches')
      .then((res) => (res.ok ? res.json() : []))
      .then(setPartidas)
      .catch(() => setPartidas([]))
  }, [])

  return (
    <div>
      <h2 className="mb-4 font-display text-xl font-semibold uppercase tracking-wide text-texto">Partidas</h2>
      {partidas === null && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {partidas?.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">
          Nenhuma Partida parseada ainda. Assim que o Coletor processar um demo, ela aparece aqui.
        </p>
      )}
      <div className="space-y-2">
        {partidas?.map((m) => <CardPartida key={m.id} m={m} />)}
      </div>
    </div>
  )
}
