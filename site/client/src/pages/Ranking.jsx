import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { corRating } from '../lib/format.js'

function Medalha({ posicao }) {
  const cores = { 0: 'text-yellow-400', 1: 'text-slate-300', 2: 'text-amber-600' }
  if (!(posicao in cores)) return <span className="text-texto-fraco">{posicao + 1}</span>
  return <span className={`font-bold ${cores[posicao]}`}>{posicao + 1}º</span>
}

export default function Ranking() {
  const [ranking, setRanking] = useState(null)

  useEffect(() => {
    fetch('/api/ranking')
      .then((res) => (res.ok ? res.json() : []))
      .then(setRanking)
      .catch(() => setRanking([]))
  }, [])

  if (ranking === null) return <p className="text-texto-fraco">Carregando…</p>

  const comPartida = ranking.filter((r) => r.partidas > 0)
  const semPartida = ranking.filter((r) => r.partidas === 0)
  const maisAces = [...comPartida].sort((a, b) => b.aces - a.aces)[0]
  const maisClutches = [...comPartida].sort((a, b) => b.clutches - a.clutches)[0]
  const melhorWinrate = [...comPartida].filter((r) => r.partidas >= 3).sort((a, b) => b.winrate - a.winrate)[0]

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Ranking do grupo</h2>

      {comPartida.length === 0 && (
        <p className="text-texto-fraco">Ninguém do grupo tem Partidas registradas ainda.</p>
      )}

      {comPartida.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {maisAces?.aces > 0 && (
            <div className="rounded-xl border border-borda bg-superficie p-4">
              <div className="text-xs uppercase text-texto-fraco">Mais ACEs</div>
              <div className="mt-1 text-lg font-bold text-destaque">{maisAces.nick}</div>
              <div className="text-sm text-texto-fraco">{maisAces.aces} ace{maisAces.aces > 1 ? 's' : ''}</div>
            </div>
          )}
          {maisClutches?.clutches > 0 && (
            <div className="rounded-xl border border-borda bg-superficie p-4">
              <div className="text-xs uppercase text-texto-fraco">Mais clutches</div>
              <div className="mt-1 text-lg font-bold text-destaque">{maisClutches.nick}</div>
              <div className="text-sm text-texto-fraco">{maisClutches.clutches} clutch{maisClutches.clutches > 1 ? 'es' : ''}</div>
            </div>
          )}
          {melhorWinrate && (
            <div className="rounded-xl border border-borda bg-superficie p-4">
              <div className="text-xs uppercase text-texto-fraco">Melhor winrate (3+ partidas)</div>
              <div className="mt-1 text-lg font-bold text-destaque">{melhorWinrate.nick}</div>
              <div className="text-sm text-texto-fraco">{melhorWinrate.winrate}%</div>
            </div>
          )}
        </div>
      )}

      {comPartida.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-borda">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-superficie text-left text-xs uppercase text-texto-fraco">
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
                <tr key={r.steamId} className="border-t border-borda">
                  <td className="px-3 py-2"><Medalha posicao={i} /></td>
                  <td className="px-3 py-2">
                    <Link to={`/jogador/${r.steamId}`} className="flex items-center gap-2 hover:text-destaque">
                      {r.avatarUrl && <img src={r.avatarUrl} alt="" className="h-6 w-6 rounded-full" />}
                      {r.nick || r.steamId}
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.partidas}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.winrate >= 50 ? 'text-emerald-400' : 'text-rose-400'}`}>{r.winrate}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.kd}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.hsPct}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.aces}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.clutches}</td>
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
        <p className="text-xs text-texto-fraco">
          Ainda sem partidas: {semPartida.map((r) => r.nick || r.steamId).join(', ')}
        </p>
      )}
    </div>
  )
}
