import { useEffect, useState } from 'react'
import { nomeAutomatico } from '../../lib/calloutsUtil.js'
import { detectar, montarTatica } from '../../lib/deteccaoTaticas.js'
import { ROTULO_TIPO_TATICA } from './CardTatica.jsx'
import { useTransicaoModal } from '../../lib/useTransicaoModal.js'
import MiniRadarTatica from './MiniRadarTatica.jsx'
import { Badge, Button, EstadoErro, EstadoVazio, Modal, Skeleton } from '../ui'

// Duas granadas do mesmo tipo/lado com alvo a menos de 0.03 (posições 0..1)
// contam como "já cadastrada" pro dedupe — mesmo limiar do gerarBiblioteca de
// PaginaMapa.jsx (Granadas).
const LIMIAR_DEDUPE = 0.03

const ROTULO_TIPO_GRANADA = { smoke: 'Smoke', flash: 'Flash', molotov: 'Molotov', he: 'HE' }

function chaveCandidato(c) {
  return `${c.lado}|${c.regiao}|${c.tipos.join(',')}`
}

// Cria (ou reaproveita via dedupe) as granadas curadas de um candidato e devolve
// um Map granada-crua -> id da biblioteca. `existentes` é mutado (push) conforme
// vai criando, pra granadas repetidas dentro do mesmo candidato deduparem entre si.
async function criarOuReaproveitarGranadas(mapa, lado, granadasCruas, existentes, callouts, descricaoBase, aoProgredir) {
  const idPorGranada = new Map()
  let falhas = 0
  for (let i = 0; i < granadasCruas.length; i++) {
    const g = granadasCruas[i]
    const existente = existentes.find((e) =>
      e.tipo === g.tipo && e.lado === lado
      && Math.hypot(e.alvoX - g.alvoX, e.alvoY - g.alvoY) < LIMIAR_DEDUPE,
    )
    if (existente) {
      idPorGranada.set(g, existente.id)
    } else {
      const titulo = nomeAutomatico(g.tipo, callouts, g.alvoX, g.alvoY, g.arremessoX, g.arremessoY)
      const res = await fetch('/api/granadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map: mapa, lado, tipo: g.tipo, titulo,
          descricao: descricaoBase,
          videoUrl: '', tecnica: 'normal', botao: 'esquerdo', passos: [],
          arremessoX: g.arremessoX, arremessoY: g.arremessoY,
          alvoX: g.alvoX, alvoY: g.alvoY,
        }),
      }).catch(() => null)
      if (res?.ok) {
        const body = await res.json()
        idPorGranada.set(g, body.id)
        existentes.push({ id: body.id, tipo: g.tipo, lado, alvoX: g.alvoX, alvoY: g.alvoY })
      } else {
        falhas += 1
      }
    }
    aoProgredir(i + 1, granadasCruas.length)
  }
  return { idPorGranada, falhas }
}

