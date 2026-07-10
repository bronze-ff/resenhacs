import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { nomeMapa, dataRelativa, corRating } from '../lib/format.js'
import StatTile from '../components/StatTile.jsx'

export default function JogadorPerfil() {
  const { steamId } = useParams()
  const [data, setData] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    setData(null)
    setErro(false)
    fetch(`/api/profile/${steamId}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setData)
      .catch(() => setErro(true))
  }, [steamId])

  if (erro) return <p className="font-mono text-sm text-texto-fraco">Jogador não encontrado.</p>
  if (!data) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const { jogador, stats, porMapa, recentes, sinergia } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        {jogador.avatarUrl && (
          <img src={jogador.avatarUrl} alt="" className="panel-cut h-16 w-16 border border-borda object-cover" />
        )}
        <div>
          <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">
            {jogador.nick || jogador.steamId}
          </h2>
          <p className="font-mono text-sm text-texto-fraco">{stats.partidas} partidas · {stats.winrate}% de vitória</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile rotulo="Rating" valor={stats.rating?.toFixed(2) ?? '–'} destaque={corRating(stats.rating)} />
        <StatTile rotulo="K/D" valor={stats.kd} />
        <StatTile rotulo="ADR" valor={stats.adr} />
        <StatTile rotulo="HS%" valor={`${stats.hsPct}%`} />
        <StatTile rotulo="Vitórias" valor={`${stats.vitorias}/${stats.partidas}`} sub={`${stats.winrate}%`} />
        <StatTile rotulo="Kills" valor={stats.kills} sub={`${stats.deaths} deaths`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Com quem mais joga</h3>
          {sinergia.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem duplas registradas ainda.</p>}
          <div className="space-y-2">
            {sinergia.map((s) => (
              <Link
                key={s.steamId}
                to={`/jogador/${s.steamId}`}
                className="panel-cut flex items-center justify-between border border-borda bg-superficie p-3 transition-colors hover:border-destaque/60"
              >
                <span className="flex items-center gap-3 font-mono text-texto">
                  {s.avatarUrl && (
                    <img src={s.avatarUrl} alt="" className="panel-cut-sm h-8 w-8 border border-borda object-cover" />
                  )}
                  <span>{s.nick || s.steamId}</span>
                </span>
                <span className="font-mono text-sm text-texto-fraco">
                  <span className="tabular-nums text-texto">{s.partidas}</span> juntos ·{' '}
                  <span className={`tabular-nums ${s.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>
                    {s.winrate}%
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Por mapa</h3>
          {porMapa.length === 0 && <p className="font-mono text-sm text-texto-fraco">Sem dados por mapa ainda.</p>}
          <div className="space-y-2">
            {porMapa.map((mp) => (
              <div key={mp.map} className="panel-cut flex items-center justify-between border border-borda bg-superficie p-3">
                <span className="font-mono text-texto">{nomeMapa(mp.map)}</span>
                <span className="font-mono text-sm text-texto-fraco">
                  <span className="tabular-nums text-texto">{mp.partidas}</span> jogos ·{' '}
                  <span className={`tabular-nums ${mp.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>{mp.winrate}%</span>
                  {mp.rating != null && (
                    <span className={`ml-2 tabular-nums ${corRating(mp.rating)}`}>{mp.rating.toFixed(2)}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section>
        <h3 className="mb-3 font-display text-lg font-semibold uppercase tracking-wide text-texto">Partidas recentes</h3>
        {recentes.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhuma partida ainda.</p>}
        <div className="space-y-2">
          {recentes.map((r) => (
            <Link
              key={r.id}
              to={`/partida/${r.id}`}
              className="panel-cut flex items-center justify-between border border-borda bg-superficie p-3 transition-colors hover:border-destaque/60"
            >
              <span className="flex items-center gap-3 font-mono text-texto">
                <span className={`inline-block h-2 w-2 rounded-full ${r.won ? 'bg-sucesso' : 'bg-perigo'}`} />
                <span>{nomeMapa(r.map)}</span>
                <span className="text-xs text-texto-fraco">{dataRelativa(r.playedAt)}</span>
              </span>
              <span className="font-mono text-sm tabular-nums text-texto-fraco">
                {r.scoreA}:{r.scoreB} · {r.kills}/{r.deaths}
                {r.rating != null && <span className={`ml-2 ${corRating(r.rating)}`}>{r.rating.toFixed(2)}</span>}
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
