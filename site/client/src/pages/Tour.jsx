import { useState } from 'react'
import { Card, SectionHeader, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'

const TOTAL_PASSOS = 4

export default function Tour() {
  const { jogador } = useAuth()
  const [passo, setPasso] = useState(0)
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)

  async function concluir() {
    const res = await fetch('/api/players/me/tour-concluido', { method: 'PUT' }).catch(() => null)
    if (!res || !res.ok) {
      setMensagem('Erro ao concluir o tour. Tente novamente.')
      return
    }
    window.location.href = '/'
  }

  async function salvarSteam(e) {
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
    <div className="mx-auto max-w-lg space-y-6 py-10">
      <SectionHeader
        titulo="Bem-vindo ao Resenha"
        acao={
          <button
            type="button"
            onClick={concluir}
            className="font-mono text-xs uppercase tracking-wide text-texto-fraco underline"
          >
            Pular tour
          </button>
        }
      />

      {passo === 0 && (
        <Card className="p-4 sm:p-5">
          <p className="font-mono text-sm leading-relaxed text-texto-fraco">
            O Resenha acompanha as Partidas de matchmaking do seu grupo — estatísticas,
            ranking, granadas e táticas puxadas direto das suas demos. Esse tour rápido mostra
            como configurar sua conta e onde achar cada coisa no menu.
          </p>
        </Card>
      )}

      {passo === 1 && (
        <Card className="space-y-4 p-4 sm:p-5">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
            Vincular Steam
          </h3>
          <PassoAPassoSteam />
          <form onSubmit={salvarSteam} className="space-y-3">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="tourAuthCode">
                Código de autenticação de histórico
              </label>
              <input
                id="tourAuthCode"
                value={matchAuthCode}
                onChange={(e) => setMatchAuthCode(e.target.value)}
                className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
                placeholder="XXXX-XXXXX-XXXX"
              />
            </div>
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="tourShareCode">
                Share code de partida (ponto de partida da busca)
              </label>
              <input
                id="tourShareCode"
                value={lastShareCode}
                onChange={(e) => setLastShareCode(e.target.value)}
                className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
                placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
              />
            </div>
            <button
              type="submit"
              className="panel-cut-sm min-h-10 w-full border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0 lg:w-auto"
            >
              Salvar códigos
            </button>
          </form>
          {mensagem && <p className="font-mono text-sm text-texto-fraco">{mensagem}</p>}
        </Card>
      )}

      {passo === 2 && (
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
              FACEIT (opcional)
            </p>
            <p className="font-mono text-xs text-texto-fraco">
              {jogador?.faceitNick
                ? `Vinculado como ${jogador.faceitNick}.`
                : 'Vincule pra importar suas partidas da FACEIT automaticamente — pode fazer isso depois em Minha conta também.'}
            </p>
          </div>
          {jogador?.faceitNick ? (
            <Badge tom="sucesso">Vinculado</Badge>
          ) : (
            <a
              href="/api/faceit/login"
              className="panel-cut-sm border border-destaque px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-destaque hover:bg-destaque/10"
            >
              Vincular
            </a>
          )}
        </Card>
      )}

      {passo === 3 && (
        <Card className="space-y-3 p-4 sm:p-5 font-mono text-sm leading-relaxed text-texto-fraco">
          <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto">
            Onde achar cada coisa
          </h3>
          <p><span className="text-texto">Partidas / Ranking / Ranking público</span> — acompanhar desempenho seu e do grupo.</p>
          <p><span className="text-texto">Enviar demo</span> — subir uma partida que não veio do matchmaking automático (ex.: scrim, campeonato).</p>
          <p><span className="text-texto">Jogadores / Comparar / Times</span> — perfis individuais e comparações entre jogadores ou times.</p>
          <p><span className="text-texto">Granadas / Táticas</span> — biblioteca de lineups e jogadas do grupo.</p>
          <p><span className="text-texto">Minha conta</span> — onde reconfigurar tudo isso (Steam, FACEIT, ranking público) depois.</p>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setPasso((p) => Math.max(0, p - 1))}
          disabled={passo === 0}
          className="panel-cut-sm min-h-10 border border-borda px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco disabled:opacity-40 lg:min-h-0"
        >
          Voltar
        </button>
        {passo < TOTAL_PASSOS - 1 ? (
          <button
            type="button"
            onClick={() => setPasso((p) => p + 1)}
            className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0"
          >
            Próximo
          </button>
        ) : (
          <button
            type="button"
            onClick={concluir}
            className="panel-cut-sm min-h-10 border border-destaque bg-destaque px-4 py-2 font-display text-sm font-semibold uppercase tracking-wide text-fundo lg:min-h-0"
          >
            Concluir
          </button>
        )}
      </div>
    </div>
  )
}
