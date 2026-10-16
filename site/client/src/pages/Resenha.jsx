import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { nomeMapa } from '../lib/format.js'
import { Abas, Avatar, Button, Card, EstadoErro, EstadoVazio, MapIcon, SectionHeader, Skeleton, SkeletonLista } from '../components/ui'

// "Resenha da semana / do mês": prêmios de zoeira do grupo no período (referência:
// Leetify Recap). Dados de GET /api/premios — só Partidas visíveis ao viewer, só o
// círculo dele (ele + amigos). Período fica na URL (?periodo=mes&ref=2026-09-01) pra
// dar pra mandar o link no grupo.

const ABAS = [
  { valor: 'semana', rotulo: 'Semana' },
  { valor: 'mes', rotulo: 'Mês' },
]

function paraData(iso) {
  const [a, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d))
}

const fmtMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtMesCurto = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
const fmtDia = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' })

export function rotuloPeriodo(periodo) {
  if (!periodo) return ''
  if (periodo.tipo === 'mes') return fmtMes.format(paraData(periodo.inicio))
  const ultimoDia = new Date(paraData(periodo.fim).getTime() - 24 * 60 * 60 * 1000)
  return `semana de ${fmtDia.format(paraData(periodo.inicio))} a ${fmtDia.format(ultimoDia)}`
}

function maiuscula(s) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Manchete do topo: "Setembro foi do Toguro. E a Nuke continua maldita."
export function manchete(periodo, premios) {
  const carregou = premios.find((p) => p.id === 'carregou')?.jogadores[0]
  const mapa = premios.find((p) => p.id === 'mapa-maldito')?.mapa
  const quando = periodo?.tipo === 'mes' ? maiuscula(fmtMesCurto.format(paraData(periodo.inicio))) : 'A semana'
  const partes = []
  if (carregou) partes.push(`${quando} foi do ${carregou.nick}.`)
  if (mapa) partes.push(`${partes.length ? 'E a' : 'A'} ${nomeMapa(mapa)} ${partes.length ? 'continua' : 'foi'} maldita.`)
  return partes.join(' ') || `${quando} ainda sem resenha.`
}

export function formatarValor(valor, formato) {
  if (valor == null) return '–'
  switch (formato) {
    case 'decimal2': return Number(valor).toFixed(2)
    case 'decimal1': return Number(valor).toFixed(1)
    case 'pct100': return `${Math.round(valor)}%`
    default: return String(Math.round(valor))
  }
}

