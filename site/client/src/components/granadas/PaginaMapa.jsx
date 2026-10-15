import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import { MAPAS_POOL } from './ExplorarMapas.jsx'
import RadarGranadas from './RadarGranadas.jsx'
import DetalheGranada from './DetalheGranada.jsx'
import FormGranada from './FormGranada.jsx'
import ListaFiltro from './ListaFiltro.jsx'
import { Abas, Button, CabecalhoPagina, MapIcon, Select, Skeleton } from '../ui'

const TIPOS = [['smoke', 'Smoke'], ['flash', 'Flash'], ['molotov', 'Molotov'], ['he', 'HE']]
const NIVEIS_CALLOUT = [['sem', 'Sem'], ['noob', 'Noob'], ['pro', 'Pro']]

export default function PaginaMapa({ mapa, onTrocarMapa }) {
  const { jogador } = useAuth()
  const isAdmin = !!jogador?.isSuperAdmin
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
    <div>
      <CabecalhoPagina
        eyebrow="Granadas"
        titulo={
          <span className="flex items-center gap-3">
            <MapIcon map={mapa} size={36} />
            {nomeMapa(mapa)}
          </span>
        }
        descricao="Passe o mouse num marcador pra ver o lineup; clique pra abrir vídeo e passos."
        acoes={isAdmin && (
          <Button variante="primario" onClick={() => setModoMarcacao({})} icone={<IconeMais />}>
            Adicionar granada
          </Button>
        )}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full lg:w-56 lg:shrink-0">
          {/* Mobile: grupos de filtro em linha (ribbon) pra não empurrar o radar
              pra baixo da dobra. Desktop: volta a ser a coluna vertical de sempre. */}
          <div className="flex flex-wrap items-end gap-3 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-5">
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
              <p className="rotulo">Chamadas</p>
              <Abas
                rotulo="Chamadas no radar"
                larguraTotal
                valor={nivelCallouts}
                onChange={setNivelCallouts}
                itens={NIVEIS_CALLOUT.map(([v, l]) => ({ valor: v, rotulo: l }))}
              />
            </div>

            <div className="flex w-full flex-col gap-1.5">
              <p className="rotulo">Tipos de granada</p>
              <ListaFiltro
                rotulo="Tipos de granada"
                valor={tipo}
                onChange={setTipo}
                itens={TIPOS.map(([v, l]) => ({ valor: v, rotulo: l, contagem: lineups ? porTipo[v] : null, desabilitado: porTipo[v] === 0 }))}
              />
            </div>
          </div>

          {modoMarcacao && (
            <div role="status" className="panel-cut-sm mt-4 flex items-center justify-between gap-2 border border-destaque/40 bg-destaque/5 px-3 py-2">
              <p className="font-mono text-xs text-destaque">
                {!modoMarcacao.arremesso ? '1º clique: de onde LANÇA' : !modoMarcacao.alvo ? '2º clique: onde CAI' : ''}
              </p>
              <Button variante="fantasma" tamanho="sm" onClick={() => setModoMarcacao(null)}>cancelar</Button>
            </div>
          )}
        </aside>

        <div className="min-w-0 flex-1">
          {!lineups && (
            <div role="status" aria-label="Carregando granadas" className="mx-auto w-full max-w-[calc(100vh-9rem)]">
              <Skeleton className="panel-cut aspect-square w-full" />
            </div>
          )}
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
            <p className="mx-auto mt-3 max-w-[calc(100vh-9rem)] text-center text-sm text-texto-fraco">
              Nenhuma granada cadastrada pra esse lado ainda.
            </p>
          )}
        </div>
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
            <>
              <Button
                variante="perigo"
                tamanho="sm"
                className="mr-auto"
                onClick={async () => {
                  if (!window.confirm(`Excluir "${selecionada.titulo}"?`)) return
                  const res = await fetch(`/api/granadas/${selecionada.id}`, { method: 'DELETE' }).catch(() => null)
                  if (res?.ok) { setSelecionada(null); recarregar() }
                }}
              >Excluir</Button>
              <Button
                variante="secundario"
                tamanho="sm"
                onClick={() => {
                  setFormAberto({
                    posicoes: { arremesso: { x: selecionada.arremessoX, y: selecionada.arremessoY }, alvo: { x: selecionada.alvoX, y: selecionada.alvoY } },
                    inicial: selecionada,
                  })
                  setSelecionada(null)
                }}
              >Editar</Button>
            </>
          )}
        />
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
