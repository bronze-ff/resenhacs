// site/client/src/pages/Competicoes.jsx
import { useEffect, useState } from 'react'
import { Badge, Button, CabecalhoPagina, Card, EstadoErro, EstadoVazio, Input, SectionHeader, Skeleton, classesBotao } from '../components/ui'
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
        return res.json().then((body) => {
          setClipesPorJogador((atual) => ({ ...atual, [steamId]: body.clipes ?? [] }))
          setErroPorJogador((atual) => ({ ...atual, [steamId]: null }))
        })
      })
      .catch(() => {
        setErroPorJogador((atual) => ({ ...atual, [steamId]: 'Falha ao carregar os clipes desse jogador. Tente novamente.' }))
      })
  }

  const lider = qualificados[0]?.total || 0
  const corPosicao = ['text-ouro', 'text-prata', 'text-bronze']

  return (
    <div className="space-y-3">
      {qualificados.length === 0 && (
        <p className="text-sm text-texto-fraco">Ninguém no ranking ainda — mínimo de {minimoParaRankear} clipes pra entrar.</p>
      )}
      {qualificados.length > 0 && (
        <ol className="panel-cut-sm border border-borda bg-fundo/40">
          {qualificados.map((l, i) => (
            <li key={l.steamId} className="border-b border-borda last:border-b-0">
              <button
                type="button"
                onClick={() => alternar(l.steamId)}
                aria-expanded={expandido === l.steamId}
                aria-controls={`leaderboard-painel-${l.steamId}`}
                className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors duration-200 hover:bg-superficie-alta ${expandido === l.steamId ? 'bg-superficie-alta' : ''}`}
              >
                <span className={`w-8 shrink-0 font-display text-lg font-semibold tabular-nums ${corPosicao[i] ?? 'text-texto-fraco'}`}>{i + 1}º</span>
                {l.avatarUrl && <img src={l.avatarUrl} alt="" className="h-7 w-7 shrink-0 border border-borda object-cover" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm text-texto">{l.nick}</span>
                  <span className="mt-1 block h-1 w-full max-w-48 bg-borda" aria-hidden="true">
                    <span className="block h-full bg-destaque/70" style={{ width: `${lider > 0 ? Math.round((l.total / lider) * 100) : 0}%` }} />
                  </span>
                </span>
                <span className="font-display text-xl font-semibold tabular-nums text-texto">{l.total}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`h-4 w-4 shrink-0 text-texto-fraco transition-transform duration-200 ${expandido === l.steamId ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>

              {expandido === l.steamId && (
                <div id={`leaderboard-painel-${l.steamId}`} className="border-t border-borda bg-superficie/60 p-3">
                  {erroPorJogador[l.steamId] ? (
                    <EstadoErro mensagem={erroPorJogador[l.steamId]} />
                  ) : clipesPorJogador[l.steamId] === undefined ? (
                    <div aria-hidden="true" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Skeleton className="panel-cut-sm h-48 w-full" />
                      <Skeleton className="panel-cut-sm hidden h-48 w-full sm:block" />
                    </div>
                  ) : clipesPorJogador[l.steamId].length === 0 ? (
                    <p className="text-sm text-texto-fraco">Nenhum clipe pra mostrar.</p>
                  ) : (
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
            </li>
          ))}
        </ol>
      )}
      {naoQualificados.length > 0 && (
        <p className="font-mono text-xs text-texto-fraco">
          Ainda não qualificado (mínimo {minimoParaRankear} clipes): {naoQualificados.map((l) => l.nick).join(', ')}
        </p>
      )}
    </div>
  )
}

function StatusCompeticao({ encerrada, naoComecou }) {
  if (naoComecou) return <Badge tom="neutro">EM BREVE</Badge>
  if (encerrada) return <Badge tom="neutro">Encerrada</Badge>
  return (
    <Badge tom="sucesso" className="gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-sucesso" aria-hidden="true" />
      Ao vivo
    </Badge>
  )
}

function TituloSecao({ children }) {
  return <h3 className="rotulo mb-3">{children}</h3>
}

function CardCompeticao({ comp, viewerSteamId, onTradelinkEnviado, destaque = false }) {
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

  const emAndamento = !encerrada && !naoComecou
  const temPremio = comp.premioImagemUrl || comp.premioMercadoUrl || comp.premioDescricao

  return (
    <Card className="overflow-hidden">
      {/* Topo: identidade + prazo à esquerda, prêmio à direita (embaixo no mobile). */}
      <div className={`grid ${temPremio ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]' : ''}`}>
        <div className="flex flex-col gap-5 p-4 lg:p-6">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <StatusCompeticao encerrada={encerrada} naoComecou={naoComecou} />
            </div>
            <h2 className={`font-display font-semibold leading-none text-texto ${destaque ? 'text-3xl sm:text-4xl' : 'text-2xl'}`}>
              {comp.nome}
            </h2>
            {comp.descricao && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-texto-fraco">{comp.descricao}</p>}
            {naoComecou && (
              <p className="mt-2 text-sm text-destaque">Começa em {dataHora(comp.dataInicio)}.</p>
            )}
          </div>

          {!encerrada && (
            <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
              <p className="flex flex-col gap-1" role="status" aria-live="polite">
                <span className="rotulo">{naoComecou ? 'INÍCIO EM' : 'TERMINA EM'}</span>
                <span className={`font-display font-semibold leading-none tabular-nums text-texto ${destaque ? 'text-4xl sm:text-5xl' : 'text-3xl'}`}>
                  {contadorRegressivo(alvoContador, agora)}
                </span>
              </p>
              {emAndamento && (
                <Button variante="primario" tamanho="lg" onClick={() => setSeletorAberto(true)}>
                  Enviar clipe
                </Button>
              )}
            </div>
          )}
          {encerrada && (
            <p className="font-mono text-xs text-texto-fraco">Encerrou em {dataHora(comp.dataFim)}</p>
          )}
        </div>

        {temPremio && (
          <aside className="flex items-center gap-4 border-t border-borda bg-fundo/50 p-4 lg:flex-col lg:items-stretch lg:justify-center lg:border-l lg:border-t-0 lg:p-6">
            {comp.premioImagemUrl && (
              <div className="relative flex h-24 w-32 shrink-0 items-center justify-center lg:h-40 lg:w-full">
                <img
                  src={comp.premioImagemUrl}
                  alt={comp.premioDescricao || 'Prêmio da competição'}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            )}
            <div className="min-w-0 lg:text-center">
              <div className="rotulo">Prêmio</div>
              {comp.premioDescricao && (
                <p className="mt-1 font-display text-lg font-semibold leading-tight text-texto">{comp.premioDescricao}</p>
              )}
              {comp.premioMercadoUrl && (
                <a
                  href={comp.premioMercadoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={classesBotao({ variante: 'secundario', tamanho: 'sm', className: 'mt-3' })}
                >
                  Ver no mercado ↗
                </a>
              )}
            </div>
          </aside>
        )}
      </div>

      {seletorAberto && (
        <SeletorClipesCompeticao
          competicaoId={comp.id}
          onFechar={() => setSeletorAberto(false)}
          onEnviado={onTradelinkEnviado}
        />
      )}

      {souVencedor && (comp.tradelinkVencedor || encerrada) && (
        <div className="border-t border-borda px-4 py-4 lg:px-6">
          {encerrada && comp.vencedorConfirmado && !comp.tradelinkVencedor && (
            <form onSubmit={enviarTradelink} className="panel-cut-sm border border-ouro/40 bg-ouro/5 p-4">
              <p className="font-display text-lg font-semibold text-ouro">🏆 Você venceu! Informe seu tradelink pra receber o prêmio.</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Input
                  value={tradelink}
                  onChange={(e) => setTradelink(e.target.value)}
                  placeholder="Seu tradelink da Steam"
                  campoClassName="flex-1"
                  className="font-mono"
                />
                <Button type="submit" variante="primario" carregando={enviando}>Enviar</Button>
              </div>
            </form>
          )}
          {encerrada && !comp.vencedorConfirmado && !comp.tradelinkVencedor && (
            <p className="text-sm text-texto-fraco">
              Você está na liderança — aguardando confirmação do admin antes de liberar o envio do tradelink.
            </p>
          )}
          {comp.tradelinkVencedor && (
            <p className="flex items-center gap-2 text-sm text-sucesso">
              <span aria-hidden="true">✓</span> Tradelink enviado — aguarde o contato pro envio do prêmio.
            </p>
          )}
        </div>
      )}

      <div className={`grid gap-6 border-t border-borda p-4 lg:p-6 ${!naoComecou ? 'lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]' : ''}`}>
        <div>
          <TituloSecao>Regras</TituloSecao>
          <ul className="space-y-2 text-sm leading-relaxed text-texto-fraco">
            <li>Período: <span className="font-mono text-xs text-texto">{dataHora(comp.dataInicio)}</span> até <span className="font-mono text-xs text-texto">{dataHora(comp.dataFim)}</span>.</li>
            <li className="text-texto">Só valem clipes de partidas jogadas dentro do período — partidas de antes não contam.</li>
            <li>Até <strong className="font-semibold text-texto">{comp.limiteDiario}</strong> clipes por dia, <strong className="font-semibold text-texto">{comp.limiteTotal}</strong> no total.</li>
            <li>Mínimo de <strong className="font-semibold text-texto">{comp.minimoParaRankear}</strong> clipes enviados pra entrar no ranking.</li>
            <li>Pontuação: kills (curva não-linear) + headshots + clutch + variedade de armas.</li>
          </ul>
        </div>

        {/* Numa agendada o leaderboard é sempre vazio — título sobre caixa vazia só
            deixa o card "em breve" oco; a seção aparece junto com a competição. */}
        {!naoComecou && (
          <div className="min-w-0">
            <TituloSecao>Leaderboard</TituloSecao>
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
      </div>

      {comp.clipesRecentes?.length > 0 && (
        <div className="border-t border-borda p-4 lg:p-6">
          <TituloSecao>Enviados recentemente</TituloSecao>
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

  const cabecalho = (
    <CabecalhoPagina
      eyebrow="Clipes valendo prêmio"
      titulo="Competições"
      descricao="Envie seus melhores clipes do período e dispute o prêmio."
    />
  )

  if (dados === null) {
    return (
      <div>
        {cabecalho}
        <div role="status" aria-label="Carregando competições" className="space-y-3">
          <Skeleton className="panel-cut h-64 w-full" />
          <Skeleton className="panel-cut h-40 w-full" />
        </div>
      </div>
    )
  }

  const agendadas = dados.agendadas ?? []

  return (
    <div className="space-y-8">
      {cabecalho}
      {!dados.ativa && agendadas.length === 0 && dados.encerradas.length === 0 && (
        <EstadoVazio titulo="Nenhuma competição no momento." descricao="Quando o admin abrir a próxima, ela aparece aqui." />
      )}
      {dados.ativa && <CardCompeticao destaque comp={dados.ativa} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />}
      {agendadas.length > 0 && (
        <section className="space-y-4">
          <SectionHeader titulo="Agendadas" />
          {agendadas.map((comp) => (
            <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
          ))}
        </section>
      )}
      {dados.encerradas.length > 0 && (
        <section className="space-y-4">
          <SectionHeader titulo="Encerradas" />
          {dados.encerradas.map((comp) => (
            <CardCompeticao key={comp.id} comp={comp} viewerSteamId={jogador?.steamId} onTradelinkEnviado={carregar} />
          ))}
        </section>
      )}
    </div>
  )
}
