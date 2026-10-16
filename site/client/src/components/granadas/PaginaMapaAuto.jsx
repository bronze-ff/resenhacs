import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { MAPAS_POOL } from './ExplorarMapas.jsx'
import RadarAuto from './RadarAuto.jsx'
import DetalheLineupAuto from './DetalheLineupAuto.jsx'
import ListaFiltro from './ListaFiltro.jsx'
import { MarcadorTipo } from './RadarGranadas.jsx'
import { filtrarClusters, nomeLineup } from './lineupAuto.js'
import { Abas, Button, CabecalhoPagina, EstadoErro, EstadoVazio, MapIcon, Select, Skeleton } from '../ui'

const TIPOS = [['todos', 'Todas'], ['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const LISTA_INICIAL = 30

// Biblioteca automática: os lineups saem das Demos (Coletor → tabela lineups),
// agrupados por spot no servidor. Nada de cadastro nem vídeo.
export default function PaginaMapaAuto({ mapa, onTrocarMapa, seletorModo = null }) {
  const [clusters, setClusters] = useState(null)
  const [erro, setErro] = useState(false)
  const [tipo, setTipo] = useState('todos')
  const [lado, setLado] = useState('todos')
  const [origem, setOrigem] = useState('todos')
  const [selecionado, setSelecionado] = useState(null)
  const [callouts, setCallouts] = useState([])
  const [verTodos, setVerTodos] = useState(false)

  function carregar() {
    setClusters(null)
    setErro(false)
    fetch(`/api/granadas/automaticas?map=${encodeURIComponent(mapa)}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then(setClusters)
      .catch(() => { setErro(true); setClusters([]) })
  }

  useEffect(() => {
    carregar()
    setSelecionado(null)
    setVerTodos(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapa])

  useEffect(() => {
    setCallouts([])
    import(`../../data/callouts/${mapa}.json`)
      .then((m) => setCallouts(m.default ?? []))
      .catch(() => setCallouts([]))
  }, [mapa])

  const semTipo = useMemo(() => filtrarClusters(clusters, { lado, origem }), [clusters, lado, origem])
  const porTipo = useMemo(() => {
    const c = { todos: semTipo.length, smoke: 0, flash: 0, molotov: 0, he: 0 }
    for (const x of semTipo) c[x.tipo] += 1
    return c
  }, [semTipo])
  const visiveis = useMemo(() => filtrarClusters(semTipo, { tipo }), [semTipo, tipo])
  const nome = (c) => nomeLineup(c, callouts)
  const lista = verTodos ? visiveis : visiveis.slice(0, LISTA_INICIAL)

  return (
    <div>
      <CabecalhoPagina
        eyebrow="Granadas"
        titulo={
          <span className="flex items-center gap-3">
            <MapIcon map={mapa} size={36} />
            {nomeMapa(mapa)}
          </span>
        }
        descricao="Lineups tirados das Demos do grupo e de pros, agrupados por spot. Clique num para ver a mira e copiar o comando de treino."
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full lg:w-56 lg:shrink-0">
          <div className="flex flex-wrap items-end gap-3 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-5">
            {seletorModo}
            <div className="flex w-40 flex-col gap-1.5 lg:w-auto">
              <p className="rotulo">Trocar mapa</p>
              <Select value={mapa} onChange={(e) => onTrocarMapa(e.target.value)} className="w-full" selectClassName="min-h-10">
                {MAPAS_POOL.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="rotulo">Lado</p>
              <Abas rotulo="Lado" larguraTotal valor={lado} onChange={setLado}
                itens={[{ valor: 'todos', rotulo: 'Todos' }, { valor: 'T', rotulo: 'T' }, { valor: 'CT', rotulo: 'CT' }]} />
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="rotulo">Quem usou</p>
              <Abas rotulo="Quem usou" larguraTotal valor={origem} onChange={setOrigem}
                itens={[{ valor: 'todos', rotulo: 'Todos' }, { valor: 'grupo', rotulo: 'Grupo' }, { valor: 'pro', rotulo: 'Pros' }]} />
            </div>
            <div className="flex w-full flex-col gap-1.5">
              <p className="rotulo">Tipos de granada</p>
              <ListaFiltro
                rotulo="Tipos de granada"
                valor={tipo}
                onChange={setTipo}
                itens={TIPOS.map(([v, l]) => ({
                  valor: v, rotulo: l,
                  contagem: clusters ? porTipo[v] : null,
                  desabilitado: v !== 'todos' && clusters != null && porTipo[v] === 0,
                }))}
              />
            </div>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          {!clusters && (
            <div role="status" aria-label="Carregando lineups" className="mx-auto w-full max-w-[calc(100vh-9rem)]">
              <Skeleton className="panel-cut aspect-square w-full" />
            </div>
          )}
          {erro && (
            <EstadoErro mensagem="Não deu pra carregar os lineups." acao={<Button variante="secundario" onClick={carregar}>Tentar de novo</Button>} />
          )}
          {clusters && !erro && clusters.length === 0 && (
            <EstadoVazio
              titulo="Nenhum lineup nesse mapa ainda."
              descricao="Eles aparecem sozinhos quando o Coletor processa Demos do grupo ou de pros nesse mapa."
            />
          )}
          {clusters && !erro && clusters.length > 0 && (
            <div className="flex flex-col gap-5 xl:flex-row">
              <div className="min-w-0 flex-1">
                <RadarAuto
                  mapa={mapa}
                  clusters={visiveis}
                  selecionadoId={selecionado?.id}
                  onSelecionar={setSelecionado}
                  rotuloDe={nome}
                />
              </div>
              <section aria-label="Lineups mais usados" className="w-full xl:w-72 xl:shrink-0">
                <p className="rotulo mb-2">Mais usados <span className="tabular-nums">({visiveis.length})</span></p>
                {visiveis.length === 0 ? (
                  <p className="text-sm text-texto-fraco">Nada com esses filtros.</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {lista.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelecionado(c)}
                          aria-pressed={selecionado?.id === c.id}
                          className={`flex w-full items-center gap-2.5 border px-2.5 py-2 text-left transition-colors duration-150 ${
                            selecionado?.id === c.id ? 'border-destaque/60 bg-destaque/5' : 'border-borda bg-superficie hover:border-borda-forte'
                          }`}
                        >
                          <svg viewBox="0 0 6 6" className="h-4 w-4 shrink-0" aria-hidden="true">
                            <MarcadorTipo tipo={c.tipo} x={3} y={3} />
                          </svg>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-texto">{nome(c)}</span>
                            <span className="block truncate text-xs text-texto-fraco">
                              {[c.lado, c.jogadores[0] ? `mais usa: ${c.jogadores[0].nick}` : c.pros[0] ? `pro: ${c.pros[0].nick}` : null].filter(Boolean).join(' · ')}
                            </span>
                          </span>
                          <span className="font-mono text-xs tabular-nums text-texto-fraco">{c.total}×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {!verTodos && visiveis.length > LISTA_INICIAL && (
                  <Button variante="fantasma" tamanho="sm" className="mt-2" onClick={() => setVerTodos(true)}>
                    Ver todos ({visiveis.length})
                  </Button>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {selecionado && (
        <DetalheLineupAuto cluster={selecionado} mapa={mapa} titulo={nome(selecionado)} onFechar={() => setSelecionado(null)} />
      )}
    </div>
  )
}