// Modal admin: detecta executes/setups recorrentes na utilitária extraída das
// demos (rounds com >=3 granadas do mesmo lado numa janela curta, agrupados por
// região+tipos+centróide) e cria a tática curada (com granadas + papéis) num clique.
// Ver docs/superpowers/plans/2026-07-14-playbook-automatico.md (Task F2).
export default function DetectarTaticas({ mapa, callouts, onFechar, onCriada }) {
  const [candidatos, setCandidatos] = useState(null) // null = carregando
  const [erroCarga, setErroCarga] = useState(null)
  const [criandoChave, setCriandoChave] = useState(null) // null | chave do candidato em criação
  const [progresso, setProgresso] = useState(null)       // {atual, total}
  const [erroCriacao, setErroCriacao] = useState(null)
  const [criadas, setCriadas] = useState(() => new Set())
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)

  useEffect(() => {
    let cancelado = false
    setCandidatos(null)
    setErroCarga(null)
    fetch(`/api/granadas/rounds-utilitaria?map=${mapa}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((rounds) => { if (!cancelado) setCandidatos(detectar(rounds, callouts)) })
      .catch(() => { if (!cancelado) { setCandidatos([]); setErroCarga('Erro ao carregar os rounds das demos.') } })
    return () => { cancelado = true }
  }, [mapa, callouts])

  async function criarTatica(candidato) {
    const chave = chaveCandidato(candidato)
    if (criandoChave) return // guard de duplo clique
    setErroCriacao(null)
    setCriandoChave(chave)

    const tatica = montarTatica(candidato, callouts)
    if (!tatica) {
      setErroCriacao('Candidato sem região classificável.')
      setCriandoChave(null)
      return
    }

    const todasGranadas = tatica.papeis.flatMap((p) => p.granadas)
    setProgresso({ atual: 0, total: todasGranadas.length })

    const existentesRes = await fetch(`/api/granadas?map=${mapa}`).catch(() => null)
    const existentes = existentesRes?.ok ? await existentesRes.json() : []

    const descricaoBase = `Gerada da detecção automática (${candidato.rounds.length}x rounds).`
    const { idPorGranada, falhas } = await criarOuReaproveitarGranadas(
      mapa, candidato.lado, todasGranadas, existentes, callouts, descricaoBase,
      (atual, total) => setProgresso({ atual, total }),
    )

    if (falhas > 0) {
      setErroCriacao(`${falhas} granada(s) falharam ao criar — tática não foi criada. Tente de novo.`)
      setCriandoChave(null)
      setProgresso(null)
      return
    }

    const papeisPayload = tatica.papeis.map((p) => ({
      ordem: p.ordem,
      descricao: p.descricao,
      obrigatorio: p.obrigatorio,
      granadaIds: p.granadas.map((g) => idPorGranada.get(g)).filter(Boolean),
    }))

    const resTatica = await fetch('/api/taticas-curadas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        map: mapa, lado: tatica.lado, tipo: tatica.tipo, local: tatica.local, armas: 'full',
        titulo: tatica.titulo,
        descricao: `Detectada automaticamente em ${candidato.rounds.length} round(s)${candidato.times.length ? ` (${candidato.times.join(' vs ')})` : ''}.`,
        papeis: papeisPayload,
      }),
    }).catch(() => null)

    setCriandoChave(null)
    setProgresso(null)
    if (resTatica?.ok) {
      setCriadas((s) => new Set(s).add(chave))
      onCriada?.()
    } else {
      const body = await resTatica?.json().catch(() => ({}))
      setErroCriacao(body?.erro ?? 'Erro ao criar a tática.')
    }
  }

  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      tamanho="lg"
      titulo="Detectar táticas"
      subtitulo="Padrões de execute/setup encontrados na utilitária extraída das demos processadas."
    >
      <div className="flex flex-col gap-4">
        {erroCarga && <EstadoErro mensagem={erroCarga} />}
        {erroCriacao && <EstadoErro mensagem={erroCriacao} />}

        {candidatos === null && (
          <div role="status" aria-label="Analisando rounds" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="panel-cut-sm flex flex-col border border-borda bg-fundo/40">
                <Skeleton className="aspect-square w-full" />
                <div className="flex flex-col gap-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="mt-1 h-9 w-full" />
                </div>
              </div>
            ))}
            <span className="sr-only">Analisando rounds…</span>
          </div>
        )}

        {candidatos && candidatos.length === 0 && !erroCarga && (
          <EstadoVazio
            titulo="Nenhum padrão recorrente"
            descricao="Precisa de pelo menos 3 granadas do mesmo lado numa janela curta, em região classificável."
          />
        )}

        {candidatos && candidatos.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {candidatos.map((c) => {
              const chave = chaveCandidato(c)
              const tatica = montarTatica(c, callouts)
              const emCriacao = criandoChave === chave
              const jaCriada = criadas.has(chave)
              return (
                <div key={chave} className="panel-cut-sm flex flex-col overflow-hidden border border-borda bg-fundo/40">
                  <div className="relative">
                    <MiniRadarTatica mapa={mapa} granadas={c.granadasRepresentativas} />
                    <div className="absolute left-1.5 top-1.5 flex flex-wrap gap-1">
                      <Badge tom="neutro" className="!bg-fundo/80">{c.regiao}</Badge>
                      <Badge tom="destaque" className="!bg-fundo/80">{ROTULO_TIPO_TATICA[tatica.tipo] ?? tatica.tipo}</Badge>
                      <Badge tom="neutro" className="!bg-fundo/80">{c.lado}</Badge>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
                    <p className="truncate font-display text-base font-semibold text-texto">{tatica.titulo}</p>
                    <p className="flex items-baseline gap-1.5 text-xs text-texto-fraco">
                      <span className="font-display text-lg font-semibold tabular-nums leading-none text-texto">{c.rounds.length}</span>
                      <span className="rotulo">{c.rounds.length === 1 ? 'round' : 'rounds'}</span>
                      {c.times.length > 0 && <span className="truncate">· {c.times.join(', ')}</span>}
                    </p>
                    <p className="text-xs text-texto-fraco">
                      {tatica.papeis.length} {tatica.papeis.length === 1 ? 'papel' : 'papéis'} ·{' '}
                      {c.granadasRepresentativas.map((g) => ROTULO_TIPO_GRANADA[g.tipo] ?? g.tipo).join(', ')}
                    </p>

                    <Button
                      variante={jaCriada ? 'secundario' : 'contorno'}
                      tamanho="sm"
                      larguraTotal
                      className="mt-auto"
                      onClick={() => criarTatica(c)}
                      disabled={!!criandoChave || jaCriada}
                      carregando={emCriacao}
                    >
                      {jaCriada ? 'Criada ✓' : emCriacao ? `Criando ${progresso?.atual ?? 0}/${progresso?.total ?? 0}…` : 'Criar tática'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Modal>
  )
}
