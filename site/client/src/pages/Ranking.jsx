import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { corRating } from '../lib/format.js'

function Medalha({ posicao }) {
  const cores = { 0: 'text-yellow-400', 1: 'text-slate-300', 2: 'text-amber-600' }
  if (!(posicao in cores)) return <span className="font-mono text-texto-fraco">{posicao + 1}</span>
  return <span className={`font-display font-bold ${cores[posicao]}`}>{posicao + 1}º</span>
}

function CardDestaque({ rotulo, nick, valor }) {
  return (
    <div className="panel-cut-sm relative border border-borda bg-superficie p-4">
      <div className="absolute left-0 top-0 h-[2px] w-6 bg-destaque/60" />
      <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-texto-fraco">{rotulo}</div>
      <div className="mt-1 font-display text-lg font-bold text-destaque">{nick}</div>
      <div className="font-mono text-sm text-texto-fraco">{valor}</div>
    </div>
  )
}

export default function Ranking() {
  const [ranking, setRanking] = useState(null)

  useEffect(() => {
    fetch('/api/ranking')
      .then((res) => (res.ok ? res.json() : []))
      .then(setRanking)
      .catch(() => setRanking([]))
  }, [])

  if (ranking === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const comPartida = ranking.filter((r) => r.partidas > 0)
  const semPartida = ranking.filter((r) => r.partidas === 0)
  const maisAces = [...comPartida].sort((a, b) => b.aces - a.aces)[0]
  const maisClutches = [...comPartida].sort((a, b) => b.clutchWins - a.clutchWins)[0]
  const melhorWinrate = [...comPartida].filter((r) => r.partidas >= 3).sort((a, b) => b.winrate - a.winrate)[0]

  return (
    <div className="space-y-6">
      <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-texto">Ranking do grupo</h2>

      {comPartida.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Ninguém do grupo tem Partidas registradas ainda.</p>
      )}

      {comPartida.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {maisAces?.aces > 0 && (
            <CardDestaque rotulo="Mais ACEs" nick={maisAces.nick} valor={`${maisAces.aces} ace${maisAces.aces > 1 ? 's' : ''}`} />
          )}
          {maisClutches?.clutchWins > 0 && (
            <CardDestaque
              rotulo="Mais clutches"
              nick={maisClutches.nick}
              valor={`${maisClutches.clutchWins}/${maisClutches.clutchAttempts} tentativas · ${maisClutches.clutchPct}%`}
            />
          )}
          {melhorWinrate && (
            <CardDestaque rotulo="Melhor winrate (3+ partidas)" nick={melhorWinrate.nick} valor={`${melhorWinrate.winrate}%`} />
          )}
        </div>
      )}

      {comPartida.length > 0 && (
        <div className="panel-cut overflow-x-auto border border-borda">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-superficie text-left font-mono text-[10px] uppercase tracking-wider text-texto-fraco">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Jogador</th>
                <th className="px-2 py-2 text-right">Partidas</th>
                <th className="px-2 py-2 text-right">Winrate</th>
                <th className="px-2 py-2 text-right">K/D</th>
                <th className="px-2 py-2 text-right">HS%</th>
                <th className="px-2 py-2 text-right">ACEs</th>
                <th className="px-2 py-2 text-right">Clutches</th>
                <th className="px-3 py-2 text-right">Rating</th>
              </tr>
            </thead>
            <tbody>
              {comPartida.map((r, i) => (
                <tr key={r.steamId} className="border-t border-borda transition-colors hover:bg-superficie-alta">
                  <td className="px-3 py-2"><Medalha posicao={i} /></td>
                  <td className="px-3 py-2">
                    <Link to={`/jogador/${r.steamId}`} className="flex items-center gap-2 font-mono text-texto hover:text-destaque">
                      {r.avatarUrl && (
                        <img src={r.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />
                      )}
                      {r.nick || r.steamId}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.partidas}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>{r.winrate}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.kd}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.hsPct}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.aces}</td>
                  <td className="px-2 py-2 text-right tabular-nums" title="Clutches vencidos / tentativas (1vX)">
                    {r.clutchWins}/{r.clutchAttempts}
                    {r.clutchAttempts > 0 && (
                      <span className={`ml-1.5 text-xs ${r.clutchPct >= 50 ? 'text-sucesso' : 'text-texto-fraco'}`}>{r.clutchPct}%</span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold tabular-nums ${corRating(r.rating)}`}>
                    {r.rating?.toFixed(2) ?? '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {semPartida.length > 0 && (
        <p className="font-mono text-xs text-texto-fraco">
          Ainda sem partidas: {semPartida.map((r) => r.nick || r.steamId).join(', ')}
        </p>
      )}
    </div>
  )
}
