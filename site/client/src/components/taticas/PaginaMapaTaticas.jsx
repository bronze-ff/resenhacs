import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import { MAPAS_POOL } from '../granadas/ExplorarMapas.jsx'
import CardTatica, { ROTULO_ARMAS, ROTULO_TIPO_TATICA } from './CardTatica.jsx'
import CardTaticaReplay from './CardTaticaReplay.jsx'
import DetalheTatica from './DetalheTatica.jsx'
import FormTatica from './FormTatica.jsx'
import ListaFiltro from '../granadas/ListaFiltro.jsx'
import { Abas, Button, CabecalhoPagina, EstadoErro, EstadoVazio, MapIcon, SectionHeader, Select, Skeleton, SkeletonLista } from '../ui'

const TIPOS = [['todas', 'Todas'], ...Object.entries(ROTULO_TIPO_TATICA)]
const LOCAIS = [['todas', 'Todas'], ['A', 'A'], ['B', 'B'], ['MID', 'MID']]
const ARMAS = [['todas', 'Todas'], ...Object.entries(ROTULO_ARMAS)]

export default function PaginaMapaTaticas({ mapa, onTrocarMapa }) {
  const { jogador } = useAuth()
  const isAdmin = !!jogador?.isSuperAdmin
  const [lado, setLado] = useState('T')
  const [tipo, setTipo] = useState('todas')
  const [local, setLocal] = useState('todas')
  const [armas, setArmas] = useState('todas')
  const [taticas, setTaticas] = useState(null)
  const [antigas, setAntigas] = useState(null)
  const [selecionada, setSelecionada] = useState(null)
  const [formAberto, setFormAberto] = useState(null) // null | {} (nova) | {inicial} (edição)
  const [erro, setErro] = useState(null)

  function recarregar() {
    setTaticas(null)
    fetch(`/api/taticas-curadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setTaticas)
      .catch(() => setTaticas([]))
  }

  useEffect(() => {
    recarregar()
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
    setFormAberto(null)
    setErro(null)
  }, [mapa, lado])

  const visiveis = useMemo(() => (taticas ?? []).filter((t) =>
    (tipo === 'todas' || t.tipo === tipo)
    && (local === 'todas' || t.local === local)
    && (armas === 'todas' || t.armas === armas),
  ), [taticas, tipo, local, armas])

  return (
    <div>
      <CabecalhoPagina
        eyebrow="Táticas"
        titulo={
          <span className="flex items-center gap-3">
            <MapIcon map={mapa} size={36} />
            {nomeMapa(mapa)}
          </span>
        }
        descricao="Playbook curado do grupo: execute, fake e setup com o papel de cada jogador."
        acoes={isAdmin && (
          <Button variante="primario" onClick={() => setFormAberto({})} icone={<IconeMais />}>
            Adicionar tática
          </Button>
        )}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full lg:w-56 lg:shrink-0">
          {/* Mesmo padrão mobile de Granadas/PaginaMapa: ribbon flex-wrap no topo,
              coluna vertical no desktop (lg:). */}
          <div className="flex flex-wrap items-start gap-3 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-5">
            <div className="flex w-40 flex-col gap-1.5 lg:w-auto">
              <p className="rotulo">Trocar mapa</p>
              <Select value={mapa} onChange={(e) => onTrocarMapa(e.target.value)} className="w-full" selectClassName="min-h-10">
                {MAPAS_POOL.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="rotulo">Lado</p>
              <Abas
                rotulo="Lado"
                larguraTotal
                valor={lado}
                onChange={setLado}
                itens={[{ valor: 'T', rotulo: 'T' }, { valor: 'CT', rotulo: 'CT' }]}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <p className="rotulo">Local</p>
              <Abas
                rotulo="Local"
                larguraTotal
                valor={local}
                onChange={setLocal}
                itens={LOCAIS.map(([v, l]) => ({ valor: v, rotulo: l }))}
              />
            </div>

            <div className="flex w-full flex-col gap-1.5">
              <p className="rotulo">Tipo</p>
              <ListaFiltro
                rotulo="Tipo de tática"
                valor={tipo}
                onChange={setTipo}
                itens={TIPOS.map(([v, l]) => ({ valor: v, rotulo: l }))}
              />
            </div>

            <div className="flex w-full flex-col gap-1.5">
              <p className="rotulo">Armas</p>
              <ListaFiltro
                rotulo="Armas"
                valor={armas}
                onChange={setArmas}
                itens={ARMAS.map(([v, l]) => ({ valor: v, rotulo: l }))}
              />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-8">
          <section className="flex flex-col gap-3">
            {taticas && (
              <p className="rotulo">
                <span className="tabular-nums text-texto">{visiveis.length}</span> {visiveis.length === 1 ? 'Tática' : 'Táticas'}
              </p>
            )}
            {!taticas && (
              <div role="status" aria-label="Carregando táticas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[0, 1, 2].map((i) => <Skeleton key={i} className="panel-cut aspect-[5/6] w-full" />)}
                <span className="sr-only">Carregando…</span>
              </div>
            )}
            {taticas && visiveis.length === 0 && (
              <EstadoVazio
                titulo="Nenhuma tática curada"
                descricao="Nenhuma tática curada pra esses filtros ainda."
                acao={isAdmin && (
                  <Button variante="contorno" tamanho="sm" onClick={() => setFormAberto({})}>Adicionar tática</Button>
                )}
              />
            )}
            {visiveis.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {visiveis.map((t) => (
                  <CardTatica key={t.id} tatica={t} onSelecionar={setSelecionada} />
                ))}
              </div>
            )}
          </section>

          <section className="border-t border-borda pt-6">
            <SectionHeader titulo="Do grupo (replays)" subtitulo="Táticas sugeridas em partidas reais e aprovadas no Admin." />
            {!antigas && <SkeletonLista linhas={2} altura="h-20" />}
            {antigas && antigas.length === 0 && (
              <p className="text-sm text-texto-fraco">Nenhuma tática aprovada nesse mapa ainda.</p>
            )}
            {antigas && antigas.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {antigas.map((t) => <CardTaticaReplay key={t.id} t={t} />)}
              </div>
            )}
          </section>
        </div>
      </div>

      {formAberto && (
        <FormTatica
          mapa={mapa}
          lado={lado}
          inicial={formAberto.inicial}
          onSalvo={() => { setFormAberto(null); recarregar() }}
          onCancelar={() => setFormAberto(null)}
        />
      )}

      {selecionada && (
        <DetalheTatica
          tatica={selecionada}
          onFechar={() => setSelecionada(null)}
          acoesAdmin={isAdmin && (
            <>
              <Button
                variante="perigo"
                tamanho="sm"
                className="mr-auto"
                onClick={async () => {
                  if (!window.confirm(`Excluir "${selecionada.titulo}"?`)) return
                  setErro(null)
                  const res = await fetch(`/api/taticas-curadas/${selecionada.id}`, { method: 'DELETE' }).catch(() => null)
                  if (res?.ok) { setSelecionada(null); recarregar() }
                  else setErro('Não foi possível excluir a tática. Tente de novo.')
                }}
              >Excluir</Button>
              <Button
                variante="secundario"
                tamanho="sm"
                onClick={() => {
                  setFormAberto({ inicial: selecionada })
                  setSelecionada(null)
                }}
              >Editar</Button>
            </>
          )}
        />
      )}

      {erro && (
        <div className="fixed bottom-4 right-4 z-[70] max-w-[calc(100vw-2rem)] bg-superficie shadow-flutuante">
          <EstadoErro mensagem={erro} />
        </div>
      )}
    </div>
  )
}

function IconeMais() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" className="h-4 w-4" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
