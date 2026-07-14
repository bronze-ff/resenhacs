import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, SectionHeader, StatTile } from '../components/ui'

const LINHAS = [
  { rotulo: 'Rating', chave: 'rating', formato: (v) => v?.toFixed(2) ?? '–' },
  { rotulo: 'Winrate', chave: 'winrate', formato: (v) => `${v}%` },
  { rotulo: 'K/D', chave: 'kd', formato: (v) => v },
  { rotulo: 'Partidas', chave: 'partidas', formato: (v) => v },
]

export default function CompararTimes() {
  const [params, setParams] = useSearchParams()
  const [meusTimes, setMeusTimes] = useState([])
  const [timesPublicos, setTimesPublicos] = useState([])
  const [a, setA] = useState(params.get('a') ?? '')
  const [b, setB] = useState(params.get('b') ?? '')
  const [dados, setDados] = useState(null)
  const [erro, setErro] = useState(null)

  useEffect(() => {
    fetch('/api/teams').then((res) => (res.ok ? res.json() : [])).then(setMeusTimes)
    fetch('/api/ranking-publico/times').then((res) => (res.ok ? res.json() : [])).then(setTimesPublicos)
  }, [])

  useEffect(() => {
    setDados(null)
    setErro(null)
    if (!a || !b) return
    if (a === b) { setErro('Escolha dois times diferentes.'); return }
    setParams({ a, b })
    fetch(`/api/teams/compare?a=${a}&b=${b}`)
      .then((res) => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(setDados)
      .catch(() => setErro('Não foi possível comparar esses times (um deles pode não ser público).'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b])

  // Time B pode ser qualquer time público (de qualquer grupo) — não só os meus.
  const opcoesB = [...meusTimes.map((t) => ({ id: t.id, nome: t.nome })), ...timesPublicos.filter((t) => !meusTimes.some((m) => m.id === t.id))]

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Comparar times" />
      <div className="flex flex-wrap items-center gap-3">
        <select value={a} onChange={(e) => setA(e.target.value)} className="cursor-pointer rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Meu time…</option>
          {meusTimes.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        <span className="font-display text-texto-fraco">vs</span>
        <select value={b} onChange={(e) => setB(e.target.value)} className="cursor-pointer rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm">
          <option value="">Time adversário (público)…</option>
          {opcoesB.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </div>

      {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}

      {dados && (
        <>
          <Card className="p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-center">
                <p className="font-display text-lg font-bold uppercase text-texto">{dados.a.nome}</p>
                <p className="font-mono text-xs text-texto-fraco">{dados.a.grupoNome}</p>
              </div>
              <span className="font-display text-xs uppercase tracking-widest text-texto-fraco">vs</span>
              <div className="text-center">
                <p className="font-display text-lg font-bold uppercase text-texto">{dados.b.nome}</p>
                <p className="font-mono text-xs text-texto-fraco">{dados.b.grupoNome}</p>
              </div>
            </div>
            <div className="mt-4 divide-y divide-borda border-t border-borda">
              {LINHAS.map((linha) => (
                <div key={linha.chave} className="grid grid-cols-3 items-center gap-2 py-2.5">
                  <span className="text-right font-mono text-sm font-bold tabular-nums text-texto">{linha.formato(dados.a.stats[linha.chave])}</span>
                  <span className="text-center text-[10px] font-display uppercase tracking-wider text-texto-fraco">{linha.rotulo}</span>
                  <span className="text-left font-mono text-sm font-bold tabular-nums text-texto">{linha.formato(dados.b.stats[linha.chave])}</span>
                </div>
              ))}
            </div>
          </Card>

          <section>
            <SectionHeader titulo="Confronto direto" />
            {dados.confronto.partidasJuntos === 0 ? (
              <p className="font-mono text-sm text-texto-fraco">Esses times nunca se enfrentaram ainda.</p>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <StatTile rotulo="Partidas" valor={dados.confronto.partidasJuntos} />
                <StatTile rotulo={`${dados.a.nome} venceu`} valor={dados.confronto.aVenceu} />
                <StatTile rotulo={`${dados.b.nome} venceu`} valor={dados.confronto.bVenceu} />
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
