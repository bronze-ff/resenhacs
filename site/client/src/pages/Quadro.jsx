import { useEffect, useReducer, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Button, Card, CabecalhoPagina, Input, Textarea, Select, Modal, EstadoErro, EstadoVazio, SkeletonLista, Badge,
} from '../components/ui'
import EditorQuadro from '../components/quadro/EditorQuadro.jsx'
import { MAPAS_POOL } from '../components/granadas/ExplorarMapas.jsx'
import { nomeMapa, dataRelativa } from '../lib/format.js'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'
import { reducerQuadro, estadoInicial, deQuadro, paraApi } from '../lib/quadroEditor.js'
import { buscarRoundDoReplay, objetosDoFrame, paramsImportacao } from '../lib/quadroImportar.js'

function ModalTransicao({ onFechar, ...props }) {
  const { visivel, iniciarSaida } = useTransicaoModal()
  return <Modal visivel={visivel} onFechar={() => iniciarSaida(onFechar)} {...props} />
}

function ListaQuadros({ onAbrir }) {
  const [quadros, setQuadros] = useState(null)
  const [erro, setErro] = useState(false)
  useEffect(() => {
    let vivo = true
    fetch('/api/quadros')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((q) => { if (vivo) setQuadros(q) })
      .catch(() => { if (vivo) setErro(true) })
    return () => { vivo = false }
  }, [])
  if (erro) return <EstadoErro mensagem="Não foi possível carregar os quadros." />
  if (!quadros) return <SkeletonLista linhas={3} altura="h-14" rotulo="Carregando quadros" />
  if (quadros.length === 0) {
    return <EstadoVazio titulo="Nenhum quadro salvo" descricao="Os quadros que você ou seus amigos salvarem aparecem aqui." />
  }
  return (
    <ul className="space-y-2">
      {quadros.map((q) => (
        <li key={q.id}>
          <button
            type="button"
            onClick={() => onAbrir(q.id)}
            className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-pequeno)] border border-borda bg-superficie-alta px-3 py-2.5 text-left transition-colors hover:border-borda-forte"
          >
            <span className="min-w-0">
              <span className="block truncate font-medium text-texto">{q.nome}</span>
              <span className="block text-xs text-texto-fraco">
                {nomeMapa(q.map)}{q.lado ? ` · ${q.lado}` : ''} · <span className="font-mono tabular-nums">{q.qtdPassos}</span> {q.qtdPassos === 1 ? 'passo' : 'passos'}
                {!q.meu && q.criadoPorNick ? ` · por ${q.criadoPorNick}` : ''}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {q.meu && <Badge>Meu</Badge>}
              {q.updatedAt && <span className="font-mono text-xs tabular-nums text-texto-fraco">{dataRelativa(q.updatedAt)}</span>}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

const ROTULO_GRANADA = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

export default function Quadro() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [estado, dispatch] = useReducer(reducerQuadro, undefined, () => estadoInicial())
  const [carregando, setCarregando] = useState(false)
  const [erroCarga, setErroCarga] = useState(null)
  const [aviso, setAviso] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erroSalvar, setErroSalvar] = useState(null)
  const [modal, setModal] = useState(null) // 'abrir' | 'importar' | 'excluir'
  const idUrl = searchParams.get('id')
  const importacao = paramsImportacao(searchParams)
  const chaveImportacao = importacao ? `${importacao.partida}:${importacao.round}:${importacao.tick}` : null

  // ?id= abre um quadro salvo.
  useEffect(() => {
    if (!idUrl || idUrl === estado.meta.id) return
    let vivo = true
    setCarregando(true)
    setErroCarga(null)
    fetch(`/api/quadros/${encodeURIComponent(idUrl)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((q) => { if (vivo) dispatch({ tipo: 'carregar', estado: deQuadro(q) }) })
      .catch(() => { if (vivo) setErroCarga('Quadro não encontrado ou sem acesso.') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [idUrl]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?partida=&round=&tick= importa os jogadores vivos daquele momento do Replay 2D.
  useEffect(() => {
    if (!importacao || idUrl) return
    let vivo = true
    setCarregando(true)
    setErroCarga(null)
    buscarRoundDoReplay(importacao.partida, importacao.round)
      .then((replay) => {
        if (!vivo) return
        const r = objetosDoFrame(replay, importacao.round, importacao.tick)
        if (r.erro) { setErroCarga(r.erro); return }
        const segundos = replay.tickRate ? ` aos ${(r.frame / replay.tickRate).toFixed(1)}s` : ''
        const novo = deQuadro({ nome: `Round ${importacao.round}${segundos}`, map: r.map, passos: [{ nome: 'Setup', objetos: r.objetos }] })
        dispatch({ tipo: 'carregar', estado: { ...novo, sujo: true } })
        setAviso(`${r.objetos.length} jogadores importados do round ${importacao.round}. Salve pra guardar o quadro.`)
      })
      .catch(() => { if (vivo) setErroCarga('Não foi possível carregar o Replay 2D dessa Partida.') })
      .finally(() => { if (vivo) setCarregando(false) })
    return () => { vivo = false }
  }, [chaveImportacao]) // eslint-disable-line react-hooks/exhaustive-deps

  // Aviso ao sair com alteração não salva.
  useEffect(() => {
    if (!estado.sujo) return
    const aoSair = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', aoSair)
    return () => window.removeEventListener('beforeunload', aoSair)
  }, [estado.sujo])

  const { meta } = estado
  const passo = estado.passos[estado.passoAtivo]
  const granadas = passo.objetos.filter((o) => ROTULO_GRANADA[o.tipo])
  const ehCopia = meta.id && !meta.meu

  function novo() {
    dispatch({ tipo: 'carregar', estado: estadoInicial() })
    setSearchParams({})
    setAviso(null)
    setErroCarga(null)
  }

  async function salvar() {
    setErroSalvar(null)
    if (!meta.nome.trim()) { setErroSalvar('Dê um nome à estratégia.'); return }
    setSalvando(true)
    try {
      const editar = meta.id && meta.meu
      const res = await fetch(editar ? `/api/quadros/${meta.id}` : '/api/quadros', {
        method: editar ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paraApi(estado)),
      })
      if (res.status === 413) throw new Error('Quadro grande demais. Apague alguns desenhos livres.')
      const corpo = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(corpo.erro ?? 'Não foi possível salvar.')
      dispatch({ tipo: 'salvo', id: corpo.id })
      setSearchParams({ id: corpo.id })
      setAviso('Estratégia salva.')
    } catch (e) {
      setErroSalvar(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir() {
    const res = await fetch(`/api/quadros/${meta.id}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) { setErroSalvar('Não foi possível excluir.'); return }
    novo()
    setAviso('Quadro excluído.')
  }

  return (
    <div>
      <CabecalhoPagina
        eyebrow="Biblioteca · modo sério"
        titulo="Quadro tático"
        descricao="Monte a estratégia em passos sobre o radar: jogadores, granadas, setas e desenho livre."
        acoes={
          <>
            <Button onClick={() => setModal('importar')}>Importar de um round</Button>
            <Button onClick={() => setModal('abrir')}>Abrir salvo</Button>
            <Button variante="fantasma" onClick={novo}>Novo</Button>
            <Button variante="primario" carregando={salvando} onClick={salvar}>
              {ehCopia ? 'Salvar cópia' : 'Salvar estratégia'}
            </Button>
          </>
        }
      />

      {aviso && <p role="status" className="mb-3 text-sm text-texto-fraco">{aviso}</p>}
      {erroSalvar && <p role="alert" className="mb-3 text-sm text-perigo">{erroSalvar}</p>}
      {erroCarga && <div className="mb-4"><EstadoErro mensagem={erroCarga} /></div>}

      {carregando ? (
        <SkeletonLista linhas={1} altura="h-[480px]" rotulo="Carregando quadro" />
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
          <EditorQuadro estado={estado} dispatch={dispatch} />

          <aside className="flex flex-col gap-3">
            <Card className="flex flex-col gap-3 p-4">
              <div className="rotulo">Estratégia</div>
              <Input
                rotulo="Nome"
                maxLength={120}
                value={meta.nome}
                placeholder="Ex.: Execução A com split"
                onChange={(e) => dispatch({ tipo: 'meta', campos: { nome: e.target.value } })}
              />
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5">
                  <span className="rotulo">Mapa</span>
                  <Select value={meta.map} onChange={(e) => dispatch({ tipo: 'meta', campos: { map: e.target.value } })} className="w-full">
                    {(MAPAS_POOL.includes(meta.map) ? MAPAS_POOL : [meta.map, ...MAPAS_POOL]).map((m) => (
                      <option key={m} value={m}>{nomeMapa(m)}</option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="rotulo">Lado</span>
                  <Select value={meta.lado} onChange={(e) => dispatch({ tipo: 'meta', campos: { lado: e.target.value } })} className="w-full">
                    <option value="">Qualquer</option>
                    <option value="T">T</option>
                    <option value="CT">CT</option>
                  </Select>
                </div>
              </div>
              <Textarea
                rotulo="Descrição"
                maxLength={2000}
                value={meta.descricao}
                onChange={(e) => dispatch({ tipo: 'meta', campos: { descricao: e.target.value } })}
              />
              <label className="flex items-center gap-2 text-sm text-texto">
                <input
                  type="checkbox"
                  checked={meta.publicoNoGrupo}
                  onChange={(e) => dispatch({ tipo: 'meta', campos: { publicoNoGrupo: e.target.checked } })}
                  className="h-4 w-4 accent-[color:var(--color-destaque)]"
                />
                Amigos podem ver
              </label>
              {ehCopia && (
                <p className="text-xs text-texto-fraco">
                  Criado por {meta.criadoPorNick ?? 'um amigo'}. Salvar cria uma cópia sua.
                </p>
              )}
              {meta.id && meta.meu && (
                <Button variante="perigo" tamanho="sm" onClick={() => setModal('excluir')}>Excluir quadro</Button>
              )}
            </Card>

            <Card className="flex flex-col gap-2 p-4">
              <div className="rotulo">Granadas deste passo</div>
              {granadas.length === 0 ? (
                <p className="text-sm text-texto-fraco">Nenhuma granada neste passo.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {Object.keys(ROTULO_GRANADA).map((tipo) => {
                    const n = granadas.filter((g) => g.tipo === tipo).length
                    return n ? (
                      <li key={tipo} className="flex justify-between">
                        <span>{ROTULO_GRANADA[tipo]}</span>
                        <span className="font-mono tabular-nums text-texto-fraco">{n}</span>
                      </li>
                    ) : null
                  })}
                </ul>
              )}
              <Link to={`/granadas?map=${encodeURIComponent(meta.map)}`} className="text-[13px] text-destaque-forte hover:underline">
                Ver lineups de {nomeMapa(meta.map)}
              </Link>
            </Card>

            <Card className="p-4 text-[13px] leading-relaxed text-texto-fraco">
              Atalhos: V mover, C/T jogador, S smoke, F flash, M molotov, H HE, A seta, D desenho, E apagar, Ctrl+Z desfaz, Delete apaga o selecionado. Dois cliques no passo renomeiam.
            </Card>
          </aside>
        </div>
      )}

      {modal === 'abrir' && (
        <ModalTransicao titulo="Abrir quadro salvo" onFechar={() => setModal(null)}>
          <ListaQuadros onAbrir={(id) => { setModal(null); setAviso(null); setSearchParams({ id }) }} />
        </ModalTransicao>
      )}
      {modal === 'importar' && (
        <ModalTransicao titulo="Importar de um round" onFechar={() => setModal(null)} tamanho="sm">
          <p className="text-sm leading-relaxed text-texto-fraco">
            Abra o Replay 2D de uma Partida, pause no momento que quiser e clique em <strong className="text-texto">Levar pro quadro</strong>.
            Os jogadores vivos naquele instante viram o passo 1, prontos pra editar.
          </p>
          <div className="mt-4">
            <Button as={Link} to="/" variante="primario" onClick={() => setModal(null)}>Ver Partidas</Button>
          </div>
        </ModalTransicao>
      )}
      {modal === 'excluir' && (
        <ModalTransicao
          titulo="Excluir quadro?"
          tamanho="sm"
          onFechar={() => setModal(null)}
          rodape={
            <>
              <Button variante="fantasma" onClick={() => setModal(null)}>Cancelar</Button>
              <Button variante="perigo" onClick={() => { setModal(null); excluir() }}>Excluir</Button>
            </>
          }
        >
          <p className="text-sm text-texto-fraco">“{meta.nome}” some pra você e pros seus amigos. Não dá pra desfazer.</p>
        </ModalTransicao>
      )}
    </div>
  )
}
