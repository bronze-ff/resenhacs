import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { nomeMapa, dataHora, origemPartida, corRating } from '../lib/format.js'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'

const MAPAS = ['de_anubis', 'de_ancient', 'de_cache', 'de_dust2', 'de_inferno', 'de_mirage', 'de_nuke', 'de_overpass', 'de_train', 'de_vertigo']

// Resultado do ponto de vista do GRUPO (não do "Time A"): vitória/derrota quando todo
// mundo do grupo estava no mesmo lado; 'misto' quando o grupo se dividiu nos dois times.
// won é nullable no banco (empate — placar igual, ex.: 12:12 — não tem vencedor); só
// checar `!x.won` trataria empate como derrota, então os 3 estados são explícitos.
function resultadoDoGrupo(m) {
  const t = m.tracked ?? []
  if (t.length === 0) return null
  if (t.every((x) => x.won === true)) return 'vitoria'
  if (t.every((x) => x.won === false)) return 'derrota'
  if (t.every((x) => x.won === null)) return 'empate'
  return 'misto'
}

function Placar({ m }) {
  const resultado = resultadoDoGrupo(m)
  // Orienta o placar pra perspectiva do grupo: nosso placar primeiro.
  let a = m.scoreA
  let b = m.scoreB
  if (resultado === 'vitoria') [a, b] = [Math.max(a, b), Math.min(a, b)]
  if (resultado === 'derrota') [a, b] = [Math.min(a, b), Math.max(a, b)]
  const corNosso = resultado === 'vitoria' ? 'text-sucesso' : resultado === 'derrota' ? 'text-perigo' : 'text-texto'
  return (
    <div className="flex items-center gap-3">
      {resultado === 'vitoria' && (
        <span className="panel-cut-sm border border-sucesso/40 bg-sucesso/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-sucesso">
          Vitória
        </span>
      )}
      {resultado === 'derrota' && (
        <span className="panel-cut-sm border border-perigo/40 bg-perigo/10 px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-perigo">
          Derrota
        </span>
      )}
      {resultado === 'empate' && (
        <span className="panel-cut-sm border border-borda bg-superficie px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-texto-fraco">
          Empate
        </span>
      )}
      {resultado === 'misto' && (
        <span className="panel-cut-sm border border-borda bg-superficie px-2 py-0.5 font-display text-[10px] font-bold uppercase tracking-widest text-texto-fraco" title="O grupo jogou dividido nos dois times">
          Misto
        </span>
      )}
      <div className="flex items-center gap-1.5 font-mono text-lg font-bold tabular-nums">
        <span className={corNosso}>{a ?? '–'}</span>
        <span className="text-texto-fraco">:</span>
        <span className="text-texto-fraco">{b ?? '–'}</span>
      </div>
    </div>
  )
}

