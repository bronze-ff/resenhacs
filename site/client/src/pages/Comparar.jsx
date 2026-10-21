import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { dataHora } from '../lib/format.js'
import LinhaEvolucao from '../components/LinhaEvolucao.jsx'
import FiltroPeriodo from '../components/FiltroPeriodo.jsx'
import { CabecalhoPagina, Card, EstadoErro, EstadoVazio, SectionHeader, SkeletonLista, StatTile, RatingBadge, Select } from '../components/ui'

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
    <div className="panel-cut-sm flex h-16 w-16 shrink-0 items-center justify-center border border-borda bg-fundo font-display text-lg font-semibold text-texto-fraco sm:h-20 sm:w-20">
      {(nick || '?').slice(0, 2)}
    </div>
  )
}

function CabecalhoJogador({ p, alinhamento }) {
  if (!p) return <div className="min-w-0 flex-1" />
  return (
    <Link
      to={`/jogador/${p.steamId}`}
      className={`flex min-w-0 flex-1 flex-col items-center gap-2 transition-colors duration-200 hover:text-destaque sm:flex-row ${alinhamento === 'direita' ? 'sm:flex-row-reverse sm:text-right' : 'sm:text-left'}`}
    >
      {p.avatarUrl ? (
        <img src={p.avatarUrl} alt="" className="panel-cut-sm h-16 w-16 shrink-0 border border-borda object-cover sm:h-20 sm:w-20" />
      ) : (
        <AvatarFallback nick={p.nick} />
      )}
      <div className="flex min-w-0 flex-col items-center gap-1 sm:items-start">
        <span className="w-full truncate font-display text-lg font-semibold text-texto sm:text-2xl">
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
    <div className="mt-1 flex h-1 w-full overflow-hidden bg-fundo">
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
  const [erroJogadores, setErroJogadores] = useState(false)

  useEffect(() => {
    // Erro do server (ex.: { erro }) não pode virar a lista: o .map dos Selects quebrava.
    fetch('/api/players')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((lista) => setJogadores(Array.isArray(lista) ? lista : []))
      .catch(() => {
        setJogadores([])
        setErroJogadores(true)
      })
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
    // Trocar a seleção com uma comparação em voo: a resposta antiga é descartada.
    let vivo = true
    fetch(`/api/profile/compare?${qs}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then((d) => { if (vivo) setDados(d) })
      .catch(() => { if (vivo) setErro('Não foi possível comparar esses Jogadores.') })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b, de, ate])

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        eyebrow="Duelo"
        titulo="Comparar Jogadores"
        descricao="Rating, stats e confronto direto entre dois Jogadores do grupo."
        className="!mb-0"
      />

      <Card className="p-4 sm:p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <div>
            <p className="rotulo mb-2">Duelo</p>
            <div className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
              <Select value={a} onChange={(e) => setA(e.target.value)} className="w-full">
            <option value="">Jogador A…</option>
            {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick || j.steamId}</option>)}
          </Select>
              <span className="panel-cut-sm mx-auto flex h-9 w-9 items-center justify-center border border-borda bg-fundo font-display text-xs text-texto-fraco">vs</span>
              <Select value={b} onChange={(e) => setB(e.target.value)} className="w-full">
            <option value="">Jogador B…</option>
            {jogadores.map((j) => <option key={j.steamId} value={j.steamId}>{j.nick || j.steamId}</option>)}
          </Select>
            </div>
          </div>
          <div>
            <p className="rotulo mb-2">Recorte</p>
            <FiltroPeriodo de={de} ate={ate} onDe={setDe} onAte={setAte} />
          </div>
        </div>
      </Card>

      {erroJogadores && <EstadoErro mensagem="Não deu para carregar a lista de Jogadores. Recarregue a página." />}
      {erro && <EstadoErro mensagem={erro} />}

      {!dados && !erro && a && b && <SkeletonLista linhas={6} altura="h-12" rotulo="Comparando Jogadores" />}

      {/* Estado vazio: sem os dois jogadores escolhidos, `dados` é null — em vez de
          deixar a página em branco, mostra uma instrução clara. */}
      {/* Estado vazio: sem os dois jogadores escolhidos, `dados` é null — em vez de
          deixar a página em branco, mostra uma instrução clara. */}
      {!dados && !erro && (!a || !b) && (
        <EstadoVazio
          titulo="Prepare o confronto"
          descricao="Selecione um jogador de cada lado. O relatório mostra a vantagem por métrica, o desempenho recente e o histórico das partidas que jogaram juntos."
        />
      )}

      {dados && (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <CabecalhoJogador p={dados.a} alinhamento="esquerda" />
              <div className="shrink-0 pt-4 font-display text-2xl font-semibold text-texto-fraco sm:pt-6">vs</div>
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
                    <span className={`text-right font-display text-xl font-semibold tabular-nums ${aGanha ? 'text-time-a' : 'text-texto'}`}>
                      {aGanha && <span aria-hidden="true" className="mr-1.5 text-xs">◀</span>}
                      {linha.formato(va, dados.a.stats)}
                    </span>
                    <span className="rotulo text-center">{linha.rotulo}</span>
                    <span className={`text-left font-display text-xl font-semibold tabular-nums ${bGanha ? 'text-time-b' : 'text-texto'}`}>
                      {linha.formato(vb, dados.b.stats)}
                      {bGanha && <span aria-hidden="true" className="ml-1.5 text-xs">▶</span>}
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
              <EstadoVazio titulo="Nunca se cruzaram" descricao="Esses dois nunca jogaram a mesma Partida ainda." />
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile rotulo="Partidas juntos" valor={dados.confronto.partidasJuntos} />
                <StatTile rotulo="Mesmo time" valor={`${dados.confronto.mesmoTimeVitorias}/${dados.confronto.mesmoTime}`} sub="vitórias" />
                <StatTile rotulo={`${dados.a.nick || 'A'} venceu`} valor={dados.confronto.aVenceu} sub="times opostos" />
                <StatTile
                  rotulo={`${dados.b.nick || 'B'} venceu`}
                  valor={dados.confronto.bVenceu}
                  sub={dados.confronto.empates ? `times opostos · ${dados.confronto.empates} empate${dados.confronto.empates > 1 ? 's' : ''}` : 'times opostos'}
                />
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
