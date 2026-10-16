import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DataTable, EstadoErro, EstadoVazio, SectionHeader, SkeletonLista } from './ui'

// Aba "Duelos" da Partida: duelos de abertura e trocas por Jogador
// (GET /api/matches/:id/duelos; definições em site/server/src/trades.js).

function fmtPct(v) {
  return v == null ? '–' : `${Math.round(v)}%`
}

function TabelaTime({ time, jogadores }) {
  const cor = time === 'A' ? 'text-time-a' : 'text-time-b'
  return (
    <section>
      <SectionHeader titulo={<span className={cor}>Time {time}</span>} margem="pequena" />
      <DataTable
        head={
          <tr>
            <th scope="col" className="py-2 pr-3">Jogador</th>
            <th scope="col" className="px-2 py-2 text-right" title="Duelos de abertura ganhos e perdidos">Aberturas</th>
            <th scope="col" className="px-2 py-2 text-right">% abertura</th>
            <th scope="col" className="px-2 py-2 text-right">CT</th>
            <th scope="col" className="px-2 py-2 text-right">T</th>
            <th scope="col" className="px-2 py-2 text-right" title="Um colega matou quem matou esse jogador em até 5 s">Mortes trocadas</th>
            <th scope="col" className="px-2 py-2 text-right">Sem troca</th>
            <th scope="col" className="py-2 pl-2 text-right" title="Matou quem tinha acabado de matar um colega, em até 5 s">Trocas feitas</th>
          </tr>
        }
      >
        {jogadores.map((j) => (
          <tr key={j.steamId}>
            <td className="max-w-40 truncate py-2 pr-3">
              <Link to={`/jogador/${j.steamId}`} className="text-texto hover:text-destaque-forte">{j.nick || j.steamId}</Link>
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              <span className="text-sucesso"><span aria-hidden="true">↑</span>{j.aberturasGanhas}</span>
              <span className="text-texto-fraco"> / </span>
              <span className="text-perigo"><span aria-hidden="true">↓</span>{j.aberturasPerdidas}</span>
              <span className="sr-only"> ganhas / perdidas</span>
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{fmtPct(j.aberturasPct)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-texto-fraco">{fmtPct(j.porLado.CT.pct)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums text-texto-fraco">{fmtPct(j.porLado.T.pct)}</td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">
              {j.mortesTrocadas}/{j.mortes} <span className="text-texto-fraco">({fmtPct(j.mortesTrocadasPct)})</span>
            </td>
            <td className="px-2 py-2 text-right font-mono tabular-nums">{j.mortesSemTroca}</td>
            <td className="py-2 pl-2 text-right font-mono tabular-nums">{j.trocasFeitas}</td>
          </tr>
        ))}
      </DataTable>
    </section>
  )
}

export default function DuelosPartida({ matchId }) {
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let vivo = true
    setDados(null)
    setErro(false)
    fetch(`/api/matches/${matchId}/duelos`)
      .then((r) => {
        if (!r.ok) throw new Error()
        return r.json()
      })
      .then((j) => vivo && setDados(j))
      .catch(() => vivo && setErro(true))
    return () => {
      vivo = false
    }
  }, [matchId])

  if (erro) return <EstadoErro mensagem="Não deu pra carregar os duelos dessa partida." />
  if (!dados) return <SkeletonLista linhas={5} altura="h-10" rotulo="Carregando duelos" />
  const jogadores = dados.jogadores ?? []
  if (jogadores.every((j) => j.aberturas === 0 && j.mortes === 0)) {
    return <EstadoVazio titulo="Sem kills registradas" descricao="Essa partida não tem as kills por round gravadas." />
  }
  const ordenar = (a, b) => b.aberturasGanhas - a.aberturasGanhas || b.trocasFeitas - a.trocasFeitas
  return (
    <div className="space-y-6">
      <p className="text-sm text-texto-fraco">
        Duelo de abertura é a primeira kill do round. Morte trocada: um colega matou quem te matou em até 5 segundos.
        Team-kill não conta.
      </p>
      {['A', 'B'].map((t) => {
        const doTime = jogadores.filter((j) => j.team === t).sort(ordenar)
        return doTime.length ? <TabelaTime key={t} time={t} jogadores={doTime} /> : null
      })}
    </div>
  )
}