function CardPartida({ m }) {
  const resultado = resultadoDoGrupo(m)
  const borda =
    resultado === 'vitoria' ? 'border-l-2 border-l-sucesso/70' : resultado === 'derrota' ? 'border-l-2 border-l-perigo/70' : ''
  return (
    <Link
      to={`/partida/${m.id}`}
      className={`panel-cut relative flex items-center justify-between gap-3 border border-borda bg-superficie p-4 transition-colors hover:border-destaque/50 hover:bg-superficie-alta ${borda}`}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3 lg:gap-4">
        <div className="panel-cut-sm flex h-12 w-12 shrink-0 items-center justify-center border border-borda bg-fundo font-mono text-xs font-bold uppercase text-destaque">
          {nomeMapa(m.map).slice(0, 3)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-display font-semibold uppercase tracking-wide text-texto">{nomeMapa(m.map)}</span>
            <span
              title={origemPartida(m.source).title}
              className="panel-cut-sm shrink-0 border border-borda bg-fundo px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-texto-fraco"
            >
              {origemPartida(m.source).label}
            </span>
          </div>
          <div className="truncate font-mono text-xs text-texto-fraco">
            {dataHora(m.playedAt)}
            {m.tracked?.length > 0 && (
              <span> · {m.tracked.map((t) => t.nick).join(', ')}</span>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0">
        <Placar m={m} />
      </div>
    </Link>
  )
}

// Quantas Partidas descobertas ainda faltam baixar/parsear (o Coletor roda de hora
// em hora sozinho — isto é só visibilidade, não dispara nada). Atualiza a cada 30s
// enquanto a aba estiver aberta, pra acompanhar um backfill grande em andamento.
function SincStatus() {
  const [status, setStatus] = useState(null)

  useEffect(() => {
    let vivo = true
    function carregar() {
      fetch('/api/matches/sync-status')
        .then((res) => (res.ok ? res.json() : null))
        .then((s) => { if (vivo) setStatus(s) })
        .catch(() => {})
    }
    carregar()
    const t = setInterval(carregar, 30000)
    return () => { vivo = false; clearInterval(t) }
  }, [])

  if (!status || (status.pending === 0 && status.failed === 0)) return null
  return (
    <div className="panel-cut-sm mb-4 flex flex-wrap items-center gap-2 border border-borda bg-superficie px-3 py-2 font-mono text-xs text-texto-fraco">
      <span className="inline-block h-1.5 w-1.5 animate-pulso-sinal rounded-full bg-destaque" />
      {status.pending > 0 && (
        <span>
          <span className="text-texto">{status.pending}</span> partida{status.pending === 1 ? '' : 's'} pra sincronizar
        </span>
      )}
      {status.failed > 0 && (
        <span title="Demo expirado na Valve ou falha de download — sem solução automática">
          · <span className="text-perigo">{status.failed}</span> com falha
        </span>
      )}
    </div>
  )
}

// "Resenhas": partidas jogadas seguidas (gap < 3h) resumidas — quem se destacou,
// quantas venceu/perdeu, sem precisar abrir partida por partida.
function Resenhas() {
  const [sessoes, setSessoes] = useState(null)

  useEffect(() => {
    fetch('/api/sessions?limit=5')
      .then((res) => (res.ok ? res.json() : []))
      .then(setSessoes)
      .catch(() => setSessoes([]))
  }, [])

  if (!sessoes || sessoes.length === 0) return null

  return (
    <section className="mb-6">
      <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
        Resenhas recentes
      </h3>
      <div className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-1">
        {(sessoes ?? []).map((s) => (
          <div
            key={s.matchIds[0]}
            className="panel-cut-sm min-w-[240px] flex-shrink-0 snap-start border border-borda bg-superficie p-3"
          >
            <div className="flex items-center justify-between font-mono text-xs text-texto-fraco">
              <span>{dataHora(s.inicio)}</span>
              <span>{s.partidas} partida{s.partidas === 1 ? '' : 's'}</span>
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-sm">
              {s.vitorias > 0 && <span className="text-sucesso">{s.vitorias}V</span>}
              {s.derrotas > 0 && <span className="text-perigo">{s.derrotas}D</span>}
              {s.empates > 0 && <span className="text-texto-fraco">{s.empates}E</span>}
              {s.mistos > 0 && <span className="text-texto-fraco">{s.mistos} misto</span>}
            </div>
            {s.destaque && (
              <div className="mt-2 border-t border-borda pt-2 font-mono text-xs">
                <span className="text-texto-fraco">Destaque: </span>
                <Link to={`/jogador/${s.destaque.steamId}`} className="text-texto hover:text-destaque">
                  {s.destaque.nick}
                </Link>{' '}
                <span className={corRating(s.destaque.ratingMedio)}>{s.destaque.ratingMedio.toFixed(2)}</span>
                {s.destaque.aces > 0 && <span className="ml-1 text-texto-fraco">· {s.destaque.aces} ace{s.destaque.aces > 1 ? 's' : ''}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function Feed() {
  const [partidas, setPartidas] = useState(null)
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [mapa, setMapa] = useState('')
  const [origem, setOrigem] = useState('')
  const [resultado, setResultado] = useState('')

  useEffect(() => {
    const qs = new URLSearchParams()
    if (de) qs.set('from', de)
    if (ate) qs.set('to', ate)
    if (mapa) qs.set('map', mapa)
    if (origem) qs.set('source', origem)
    fetch(`/api/matches${qs.size ? `?${qs}` : ''}`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setPartidas)
      .catch(() => setPartidas([]))
  }, [de, ate, mapa, origem])

  // Resultado (V/D) é do ponto de vista do grupo — filtrado no client.
  const visiveis = useMemo(() => {
    if (!partidas) return null
    if (!resultado) return partidas
    return partidas.filter((m) => resultadoDoGrupo(m) === resultado)
  }, [partidas, resultado])

  return (
    <div>
      <h2 className="mb-4 font-display text-xl font-semibold uppercase tracking-wide text-texto">Partidas</h2>
      <SincStatus />
      <Resenhas />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
        <select
          value={mapa}
          onChange={(e) => setMapa(e.target.value)}
          className="rounded border border-borda bg-superficie px-2 py-2 font-mono text-xs lg:py-1"
        >
          <option value="">Todos os mapas</option>
          {MAPAS.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
        </select>
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {[['', 'Tudo'], ['vitoria', 'Vitórias'], ['derrota', 'Derrotas']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setResultado(v)}
              className={`px-2.5 py-3 transition-colors lg:py-1 ${resultado === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
          {[['', 'Todas'], ['valve_mm', 'Auto'], ['upload', 'Manual']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setOrigem(v)}
              className={`px-2.5 py-3 transition-colors lg:py-1 ${origem === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visiveis === null && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
      {visiveis?.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">
          Nenhuma Partida encontrada com esses filtros.
        </p>
      )}
      <div className="space-y-2">
        {visiveis?.map((m) => <CardPartida key={m.id} m={m} />)}
      </div>
    </div>
  )
}
