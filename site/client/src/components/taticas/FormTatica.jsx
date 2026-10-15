import { useEffect, useId, useMemo, useRef, useState } from 'react'
import RadarGranadas from '../granadas/RadarGranadas.jsx'
import { ROTULO_TIPO_TATICA, ROTULO_ARMAS } from './CardTatica.jsx'
import { useTransicaoModal } from '../../lib/useTransicaoModal.js'
import { Abas, Button, Campo, Input, Modal, Select, Skeleton, Textarea } from '../ui'

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
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onCancelar)
  const formId = useId()

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
    if (res?.ok) return iniciarSaida(onSalvo)
    const body = await res?.json().catch(() => ({}))
    setErro(body?.erro ?? 'Erro ao salvar.')
  }

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      tamanho="xl"
      titulo={inicial ? 'Editar tática' : 'Nova tática'}
      subtitulo="Escolha um papel e clique nos marcadores do radar pra vincular as granadas."
      rodape={
        <>
          {erro && <p role="alert" className="mr-auto text-sm text-perigo">{erro}</p>}
          <Button variante="fantasma" onClick={fechar}>Cancelar</Button>
          {/* Botão no rodapé do Modal (fora do <form>): `form` liga ele ao formulário. */}
          <Button variante="primario" type="submit" form={formId} carregando={salvando}>
            {salvando ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,58fr)_minmax(0,42fr)] lg:items-start">
        {/* Coluna do radar: sempre visível, mostra TODAS as granadas curadas do
            mapa+lado atual. É aqui que a tática é montada de fato. No desktop fica
            presa no topo enquanto o painel de papéis rola. */}
        <div className="flex flex-col gap-3 lg:sticky lg:top-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="rotulo">Vinculando ao papel</p>
            <Abas
              rotulo="Papel ativo no radar"
              valor={papelAtivoSeguro}
              onChange={setPapelAtivo}
              itens={papeis.map((_, i) => ({ valor: i, rotulo: `Jogador ${i + 1}` }))}
              className="max-w-full flex-wrap"
            />
          </div>

          {granadas === null ? (
            <div role="status" aria-label="Carregando granadas">
              <Skeleton className="panel-cut aspect-square w-full" />
            </div>
          ) : (
            <RadarGranadas
              mapa={mapa}
              lineups={granadas}
              estadoPorId={estadoPorId}
              onSelecionar={(g) => alternarGranada(papelAtivoSeguro, g.id)}
            />
          )}

          {granadas?.length === 0 && (
            <p className="text-sm text-texto-fraco">Nenhuma granada cadastrada pra esse lado ainda. Cadastre em Granadas primeiro.</p>
          )}
          {granadas != null && granadas.length > 0 && (
            <p className="text-sm text-texto-fraco">
              Clique num marcador pra vincular ou desvincular do <span className="font-semibold text-destaque">Jogador {papelAtivoSeguro + 1}</span>.
            </p>
          )}
        </div>

        {/* Coluna do painel: campos da tática compactados no topo + papéis como
            cards selecionáveis (clicar num card o torna o papel ativo). */}
        <div className="flex min-w-0 flex-col gap-4">
          <Input
            rotulo="Título"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Título (ex.: Execute A padrão)"
          />
          <Textarea
            rotulo="Descrição"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="Descrição (opcional)"
            rows={2}
            className="min-h-16"
          />

          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Lado">
              <Select value={lado} onChange={(e) => setLado(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
                <option value="T">T</option>
                <option value="CT">CT</option>
              </Select>
            </Campo>
            <Campo rotulo="Tipo">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
                {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Campo>
            <Campo rotulo="Local">
              <Select value={local} onChange={(e) => setLocal(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
                {LOCAIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Campo>
            <Campo rotulo="Armas">
              <Select value={armas} onChange={(e) => setArmas(e.target.value)} className="w-full" selectClassName="min-h-11 lg:min-h-10">
                {ARMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
            </Campo>
          </div>

          <div className="flex flex-col gap-2 border-t border-borda pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="rotulo">Papéis <span className="tabular-nums text-texto">{papeis.length}</span></p>
              <Button variante="secundario" tamanho="sm" onClick={adicionarPapel}>+ papel</Button>
            </div>

            {papeis.map((p, i) => {
              const ativo = i === papelAtivoSeguro
              return (
                <div
                  key={i}
                  onClick={() => setPapelAtivo(i)}
                  className={`panel-cut-sm flex cursor-pointer flex-col gap-3 border p-3 transition-colors duration-200 ${
                    ativo ? 'border-destaque/60 bg-superficie-alta' : 'border-borda bg-fundo/40 hover:border-borda-forte'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-2 font-display text-base font-semibold text-texto">
                      Jogador {i + 1}
                      {ativo && (
                        <span className="flex items-center gap-1.5 font-mono text-[11px] font-normal normal-case tracking-normal text-destaque">
                          <span className="h-1.5 w-1.5 rounded-full bg-destaque" aria-hidden="true" />
                          ativo no radar
                        </span>
                      )}
                    </p>
                    {papeis.length > 1 && (
                      <Button
                        variante="perigo"
                        tamanho="sm"
                        onClick={(e) => { e.stopPropagation(); removerPapel(i) }}
                      >remover</Button>
                    )}
                  </div>

                  <Textarea
                    value={p.descricao}
                    onChange={(e) => atualizarPapel(i, { descricao: e.target.value })}
                    placeholder="Descrição do papel (obrigatória)"
                    rows={2}
                    className="min-h-16"
                    aria-label={`Descrição do papel do Jogador ${i + 1}`}
                  />

                  <label className="flex min-h-10 w-fit cursor-pointer items-center gap-2 text-sm text-texto-fraco lg:min-h-0">
                    <input
                      type="checkbox"
                      checked={p.obrigatorio}
                      onChange={(e) => atualizarPapel(i, { obrigatorio: e.target.checked })}
                      className="h-4 w-4 accent-[var(--color-destaque)]"
                    />
                    necessário
                  </label>

                  <div className="flex flex-col gap-1.5">
                    <p className="rotulo">
                      Granadas vinculadas <span className="tabular-nums text-texto">{p.granadaIds.length}</span>
                    </p>
                    {p.granadaIds.length === 0 ? (
                      <p className="text-xs text-texto-fraco/80">
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
                              className="panel-cut-tr flex min-h-10 items-center gap-1.5 border border-borda bg-superficie px-2.5 py-1 font-mono text-[11px] text-texto transition-colors duration-200 hover:border-perigo/60 hover:text-perigo lg:min-h-8"
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
                </div>
              )
            })}
          </div>
        </div>
      </form>
    </Modal>
  )
}
