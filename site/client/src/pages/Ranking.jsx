import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { corRating } from '../lib/format.js'
import { useAuth } from '../auth/AuthContext.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import TagEstilo from '../components/TagEstilo.jsx'

function Medalha({ posicao }) {
  const cores = { 0: 'text-yellow-400', 1: 'text-slate-300', 2: 'text-amber-600' }
  if (!(posicao in cores)) return <span className="font-mono text-texto-fraco">{posicao + 1}</span>
  return <span className={`font-display font-bold ${cores[posicao]}`}>{posicao + 1}º</span>
}

// Avatar do ranking com fallback pra quem nunca logou no site (avatarUrl null) — mesmo
// padrão do Avatar em Partida.jsx (Economia/Utilitária), mas quadrado maior pro card mobile.
function AvatarRanking({ r }) {
  const titulo = r.nick || r.steamId
  if (r.avatarUrl) {
    return <img src={r.avatarUrl} alt="" className="panel-cut-sm h-14 w-14 shrink-0 border border-borda object-cover" />
  }
  return (
    <span className="panel-cut-sm flex h-14 w-14 shrink-0 items-center justify-center border border-borda bg-superficie-alta font-display text-xl font-bold text-texto-fraco">
      {titulo.charAt(0).toUpperCase()}
    </span>
  )
}

function Stat({ rotulo, valor, cor }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10px] uppercase tracking-wide text-texto-fraco">{rotulo}</div>
      <div className={`truncate text-base font-semibold tabular-nums ${cor ?? 'text-texto'}`}>{valor}</div>
    </div>
  )
}

// Card mobile (estilo app FACEIT): avatar grande + posição/nick + grade de 4 stats.
// Destaca o próprio usuário logado com fundo/borda laranja.
function CardJogador({ r, posicao, souEu }) {
  return (
    <Link
      to={`/jogador/${r.steamId}`}
      className={`panel-cut flex gap-3 border p-4 transition-colors ${
        souEu ? 'border-destaque bg-destaque/10' : 'border-borda bg-superficie hover:bg-superficie-alta'
      }`}
    >
      <AvatarRanking r={r} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-texto-fraco">#{posicao + 1}</span>
          <span className="truncate font-display text-lg font-bold text-texto">{r.nick || r.steamId}</span>
          <TagEstilo estilo={r.estilo} />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <Stat rotulo="Rating" valor={r.rating?.toFixed(2) ?? '–'} cor={corRating(r.rating)} />
          <Stat rotulo="K/D" valor={r.kd} />
          <Stat rotulo="Partidas" valor={r.partidas} />
          <Stat rotulo="HS%" valor={`${r.hsPct}%`} />
        </div>
      </div>
    </Link>
  )
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
  const { jogador } = useAuth()
  const [ranking, setRanking] = useState(null)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')

  useEffect(() => {
    const qs = new URLSearchParams()
    if (de) qs.set('from', de)
    if (ate) qs.set('to', ate)
    fetch(`/api/ranking${qs.size ? `?${qs}` : ''}`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setRanking)
      .catch(() => setRanking([]))
  }, [de, ate])

  if (ranking === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const comPartida = ranking.filter((r) => r.partidas > 0)
  const semPartida = ranking.filter((r) => r.partidas === 0)
  const maisAces = [...comPartida].sort((a, b) => b.aces - a.aces)[0]
  const maisClutches = [...comPartida].sort((a, b) => b.clutchWins - a.clutchWins)[0]
  const melhorWinrate = [...comPartida].filter((r) => r.partidas >= 3).sort((a, b) => b.winrate - a.winrate)[0]
  // Categorias "peixe grande, lago pequeno": olham a TAXA, não o total — com piso
  // mínimo de amostra pra não premiar quem teve sorte numa tentativa só.
  const melhorClutchPct = [...comPartida].filter((r) => r.clutchAttempts >= 5).sort((a, b) => b.clutchPct - a.clutchPct)[0]
  const melhorEntryRate = [...comPartida].filter((r) => r.entryKills + r.entryDeaths >= 10).sort((a, b) => b.entryWinPct - a.entryWinPct)[0]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-texto">Ranking do grupo</h2>
        <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
      </div>

      {comPartida.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Ninguém do grupo tem Partidas registradas {de || ate ? 'nesse período' : 'ainda'}.</p>
      )}

      {comPartida.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
          {melhorClutchPct && (
            <CardDestaque
              rotulo="Melhor clutch% (5+ tentativas)"
              nick={melhorClutchPct.nick}
              valor={`${melhorClutchPct.clutchPct}% (${melhorClutchPct.clutchWins}/${melhorClutchPct.clutchAttempts})`}
            />
          )}
          {melhorEntryRate && (
            <CardDestaque
              rotulo="Melhor entry rate (10+ duelos)"
              nick={melhorEntryRate.nick}
              valor={`${melhorEntryRate.entryWinPct}% (${melhorEntryRate.entryKills}/${melhorEntryRate.entryKills + melhorEntryRate.entryDeaths})`}
            />
          )}
        </div>
      )}

      {comPartida.length > 0 && (
        <div className="space-y-3 lg:hidden">
          {comPartida.map((r, i) => (
            <CardJogador key={r.steamId} r={r} posicao={i} souEu={r.steamId === jogador?.steamId} />
          ))}
        </div>
      )}

      {comPartida.length > 0 && (
        <div className="panel-cut hidden overflow-x-auto border border-borda lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-superficie text-left font-mono text-[10px] uppercase tracking-wider text-texto-fraco">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Jogador</th>
                <th className="px-2 py-2 text-right">Partidas</th>
                <th className="px-2 py-2 text-right">Winrate</th>
                <th className="px-2 py-2 text-right">K/D</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">HS%</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">ACEs</th>
                <th className="hidden px-2 py-2 text-right sm:table-cell">Clutches</th>
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
                      <TagEstilo estilo={r.estilo} />
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.partidas}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.winrate >= 50 ? 'text-sucesso' : 'text-perigo'}`}>{r.winrate}%</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.kd}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{r.hsPct}%</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell">{r.aces}</td>
                  <td className="hidden px-2 py-2 text-right tabular-nums sm:table-cell" title="Clutches vencidos / tentativas (1vX)">
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
