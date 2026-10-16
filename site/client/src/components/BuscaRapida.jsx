import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from './ui'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'
import { nomeMapa, dataHora } from '../lib/format.js'

// Busca rápida (Ctrl+K / ⌘K): pula direto pra uma tela, um jogador ou uma partida
// recente. As telas vêm da mesma lista do menu (passada pelo Shell); jogadores e
// partidas são buscados uma vez quando a busca abre.

function normalizar(texto) {
  return String(texto ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filtrarResultados({ telas, jogadores, partidas }, termo) {
  const t = normalizar(termo).trim()
  const casa = (texto) => !t || normalizar(texto).includes(t)
  return [
    ...telas.filter((x) => casa(x.label) || casa(x.grupo)).map((x) => ({ tipo: 'Telas', id: `tela:${x.to}`, rotulo: x.label, detalhe: x.grupo, para: x.to })),
    ...jogadores.filter((j) => t && casa(j.nick)).slice(0, 6).map((j) => ({ tipo: 'Jogadores', id: `jogador:${j.steamId}`, rotulo: j.nick, detalhe: 'perfil', para: `/jogador/${j.steamId}` })),
    ...partidas.filter((m) => t && (casa(nomeMapa(m.map)) || casa(m.map))).slice(0, 6).map((m) => ({ tipo: 'Partidas', id: `partida:${m.id}`, rotulo: nomeMapa(m.map), detalhe: dataHora(m.playedAt) ?? '', para: `/partida/${m.id}` })),
  ]
}

function PainelBusca({ telas, onFechar }) {
  const { visivel, iniciarSaida } = useTransicaoModal()
  const fechar = () => iniciarSaida(onFechar)
  const navegar = useNavigate()
  const [termo, setTermo] = useState('')
  const [ativo, setAtivo] = useState(0)
  const [jogadores, setJogadores] = useState([])
  const [partidas, setPartidas] = useState([])
  const entradaRef = useRef(null)

  useEffect(() => {
    entradaRef.current?.focus()
    fetch('/api/players').then((r) => (r.ok ? r.json() : [])).then((d) => setJogadores(Array.isArray(d) ? d : [])).catch(() => {})
    fetch('/api/matches?limit=30').then((r) => (r.ok ? r.json() : [])).then((d) => setPartidas(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const resultados = useMemo(() => filtrarResultados({ telas, jogadores, partidas }, termo), [telas, jogadores, partidas, termo])

  function ir(r) {
    if (!r) return
    navegar(r.para)
    fechar()
  }

  function aoTeclar(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => Math.min(i + 1, resultados.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)) }
    if (e.key === 'Enter') { e.preventDefault(); ir(resultados[ativo]) }
  }

  let grupoAnterior = null
  return (
    <Modal visivel={visivel} onFechar={fechar} tamanho="sm" corpoClassName="!p-0" rotuloFechar="Fechar busca">
      <div className="border-b border-borda px-4 py-3">
        <label htmlFor="busca-rapida" className="sr-only">Buscar tela, jogador ou partida</label>
        <input
          id="busca-rapida"
          ref={entradaRef}
          value={termo}
          onChange={(e) => { setTermo(e.target.value); setAtivo(0) }}
          onKeyDown={aoTeclar}
          placeholder="Buscar tela, jogador ou mapa…"
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls="busca-rapida-lista"
          aria-activedescendant={resultados[ativo] ? `br-${ativo}` : undefined}
          className="w-full bg-transparent text-[15px] text-texto placeholder:text-texto-fraco/70 focus:outline-none"
        />
      </div>
      <ul id="busca-rapida-lista" role="listbox" className="max-h-80 overflow-y-auto p-1">
        {resultados.length === 0 && <li className="px-3 py-6 text-center text-sm text-texto-fraco">Nada encontrado.</li>}
        {resultados.map((r, i) => {
          const cabecalho = r.tipo !== grupoAnterior ? r.tipo : null
          grupoAnterior = r.tipo
          return (
            <li key={r.id} role="presentation">
              {cabecalho && <div className="px-3 pb-1 pt-2 text-xs font-medium text-texto-fraco">{cabecalho}</div>}
              <div
                id={`br-${i}`}
                role="option"
                aria-selected={i === ativo}
                onMouseEnter={() => setAtivo(i)}
                onClick={() => ir(r)}
                className={`flex cursor-pointer items-center justify-between gap-3 rounded-[var(--radius-pequeno)] px-3 py-2 text-sm ${i === ativo ? 'bg-superficie-topo text-texto' : 'text-texto-fraco'}`}
              >
                <span className="truncate">{r.rotulo}</span>
                <span className="shrink-0 text-xs text-texto-fraco">{r.detalhe}</span>
              </div>
            </li>
          )
        })}
      </ul>
      <div className="flex gap-4 border-t border-borda px-4 py-2 text-[11px] text-texto-fraco">
        <span>↑↓ navegar</span><span>Enter abrir</span><span>Esc fechar</span>
      </div>
    </Modal>
  )
}

// Botão do menu + atalho global. `telas`: [{ to, label, grupo }].
export default function BuscaRapida({ telas, className = '' }) {
  const [aberta, setAberta] = useState(false)

  useEffect(() => {
    function atalho(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setAberta(true)
      }
    }
    window.addEventListener('keydown', atalho)
    return () => window.removeEventListener('keydown', atalho)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        className={`flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-pequeno)] border border-borda bg-superficie px-3 text-[13px] text-texto-fraco transition-colors duration-150 hover:border-borda-forte hover:text-texto ${className}`}
      >
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          Buscar
        </span>
        <kbd className="rounded border border-borda-forte px-1.5 font-mono text-[11px]">Ctrl K</kbd>
      </button>
      {aberta && <PainelBusca telas={telas} onFechar={() => setAberta(false)} />}
    </>
  )
}
