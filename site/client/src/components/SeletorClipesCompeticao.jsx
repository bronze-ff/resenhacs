// site/client/src/components/SeletorClipesCompeticao.jsx
import { useEffect, useState } from 'react'
import { nomeMapa } from '../lib/format.js'

// Tela de seleção compartilhada — acionada tanto pelo botão "Enviar clipe" da aba
// Competições quanto pelo atalho "Enviar pra competição →" dentro de Partida > Clipes.
// Lista só os clipes elegíveis (já gerados, Processed, partida dentro do período da
// competição — GET /api/competicoes/:id/elegiveis já filtra isso no servidor).
export default function SeletorClipesCompeticao({ competicaoId, onFechar, onEnviado }) {
  const [clipes, setClipes] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [erro, setErro] = useState(null)
  const [visivel, setVisivel] = useState(false)

  useEffect(() => { setVisivel(true) }, [])

  function fechar() {
    setVisivel(false)
    setTimeout(onFechar, 200)
  }

  function carregar() {
    fetch(`/api/competicoes/${competicaoId}/elegiveis`)
      .then((res) => (res.ok ? res.json() : []))
      .then(setClipes)
      .catch(() => setClipes([]))
  }

  useEffect(carregar, [competicaoId])

  async function enviar(allstarClipId) {
    setEnviando(allstarClipId)
    setErro(null)
    const res = await fetch(`/api/competicoes/${competicaoId}/submissoes`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allstarClipId }),
    }).catch(() => null)
    setEnviando(null)
    if (res?.ok) { carregar(); onEnviado() } else {
      const body = await res?.json().catch(() => ({}))
      setErro(body?.erro ?? 'Falha ao enviar o clipe.')
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4 transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={fechar}
    >
      <div className="panel-cut max-h-[80vh] w-full max-w-3xl overflow-y-auto border border-borda bg-superficie p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-texto">Selecionar clipes pra enviar</h2>
          <button onClick={fechar} className="font-mono text-xs uppercase text-texto-fraco hover:text-texto">fechar</button>
        </div>
        {erro && <p className="mt-2 font-mono text-xs text-perigo">{erro}</p>}
        {clipes === null ? (
          <p className="mt-4 font-mono text-sm text-texto-fraco">Carregando…</p>
        ) : clipes.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-texto-fraco">Nenhum clipe elegível ainda — gere um clipe de uma partida jogada dentro do período da competição.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clipes.map((c) => (
              <div key={c.allstarClipId} className="panel-cut-sm border border-borda p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-texto">{nomeMapa(c.map)} · round {c.roundNumber}</span>
                  <span className="font-display font-bold text-destaque">{c.pontuacao.total}</span>
                </div>
                <button
                  onClick={() => enviar(c.allstarClipId)}
                  disabled={c.jaEnviado || enviando === c.allstarClipId}
                  className="panel-cut-sm mt-2 min-h-10 w-full border border-borda px-3 font-mono text-xs uppercase text-texto-fraco hover:border-destaque/50 hover:text-destaque disabled:opacity-50 lg:min-h-0"
                >
                  {c.jaEnviado ? 'já enviado' : enviando === c.allstarClipId ? '…' : 'enviar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
