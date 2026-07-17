import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, SectionHeader, Badge } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'

// Seta que gira 90° quando aberto — mesmo ícone pros dois estados, só rotaciona.
function SetaExpandir({ aberto }) {
  return (
    <svg
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={`h-3.5 w-3.5 shrink-0 transition-transform ${aberto ? 'rotate-90' : ''}`}
    >
      <path d="M9 5L15 12L9 19" />
    </svg>
  )
}

export default function Perfil() {
  const { jogador } = useAuth()
  const [matchAuthCode, setMatchAuthCode] = useState('')
  const [lastShareCode, setLastShareCode] = useState('')
  const [mensagem, setMensagem] = useState(null)
  const [rankingPublico, setRankingPublico] = useState(false)
  const [passoAPassoAberto, setPassoAPassoAberto] = useState(false)
  // Resultado do callback OAuth da FACEIT (?faceit=vinculado / ?erro=faceit-invalido) —
  // sem isso a falha era silenciosa: o callback redirecionava de volta pra cá e nada
  // na tela dizia se deu certo ou errado.
  const [searchParams] = useSearchParams()
  const faceitResultado = searchParams.get('faceit') === 'vinculado'
    ? 'ok'
    : searchParams.get('erro') === 'faceit-invalido' ? 'erro' : null

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
    // 2 colunas no desktop (Steam | Ranking+Contas) pra caber tudo sem scroll, largura
    // cheia igual Feed/Ranking — uma coluna única de max-w-lg deixava um deserto
    // horizontal à direita e empurrava as seções de baixo pra fora da tela. Mobile
    // continua empilhado.
    <div className="space-y-6">
      <SectionHeader titulo="Minha conta" />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <section className="space-y-3">
        <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-texto-fraco">
          Importação automática (Steam)
        </h3>
        <Card className="p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setPassoAPassoAberto((v) => !v)}
            className="flex min-h-10 w-full items-center justify-between gap-2 text-left lg:min-h-0"
          >
            <span className="font-mono text-sm text-texto-fraco">
              Não sabe onde pegar os códigos? <span className="text-destaque">Veja o passo a passo</span>
            </span>
            <SetaExpandir aberto={passoAPassoAberto} />
          </button>
          {passoAPassoAberto && (
            // Altura limitada com scroll INTERNO: expandido, o guia inteiro empurrava o
            // formulário e as outras seções pra fora da tela — agora rola dentro do
            // próprio quadro e a página continua cabendo sem scroll. O pl-2 é necessário:
            // os números da lista (list-decimal) desenham FORA do recuo do <ol> e o
            // overflow do quadro cortava eles no meio.
            <div className="mt-4 max-h-[45vh] overflow-y-auto border-b border-borda pb-3 pl-2 pr-2">
              <PassoAPassoSteam />
            </div>
          )}
          <form onSubmit={salvar} className="mt-4 space-y-3">
            <div>
              <label className="block font-mono text-xs uppercase tracking-wide text-texto-fraco" htmlFor="authCode">
                Código de autenticação de histórico
              </label>
              <input
                id="authCode"
                value={matchAuthCode}
                onChange={(e) => setMatchAuthCode(e.target.value)}
                className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
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
                className="panel-cut-sm min-h-10 w-full border border-borda bg-superficie px-3 py-2 font-mono text-sm lg:min-h-0"
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

      <div className="space-y-6">
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
            className={`panel-cut-sm min-h-10 shrink-0 border px-3 py-1.5 font-mono text-xs uppercase tracking-wide lg:min-h-0 ${
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
            <p className="font-mono text-xs text-texto-fraco">
              {jogador?.faceitNick
                ? `Vinculado como ${jogador.faceitNick}.`
                : 'Vincule pra importar suas partidas da FACEIT automaticamente.'}
            </p>
          </div>
          {jogador?.faceitNick ? (
            <Badge tom="sucesso">Vinculado</Badge>
          ) : (
            <a
              href="/api/faceit/login"
              className="panel-cut-sm inline-flex min-h-10 shrink-0 items-center border border-destaque px-3 py-1.5 font-mono text-xs uppercase tracking-wide text-destaque hover:bg-destaque/10 lg:min-h-0"
            >
              Vincular
            </a>
          )}
        </Card>
        {faceitResultado === 'erro' && (
          <p className="font-mono text-xs text-perigo">
            Não deu pra concluir o vínculo com a FACEIT — a autenticação passou, mas a troca de
            credenciais falhou do nosso lado. Tenta de novo; se persistir, avisa o admin.
          </p>
        )}
        {faceitResultado === 'ok' && !jogador?.faceitNick && (
          <p className="font-mono text-xs text-texto-fraco">
            Vínculo concluído — recarregue a página se o status ainda não atualizou.
          </p>
        )}
      </section>
      </div>
      </div>
    </div>
  )
}
