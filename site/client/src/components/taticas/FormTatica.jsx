import { useEffect, useRef, useState } from 'react'
import { ROTULO_TIPO_TATICA, ROTULO_ARMAS } from './CardTatica.jsx'

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

// Form modal de criar/editar tática curada: título/descrição/lado/tipo/local/armas
// + lista dinâmica de papéis, cada um com descrição, toggle "necessário" e um
// seletor de granadas da biblioteca (por mapa+lado). Segue o mesmo padrão visual
// de FormGranada.jsx (modal tela cheia no mobile, painel `lg:max-w-2xl` no desktop).
export default function FormTatica({ mapa, lado: ladoInicial, inicial = null, onSalvo, onCancelar }) {
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [descricao, setDescricao] = useState(inicial?.descricao ?? '')
  const [lado, setLado] = useState(inicial?.lado ?? ladoInicial ?? 'T')
  const [tipo, setTipo] = useState(inicial?.tipo ?? 'execute')
  const [local, setLocal] = useState(inicial?.local ?? 'A')
  const [armas, setArmas] = useState(inicial?.armas ?? 'full')
  const [papeis, setPapeis] = useState(() => papeisIniciais(inicial))
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
    setPapeis((ps) => [...ps, novoPapel()])
  }

  function removerPapel(i) {
    setPapeis((ps) => ps.filter((_, idx) => idx !== i))
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
        className="fixed right-3 top-3 z-[60] flex min-h-10 min-w-10 items-center justify-center rounded-full border border-borda bg-superficie font-mono text-sm text-texto-fraco hover:text-texto lg:hidden"
      >✕</button>
      <form
        onSubmit={salvar}
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full space-y-3 overflow-y-auto border border-borda bg-superficie p-5 lg:panel-cut lg:h-auto lg:max-h-[90vh] lg:w-full lg:max-w-2xl"
      >
        <h3 className="font-display text-lg font-bold uppercase text-texto">
          {inicial ? 'Editar tática' : 'Nova tática'}
        </h3>

        <input
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Título (ex.: Execute A padrão)"
          className="min-h-10 w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm lg:min-h-0"
        />
        <textarea
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Descrição (opcional)"
          rows={2}
          className="w-full rounded border border-borda bg-fundo px-3 py-2 font-mono text-sm"
        />

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div>
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Lado</p>
            <select value={lado} onChange={(e) => setLado(e.target.value)}
              className="min-h-10 w-full rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs lg:min-h-0">
              <option value="T">T</option>
              <option value="CT">CT</option>
            </select>
          </div>
          <div>
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipo</p>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)}
              className="min-h-10 w-full rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs lg:min-h-0">
              {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Local</p>
            <select value={local} onChange={(e) => setLocal(e.target.value)}
              className="min-h-10 w-full rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs lg:min-h-0">
              {LOCAIS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Armas</p>
            <select value={armas} onChange={(e) => setArmas(e.target.value)}
              className="min-h-10 w-full rounded border border-borda bg-fundo px-2 py-1.5 font-mono text-xs lg:min-h-0">
              {ARMAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs uppercase text-texto-fraco">Papéis</p>
            <button
              type="button"
              onClick={adicionarPapel}
              className="min-h-8 rounded border border-borda px-2 py-1 font-mono text-xs uppercase text-texto-fraco hover:text-texto"
            >+ papel</button>
          </div>

          {papeis.map((p, i) => (
            <div key={i} className="panel-cut-sm space-y-2 border border-borda bg-fundo p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-sm font-semibold uppercase text-texto">Jogador {i + 1}</p>
                {papeis.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removerPapel(i)}
                    className="min-h-8 px-2 py-1 font-mono text-xs uppercase text-perigo hover:brightness-125"
                  >remover</button>
                )}
              </div>

              <textarea
                value={p.descricao}
                onChange={(e) => atualizarPapel(i, { descricao: e.target.value })}
                placeholder="Descrição do papel (obrigatória)"
                rows={2}
                className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
              />

              <label className="flex min-h-8 w-fit items-center gap-2 font-mono text-xs uppercase text-texto-fraco">
                <input
                  type="checkbox"
                  checked={p.obrigatorio}
                  onChange={(e) => atualizarPapel(i, { obrigatorio: e.target.checked })}
                  className="h-4 w-4"
                />
                necessário
              </label>

              <div>
                <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Granadas ({lado})</p>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-borda bg-superficie p-2">
                  {granadas === null && (
                    <p className="font-mono text-xs text-texto-fraco">Carregando…</p>
                  )}
                  {granadas?.length === 0 && (
                    <p className="font-mono text-xs text-texto-fraco">Nenhuma granada cadastrada pra esse lado ainda.</p>
                  )}
                  {granadas?.map((g) => (
                    <label key={g.id} className="flex min-h-8 items-center gap-2 font-mono text-xs text-texto">
                      <input
                        type="checkbox"
                        checked={p.granadaIds.includes(g.id)}
                        onChange={() => alternarGranada(i, g.id)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">{g.titulo}</span>
                      <span className="shrink-0 uppercase text-texto-fraco">{ROTULO_TIPO_GRANADA[g.tipo] ?? g.tipo}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>

        {erro && <p className="font-mono text-sm text-perigo">{erro}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancelar} className="min-h-10 px-4 py-2 font-mono text-xs uppercase text-texto-fraco hover:text-texto lg:min-h-0">Cancelar</button>
          <button type="submit" disabled={salvando}
            className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase text-fundo disabled:opacity-50 lg:min-h-0">
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </div>
  )
}
