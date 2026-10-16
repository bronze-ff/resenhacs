import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { nomeMapa } from '../lib/format.js'
import { CabecalhoPagina, Card, EstadoErro, EstadoVazio, MapIcon, Select, Skeleton, classeEntrada, classesBotao } from '../components/ui'

// Página Mapas (artboard "Mapas" do canvas de design): um card por mapa com o radar ao
// fundo, winrate, partidas, variação vs período anterior e barras CT/T comparando
// período atual, anterior e a média do grupo. Dados: GET /api/mapas
// (site/server/src/routes/mapas.js).

const classeData = `${classeEntrada} font-mono tabular-nums [color-scheme:dark] lg:w-36 lg:px-2 lg:text-xs`

function fmtPct(v) {
  return v == null ? '–' : `${Math.round(v)}%`
}

function fmtData(iso) {
  if (!iso) return '…'
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

// Variação em pontos percentuais com seta (Regra do Sinal Duplo: nunca só cor).
function Variacao({ valor }) {
  if (valor == null) return <span className="font-mono text-xs text-texto-fraco">sem comparação</span>
  const pts = Math.round(valor)
  if (pts === 0) return <span className="font-mono text-xs tabular-nums text-texto-fraco">= 0 pts vs anterior</span>
  const sobe = pts > 0
  return (
    <span className={`font-mono text-xs tabular-nums ${sobe ? 'text-sucesso' : 'text-perigo'}`}>
      <span aria-hidden="true">{sobe ? '↑' : '↓'} </span>
      <span className="sr-only">{sobe ? 'subiu' : 'caiu'} </span>
      {Math.abs(pts)} pts vs anterior
    </span>
  )
}

function BarraLado({ lado, dados }) {
  const estilo = lado === 'CT' ? 'bg-time-b/10 text-time-b' : 'bg-time-a/10 text-time-a'
  const largura = (v) => `${Math.max(0, Math.min(100, v ?? 0))}%`
  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5">
      <span className={`rounded-[var(--radius-pequeno)] py-1 text-center font-mono text-xs font-semibold ${estilo}`}>{lado}</span>
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="relative h-2 flex-1 rounded-sm bg-superficie-alta">
            <div className="h-2 rounded-sm bg-texto" style={{ width: largura(dados.atual) }} />
            {dados.grupo != null && (
              <span
                className="absolute -top-[3px] h-3.5 w-0.5 bg-time-b"
                style={{ left: largura(dados.grupo) }}
                title={`Média do grupo: ${fmtPct(dados.grupo)}`}
              />
            )}
          </div>
          <span className="w-9 text-right font-mono text-xs tabular-nums text-texto">{fmtPct(dados.atual)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-2 flex-1 rounded-sm bg-superficie-alta">
            <div className="h-2 rounded-sm bg-[#55555c]" style={{ width: largura(dados.anterior) }} />
          </div>
          <span className="w-9 text-right font-mono text-xs tabular-nums text-texto-fraco">{fmtPct(dados.anterior)}</span>
        </div>
        <span className="sr-only">
          {lado}: período atual {fmtPct(dados.atual)}, anterior {fmtPct(dados.anterior)}, média do grupo {fmtPct(dados.grupo)} dos rounds ganhos
        </span>
      </div>
    </div>
  )
}

function CardMapa({ m }) {
  const saldo = [`${m.vitorias}V`, `${m.derrotas}D`, m.empates ? `${m.empates}E` : null].filter(Boolean).join(' · ')
  const corWr = m.winrate == null ? 'text-texto' : m.winrate > 50 ? 'text-sucesso' : m.winrate < 50 ? 'text-perigo' : 'text-texto'
  const mapaQs = encodeURIComponent(m.map)
  return (
    <Card as="article" className="overflow-hidden">
      <div className="relative h-[150px] overflow-hidden border-b border-borda bg-fundo">
        <img src={`/radars/${m.map}.png`} alt="" aria-hidden="true" className="absolute left-0 top-[-30%] w-full opacity-50" onError={(e) => { e.currentTarget.style.display = 'none' }} />
        <div className="absolute inset-x-0 bottom-0 h-[70px] bg-gradient-to-t from-superficie to-transparent" />
        <div className="absolute bottom-3 left-4 flex items-center gap-2.5">
          <MapIcon map={m.map} size={30} />
          <h3 className="text-xl font-semibold text-texto">{nomeMapa(m.map)}</h3>
        </div>
      </div>
      <div className="p-4">
        <div className="grid grid-cols-2">
          <div>
            <div className="rotulo">Winrate</div>
            <div className={`mt-0.5 font-mono text-3xl font-medium tabular-nums ${corWr}`}>{fmtPct(m.winrate)}</div>
            <Variacao valor={m.variacao} />
          </div>
          <div>
            <div className="rotulo">Partidas</div>
            <div className="mt-0.5 font-mono text-3xl font-medium tabular-nums text-texto">{m.partidas}</div>
            <div className="font-mono text-xs tabular-nums text-texto-fraco">{saldo}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3.5">
          <BarraLado lado="CT" dados={m.lados.CT} />
          <BarraLado lado="T" dados={m.lados.T} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link to={`/granadas?map=${mapaQs}`} className={classesBotao({ variante: 'secundario', tamanho: 'sm' })}>Granadas</Link>
          <Link to={`/taticas?map=${mapaQs}`} className={classesBotao({ variante: 'secundario', tamanho: 'sm' })}>Táticas</Link>
        </div>
      </div>
    </Card>
  )
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-3.5 text-xs text-texto-fraco">
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm bg-texto" />Período atual</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3.5 rounded-sm bg-[#55555c]" />Período anterior</span>
      <span className="inline-flex items-center gap-1.5"><span className="h-3 w-0.5 bg-time-b" />Média do grupo</span>
      <span>Barras: % de rounds ganhos em cada lado</span>
    </div>
  )
}

