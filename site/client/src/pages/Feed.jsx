import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataRelativa } from '../lib/format.js'

function Placar({ a, b }) {
  const venceuA = a > b
  return (
    <div className="flex items-center gap-1 font-bold tabular-nums">
      <span className={venceuA ? 'text-emerald-400' : 'text-rose-400'}>{a ?? '–'}</span>
      <span className="text-texto-fraco">:</span>
      <span className={!venceuA ? 'text-emerald-400' : 'text-rose-400'}>{b ?? '–'}</span>
    </div>
  )
}

function CardPartida({ m }) {
  return (
    <Link
      to={`/partida/${m.id}`}
      className="flex items-center justify-between rounded-xl border border-borda bg-superficie p-4 transition hover:border-destaque/60"
    >
      <div className="flex items-center gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-fundo text-xs font-bold uppercase text-destaque">
          {nomeMapa(m.map).slice(0, 3)}
        </div>
        <div>
          <div className="font-semibold">{nomeMapa(m.map)}</div>
          <div className="text-xs text-texto-fraco">
            {dataRelativa(m.playedAt)}
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
      <h2 className="mb-4 text-xl font-semibold">Partidas</h2>
      {partidas === null && <p className="text-texto-fraco">Carregando…</p>}
      {partidas?.length === 0 && (
        <p className="text-texto-fraco">
          Nenhuma Partida parseada ainda. Assim que o Coletor processar um demo, ela aparece aqui.
        </p>
      )}
      <div className="space-y-2">
        {partidas?.map((m) => <CardPartida key={m.id} m={m} />)}
      </div>
    </div>
  )
}