function CardPremio({ p }) {
  const bom = p.tom === 'bom'
  const quem = p.mapa ? nomeMapa(p.mapa) : p.jogadores.map((j) => j.nick).join(' e ')
  return (
    <Card as="article" className="flex flex-col gap-3.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-texto">{p.titulo}</span>
        <span className={`text-xs ${bom ? 'text-sucesso' : 'text-perigo'}`}>
          <span aria-hidden="true">{bom ? '▲ ' : '▼ '}</span>{bom ? 'mérito' : 'vergonha'}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {p.mapa ? (
          <MapIcon map={p.mapa} size={44} />
        ) : (
          <div className="flex shrink-0 -space-x-2">
            {p.jogadores.map((j) => <Avatar key={j.steamId} p={j} size={44} />)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {p.jogadores.length === 1 ? (
            <Link to={`/jogador/${p.jogadores[0].steamId}`} className="block truncate text-base font-semibold text-texto hover:text-destaque-forte">{quem}</Link>
          ) : (
            <div className="truncate text-base font-semibold text-texto">{quem}</div>
          )}
          <div className="text-xs text-texto-fraco">{p.descricao}</div>
        </div>
        <span className="font-mono text-[22px] tabular-nums text-texto">{formatarValor(p.valor, p.formato)}</span>
      </div>
    </Card>
  )
}

export default function Resenha() {
  const [params, setParams] = useSearchParams()
  const tipo = params.get('periodo') === 'mes' ? 'mes' : 'semana'
  const ref = params.get('ref')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)
  const [tentativa, setTentativa] = useState(0)

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(false)
    const qs = new URLSearchParams({ periodo: tipo })
    if (ref) qs.set('ref', ref)
    fetch(`/api/premios?${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json()
      })
      .then((d) => vivo && setDados(d))
      .catch(() => vivo && setErro(true))
    return () => { vivo = false }
  }, [tipo, ref, tentativa])

  function ir(novoTipo, novaRef) {
    const p = new URLSearchParams({ periodo: novoTipo })
    if (novaRef) p.set('ref', novaRef)
    setParams(p)
  }

  const periodo = dados?.periodo
  const premios = dados?.premios ?? []
  const n = dados?.numeros
  const numeros = n
    ? [
        { valor: n.partidas, nome: 'Partidas do grupo' },
        { valor: `${String(n.horas).replace('.', ',')}h`, nome: 'De jogo juntos' },
        { valor: n.winrate == null ? '–' : `${Math.round(n.winrate)}%`, nome: 'Winrate do grupo' },
        { valor: n.clutches, nome: 'Clutches vencidos' },
      ]
    : []

  return (
    <div className="mx-auto flex max-w-[1120px] flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Abas itens={ABAS} valor={tipo} onChange={(v) => ir(v, null)} rotulo="Período da resenha" />
        <div className="flex gap-2">
          <Button tamanho="sm" variante="secundario" disabled={!periodo} onClick={() => ir(tipo, periodo.anterior)}>
            <span aria-hidden="true">←</span> {tipo === 'mes' ? 'Mês anterior' : 'Semana anterior'}
          </Button>
          <Button tamanho="sm" variante="secundario" disabled={!periodo?.proximo} onClick={() => ir(tipo, periodo.proximo)}>
            {tipo === 'mes' ? 'Próximo mês' : 'Próxima semana'} <span aria-hidden="true">→</span>
          </Button>
        </div>
      </div>

      {erro && (
        <EstadoErro
          mensagem="Não deu pra carregar a resenha."
          acao={<Button tamanho="sm" onClick={() => setTentativa((t) => t + 1)}>Tentar de novo</Button>}
        />
      )}

      {!erro && !dados && (
        <>
          <Skeleton className="panel-cut h-64 w-full" />
          <SkeletonLista linhas={3} altura="h-24" rotulo="Carregando prêmios" />
        </>
      )}

      {dados && (
        <>
          <Card as="section" className="relative overflow-hidden px-5 py-7 sm:px-9 sm:py-9">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="text-destaque-forte">{tipo === 'mes' ? 'Resenha do mês' : 'Resenha da semana'}</span>
              <span className="text-texto-fraco">· {rotuloPeriodo(periodo)}</span>
            </div>
            <h2 className="mt-2.5 max-w-[680px] font-display text-[34px] font-semibold leading-none tracking-[-0.035em] text-texto sm:text-[56px]">
              {manchete(periodo, premios)}
            </h2>
            <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {numeros.map((x) => (
                <div key={x.nome} className="border-t border-borda-forte pt-3">
                  <div className="font-mono text-[28px] font-medium tabular-nums text-texto sm:text-4xl">{x.valor}</div>
                  <div className="mt-0.5 text-xs font-medium text-texto-fraco">{x.nome}</div>
                </div>
              ))}
            </div>
          </Card>

          <section>
            <SectionHeader
              titulo={tipo === 'mes' ? 'Prêmios do mês' : 'Prêmios da semana'}
              acao={<span className="text-xs text-texto-fraco">calculados das partidas do período</span>}
            />
            {premios.length === 0 ? (
              <EstadoVazio
                titulo="Ninguém jogou o suficiente"
                descricao="Os prêmios aparecem quando o grupo tem partidas no período."
                acao={periodo && (
                  <Button tamanho="sm" onClick={() => ir(tipo, periodo.anterior)}>
                    Ver {tipo === 'mes' ? 'mês anterior' : 'semana anterior'}
                  </Button>
                )}
              />
            ) : (
              <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                {premios.map((p) => <CardPremio key={p.id} p={p} />)}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
