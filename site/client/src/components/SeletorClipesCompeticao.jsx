// site/client/src/components/SeletorClipesCompeticao.jsx
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import CardClipeCompeticao from './CardClipeCompeticao.jsx'

// Tela de seleção compartilhada — acionada tanto pelo botão "Enviar clipe" da aba
// Competições quanto pelo atalho "Enviar pra competição →" dentro de Partida > Clipes.
// Lista só os clipes elegíveis (já gerados, Processed, partida dentro do período da
// competição — GET /api/competicoes/:id/elegiveis já filtra isso no servidor).
export default function SeletorClipesCompeticao({ competicaoId, onFechar, onEnviado }) {
  const { jogador } = useAuth()
  const [clipes, setClipes] = useState(null)
  const [limites, setLimites] = useState(null)
  const [enviando, setEnviando] = useState(null)
  const [erro, setErro] = useState(null)
  const [visivel, setVisivel] = useState(false)
  const [clipeAberto, setClipeAberto] = useState(null)

  const motivoBloqueio = !limites
    ? null
    : limites.hoje >= limites.limiteDiario
      ? 'limite diário atingido'
      : limites.total >= limites.limiteTotal
        ? 'limite total atingido'
        : null

  useEffect(() => { setVisivel(true) }, [])

  function fechar() {
    setVisivel(false)
    setTimeout(onFechar, 200)
  }

  function carregar() {
    fetch(`/api/competicoes/${competicaoId}/elegiveis`)
      .then((res) => {
        if (!res.ok) {
          setErro('Falha ao carregar os clipes elegíveis. Tente novamente.')
          return { clipes: [], limites: null }
        }
        return res.json()
      })
      .then((body) => {
        // O card compartilhado exige `id`; /elegiveis devolve `allstarClipId` por
        // contrato anterior. Normaliza aqui, na fronteira, em vez de o card
        // aceitar duas chaves.
        setClipes((body.clipes ?? []).map((c) => ({ ...c, id: c.allstarClipId })))
        setLimites(body.limites ?? null)
      })
      .catch(() => {
        setErro('Falha ao carregar os clipes elegíveis. Tente novamente.')
        setClipes([]); setLimites(null)
      })
  }

  useEffect(carregar, [competicaoId])

  // O modal cobre a tela inteira: sem travar o scroll, rolar dentro dele leva a
  // página de trás junto; sem o Esc, a única saída é o clique no backdrop.
  useEffect(() => {
    function aoTeclar(e) { if (e.key === 'Escape') fechar() }
    document.addEventListener('keydown', aoTeclar)
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', aoTeclar)
      document.body.style.overflow = anterior
    }
  }, [])

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

  // Portal pro body de propósito: na aba Competições este seletor é montado dentro
  // de um <Card>, cuja classe panel-cut é um clip-path — e clip-path RECORTA os
  // descendentes, inclusive os position:fixed. Sem o portal o modal aparece
  // truncado na caixa do card. O portal imuniza qualquer ponto de montagem futuro.
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-fundo/80 p-4 transition-opacity duration-200 ${visivel ? 'opacity-100' : 'opacity-0'}`}
      onClick={fechar}
    >
      <div className="panel-cut max-h-[80vh] w-full max-w-3xl overflow-y-auto border border-borda bg-superficie p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-texto">Selecionar clipes pra enviar</h2>
          <button onClick={fechar} className="font-mono text-xs uppercase text-texto-fraco hover:text-texto">fechar</button>
        </div>
        {limites && (
          <p className="mt-1 font-mono text-xs text-texto-fraco">
            {limites.hoje} de {limites.limiteDiario} enviados hoje · {limites.total} de {limites.limiteTotal} no total · mínimo {limites.minimoParaRankear} pra rankear
          </p>
        )}
        {erro && <p className="mt-2 font-mono text-xs text-perigo">{erro}</p>}
        {clipes === null ? (
          <p className="mt-4 font-mono text-sm text-texto-fraco">Carregando…</p>
        ) : clipes.length === 0 ? (
          <p className="mt-4 font-mono text-sm text-texto-fraco">Nenhum clipe elegível ainda — gere um clipe de uma partida jogada dentro do período da competição.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clipes.map((c) => (
              <CardClipeCompeticao
                key={c.id}
                clipe={c}
                aberto={clipeAberto === c.id}
                onAbrir={setClipeAberto}
                viewerSteamId={jogador?.steamId}
                location="selecaoCompeticao"
                acao={
                  <button
                    onClick={() => enviar(c.allstarClipId)}
                    disabled={c.jaEnviado || enviando === c.allstarClipId || Boolean(motivoBloqueio)}
                    className="panel-cut-sm mt-2 min-h-10 w-full border border-borda px-3 font-mono text-xs uppercase text-texto-fraco hover:border-destaque/50 hover:text-destaque disabled:opacity-50 lg:min-h-0"
                  >
                    {c.jaEnviado ? 'já enviado' : motivoBloqueio ? motivoBloqueio : enviando === c.allstarClipId ? '…' : 'enviar'}
                  </button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
