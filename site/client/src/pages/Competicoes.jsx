// site/client/src/pages/Competicoes.jsx
import { useEffect, useState } from 'react'
import { SectionHeader, Card, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import { contadorRegressivo, dataHora } from '../lib/format.js'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'
import CardClipeCompeticao from '../components/CardClipeCompeticao.jsx'

function Leaderboard({ leaderboard, minimoParaRankear, competicaoId, clipeAberto, onAbrirClipe, viewerSteamId }) {
  const qualificados = leaderboard.filter((l) => l.qualificado)
  const naoQualificados = leaderboard.filter((l) => !l.qualificado)
  const [expandido, setExpandido] = useState(null)
  // Cache por steamId: recolher e expandir de novo não refaz a busca. Erro NÃO
  // entra nesse cache (ver erroPorJogador abaixo) — só sucesso é reaproveitável,
  // senão uma falha de rede vira permanente até recarregar a página.
  const [clipesPorJogador, setClipesPorJogador] = useState({})
  const [erroPorJogador, setErroPorJogador] = useState({})

  function alternar(steamId) {
    if (expandido === steamId) {
      setExpandido(null)
      return
    }
    setExpandido(steamId)
    if (clipesPorJogador[steamId]) return
    setErroPorJogador((atual) => ({ ...atual, [steamId]: null }))
    // Busca só na primeira expansão — carregar os Clipes de todos só pra mostrar
    // o ranking seria desperdício.
    fetch(`/api/competicoes/${competicaoId}/jogador/${steamId}/clipes`)
      .then((res) => {
        if (!res.ok) {
          setErroPorJogador((atual) => ({ ...atual, [steamId]: 'Falha ao carregar os clipes desse jogador. Tente novamente.' }))
          return
        }
        return res.json().then((body) => setClipesPorJogador((atual) => ({ ...atual, [steamId]: body.clipes ?? [] })))
      })
      .catch(() => {
        setErroPorJogador((atual) => ({ ...atual, [steamId]: 'Falha ao carregar os clipes desse jogador. Tente novamente.' }))
      })
  }

  return (
    <div className="space-y-3">
      <div className="panel-cut border border-borda">
        {qualificados.map((l, i) => (
          <div key={l.steamId} className="border-b border-borda last:border-b-0">
            <button
              type="button"
              onClick={() => alternar(l.steamId)}
              aria-expanded={expandido === l.steamId}
              aria-controls={`leaderboard-painel-${l.steamId}`}
              className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-superficie-alta"
            >
              <span className="font-mono text-texto-fraco">{i + 1}º</span>
              {l.avatarUrl && <img src={l.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
              <span className="flex-1 font-mono text-texto">{l.nick}</span>
              <span className="font-display font-bold text-destaque tabular-nums">{l.total}</span>
            </button>

            {expandido === l.steamId && (
              <div id={`leaderboard-painel-${l.steamId}`} className="px-3 pb-3">
                {erroPorJogador[l.steamId] ? (
                  <p className="font-mono text-xs text-perigo">{erroPorJogador[l.steamId]}</p>
                ) : clipesPorJogador[l.steamId] === undefined ? (
                  <p className="font-mono text-xs text-texto-fraco">Carregando…</p>
                ) : clipesPorJogador[l.steamId].length === 0 ? (
                  <p className="font-mono text-xs text-texto-fraco">Nenhum clipe pra mostrar.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {clipesPorJogador[l.steamId].map((c) => (
                      <CardClipeCompeticao
                        key={c.id}
                        clipe={c}
                        chave={`lb:${c.id}`}
                        aberto={clipeAberto === `lb:${c.id}`}
                        onAbrir={onAbrirClipe}
                        viewerSteamId={viewerSteamId}
                        location="leaderboardCompeticao"
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {naoQualificados.length > 0 && (
        <p className="font-mono text-xs text-texto-fraco">
          Ainda não qualificado (mínimo {minimoParaRankear} clipes): {naoQualificados.map((l) => l.nick).join(', ')}
        </p>
      )}
    </div>
  )
}

function CardCompeticao({ comp, viewerSteamId, onTradelinkEnviado }) {
  const [tradelink, setTradelink] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [seletorAberto, setSeletorAberto] = useState(false)
  // Um player tocando por vez em toda a tela: o estado mora aqui, acima do feed e
  // do leaderboard, senão dois vídeos tocariam com áudio ao mesmo tempo.
  const [clipeAberto, setClipeAberto] = useState(null)
  const [agora, setAgora] = useState(Date.now())
  useEffect(() => {
    const intervalo = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(intervalo)
  }, [])
  const encerrada = new Date(comp.dataFim).getTime() < agora
  const naoComecou = new Date(comp.dataInicio).getTime() > agora
  const alvoContador = naoComecou ? comp.dataInicio : comp.dataFim
  const souVencedor = comp.vencedorSteamId === viewerSteamId

  async function enviarTradelink(e) {
    e.preventDefault()
    setEnviando(true)
    const res = await fetch(`/api/competicoes/${comp.id}/tradelink`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tradelink }),
    }).catch(() => null)
    setEnviando(false)
    if (res?.ok) onTradelinkEnviado()
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-xl font-bold text-texto">{comp.nome}</h2>
          {naoComecou && <Badge tom="neutro">EM BREVE</Badge>}
        </div>
        {comp.premioDescricao && <Badge tom="destaque">{comp.premioDescricao}</Badge>}
      </div>
      {(comp.premioImagemUrl || comp.premioMercadoUrl) && (
        <div className="mt-3 flex items-center gap-3">
          {comp.premioImagemUrl && (
            <img
              src={comp.premioImagemUrl}
              alt={comp.premioDescricao || 'Prêmio da competição'}
              className="panel-cut-sm h-16 w-16 border border-borda object-cover"
            />
          )}
          {comp.premioMercadoUrl && (
            <a
              href={comp.premioMercadoUrl}
              target="_blank"
              rel="noreferrer"
              className="panel-cut-sm border border-borda px-2 py-1 font-mono text-xs uppercase tracking-wide text-texto-fraco hover:border-destaque/50 hover:text-destaque"
            >
              Ver no mercado ↗
            </a>
          )}
        </div>
      )}
      {comp.descricao && <p className="mt-2 font-mono text-sm text-texto-fraco">{comp.descricao}</p>}
      {naoComecou && (
        <p className="mt-2 font-mono text-sm text-destaque">Começa em {dataHora(comp.dataInicio)}.</p>
      )}
      {!encerrada && (
        <p className="panel-cut-sm mt-3 inline-flex border border-borda bg-fundo px-2 py-1 font-mono text-xs tabular-nums text-texto" role="status" aria-live="polite">
          <span className="mr-2 text-texto-fraco">{naoComecou ? 'INÍCIO EM' : 'TERMINA EM'}</span>
          {contadorRegressivo(alvoContador, agora)}
        </p>
      )}
      <div className="mt-3">
        <h3 className="mb-1 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Regras</h3>
        <ul className="space-y-1 font-mono text-xs text-texto-fraco">
          <li>· Período: {dataHora(comp.dataInicio)} até {dataHora(comp.dataFim)}.</li>
          <li className="text-texto">· Só valem clipes de partidas jogadas dentro do período — partidas de antes não contam.</li>
          <li>· Até {comp.limiteDiario} clipes por dia, {comp.limiteTotal} no total.</li>
          <li>· Mínimo de {comp.minimoParaRankear} clipes enviados pra entrar no ranking.</li>
          <li>· Pontuação: kills (curva não-linear) + headshots + clutch + variedade de armas.</li>
        </ul>
      </div>

      {!encerrada && !naoComecou && (
        <button
          onClick={() => setSeletorAberto(true)}
          className="panel-cut-sm mt-3 min-h-10 border border-destaque bg-destaque/10 px-3 font-mono text-xs uppercase text-destaque hover:bg-destaque/20 lg:min-h-0"
        >
          Enviar clipe
        </button>
      )}
      {seletorAberto && (
        <SeletorClipesCompeticao
          competicaoId={comp.id}
          onFechar={() => setSeletorAberto(false)}
          onEnviado={onTradelinkEnviado}
        />
      )}

      {souVencedor && encerrada && comp.vencedorConfirmado && !comp.tradelinkVencedor && (
        <form onSubmit={enviarTradelink} className="mt-4 panel-cut-sm border border-destaque bg-destaque/10 p-3">
          <p className="font-mono text-sm text-destaque">🏆 Você venceu! Informe seu tradelink pra receber o prêmio.</p>
          <div className="mt-2 flex gap-2">
            <input
              value={tradelink}
              onChange={(e) => setTradelink(e.target.value)}
              placeholder="Seu tradelink da Steam"
              className="min-h-10 flex-1 border border-borda bg-superficie px-2 font-mono text-xs text-texto"
            />
            <button disabled={enviando} className="panel-cut-sm border border-destaque px-3 font-mono text-xs uppercase text-destaque">
              {enviando ? '…' : 'Enviar'}
            </button>
          </div>
        </form>
      )}
      {souVencedor && encerrada && !comp.vencedorConfirmado && !comp.tradelinkVencedor && (
        <p className="mt-4 font-mono text-sm text-texto-fraco">
          Você está na liderança — aguardando confirmação do admin antes de liberar o envio do tradelink.
        </p>
      )}
      {souVencedor && comp.tradelinkVencedor && (
        <p className="mt-4 font-mono text-sm text-sucesso">Tradelink enviado — aguarde o contato pro envio do prêmio.</p>
      )}

      {/* Numa agendada o leaderboard é sempre vazio — título sobre caixa vazia só
          deixa o card "em breve" oco; a seção aparece junto com a competição. */}
      {!naoComecou && (
        <div className="mt-4">
          <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Leaderboard</h3>
          <Leaderboard
            leaderboard={comp.leaderboard}
            minimoParaRankear={comp.minimoParaRankear}
            competicaoId={comp.id}
            clipeAberto={clipeAberto}
            onAbrirClipe={setClipeAberto}
            viewerSteamId={viewerSteamId}
          />
        </div>
      )}

      {comp.clipesRecentes?.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Enviados recentemente</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {comp.clipesRecentes.map((c) => (
              <CardClipeCompeticao
                key={c.id}
                clipe={c}
                autor
                chave={`feed:${c.id}`}
                aberto={clipeAberto === `feed:${c.id}`}
                onAbrir={setClipeAberto}
                viewerSteamId={viewerSteamId}
                location="feedCompeticao"
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Competicoes() {
  const { jogador } = useAuth()
  const [dados, setDados] = useState(null)

  function carregar() {
    fetch('/api/competicoes')
      .then((res) => (res.ok ? res.json() : { ativa: null, agendadas: [], encerradas: [] }))
      .then(setDados)
      .catch(() => setDados({ ativa: null, agendadas: [], encerradas: [] }))
  }

  useEffect(carregar, [])

  if (dados === null) return <p className="font-mono text-sm text-texto-fraco">Carregando…</p>

  return (
    <div className="space-y-6">
      <SectionHeader titulo="Competições" />
      {!dados.ativa && (dados.agendadas ?? []).length === 0 && dados.encerradas.length === 0 && (
        <p className="font-mono text-sm text-texto-fraco">Nenhuma competição no momento.</p>
      )}
      {dados.ativa && <CardCompeticao comp={dados.ativa} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />}
      {(dados.agendadas ?? []).map((comp) => (
        <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
      ))}
      {dados.encerradas.map((comp) => (
        <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
      ))}
    </div>
  )
}
