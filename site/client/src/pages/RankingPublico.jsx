import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SectionHeader, DataTable, RatingBadge } from '../components/ui'

export default function RankingPublico() {
  const [aba, setAba] = useState('jogadores')
  const [jogadores, setJogadores] = useState(null)
  const [times, setTimes] = useState(null)

  useEffect(() => {
    fetch('/api/ranking-publico/jogadores').then((res) => (res.ok ? res.json() : [])).then(setJogadores)
    fetch('/api/ranking-publico/times').then((res) => (res.ok ? res.json() : [])).then(setTimes)
  }, [])

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Ranking público" />
      <div className="flex gap-2">
        {['jogadores', 'times'].map((a) => (
          <button
            key={a}
            onClick={() => setAba(a)}
            className={`panel-cut-sm border px-3 py-1.5 font-mono text-xs uppercase tracking-wide ${
              aba === a ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {aba === 'jogadores' && (
        jogadores === null ? <p className="font-mono text-sm text-texto-fraco">Carregando…</p> :
        jogadores.length === 0 ? <p className="font-mono text-sm text-texto-fraco">Ninguém optou por aparecer aqui ainda.</p> :
        <DataTable head={<tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Jogador</th><th className="px-2 py-2 text-right">Partidas</th><th className="px-2 py-2 text-right">Winrate</th><th className="px-2 py-2 text-right">K/D</th><th className="px-3 py-2 text-right">Rating</th></tr>}>
          {jogadores.map((j, i) => (
            <tr key={j.steamId}>
              <td className="px-3 py-2 font-mono text-texto-fraco">{i + 1}</td>
              <td className="px-3 py-2">
                <Link to={`/jogador/${j.steamId}`} className="flex items-center gap-2 font-mono text-texto hover:text-destaque">
                  {j.avatarUrl && <img src={j.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
                  {j.nick || j.steamId}
                </Link>
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{j.partidas}</td>
              <td className="px-2 py-2 text-right tabular-nums">{j.winrate}%</td>
              <td className="px-2 py-2 text-right tabular-nums">{j.kd}</td>
              <td className="px-3 py-2 text-right"><RatingBadge valor={j.rating} /></td>
            </tr>
          ))}
        </DataTable>
      )}

      {aba === 'times' && (
        times === null ? <p className="font-mono text-sm text-texto-fraco">Carregando…</p> :
        times.length === 0 ? <p className="font-mono text-sm text-texto-fraco">Nenhum time público ainda.</p> :
        <DataTable head={<tr><th className="px-3 py-2">#</th><th className="px-3 py-2">Time</th><th className="px-2 py-2">Grupo</th><th className="px-2 py-2 text-right">Partidas</th><th className="px-2 py-2 text-right">Winrate</th><th className="px-3 py-2 text-right">Rating</th></tr>}>
          {times.map((t, i) => (
            <tr key={t.id}>
              <td className="px-3 py-2 font-mono text-texto-fraco">{i + 1}</td>
              <td className="px-3 py-2 font-mono text-texto">
                <Link to={`/times/comparar?a=${t.id}`} className="hover:text-destaque">{t.nome}</Link>
              </td>
              <td className="px-2 py-2 font-mono text-xs text-texto-fraco">{t.grupoNome}</td>
              <td className="px-2 py-2 text-right tabular-nums">{t.partidas}</td>
              <td className="px-2 py-2 text-right tabular-nums">{t.winrate}%</td>
              <td className="px-3 py-2 text-right"><RatingBadge valor={t.rating} /></td>
            </tr>
          ))}
        </DataTable>
      )}
    </div>
  )
}
