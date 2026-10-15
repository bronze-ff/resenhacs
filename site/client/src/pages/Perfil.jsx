import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Badge, Button, CabecalhoPagina, Card, EstadoErro, Input, classesBotao } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'
import PrivacidadeConta from '../components/PrivacidadeConta.jsx'

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
  const [passoAPassoAberto, setPassoAPassoAberto] = useState(false)
  // Resultado do callback OAuth da FACEIT (?faceit=vinculado / ?erro=faceit-invalido) —
  // sem isso a falha era silenciosa: o callback redirecionava de volta pra cá e nada
  // na tela dizia se deu certo ou errado.
  const [searchParams] = useSearchParams()
  const faceitResultado = searchParams.get('faceit') === 'vinculado'
    ? 'ok'
    : searchParams.get('erro') === 'faceit-invalido' ? 'erro' : null

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
      <CabecalhoPagina eyebrow="Perfil" titulo="Minha conta" descricao="Códigos da Steam e contas vinculadas pra importar suas Partidas." className="mb-0" />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <section className="space-y-3">
        <h3 className="rotulo">Importação automática (Steam)</h3>
        <Card className="p-4 sm:p-5">
          <button
            type="button"
            onClick={() => setPassoAPassoAberto((v) => !v)}
            className="flex min-h-10 w-full items-center justify-between gap-2 text-left lg:min-h-0"
          >
            <span className="text-sm text-texto-fraco">
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
          <form onSubmit={salvar} className="mt-4 space-y-4">
            <Input
              id="authCode"
              rotulo="Código de autenticação de histórico"
              value={matchAuthCode}
              onChange={(e) => setMatchAuthCode(e.target.value)}
              className="font-mono"
              placeholder="XXXX-XXXXX-XXXX"
            />
            <Input
              id="shareCode"
              rotulo="Share code de partida (ponto de partida da busca)"
              value={lastShareCode}
              onChange={(e) => setLastShareCode(e.target.value)}
              className="font-mono"
              placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
            />
            <Button type="submit" variante="primario" className="w-full sm:w-auto">
              Salvar
            </Button>
          </form>
          {mensagem && <p role="status" className="mt-3 text-sm text-texto-fraco">{mensagem}</p>}
        </Card>
      </section>

      <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="rotulo">Contas vinculadas</h3>
        <Card className="flex items-center justify-between gap-3 p-4 sm:p-5">
          <div>
            <p className="font-display text-sm font-semibold text-texto">FACEIT</p>
            <p className="text-sm text-texto-fraco">
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
              className={classesBotao({ variante: 'contorno', tamanho: 'sm' })}
            >
              Vincular
            </a>
          )}
        </Card>
        {faceitResultado === 'erro' && (
          <EstadoErro
            mensagem="Não deu pra concluir o vínculo com a FACEIT — a autenticação passou, mas a troca de credenciais falhou do nosso lado. Tenta de novo; se persistir, avisa o admin."
          />
        )}
        {faceitResultado === 'ok' && !jogador?.faceitNick && (
          <p className="text-sm text-texto-fraco">
            Vínculo concluído — recarregue a página se o status ainda não atualizou.
          </p>
        )}
      </section>
      <PrivacidadeConta />
      </div>
      </div>
    </div>
  )
}
