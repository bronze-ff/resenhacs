// site/client/src/components/SeletorClipesCompeticao.jsx
import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext.jsx'
import { useTransicaoModal } from '../lib/useTransicaoModal.js'
import CardClipeCompeticao from './CardClipeCompeticao.jsx'
import { Button, EstadoErro, EstadoVazio, Modal, Skeleton } from './ui'

// Contador de envio: número grande + barra de uso; vira perigo quando estoura.
function Medidor({ rotulo, usado, limite }) {
  const cheio = usado >= limite
  const pct = Math.min(100, limite > 0 ? (usado / limite) * 100 : 0)
  return (
    <div className="min-w-0 flex-1">
      <div className="rotulo">{rotulo}</div>
      <div className="mt-1 flex items-baseline gap-1 font-display font-semibold tabular-nums">
        <span className={`text-2xl leading-none ${cheio ? 'text-perigo' : 'text-texto'}`}>{usado}</span>
        <span className="text-sm text-texto-fraco">/ {limite}</span>
      </div>
      <div className="mt-1.5 h-1 w-full bg-borda" aria-hidden="true">
        <div className={`h-full ${cheio ? 'bg-perigo' : 'bg-destaque'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

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
  const { visivel, iniciarSaida } = useTransicaoModal()
  const [clipeAberto, setClipeAberto] = useState(null)

  const motivoBloqueio = !limites
    ? null
    : limites.hoje >= limites.limiteDiario
      ? 'limite diário atingido'
      : limites.total >= limites.limiteTotal
        ? 'limite total atingido'
        : null

  const fechar = () => iniciarSaida(onFechar)

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

  // ui/Modal já vai por portal pro body (o panel-cut do Card de Competições é um
  // clip-path e recortava o position:fixed), trava o scroll e fecha no Esc.
  return (
    <Modal
      visivel={visivel}
      onFechar={fechar}
      titulo="Selecionar clipes pra enviar"
      subtitulo="Só aparecem clipes gerados de partidas dentro do período"
      tamanho="lg"
    >
      <div className="flex flex-col gap-4">
        {limites && (
          <div className="panel-cut-sm border border-borda bg-fundo/50 p-3">
            <div className="flex gap-4">
              <Medidor rotulo="Hoje" usado={limites.hoje} limite={limites.limiteDiario} />
              <Medidor rotulo="Total" usado={limites.total} limite={limites.limiteTotal} />
            </div>
            <p className="mt-2 font-mono text-xs text-texto-fraco">
              {limites.hoje} de {limites.limiteDiario} enviados hoje · {limites.total} de {limites.limiteTotal} no total · mínimo {limites.minimoParaRankear} pra rankear
            </p>
          </div>
        )}
        {erro && <EstadoErro mensagem={erro} />}
        {clipes === null ? (
          <div role="status" aria-label="Carregando clipes" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Skeleton className="panel-cut-sm aspect-[4/3] w-full" />
            <Skeleton className="panel-cut-sm aspect-[4/3] w-full" />
          </div>
        ) : clipes.length === 0 ? (
          <EstadoVazio
            titulo="Sem clipes elegíveis"
            descricao="Nenhum clipe elegível ainda — gere um clipe de uma partida jogada dentro do período da competição."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {clipes.map((c) => (
              <CardClipeCompeticao
                key={c.id}
                clipe={c}
                aberto={clipeAberto === c.id}
                onAbrir={setClipeAberto}
                viewerSteamId={jogador?.steamId}
                location="selecaoCompeticao"
                acao={
                  <Button
                    variante={c.jaEnviado || motivoBloqueio ? 'secundario' : 'primario'}
                    tamanho="sm"
                    larguraTotal
                    className="mt-3"
                    onClick={() => enviar(c.allstarClipId)}
                    disabled={c.jaEnviado || enviando === c.allstarClipId || Boolean(motivoBloqueio)}
                  >
                    {c.jaEnviado ? 'já enviado' : motivoBloqueio ? motivoBloqueio : enviando === c.allstarClipId ? '…' : 'enviar'}
                  </Button>
                }
              />
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