export default function Mapas() {
  const { jogador: viewer } = useAuth()
  const [modo, setModo] = useState('partidas') // partidas | datas
  const [de, setDe] = useState('')
  const [ate, setAte] = useState('')
  const [compararDe, setCompararDe] = useState('')
  const [compararAte, setCompararAte] = useState('')
  const [alvo, setAlvo] = useState('')
  const [amigos, setAmigos] = useState([])
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    fetch('/api/amigos')
      .then((r) => (r.ok ? r.json() : { amigos: [] }))
      .then((j) => setAmigos(j.amigos ?? []))
      .catch(() => setAmigos([]))
  }, [])

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(false)
    const qs = new URLSearchParams()
    if (alvo) qs.set('jogador', alvo)
    if (modo === 'datas') {
      if (de) qs.set('de', de)
      if (ate) qs.set('ate', ate)
      if (compararDe) qs.set('compararDe', compararDe)
      if (compararAte) qs.set('compararAte', compararAte)
    }
    fetch(`/api/mapas${qs.size ? `?${qs}` : ''}`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((j) => vivo && setDados(j))
      .catch(() => vivo && setErro(true))
    return () => {
      vivo = false
    }
  }, [alvo, modo, de, ate, compararDe, compararAte])

  const periodo = dados?.periodo
  const rotuloAtual = periodo
    ? `${fmtData(periodo.atual.de)} – ${fmtData(periodo.atual.ate)} · ${periodo.atual.partidas} partidas`
    : ''
  const rotuloAnterior = periodo?.anterior?.partidas
    ? `${fmtData(periodo.anterior.de)} – ${fmtData(periodo.anterior.ate)} · ${periodo.anterior.partidas} partidas`
    : 'sem partidas pra comparar'

  return (
    <div className="space-y-6">
      <CabecalhoPagina
        titulo="Mapas"
        eyebrow="Análise"
        descricao="Winrate por mapa e por lado, comparando o período atual com o anterior e com a média do grupo."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <span className="rotulo">Período</span>
          <Select value={modo} onChange={(e) => setModo(e.target.value)} className="min-w-56">
            <option value="partidas">Últimas 30 vs 30 anteriores</option>
            <option value="datas">Escolher datas</option>
          </Select>
        </div>
        {modo === 'datas' && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="rotulo">Período atual</span>
              <div className="flex items-center gap-2">
                <input type="date" value={de} onChange={(e) => setDe(e.target.value)} aria-label="Início do período atual" className={classeData} />
                <span className="font-mono text-xs text-texto-fraco" aria-hidden="true">→</span>
                <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} aria-label="Fim do período atual" className={classeData} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="rotulo">Comparar com</span>
              <div className="flex items-center gap-2">
                <input type="date" value={compararDe} onChange={(e) => setCompararDe(e.target.value)} aria-label="Início do período de comparação" className={classeData} />
                <span className="font-mono text-xs text-texto-fraco" aria-hidden="true">→</span>
                <input type="date" value={compararAte} onChange={(e) => setCompararAte(e.target.value)} aria-label="Fim do período de comparação" className={classeData} />
              </div>
            </div>
          </>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="rotulo">Jogador</span>
          <Select value={alvo} onChange={(e) => setAlvo(e.target.value)} className="min-w-48">
            <option value="">{viewer?.nick ? `Eu (${viewer.nick})` : 'Eu'}</option>
            {amigos.map((a) => (
              <option key={a.steamId} value={a.steamId}>{a.nick || a.steamId}</option>
            ))}
          </Select>
        </div>
      </div>

      {periodo && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <Legenda />
          <div className="font-mono text-xs tabular-nums text-texto-fraco">
            <span className="text-texto">{rotuloAtual}</span> vs {rotuloAnterior}
          </div>
        </div>
      )}

      {erro && <EstadoErro mensagem="Não deu pra carregar os mapas." />}
      {!erro && !dados && (
        <div role="status" aria-label="Carregando mapas" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="panel-cut h-[380px]" />)}
        </div>
      )}
      {dados && dados.mapas.length === 0 && (
        <EstadoVazio titulo="Nenhuma partida no período" descricao="Troque o período ou o jogador pra ver os mapas." />
      )}
      {dados && dados.mapas.length > 0 && (
        <>
          <p className="rotulo">Ordenado por partidas jogadas</p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {dados.mapas.map((m) => <CardMapa key={m.map} m={m} />)}
          </div>
        </>
      )}
    </div>
  )
}
