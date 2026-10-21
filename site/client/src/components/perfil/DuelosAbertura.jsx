import { useEffect, useState } from 'react'
import { Card, Explicacao, SectionHeader, Skeleton } from '../ui'
import { METRICAS } from '../../lib/metricas.js'

// "Duelos de abertura e trocas" no perfil (referência: Leetify Opening Duels /
// Trade Kill Success / Traded Death). Agregado das últimas 30 Partidas visíveis —
// GET /api/profile/:steamId/duelos (site/server/src/trades.js tem as definições).

export function fmtPct(v) {
  return v == null ? '–' : `${Math.round(v)}%`
}

function Tile({ rotulo, valor, sub, metrica }) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="rotulo"><Explicacao metrica={metrica}>{rotulo}</Explicacao></span>
      <span className="font-mono text-2xl tabular-nums text-texto">{valor}</span>
      {sub && <span className="font-mono text-xs tabular-nums text-texto-fraco">{sub}</span>}
    </Card>
  )
}

function BarraLado({ lado, dados }) {
  const cor = lado === 'CT' ? 'bg-time-b' : 'bg-time-a'
  const texto = lado === 'CT' ? 'text-time-b' : 'text-time-a'
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2">
      <span className={`font-mono text-xs font-semibold ${texto}`}>
        <Explicacao metrica={lado === 'CT' ? METRICAS.abCt : METRICAS.abT}>{lado}</Explicacao>
      </span>
      <div className="h-2 rounded-sm bg-superficie-alta" aria-hidden="true">
        <div className={`h-2 rounded-sm ${cor}`} style={{ width: `${dados.pct ?? 0}%` }} />
      </div>
      <span className="font-mono text-xs tabular-nums text-texto-fraco">
        {fmtPct(dados.pct)} <span className="text-texto-fraco/70">({dados.aberturasGanhas}/{dados.aberturas})</span>
      </span>
    </div>
  )
}

export default function DuelosAbertura({ steamId }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(false)
    fetch(`/api/profile/${steamId}/duelos`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((j) => vivo && setDados(j))
      .catch(() => vivo && setErro(true))
    return () => {
      vivo = false
    }
  }, [steamId])

  // Seção complementar: se falhar, some em vez de poluir o perfil com erro.
  if (erro) return null
  if (!dados) {
    return (
      <section aria-label="Carregando duelos">
        <SectionHeader titulo="Duelos de abertura e trocas" />
        <Skeleton className="panel-cut h-32" />
      </section>
    )
  }
  if (!dados.partidas || (dados.aberturas === 0 && dados.mortes === 0)) return null

  return (
    <section>
      <SectionHeader
        titulo="Duelos de abertura e trocas"
        subtitulo={`Últimas ${dados.partidas} partidas · troca = colega mata quem te matou em até 5 s`}
      />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card className="flex flex-col gap-3 p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="rotulo"><Explicacao metrica={METRICAS.aberturasPct}>Vitória no 1º duelo do round</Explicacao></div>
              <div className="font-mono text-3xl tabular-nums text-texto">{fmtPct(dados.aberturasPct)}</div>
            </div>
            <div className="text-right font-mono text-xs tabular-nums text-texto-fraco">
              <div><span className="text-sucesso" aria-hidden="true">↑ </span>{dados.aberturasGanhas} abertura{dados.aberturasGanhas === 1 ? '' : 's'} ganha{dados.aberturasGanhas === 1 ? '' : 's'}</div>
              <div><span className="text-perigo" aria-hidden="true">↓ </span>{dados.aberturasPerdidas} perdida{dados.aberturasPerdidas === 1 ? '' : 's'}</div>
            </div>
          </div>
          <BarraLado lado="CT" dados={dados.porLado.CT} />
          <BarraLado lado="T" dados={dados.porLado.T} />
        </Card>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
          <Tile
            rotulo="Mortes trocadas"
            valor={fmtPct(dados.mortesTrocadasPct)}
            sub={`${dados.mortesTrocadas} de ${dados.mortes} mortes`}
            metrica={METRICAS.trocadas}
          />
          <Tile rotulo="Mortes sem troca" valor={dados.mortesSemTroca} sub="ninguém vingou" metrica={METRICAS.semTroca} />
          <Tile rotulo="Trocas feitas" valor={dados.trocasFeitas} sub="vingou um colega em até 5 s" metrica={METRICAS.trocas} />
          <Tile rotulo="Duelos de abertura" valor={dados.aberturas} sub={`em ${dados.partidas} partidas`} metrica={METRICAS.aberturas} />
        </div>
      </div>
    </section>
  )
}
