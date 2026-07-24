// site/client/src/pages/Competicoes.jsx
import { useEffect, useState } from 'react'
import { SectionHeader, Card, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import { dataHora } from '../lib/format.js'
import SeletorClipesCompeticao from '../components/SeletorClipesCompeticao.jsx'

function Leaderboard({ leaderboard, minimoParaRankear }) {
  const qualificados = leaderboard.filter((l) => l.qualificado)
  const naoQualificados = leaderboard.filter((l) => !l.qualificado)
  return (
    <div className="space-y-3">
      <div className="panel-cut border border-borda">
        {qualificados.map((l, i) => (
          <div key={l.steamId} className="flex items-center gap-3 border-b border-borda px-3 py-2 last:border-b-0">
            <span className="font-mono text-texto-fraco">{i + 1}º</span>
            {l.avatarUrl && <img src={l.avatarUrl} alt="" className="panel-cut-sm h-6 w-6 border border-borda object-cover" />}
            <span className="flex-1 font-mono text-texto">{l.nick}</span>
            <span className="font-display font-bold text-destaque tabular-nums">{l.total}</span>
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
  const encerrada = new Date(comp.dataFim) < new Date()
  const naoComecou = new Date() < new Date(comp.dataInicio)
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

      <div className="mt-4">
        <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Leaderboard</h3>
        <Leaderboard leaderboard={comp.leaderboard} minimoParaRankear={comp.minimoParaRankear} />
      </div>

      {comp.clipesRecentes?.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">Enviados recentemente</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {comp.clipesRecentes.map((c) => (
              <div key={c.id} className="panel-cut-sm border border-borda p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-texto">{c.nick}</span>
                  <span className="font-display font-bold text-destaque">{c.pontuacao.total}</span>
                </div>
              </div>
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
