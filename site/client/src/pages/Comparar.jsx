import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { dataHora } from '../lib/format.js'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import { Card, SectionHeader, StatTile, RatingBadge } from '../components/ui'

const LINHAS_STAT = [
  { rotulo: 'Rating', chave: 'rating', formato: (v) => v?.toFixed(2) ?? '–', rating: true },
  { rotulo: 'K/D', chave: 'kd', formato: (v) => v },
  { rotulo: 'Vitórias', chave: 'winrate', formato: (v) => `${v}%` },
  { rotulo: 'ADR', chave: 'adr', formato: (v) => v },
  { rotulo: 'HS%', chave: 'hsPct', formato: (v) => `${v}%` },
  { rotulo: 'Kills/partida', chave: 'kills', formato: (v, s) => (s.partidas ? Math.round((v / s.partidas) * 10) / 10 : v) },
  { rotulo: 'Precisão', chave: 'accuracy', formato: (v) => `${v}%` },
  { rotulo: 'Clutch %', chave: 'clutchPct', formato: (v) => `${v}%` },
  { rotulo: 'Entry win %', chave: 'entryWinPct', formato: (v) => `${v}%` },
  { rotulo: 'Partidas', chave: 'partidas', formato: (v) => v },
]

function AvatarFallback({ nick }) {
  return (
    <div className="panel-cut-sm flex h-16 w-16 shrink-0 items-center justify-center border border-borda bg-fundo font-display text-lg font-bold uppercase text-texto-fraco sm:h-20 sm:w-20">
      {(nick || '?').slice(0, 2)}
    </div>
  )
}

function CabecalhoJogador({ p, alinhamento }) {
  if (!p) return <div className="min-w-0 flex-1" />
  return (
    <Link
      to={`/jogador/${p.steamId}`}
      className={`flex min-w-0 flex-1 flex-col items-center gap-2 rounded transition-colors duration-200 hover:text-destaque sm:flex-row ${alinhamento === 'direita' ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}
    >
      {p.avatarUrl ? (
        <img src={p.avatarUrl} alt="" className="panel-cut-sm h-16 w-16 shrink-0 border border-borda object-cover sm:h-20 sm:w-20" />
      ) : (
        <AvatarFallback nick={p.nick} />
      )}
      <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
        <span className="w-full truncate font-display text-base font-semibold uppercase tracking-wide text-texto sm:text-lg">
          {p.nick || p.steamId}
        </span>
        <RatingBadge valor={p.stats?.rating} className="text-sm" />
      </div>
    </Link>
  )
}

// Barra dividida A|B proporcional ao peso de cada lado nessa métrica (só quando os dois
// valores são numéricos e positivos — clutch%/precisão etc. já são 0–100).
function BarraComparacao({ va, vb }) {
  if (typeof va !== 'number' || typeof vb !== 'number' || (va === 0 && vb === 0)) return null
  const total = Math.abs(va) + Math.abs(vb)
  const pctA = total ? (Math.abs(va) / total) * 100 : 50
  return (
    <div className="mt-1 flex h-1 w-full overflow-hidden rounded-full bg-fundo">
      <div className="bg-time-a" style={{ width: `${pctA}%` }} />
      <div className="bg-time-b" style={{ width: `${100 - pctA}%` }} />
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
        <select value={a} onChange={(e) => setA(e.target.value)} className="cursor-pointer rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Jogador A…</option>
          {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick || j.steamId}</option>)}
        </select>
        <span className="font-display text-texto-fraco">vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} className="cursor-pointer rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Jogador B…</option>
          {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick || j.steamId}</option>)}
        </select>
        <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
      </div>

      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}

      {/* Estado vazio: sem os dois jogadores escolhidos, `dados` é null — em vez de
          deixar a página em branco, mostra uma instrução clara. */}
      {!dados && !erro && (
        <Card className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <span className="font-display text-lg font-semibold uppercase tracking-wide text-texto-fraco">
            Escolha dois jogadores
          </span>
          <p className="max-w-sm font-mono text-xs text-texto-fraco/80">
            Selecione o Jogador A e o Jogador B acima pra ver o confronto direto — rating, stats lado a lado e histórico entre eles.
          </p>
        </Card>
      )}

      {dados && (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <CabecalhoJogador p={dados.a} alinhamento="esquerda" />
              <div className="shrink-0 pt-2 font-display text-xs uppercase tracking-widest text-texto-fraco sm:pt-6">vs</div>
              <CabecalhoJogador p={dados.b} alinhamento="direita" />
            </div>

            <div className="mt-4 divide-y divide-borda border-t border-borda">
              {LINHAS_STAT.map((linha) => {
                const va = dados.a.stats[linha.chave]
                const vb = dados.b.stats[linha.chave]
                const aGanha = typeof va === 'number' && typeof vb === 'number' && va > vb
                const bGanha = typeof va === 'number' && typeof vb === 'number' && vb > va
                return (
                  <div key={linha.chave} className="grid grid-cols-3 items-center gap-2 py-2.5">
                    <span className={`text-right font-mono text-sm font-bold tabular-nums ${aGanha ? 'text-destaque' : 'text-texto'}`}>
                      {linha.formato(va, dados.a.stats)}
                    </span>
                    <span className="text-center text-[10px] font-display uppercase tracking-wider text-texto-fraco">{linha.rotulo}</span>
                    <span className={`text-left font-mono text-sm font-bold tabular-nums ${bGanha ? 'text-destaque' : 'text-texto'}`}>
                      {linha.formato(vb, dados.b.stats)}
                    </span>
                    <div className="col-span-3">
                      <BarraComparacao va={typeof va === 'number' ? va : 0} vb={typeof vb === 'number' ? vb : 0} />
                    </div>
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
