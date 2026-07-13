import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { MAPAS_POOL } from './ExplorarMapas.jsx'
import RadarGranadas from './RadarGranadas.jsx'
import DetalheGranada from './DetalheGranada.jsx'

const TIPOS = [['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const NIVEIS_CALLOUT = [['sem', 'Sem'], ['noob', 'Noob'], ['pro', 'Pro']]

export default function PaginaMapa({ mapa, onTrocarMapa }) {
  const [lado, setLado] = useState('T')
  const [tipo, setTipo] = useState('smoke')
  const [lineups, setLineups] = useState(null)
  const [selecionada, setSelecionada] = useState(null)
  const [nivelCallouts, setNivelCallouts] = useState('sem')
  const [callouts, setCallouts] = useState([])

  useEffect(() => {
    setLineups(null)
    fetch(`/api/granadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }, [mapa, lado])

  useEffect(() => {
    setCallouts([])
    import(`../../data/callouts/${mapa}.json`)
      .then((m) => setCallouts(m.default ?? []))
      .catch(() => setCallouts([]))
  }, [mapa])

  const porTipo = useMemo(() => {
    const c = { smoke: 0, flash: 0, molotov: 0, he: 0 }
    for (const l of lineups ?? []) c[l.tipo] += 1
    return c
  }, [lineups])

  const visiveis = (lineups ?? []).filter((l) => l.tipo === tipo)

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full space-y-4 lg:w-56">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(mapa)}</h2>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar mapa</p>
          <select
            value={mapa}
            onChange={(e) => onTrocarMapa(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm"
          >
            {MAPAS_POOL.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
          </select>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar lado</p>
          <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {['T', 'CT'].map((v) => (
              <button
                key={v}
                onClick={() => setLado(v)}
                className={`flex-1 px-3 py-1.5 transition-colors ${lado === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipos de granada</p>
          <div className="space-y-1">
            {TIPOS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTipo(v)}
                disabled={porTipo[v] === 0}
                className={`flex w-full items-center justify-between rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
                  tipo === v ? 'border-destaque bg-destaque/10 text-destaque'
                    : porTipo[v] === 0 ? 'border-borda text-texto-fraco/40'
                    : 'border-borda text-texto-fraco hover:text-texto'
                }`}
              >
                <span>{label}</span>
                <span>{porTipo[v]}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Chamadas</p>
          <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {NIVEIS_CALLOUT.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setNivelCallouts(v)}
                className={`flex-1 px-2 py-1.5 transition-colors ${nivelCallouts === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {!lineups && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
        {lineups && (
          <RadarGranadas
            mapa={mapa}
            lineups={visiveis}
            selecionadaId={selecionada?.id}
            onSelecionar={setSelecionada}
            callouts={callouts}
            nivelCallouts={nivelCallouts}
          />
        )}
        {lineups?.length === 0 && (
          <p className="mt-2 font-mono text-sm text-texto-fraco">Nenhuma granada cadastrada pra esse lado ainda.</p>
        )}
      </div>

      {selecionada && <DetalheGranada granada={selecionada} onFechar={() => setSelecionada(null)} />}
    </div>
  )
}
