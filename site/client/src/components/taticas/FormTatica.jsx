import { useEffect, useMemo, useRef, useState } from 'react'
import RadarGranadas from '../granadas/RadarGranadas.jsx'
import { ROTULO_TIPO_TATICA, ROTULO_ARMAS } from './CardTatica.jsx'
import { Card, Select } from '../ui'

const TIPOS = Object.entries(ROTULO_TIPO_TATICA)
const LOCAIS = [['A', 'A'], ['B', 'B'], ['MID', 'MID']]
const ARMAS = Object.entries(ROTULO_ARMAS)
const ROTULO_TIPO_GRANADA = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

function novoPapel() {
  return { descricao: '', obrigatorio: true, granadaIds: [] }
}

// Papéis pré-preenchidos a partir de uma tática existente (edição): granadaIds
// vem de p.granadas (shape aninhado do GET), não existe ainda no payload de entrada.
function papeisIniciais(inicial) {
  if (!inicial?.papeis?.length) return [novoPapel()]
  return [...inicial.papeis]
    .sort((a, b) => a.ordem - b.ordem)
    .map((p) => ({
      descricao: p.descricao,
      obrigatorio: p.obrigatorio,
      granadaIds: (p.granadas ?? []).map((g) => g.id),
    }))
}

// Form modal de criar/editar tática curada — builder no radar (estilo
// tactician.it/tactics): a montagem acontece DIRETO no mapa, não numa lista de
// checkboxes. Layout de duas colunas no desktop (radar ~58% à esquerda, painel
// de edição à direita); empilha no mobile (radar em cima, painel embaixo).
//
// Fluxo: um papel fica "ativo" por vez (pills acima do radar ou clicando no
// card dele à direita); clicar num marcador do radar vincula/desvincula esse
// papel àquela granada. RadarGranadas mostra os 3 estados via `estadoPorId`
// (ativo = anel laranja forte, outro papel = anel cinza fino, sem vínculo =
// apagado) — ver RadarGranadas.jsx.
export default function FormTatica({ mapa, lado: ladoInicial, inicial = null, onSalvo, onCancelar }) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [lado, setLado] = useState(inicial?.lado ?? ladoInicial ?? 'T')
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'execute')
  const [local, setLocal] = useState(inicial?.local ?? 'A')
  const [armas, setArmas] = useState(inicial?.armas ?? 'full')
  const [papeis, setPapeis] = useState(() => papeisIniciais(inicial))
  const [papelAtivo, setPapelAtivo] = useState(0)
  const [granadas, setGranadas] = useState(null)
  const [erro, setErro] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const primeiraRenderLado = useRef(true)

  useEffect(() => {
    setGranadas(null)
    fetch(`/api/granadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setGranadas)
      .catch(() => setGranadas([]))

    // Granadas são específicas por lado: se o admin troca o lado no meio do
    // preenchimento (não na carga inicial), os granadaIds já marcados deixam de
    // fazer sentido (referenciam granadas de outro lado) — limpa pra evitar
    // enviar vínculos "fantasmas" que nem aparecem mais na lista.
    if (primeiraRenderLado.current) {
      primeiraRenderLado.current = false
    } else {
      setPapeis((ps) => ps.map((p) => ({ ...p, granadaIds: [] })))
    }
  }, [mapa, lado])

  // Índice do papel ativo, blindado contra ficar apontando pra fora do array
  // depois de uma remoção (removerPapel já tenta recalcular, isso é só a rede
  // de segurança final usada em todo lugar que lê o papel ativo).
  const papelAtivoSeguro = Math.min(papelAtivo, papeis.length - 1)

  const granadaPorId = useMemo(
    () => new Map((granadas ?? []).map((g) => [g.id, g])),
    [granadas],
  )

  // Estado visual de cada marcador do radar pro papel ativo: 'ativo' (vinculada
  // a ele), 'outro' (vinculada a outro papel da mesma tática) ou 'normal'.
  const estadoPorId = useMemo(() => {
    const mapa2 = {}
    for (const g of granadas ?? []) {
      const doAtivo = papeis[papelAtivoSeguro]?.granadaIds.includes(g.id) ?? false
      const deOutroPapel = !doAtivo && papeis.some((p) => p.granadaIds.includes(g.id))
      mapa2[g.id] = doAtivo ? 'ativo' : deOutroPapel ? 'outro' : 'normal'
    }
    return mapa2
  }, [granadas, papeis, papelAtivoSeguro])

  function atualizarPapel(i, patch) {
    setPapeis((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  }

  function alternarGranada(i, granadaId) {
    setPapeis((ps) => ps.map((p, idx) => {
      if (idx !== i) return p
      const marcado = p.granadaIds.includes(granadaId)
      return {
        ...p,
        granadaIds: marcado ? p.granadaIds.filter((id) => id !== granadaId) : [...p.granadaIds, granadaId],
      }
    }))
  }

  function adicionarPapel() {
    setPapelAtivo(papeis.length)
    setPapeis((ps) => [...ps, novoPapel()])
  }

  function removerPapel(i) {
    const novoLen = papeis.length - 1
    setPapeis((ps) => ps.filter((_, idx) => idx !== i))
    setPapelAtivo((atual) => {
      const ajustado = i < atual ? atual - 1 : atual
      return Math.min(ajustado, Math.max(0, novoLen - 1))
    })
  }

  async function salvar(e) {
    e.preventDefault()
    setErro(null)
    if (!titulo.trim()) return setErro('Título é obrigatório.')
    if (papeis.some((p) => !p.descricao.trim())) return setErro('Todo papel precisa de uma descrição.')

    setSalvando(true)
    const corpo = {
      map: mapa, lado, tipo, local, armas,
      titulo: titulo.trim(),
      descricao: descricao.trim() || null,
      papeis: papeis.map((p, i) => ({
        ordem: i, descricao: p.descricao.trim(), obrigatorio: p.obrigatorio, granadaIds: p.granadaIds,
      })),
    }
    const res = await fetch(inicial ? `/api/taticas-curadas/${inicial.id}` : '/api/taticas-curadas', {
      method: inicial ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo),
    }).catch(() => null)
    setSalvando(false)
    if (res?.ok) return onSalvo()
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-0 lg:p-4" onClick={onCancelar}>
      {/* Mobile: form ocupa a tela inteira, então o backdrop clicável some; esse
          X fixo é o único jeito de fechar sem rolar até o fim. */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancelar() }}
        aria-label="Fechar"
        className="panel-cut-sm fixed right-3 top-3 z-[60] flex min-h-10 min-w-10 items-center justify-center border border-borda bg-superficie font-mono text-sm text-texto-fraco hover:text-texto lg:hidden"
      >✕</button>
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full flex-col overflow-y-auto border border-borda bg-superficie lg:panel-cut lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-6xl lg:flex-row lg:overflow-hidden"
      >
        {/* Coluna do radar: sempre visível, mostra TODAS as granadas curadas do
            mapa+lado atual. É aqui que a tática é montada de fato. */}
        <div className="shrink-0 border-b border-borda p-4 lg:w-[58%] lg:overflow-y-auto lg:border-b-0 lg:border-r lg:p-5">
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <p className="mr-1 font-mono text-xs uppercase text-texto-fraco">Vinculando ao papel:</p>
            {papeis.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPapelAtivo(i)}
                className={`panel-cut-sm min-h-10 border px-2.5 py-1 font-mono text-xs uppercase transition-colors lg:min-h-0 ${
                  i === papelAtivoSeguro ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco hover:text-texto'
                }`}
              >
                Jogador {i + 1}
              </button>
            ))}
          </div>

          <RadarGranadas
            mapa={mapa}
            lineups={granadas ?? []}
            estadoPorId={estadoPorId}
            onSelecionar={(g) => alternarGranada(papelAtivoSeguro, g.id)}
          />

          {granadas === null && (
            <p className="mt-2 font-mono text-xs text-texto-fraco">Carregando granadas…</p>
          )}
          {granadas?.length === 0 && (
            <p className="mt-2 font-mono text-xs text-texto-fraco">Nenhuma granada cadastrada pra esse lado ainda. Cadastre em Granadas primeiro.</p>
          )}
          {granadas != null && granadas.length > 0 && (
            <p className="mt-2 font-mono text-xs text-texto-fraco">
              Clique num marcador pra vincular ou desvincular do <span className="text-destaque">Jogador {papelAtivoSeguro + 1}</span>.
            </p>
          )}
        </div>

        {/* Coluna do painel: campos da tática compactados no topo + papéis como
            cards selecionáveis (clicar num card o torna o papel ativo). */}
        <div className="min-w-0 flex-1 space-y-3 p-4 lg:overflow-y-auto lg:p-5">
          <h3 className="font-display text-lg font-bold uppercase text-texto">
            {inicial ? 'Editar tática' : 'Nova tática'}
          </h3>

          <input
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título (ex.: Execute A padrão)"
            className="panel-cut-sm min-h-10 w-full border border-borda bg-fundo px-3 py-2 font-mono text-sm lg:min-h-0"
          />
          <textarea
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)"
            rows={1}
            className="panel-cut-sm w-full border border-borda bg-fundo px-3 py-1.5 font-mono text-sm"
          />

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div>
              <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Lado</p>
              <Select value={lado} onChange={(e) => setLado(e.target.value)} className="w-full" selectClassName="pl-2 pr-7 text-xs">
                <option value="T">T</option>
                <option value="CT">CT</option>
              </Select>
            </div>
            <div>
              <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipo</p>
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full" selectClassName="pl-2 pr-7 text-xs">
                {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div>
              <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Local</p>
              <Select value={local} onChange={(e) => setLocal(e.target.value)} className="w-full" selectClassName="pl-2 pr-7 text-xs">
                {LOCAIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
            <div>
              <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Armas</p>
              <Select value={armas} onChange={(e) => setArmas(e.target.value)} className="w-full" selectClassName="pl-2 pr-7 text-xs">
                {ARMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs uppercase text-texto-fraco">Papéis</p>
              <button
                type="button"
                onClick={adicionarPapel}
                className="panel-cut-sm min-h-10 lg:min-h-0 border border-borda px-2 py-1 font-mono text-xs uppercase text-texto-fraco hover:text-texto"
              >+ papel</button>
            </div>

            {papeis.map((p, i) => {
              const ativo = i === papelAtivoSeguro
              return (
                <Card
                  key={i}
                  onClick={() => setPapelAtivo(i)}
                  className={`cursor-pointer space-y-2 p-3 ${
                    ativo ? '!border-destaque bg-destaque/5' : 'bg-fundo hover:border-destaque/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className={`font-display text-sm font-semibold uppercase ${ativo ? 'text-destaque' : 'text-texto'}`}>
                      Jogador {i + 1}
                      {ativo && <span className="ml-1.5 font-mono text-[10px] normal-case text-texto-fraco">ativo no radar</span>}
                    </p>
                    {papeis.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); removerPapel(i) }}
                        className="min-h-10 lg:min-h-0 px-2 py-1 font-mono text-xs uppercase text-perigo hover:brightness-125"
                      >remover</button>
                    )}
                  </div>

                  <textarea
                    value={p.descricao}
                    onChange={(e) => atualizarPapel(i, { descricao: e.target.value })}
                    placeholder="Descrição do papel (obrigatória)"
                    rows={2}
                    className="panel-cut-sm w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm"
                  />

                  <label className="flex min-h-10 lg:min-h-0 w-fit items-center gap-2 font-mono text-xs uppercase text-texto-fraco">
                    <input
                      type="checkbox"
                      checked={p.obrigatorio}
                      onChange={(e) => atualizarPapel(i, { obrigatorio: e.target.checked })}
                      className="h-4 w-4"
                    />
                    necessário
                  </label>

                  <div>
                    <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">
                      Granadas vinculadas ({p.granadaIds.length})
                    </p>
                    {p.granadaIds.length === 0 ? (
                      <p className="font-mono text-xs text-texto-fraco/70">
                        Nenhuma ainda — clique nos marcadores do radar {!ativo && '(torne esse papel ativo primeiro)'}.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {p.granadaIds.map((id) => {
                          const g = granadaPorId.get(id)
                          return (
                            <button
                              key={id}
                              type="button"
                              onClick={(e) => { e.stopPropagation(); alternarGranada(i, id) }}
                              title="Clique pra desvincular"
                              className="panel-cut-sm flex min-h-10 items-center gap-1.5 border border-borda bg-superficie px-2.5 py-1 font-mono text-[10px] uppercase text-texto transition-colors hover:border-perigo/60 hover:text-perigo lg:min-h-0"
                            >
                              <span className="max-w-[8rem] truncate">{g?.titulo ?? 'Granada'}</span>
                              <span className="text-texto-fraco">{ROTULO_TIPO_GRANADA[g?.tipo] ?? ''}</span>
                              <span aria-hidden>✕</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}

          <div className="flex justify-end gap-2 pb-1">
            <button type="button" onClick={onCancelar} className="min-h-10 px-4 py-2 font-mono text-xs uppercase text-texto-fraco hover:text-texto lg:min-h-0">Cancelar</button>
            <button type="submit" disabled={salvando}
              className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo disabled:opacity-50 lg:min-h-0">
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
