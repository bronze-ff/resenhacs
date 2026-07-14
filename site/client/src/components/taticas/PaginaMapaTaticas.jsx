import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { MAPAS_POOL } from '../granadas/ExplorarMapas.jsx'
import CardTatica, { ROTULO_ARMAS, ROTULO_TIPO_TATICA } from './CardTatica.jsx'
import CardTaticaReplay from './CardTaticaReplay.jsx'

const TIPOS = [['todas', 'Todas'], ...Object.entries(ROTULO_TIPO_TATICA)]
const LOCAIS = [['todas', 'Todas'], ['A', 'A'], ['B', 'B'], ['MID', 'MID']]
const ARMAS = [['todas', 'Todas'], ...Object.entries(ROTULO_ARMAS)]

export default function PaginaMapaTaticas({ mapa, onTrocarMapa }) {
  const [lado, setLado] = useState('T')
  const [tipo, setTipo] = useState('todas')
  const [local, setLocal] = useState('todas')
  const [armas, setArmas] = useState('todas')
  const [taticas, setTaticas] = useState(null)
  const [antigas, setAntigas] = useState(null)
  // T3 (DetalheTatica) vai ler/ligar esse estado num modal. Por ora o clique no
  // card só guarda a tática selecionada — nenhum modal é renderizado ainda.
  const [selecionada, setSelecionada] = useState(null)

  useEffect(() => {
    setTaticas(null)
    fetch(`/api/taticas-curadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setTaticas)
      .catch(() => setTaticas([]))
  }, [mapa, lado])

  useEffect(() => {
    setAntigas(null)
    fetch(`/api/taticas?map=${mapa}`)
      .then((r) => r.json())
      .then(setAntigas)
      .catch(() => setAntigas([]))
  }, [mapa])

  useEffect(() => {
    setTipo('todas')
    setLocal('todas')
    setArmas('todas')
    setSelecionada(null)
  }, [mapa, lado])

  const visiveis = useMemo(() => (taticas ?? []).filter((t) =>
    (tipo === 'todas' || t.tipo === tipo)
    && (local === 'todas' || t.local === local)
    && (armas === 'todas' || t.armas === armas),
  ), [taticas, tipo, local, armas])

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full space-y-3 lg:w-56 lg:space-y-4">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(mapa)}</h2>

        {/* Mesmo padrão mobile de Granadas/PaginaMapa: ribbon flex-wrap no topo,
            coluna vertical no desktop (lg:). */}
        <div className="flex flex-wrap items-end gap-2 lg:block lg:items-stretch lg:gap-0 lg:space-y-4">
          <div className="w-36 lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar mapa</p>
            <select
              value={mapa}
              onChange={(e) => onTrocarMapa(e.target.value)}
              className="min-h-10 w-full rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm lg:min-h-0"
            >
              {MAPAS_POOL.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
            </select>
          </div>

          <div className="w-24 lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar lado</p>
            <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
              {['T', 'CT'].map((v) => (
                <button
                  key={v}
                  onClick={() => setLado(v)}
                  className={`min-h-10 flex-1 px-3 py-1.5 transition-colors lg:min-h-0 ${lado === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          <div className="w-36 lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipo</p>
            <div className="flex flex-wrap gap-1 lg:block lg:space-y-1">
              {TIPOS.map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setTipo(v)}
                  className={`min-h-10 rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors lg:min-h-0 lg:block lg:w-full ${
                    tipo === v ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco hover:text-texto'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-28 lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Local</p>
            <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
              {LOCAIS.map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setLocal(v)}
                  className={`min-h-10 flex-1 px-2 py-1.5 transition-colors lg:min-h-0 ${local === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="w-32 lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Armas</p>
            <div className="flex flex-wrap gap-1 lg:block lg:space-y-1">
              {ARMAS.map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setArmas(v)}
                  className={`min-h-10 rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors lg:min-h-0 lg:block lg:w-full ${
                    armas === v ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco hover:text-texto'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 space-y-6">
        <div>
          {!taticas && <p className="font-mono text-sm text-texto-fraco">Carregando…</p>}
          {taticas && visiveis.length === 0 && (
            <p className="font-mono text-sm text-texto-fraco">Nenhuma tática curada pra esses filtros ainda.</p>
          )}
          {visiveis.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visiveis.map((t) => (
                <CardTatica key={t.id} tatica={t} onSelecionar={setSelecionada} />
              ))}
            </div>
          )}
          {taticas && (
            <p className="mt-3 font-mono text-xs uppercase text-texto-fraco">
              {visiveis.length} {visiveis.length === 1 ? 'Tática' : 'Táticas'}
            </p>
          )}
        </div>

        <div className="border-t border-borda pt-4">
          <h3 className="font-display text-lg font-bold uppercase tracking-wide text-texto">Do grupo (replays)</h3>
          <p className="font-mono text-xs text-texto-fraco">Táticas sugeridas em partidas reais e aprovadas no Admin.</p>
          {!antigas && <p className="mt-2 font-mono text-sm text-texto-fraco">Carregando…</p>}
          {antigas && antigas.length === 0 && (
            <p className="mt-2 font-mono text-sm text-texto-fraco">Nenhuma tática aprovada nesse mapa ainda.</p>
          )}
          {antigas && antigas.length > 0 && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {antigas.map((t) => <CardTaticaReplay key={t.id} t={t} />)}
            </div>
          )}
        </div>
      </div>

      {/* T3 (DetalheTatica) vai renderizar aqui o modal quando `selecionada` estiver
          preenchida (Overview + abas por jogador). Por enquanto nada é exibido. */}
      {selecionada && null}
    </div>
  )
}
