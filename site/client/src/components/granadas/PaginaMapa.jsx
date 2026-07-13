import { useEffect, useMemo, useState } from 'react'
import { nomeMapa } from '../../lib/format.js'
import { nomeAutomatico } from '../../lib/calloutsUtil.js'
import { useAuth } from '../../auth/AuthContext.jsx'
import { MAPAS_POOL } from './ExplorarMapas.jsx'
import RadarGranadas from './RadarGranadas.jsx'
import DetalheGranada from './DetalheGranada.jsx'
import FormGranada from './FormGranada.jsx'

// Duas entradas do mesmo tipo/lado com alvo a menos de 0.03 (posições 0..1)
// contam como "já cadastrada" pro dedupe da geração em lote.
const LIMIAR_DEDUPE = 0.03

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
  const [sugestoes, setSugestoes] = useState(null)       // null = fechado, [] = aberto vazio
  const [sugestaoHover, setSugestaoHover] = useState(null)
  const [gerando, setGerando] = useState(null)            // null | {atual, total}
  const [resumoGeracao, setResumoGeracao] = useState(null)

  function recarregar() {
    setLineups(null)
    fetch(`/api/granadas?map=${mapa}&lado=${lado}`)
      .then((r) => r.json())
      .then(setLineups)
      .catch(() => setLineups([]))
  }

  async function abrirSugestoes() {
    setSugestoes([])  // Previne duplo clique (botão desaparece imediatamente)
    const res = await fetch(`/api/granadas/sugestoes?map=${mapa}`).catch(() => null)
    setSugestoes(res?.ok ? await res.json() : [])
  }

  // Cadastra em lote os clusters de granadas mais usadas nas demos (os mesmos
  // até 15 exibidos em "Sugestões"), com título automático via callout mais
  // próximo. Pula clusters sem lado identificado (demos antigas) e os que já
  // têm entrada curada equivalente (mesmo tipo/lado, alvo bem próximo).
  async function gerarBiblioteca() {
    if (gerando) return
    setGerando('preparando…')
    setResumoGeracao(null)
    const clusters = (sugestoes ?? []).slice(0, 15)
    const semLado = clusters.filter((s) => !s.lado).length
    const candidatos = clusters.filter((s) => s.lado)

    const existentesRes = await fetch(`/api/granadas?map=${mapa}`).catch(() => null)
    const existentes = existentesRes?.ok ? await existentesRes.json() : []

    const paraCriar = candidatos.filter((s) => !existentes.some((e) =>
      e.tipo === s.tipo && e.lado === s.lado
      && Math.hypot(e.alvoX - s.alvoX, e.alvoY - s.alvoY) < LIMIAR_DEDUPE,
    ))

    setGerando({ atual: 0, total: paraCriar.length })
    let criados = 0
    let falhas = 0
    for (let i = 0; i < paraCriar.length; i++) {
      const s = paraCriar[i]
      const titulo = nomeAutomatico(s.tipo, callouts, s.alvoX, s.alvoY, s.arremessoX, s.arremessoY)
      const res = await fetch('/api/granadas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          map: mapa, lado: s.lado, tipo: s.tipo, titulo,
          descricao: `Gerada automaticamente das demos (${s.total}x). Adicione um vídeo.`,
          videoUrl: '', tecnica: 'normal', botao: 'esquerdo', passos: [],
          arremessoX: s.arremessoX, arremessoY: s.arremessoY,
          alvoX: s.alvoX, alvoY: s.alvoY,
        }),
      }).catch(() => null)
      if (res?.ok) criados += 1
      else falhas += 1
      setGerando({ atual: i + 1, total: paraCriar.length })
    }

    setGerando(null)
    const jaExistiam = candidatos.length - paraCriar.length
    const partes = [`${criados} granada(s) cadastrada(s)`]
    if (jaExistiam > 0) partes.push(`${jaExistiam} já existia(m)`)
    if (falhas > 0) partes.push(`${falhas} falharam`)
    if (semLado > 0) partes.push(`${semLado} sem lado identificado (demos antigas)`)
    setResumoGeracao(`${partes.join(' · ')}.`)
    setSugestoes(null)
    recarregar()
  }

  useEffect(() => {
    recarregar()
  }, [mapa, lado])

  useEffect(() => {
    setCallouts([])
    import(`../../data/callouts/${mapa}.json`)
      .then((m) => setCallouts(m.default ?? []))
      .catch(() => setCallouts([]))
  }, [mapa])

  useEffect(() => {
    setSugestoes(null)
    setSugestaoHover(null)
    setGerando(null)
    setResumoGeracao(null)
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
      <aside className="w-full space-y-4 lg:w-56">
        <h2 className="font-display text-2xl font-bold uppercase tracking-wide text-texto">{nomeMapa(mapa)}</h2>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar mapa</p>
          <select
            value={mapa}
            onChange={(e) => onTrocarMapa(e.target.value)}
            className="w-full rounded border border-borda bg-superficie px-2 py-1 font-mono text-sm"
          >
            {MAPAS_POOL.map((m) => <option key={m} value={m}>{nomeMapa(m)}</option>)}
          </select>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Trocar lado</p>
          <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {['T', 'CT'].map((v) => (
              <button
                key={v}
                onClick={() => setLado(v)}
                className={`flex-1 px-3 py-1.5 transition-colors ${lado === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Tipos de granada</p>
          <div className="space-y-1">
            {TIPOS.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setTipo(v)}
                disabled={porTipo[v] === 0}
                className={`flex w-full items-center justify-between rounded border px-3 py-1.5 font-mono text-xs uppercase transition-colors ${
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

        <div>
          <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Chamadas</p>
          <div className="flex overflow-hidden rounded border border-borda font-mono text-xs uppercase">
            {NIVEIS_CALLOUT.map(([v, label]) => (
              <button
                key={v}
                onClick={() => setNivelCallouts(v)}
                className={`flex-1 px-2 py-1.5 transition-colors ${nivelCallouts === v ? 'bg-destaque text-fundo' : 'bg-superficie text-texto-fraco hover:text-texto'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isAdmin && (
          <button
            onClick={() => setModoMarcacao({})}
            className="panel-cut-sm w-full border border-destaque bg-destaque px-3 py-2 font-display text-sm font-semibold uppercase text-fundo"
          >
            Adicionar granada
          </button>
        )}
        {modoMarcacao && (
          <p className="font-mono text-xs text-destaque">
            {!modoMarcacao.arremesso ? '1º clique: de onde LANÇA' : !modoMarcacao.alvo ? '2º clique: onde CAI' : ''}
            <button onClick={() => setModoMarcacao(null)} className="ml-2 underline">cancelar</button>
          </p>
        )}

        {isAdmin && (
          <div>
            <p className="mb-1 font-mono text-xs uppercase text-texto-fraco">Sugestões (das demos)</p>
            {resumoGeracao && (
              <p className="mb-2 font-mono text-[11px] text-texto-fraco">{resumoGeracao}</p>
            )}
            {sugestoes === null ? (
              <button onClick={abrirSugestoes} className="w-full rounded border border-borda px-3 py-1.5 font-mono text-xs uppercase text-texto-fraco hover:text-texto">
                Ver granadas mais usadas
              </button>
            ) : sugestoes.length === 0 ? (
              <p className="font-mono text-xs text-texto-fraco">Nenhuma granada extraída das demos desse mapa ainda.</p>
            ) : (
              <>
                <button
                  onClick={gerarBiblioteca}
                  disabled={!!gerando}
                  className="mb-2 w-full rounded border border-destaque bg-destaque/10 px-3 py-1.5 font-mono text-xs uppercase text-destaque hover:bg-destaque/20 disabled:opacity-50"
                >
                  {gerando ? `Cadastrando ${gerando.atual}/${gerando.total}…` : 'Gerar biblioteca deste mapa'}
                </button>
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {sugestoes.slice(0, 15).map((s, i) => (
                    <li
                      key={i}
                      onMouseEnter={() => setSugestaoHover(i)}
                      onMouseLeave={() => setSugestaoHover(null)}
                      className="flex items-center justify-between rounded border border-borda px-2 py-1 font-mono text-[11px] text-texto-fraco"
                    >
                      <span className="uppercase">{s.tipo} · {s.total}x · {s.origem}</span>
                      <button
                        onClick={() => setFormAberto({
                          posicoes: { arremesso: { x: s.arremessoX, y: s.arremessoY }, alvo: { x: s.alvoX, y: s.alvoY } },
                        })}
                        className="text-destaque hover:brightness-125"
                      >usar</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
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
            sugestoes={sugestoes ?? []}
            sugestaoAtiva={sugestaoHover}
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
                className="px-3 py-1.5 font-mono text-xs uppercase text-texto-fraco hover:text-texto"
              >Editar</button>
              <button
                onClick={async () => {
                  if (!window.confirm(`Excluir "${selecionada.titulo}"?`)) return
                  const res = await fetch(`/api/granadas/${selecionada.id}`, { method: 'DELETE' }).catch(() => null)
                  if (res?.ok) { setSelecionada(null); recarregar() }
                }}
                className="px-3 py-1.5 font-mono text-xs uppercase text-perigo hover:brightness-125"
              >Excluir</button>
            </div>
          )}
        />
      )}
    </div>
  )
}
