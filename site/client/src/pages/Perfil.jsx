import { useEffect, useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'

export default function Perfil() {
  const { jogador } = useAuth()
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [rankingPublico, setRankingPublico] = useState(false)

  useEffect(() => {
    if (jogador) setRankingPublico(Boolean(jogador.rankingPublico))
  }, [jogador])

  async function alternarRankingPublico() {
    const novo = !rankingPublico
    setRankingPublico(novo)
    await fetch('/api/players/me/ranking-publico', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publico: novo }),
    })
  }

  async function salvar(e) {
    e.preventDefault()
    const res = await fetch('/api/players/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchAuthCode, lastShareCode }),
    })
    const body = await res.json().catch(() => ({}))
    setMensagem(res.ok ? 'Códigos salvos. O Coletor vai buscar suas Partidas.' : (body.erro ?? 'Erro ao salvar.'))
  }

  return (
    <div className="max-w-lg space-y-6">
      <SectionHeader titulo="Minha conta" />

      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Importação automática (Steam)
        </h3>
        <Card className="p-4 sm:p-5">
          <p className="mb-4 font-mono text-sm leading-relaxed text-texto-fraco">
            Para o Resenha achar suas Partidas de matchmaking, cole seu código de autenticação de
            histórico e um share code de partida. Pegue os dois em{' '}
            <a
              className="text-destaque underline"
              href="https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128"
              target="_blank"
              rel="noreferrer"
            >
              Steam → Ajuda → Compartilhar histórico de partidas
            </a>
            . A busca anda <span className="text-texto">pra frente</span> a partir do código informado —
            use o <span className="text-texto">"primeiro código de partilha"</span> dessa página da Steam
            pra puxar seu histórico inteiro, ou um código recente pra começar só das partidas novas.
          </p>
          <form onSubmit={salvar} className="space-y-3">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="authCode">
                Código de autenticação de histórico
              </label>
              <input
                id="authCode"
                value={matchAuthCode}
                onChange={(e) => setMatchAuthCode(e.target.value)}
                className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
                placeholder="XXXX-XXXXX-XXXX"
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="shareCode">
                Share code de partida (ponto de partida da busca)
              </label>
              <input
                id="shareCode"
                value={lastShareCode}
                onChange={(e) => setLastShareCode(e.target.value)}
                className="w-full rounded border border-borda bg-superficie px-3 py-2 font-mono text-sm"
                placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
              />
            </div>
            <button
              type="submit"
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
            >
              Salvar
            </button>
          </form>
          {mensagem && <p className="mt-3 font-mono text-sm text-texto-fraco">{mensagem}</p>}
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Ranking público
        </h3>
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">Aparecer no ranking público</p>
            <p className="font-mono text-xs text-texto-fraco">Expõe seu nick e stats agregadas fora do seu grupo, num ranking global de jogadores.</p>
          </div>
          <button
            onClick={alternarRankingPublico}
            className={`panel-cut-sm border px-3 py-1.5 font-mono text-xs uppercase tracking-wide ${
              rankingPublico ? 'border-destaque bg-destaque/10 text-destaque' : 'border-borda text-texto-fraco'
            }`}
          >
            {rankingPublico ? 'Ativado' : 'Desativado'}
          </button>
        </Card>
      </section>

      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Contas vinculadas
        </h3>
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">FACEIT</p>
            <p className="font-mono text-xs text-texto-fraco">Vincule pra importar suas partidas da FACEIT automaticamente.</p>
          </div>
          <Badge tom="neutro">Em breve</Badge>
        </Card>
      </section>
    </div>
  )
}
