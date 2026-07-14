import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { corRating, dataHora } from '../lib/format.js'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import { Card, SectionHeader, StatTile } from '../components/ui'

const LINHAS_STAT = [
  { rotulo: 'Rating', chave: 'rating', formato: (v) => v?.toFixed(2) ?? '–', cor: true },
  { rotulo: 'K/D', chave: 'kd', formato: (v) => v },
  { rotulo: 'ADR', chave: 'adr', formato: (v) => v },
  { rotulo: 'HS%', chave: 'hsPct', formato: (v) => `${v}%` },
  { rotulo: 'Precisão', chave: 'accuracy', formato: (v) => `${v}%` },
  { rotulo: 'Clutch %', chave: 'clutchPct', formato: (v) => `${v}%` },
  { rotulo: 'Vitórias', chave: 'winrate', formato: (v) => `${v}%` },
  { rotulo: 'Partidas', chave: 'partidas', formato: (v) => v },
]

function ColunaJogador({ p, ladoOposto }) {
  if (!p) return <div className="min-w-0 flex-1" />
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
      {p.avatarUrl && <img src={p.avatarUrl} alt="" className="panel-cut h-14 w-14 shrink-0 border border-borda object-cover" />}
      <Link to={`/jogador/${p.steamId}`} className="w-full truncate font-display font-semibold uppercase text-texto hover:text-destaque">
        {p.nick || p.steamId}
      </Link>
    </div>
  )
}

export default function Comparar() {
  const [params, setParams] = useSearchParams()
  const [jogadores, setJogadores] = useState([])
  const [a, setA] = useState(params.get('a') ?? '')
  const [b, setB] = useState(params.get('b') ?? '')
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    fetch('/api/players').then((res) => res.json()).then(setJogadores)
  }, [])

  useEffect(() => {
    setDados(null)
    setErro(null)
    if (!a || !b) return
    if (a === b) { setErro('Escolha dois Jogadores diferentes.'); return }
    setParams({ a, b })
    const qs = new URLSearchParams({ a, b })
    if (de) qs.set('from', de)
    if (ate) qs.set('to', ate)
    fetch(`/api/profile/compare?${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setDados)
      .catch(() => setErro('Não foi possível comparar esses Jogadores.'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, de, ate])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">Comparar Jogadores</h2>
        <p className="font-mono text-sm text-texto-fraco">Rating, stats e confronto direto entre dois Jogadores do grupo.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <select value={a} onChange={(e) => setA(e.target.value)} className="rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Jogador A…</option>
          {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick || j.steamId}</option>)}
        </select>
        <span className="font-display text-texto-fraco">vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} className="rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Jogador B…</option>
          {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick || j.steamId}</option>)}
        </select>
        <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
      </div>

      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}

      {dados && (
        <>
          <Card className="p-4">
            <div className="mb-4 flex items-start justify-between">
              <ColunaJogador p={dados.a} />
              <div className="px-2 pt-2 font-display text-xs uppercase tracking-widest text-texto-fraco">vs</div>
              <ColunaJogador p={dados.b} ladoOposto />
            </div>
            <div className="divide-y divide-borda">
              {LINHAS_STAT.map((linha) => {
                const va = dados.a.stats[linha.chave]
                const vb = dados.b.stats[linha.chave]
                const aGanha = typeof va === 'number' && typeof vb === 'number' && va > vb
                const bGanha = typeof va === 'number' && typeof vb === 'number' && vb > va
                return (
                  <div key={linha.chave} className="grid grid-cols-3 items-center py-2 font-mono text-sm tabular-nums">
                    <span className={`text-right ${aGanha ? 'font-semibold text-destaque' : 'text-texto'} ${linha.cor ? corRating(va) : ''}`}>
                      {linha.formato(va)}
                    </span>
                    <span className="text-center text-[10px] uppercase tracking-wider text-texto-fraco">{linha.rotulo}</span>
                    <span className={`text-left ${bGanha ? 'font-semibold text-destaque' : 'text-texto'} ${linha.cor ? corRating(vb) : ''}`}>
                      {linha.formato(vb)}
                    </span>
                  </div>
                )
              })}
            </div>
          </Card>

          <section>
            <SectionHeader titulo="Confronto direto" />
            {dados.confronto.partidasJuntos === 0 ? (
              <p className="font-mono text-sm text-texto-fraco">Esses dois nunca jogaram a mesma Partida ainda.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <StatTile rotulo="Partidas juntos" valor={dados.confronto.partidasJuntos} />
                <StatTile rotulo="Mesmo time" valor={`${dados.confronto.mesmoTimeVitorias}/${dados.confronto.mesmoTime}`} sub="vitórias" />
                <StatTile rotulo={`${dados.a.nick || 'A'} venceu`} valor={dados.confronto.aVenceu} sub="times opostos" />
                <StatTile rotulo={`${dados.b.nick || 'B'} venceu`} valor={dados.confronto.bVenceu} sub="times opostos" />
              </div>
            )}
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section>
              <SectionHeader titulo={`Evolução — ${dados.a.nick || dados.a.steamId}`} />
              <Card className="p-4">
                <LinhaEvolucao pontos={dados.a.evolucao.map((e) => ({ label: dataHora(e.playedAt), valor: e.rating }))} />
              </Card>
            </section>
            <section>
              <SectionHeader titulo={`Evolução — ${dados.b.nick || dados.b.steamId}`} />
              <Card className="p-4">
                <LinhaEvolucao pontos={dados.b.evolucao.map((e) => ({ label: dataHora(e.playedAt), valor: e.rating }))} cor="var(--color-time-b)" />
              </Card>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
