import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import { MAPAS_POOL } from './ExplorarMapas.jsx'
import RadarGranadas from './RadarGranadas.jsx'
import DetalheGranada from './DetalheGranada.jsx'
import FormGranada from './FormGranada.jsx'

const TIPOS = [['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const NIVEIS_CALLOUT = [['sem', 'Sem'], ['noob', 'Noob'], ['pro', 'Pro']]

export default function PaginaMapa({ mapa, onTrocarMapa }) {
  const { jogador } = useAuth()
  const isAdmin = !!jogador?.isAdmin
  const [lado, setLado] = useState('T')
  const [tipo, setTipo] = useState('smoke')
  const [lineups, setLineups] = useState(null)
  const [selecionada, setSelecionada] = useState(null)
  const [nivelCallouts, setNivelCallouts] = useState('sem')
  const [callouts, setCallouts] = useState([])
  const [modoMarcacao, setModoMarcacao] = useState(null) // null | {arremesso?, alvo?}
  const [formAberto, setFormAberto] = useState(null)     // null | {posicoes, inicial?}

  function recarregar() {
    setLineups(null)
    fetch(`/api/granadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }

  useEffect(() => {
    recarregar()
  }, [mapa, lado])

  useEffect(() => { setSelecionada(null) }, [mapa, lado])

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

  function aoCliqueMarcacao(p) {
    if (!modoMarcacao.arremesso) return setModoMarcacao({ arremesso: p })
    const marcado = { ...modoMarcacao, alvo: p }
    setModoMarcacao(marcado)
    setFormAberto({ posicoes: marcado })
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <aside className="w-full space-y-3 lg:w-56 lg:space-y-4">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(mapa)}</h2>

        {/* Mobile: grupos de filtro em linha (ribbon) pra não empurrar o radar
            pra baixo da dobra. Desktop: volta a ser a coluna vertical de sempre. */}
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

          <div className="w-full lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipos de granada</p>
            <div className="flex flex-wrap gap-1 lg:block lg:space-y-1">
              {TIPOS.map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setTipo(v)}
                  disabled={porTipo[v] === 0}
                  className={`flex min-h-10 items-center justify-between gap-1.5 rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors lg:min-h-0 lg:w-full lg:gap-0 ${
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

          <div className="w-28 lg:w-auto">
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Chamadas</p>
            <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
              {NIVEIS_CALLOUT.map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setNivelCallouts(v)}
                  className={`min-h-10 flex-1 px-2 py-1.5 transition-colors lg:min-h-0 ${nivelCallouts === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {isAdmin && (
            <button
              onClick={() => setModoMarcacao({})}
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-3 py-2 font-display text-sm font-semibold uppercase text-fundo lg:min-h-0"
            >
              Adicionar granada
            </button>
          )}
        </div>
        {modoMarcacao && (
          <p className="font-mono text-xs text-destaque">
            {!modoMarcacao.arremesso ? '1º clique: de onde LANÇA' : !modoMarcacao.alvo ? '2º clique: onde CAI' : ''}
            <button onClick={() => setModoMarcacao(null)} className="ml-2 underline">cancelar</button>
          </p>
        )}
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
            modoMarcacao={modoMarcacao}
            onCliqueMarcacao={aoCliqueMarcacao}
          />
        )}
        {lineups?.length === 0 && (
          <p className="mt-2 font-mono text-sm text-texto-fraco">Nenhuma granada cadastrada pra esse lado ainda.</p>
        )}
      </div>

      {formAberto && (
        <FormGranada
          mapa={mapa} lado={formAberto.inicial?.lado ?? lado}
          posicoes={formAberto.posicoes}
          inicial={formAberto.inicial}
          onSalvo={() => { setFormAberto(null); setModoMarcacao(null); recarregar() }}
          onCancelar={() => { setFormAberto(null); setModoMarcacao(null) }}
        />
      )}

      {selecionada && (
        <DetalheGranada
          granada={selecionada}
          onFechar={() => setSelecionada(null)}
          acoesAdmin={isAdmin && (
            <div className="mt-4 flex justify-end gap-2 border-t border-borda pt-3">
              <button
                onClick={() => {
                  setFormAberto({
                    posicoes: { arremesso: { x: selecionada.arremessoX, y: selecionada.arremessoY }, alvo: { x: selecionada.alvoX, y: selecionada.alvoY } },
                    inicial: selecionada,
                  })
                  setSelecionada(null)
                }}
                className="min-h-10 px-3 py-1.5 font-mono text-xs uppercase text-texto-fraco hover:text-texto lg:min-h-0"
              >Editar</button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Excluir "${selecionada.titulo}"?`)) return
                  const res = await fetch(`/api/granadas/${selecionada.id}`, { method: 'DELETE' }).catch(() => null)
                  if (res?.ok) { setSelecionada(null); recarregar() }
                }}
                className="min-h-10 px-3 py-1.5 font-mono text-xs uppercase text-perigo hover:brightness-125 lg:min-h-0"
              >Excluir</button>
            </div>
          )}
        />
      )}
    </div>
  )
}
