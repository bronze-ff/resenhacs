import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { nomeMapa, dataRelativa, corRating } from '../lib/format.js'
import ReplayViewer from '../components/ReplayViewer.jsx'
import { useAuth } from '../auth/AuthContext.jsx'

function SecaoReplay({ replayUrl }) {
  const [replay, setReplay] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    if (!replayUrl) return
    setReplay(null)
    setErro(false)
    fetch(replayUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setReplay)
      .catch(() => setErro(true))
  }, [replayUrl])

  if (!replayUrl) {
    return (
      <p className="font-mono text-sm text-texto-fraco">
        Replay 2D indisponível — gerado pelo Coletor quando o demo é processado (Fase 4).
      </p>
    )
  }
  if (erro) return <p className="font-mono text-sm text-perigo">Não foi possível carregar o replay.</p>
  if (!replay) return <p className="font-mono text-sm text-texto-fraco">Carregando replay…</p>
  return <ReplayViewer replay={replay} />
}

function Scoreboard({ time, jogadores, podePromover, onPromover, promovendo }) {
  return (
    <div className="panel-cut overflow-hidden border border-borda">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-superficie text-left font-mono text-[10px] uppercase tracking-wider text-texto-fraco">
            <th className="px-3 py-2">Time {time}</th>
            <th className="px-2 py-2 text-right">K</th>
            <th className="px-2 py-2 text-right" title="Team kills (não contam pro K nem pro rating)">TK</th>
            <th className="px-2 py-2 text-right">D</th>
            <th className="px-2 py-2 text-right">A</th>
            <th className="px-2 py-2 text-right">ADR</th>
            <th className="px-2 py-2 text-right">HS%</th>
            <th className="px-3 py-2 text-right">Rating</th>
          </tr>
        </thead>
        <tbody>
          {jogadores.map((p) => {
            const adr = p.roundsPlayed ? Math.round((p.damage / p.roundsPlayed) * 10) / 10 : 0
            const hs = p.kills ? Math.round((p.headshotKills / p.kills) * 100) : 0
            const conteudoNome = (
              <span className="flex items-center gap-2 font-mono">
                {p.nick || p.steamId}
                {p.isTracked && <span className="text-[10px] uppercase tracking-widest text-destaque">grupo</span>}
                {!p.isTracked && podePromover && (
                  <button
                    onClick={(e) => { e.preventDefault(); onPromover(p.steamId) }}
                    disabled={promovendo === p.steamId}
                    className="panel-cut-sm border border-borda px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque hover:text-destaque disabled:opacity-50"
                  >
                    {promovendo === p.steamId ? '…' : '+ grupo'}
                  </button>
                )}
              </span>
            )
            return (
              <tr key={p.steamId} className="border-t border-borda transition-colors hover:bg-superficie-alta">
                <td className="px-3 py-2">
                  {p.isTracked ? (
                    <Link to={`/jogador/${p.steamId}`} className="hover:text-destaque">
                      {conteudoNome}
                    </Link>
                  ) : (
                    conteudoNome
                  )}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{p.kills}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${p.teamKills > 0 ? 'text-perigo' : 'text-texto-fraco'}`}>
                  {p.teamKills || 0}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{p.deaths}</td>
                <td className="px-2 py-2 text-right tabular-nums">{p.assists}</td>
                <td className="px-2 py-2 text-right tabular-nums">{adr}</td>
                <td className="px-2 py-2 text-right tabular-nums">{hs}%</td>
                <td className={`px-3 py-2 text-right font-semibold tabular-nums ${corRating(p.rating)}`}>
                  {p.rating?.toFixed(2) ?? '–'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FormClipe({ matchId, jogadores, onAdicionado }) {
  const doGrupo = jogadores.filter((p) => p.isTracked)
  const [steamId, setSteamId] = useState(doGrupo[0]?.steamId ?? '')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [erro, setErro] = useState(null)

  async function enviar(e) {
    e.preventDefault()
    setErro(null)
    const res = await fetch('/api/clips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchId, steamId, url, title }),
    })
    if (res.ok) {
      setUrl('')
      setTitle('')
      onAdicionado()
    } else {
      const b = await res.json().catch(() => ({}))
      setErro(b.erro ?? 'Erro ao anexar clipe.')
    }
  }

  return (
    <form onSubmit={enviar} className="panel-cut flex flex-wrap items-end gap-2 border border-borda bg-superficie p-3">
      <select
        value={steamId}
        onChange={(e) => setSteamId(e.target.value)}
        className="rounded border border-borda bg-fundo px-2 py-2 font-mono text-sm"
      >
        {doGrupo.map((p) => (
          <option key={p.steamId} value={p.steamId}>{p.nick || p.steamId}</option>
        ))}
      </select>
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Link do Allstar/Medal/YouTube"
        className="flex-1 rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm"
      />
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título (opcional)"
        className="w-40 rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm"
      />
      <button
        type="submit"
        className="panel-cut-sm border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo"
      >
        Anexar clipe
      </button>
      {erro && <p className="w-full font-mono text-sm text-perigo">{erro}</p>}
    </form>
  )
}

export default function Partida() {
  const { id } = useParams()
  const { jogador } = useAuth()
  const [m, setM] = useState(null)
  const [erro, setErro] = useState(false)
  const [promovendo, setPromovendo] = useState(null)

  function carregar() {
    fetch(`/api/matches/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setM)
      .catch(() => setErro(true))
  }

  async function promover(steamId) {
    setPromovendo(steamId)
    try {
      await fetch('/api/players/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamId }),
      })
      carregar()
    } finally {
      setPromovendo(null)
    }
  }

  useEffect(carregar, [id])

  if (erro) return <p className="font-mono text-sm text-texto-fraco">Partida não encontrada.</p>
  if (!m) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  const timeA = m.players.filter((p) => p.team === 'A')
  const timeB = m.players.filter((p) => p.team === 'B')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="font-mono text-sm text-texto-fraco hover:text-texto">← Partidas</Link>
          <h2 className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(m.map)}</h2>
          <p className="font-mono text-sm text-texto-fraco">{dataRelativa(m.playedAt)} · {m.source}</p>
        </div>
        <div className="font-mono text-3xl font-bold tabular-nums">
          <span className={m.scoreA > m.scoreB ? 'text-sucesso' : 'text-perigo'}>{m.scoreA ?? '–'}</span>
          <span className="mx-2 text-texto-fraco">:</span>
          <span className={m.scoreB > m.scoreA ? 'text-sucesso' : 'text-perigo'}>{m.scoreB ?? '–'}</span>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Scoreboard time="A" jogadores={timeA} podePromover={jogador?.isAdmin} onPromover={promover} promovendo={promovendo} />
        <Scoreboard time="B" jogadores={timeB} podePromover={jogador?.isAdmin} onPromover={promover} promovendo={promovendo} />
      </div>

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold uppercase tracking-wide text-texto">Replay 2D</h3>
        <SecaoReplay replayUrl={m.replayUrl} />
      </section>

      {m.highlights.length > 0 && (
        <section>
          <h3 className="mb-2 font-display text-lg font-semibold uppercase tracking-wide text-texto">Highlights</h3>
          <div className="flex flex-wrap gap-2">
            {m.highlights.map((h) => (
              <div key={h.id} className="panel-cut-sm border border-borda bg-superficie px-3 py-2 font-mono text-sm">
                <span className="font-display font-semibold uppercase text-destaque">{h.kind}</span>{' '}
                <span className="text-texto">{h.nick || h.steamId}</span>{' '}
                <span className="text-texto-fraco">round {h.roundNumber}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 className="mb-2 font-display text-lg font-semibold uppercase tracking-wide text-texto">Clipes</h3>
        <div className="mb-3 space-y-2">
          {m.clips.length === 0 && <p className="font-mono text-sm text-texto-fraco">Nenhum clipe anexado ainda.</p>}
          {m.clips.map((c) => (
            <a
              key={c.id}
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="panel-cut-sm flex items-center gap-3 border border-borda bg-superficie p-3 font-mono text-sm transition-colors hover:border-destaque/60"
            >
              <span className="rounded bg-fundo px-2 py-1 text-xs uppercase tracking-wide text-destaque">{c.provider}</span>
              <span className="text-texto">{c.title || c.url}</span>
            </a>
          ))}
        </div>
        <FormClipe matchId={m.id} jogadores={m.players} onAdicionado={carregar} />
      </section>
    </div>
  )
}
