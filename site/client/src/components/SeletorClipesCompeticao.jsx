// site/client/src/components/SeletorClipesCompeticao.jsx
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { nomeMapa, dataHora } from '../lib/format.js'
import { PlayerClipe, SnapshotPlaceholder, nomeDoKind } from './ui/PlayerClipe.jsx'

// Breakdown como TEXTO, não tooltip: a decisão "qual clipe vale mais" é tomada
// aqui, e no celular não existe hover. Só entram os componentes que somaram.
function partesDaPontuacao(p) {
  const partes = []
  if (p.kills > 0) partes.push(`${p.kills} kills ${p.pontosKills}`)
  if (p.headshots > 0) partes.push(`${p.headshots} hs ${p.pontosHeadshots}`)
  if (p.armas > 0) partes.push(`${p.armas} armas ${p.pontosArmas}`)
  if (p.clutch) partes.push(`clutch ${p.clutch} ${p.pontosClutch}`)
  return partes
}

// Sem Highlight correspondente (kind nulo) o rótulo cai pro número de kills, que
// é mais informativo que o "MOMENTO" genérico quando o Jogador está escolhendo.
function rotuloDaJogada(clipe) {
  if (clipe.kind) return nomeDoKind(clipe.kind)
  const kills = clipe.pontuacao?.kills
  return kills > 0 ? `${kills} KILLS` : 'MOMENTO'
}

// Tela de seleção compartilhada — acionada tanto pelo botão "Enviar clipe" da aba
// Competições quanto pelo atalho "Enviar pra competição →" dentro de Partida > Clipes.
// Lista só os clipes elegíveis (já gerados, Processed, partida dentro do período da
// competição — GET /api/competicoes/:id/elegiveis já filtra isso no servidor).
export default function SeletorClipesCompeticao({ competicaoId, onFechar, onEnviado }) {
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
      .then((res) => (res.ok ? res.json() : { clipes: [], limites: null }))
      .then((body) => { setClipes(body.clipes ?? []); setLimites(body.limites ?? null) })
      .catch(() => { setClipes([]); setLimites(null) })
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
              <div key={c.allstarClipId} className="panel-cut-sm border border-borda p-3">
                {clipeAberto === c.allstarClipId ? (
                  <PlayerClipe
                    clipUrl={c.clipUrl}
                    titulo={`${nomeMapa(c.map)} round ${c.roundNumber}`}
                    location="selecaoCompeticao"
                  />
                ) : c.clipSnapshotUrl ? (
                  <button
                    type="button"
                    onClick={() => setClipeAberto(c.allstarClipId)}
                    aria-label={`Assistir clipe de ${nomeMapa(c.map)} round ${c.roundNumber}`}
                    className="relative mt-3 block aspect-video w-full border border-borda"
                  >
                    <img src={c.clipSnapshotUrl} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 flex items-center justify-center bg-fundo/40 font-mono text-xs uppercase tracking-widest text-texto">
                      ▶ assistir
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setClipeAberto(c.allstarClipId)}
                    aria-label={`Assistir clipe de ${nomeMapa(c.map)} round ${c.roundNumber}`}
                    className="block w-full"
                  >
                    <SnapshotPlaceholder />
                  </button>
                )}

                <div className="mt-3 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="panel-cut-sm border border-destaque/40 bg-destaque/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-widest text-destaque">
                      {rotuloDaJogada(c)}
                    </span>
                    <p className="mt-1 font-mono text-xs text-texto-fraco">
                      {nomeMapa(c.map)} · {dataHora(c.playedAt)} · round {c.roundNumber}
                    </p>
                  </div>
                  <span className="font-display text-lg font-bold text-destaque">{c.pontuacao.total}</span>
                </div>

                {partesDaPontuacao(c.pontuacao).length > 0 && (
                  <p className="mt-1 font-mono text-[11px] text-texto-fraco">
                    {partesDaPontuacao(c.pontuacao).join(' · ')}
                  </p>
                )}

                <button
                  onClick={() => enviar(c.allstarClipId)}
                  disabled={c.jaEnviado || enviando === c.allstarClipId || Boolean(motivoBloqueio)}
                  className="panel-cut-sm mt-2 min-h-10 w-full border border-borda px-3 font-mono text-xs uppercase text-texto-fraco hover:border-destaque/50 hover:text-destaque disabled:opacity-50 lg:min-h-0"
                >
                  {c.jaEnviado ? 'já enviado' : motivoBloqueio ? motivoBloqueio : enviando === c.allstarClipId ? '…' : 'enviar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
