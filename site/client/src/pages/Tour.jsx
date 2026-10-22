import { useState } from 'react'
import { matchPath, useNavigate, useSearchParams } from 'react-router-dom'
import { Badge, Button, CabecalhoPagina, Card, Input, classesBotao } from '../components/ui'
import { useAuth } from '../auth/AuthContext.jsx'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'

const NOMES_PASSOS = ['Boas-vindas', 'Steam', 'FACEIT', 'Menu']
const TOTAL_PASSOS = NOMES_PASSOS.length

// Só caminho interno. O valor resolve sobre a origem da página e a regra olha o
// resultado normalizado: "/.//x", "/a/..//x" e "/%2e//x" viram "//x", que o navegador lê
// como outro host. Caractere de controle sai antes (o navegador descarta TAB/LF/CR).
// Voltar ao próprio tour prenderia o Jogador nele. Qualquer outra coisa vai para "/".
export function destinoAposTour(returnTo, origem = window.location.origin) {
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/') || /[\u0000-\u001f\u007f]/.test(returnTo)) return '/'
  let u
  let decodificado
  try {
    u = new URL(returnTo, origem)
    decodificado = decodeURIComponent(u.pathname)
  } catch {
    return '/'
  }
  if (u.origin !== origem || u.pathname.startsWith('//') || u.pathname.includes('\\')) return '/'
  const ehTour = (path) => matchPath({ path, caseSensitive: false, end: true }, decodificado)
  if (ehTour('/tour') || ehTour('/tour/*')) return '/'
  return u.pathname + u.search + u.hash
}

export default function Tour() {
  const { jogador, marcarTourConcluido } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
    marcarTourConcluido()
    navigate(destinoAposTour(searchParams.get('returnTo')), { replace: true })
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
    <div className="mx-auto max-w-xl space-y-6 px-4 py-6 sm:px-0 sm:py-10">
      <CabecalhoPagina
        eyebrow={`Passo ${passo + 1} de ${TOTAL_PASSOS}`}
        titulo="Bem-vindo ao Resenha"
        className="mb-0"
        acoes={
          <Button variante="fantasma" tamanho="sm" onClick={concluir}>
            Pular tour
          </Button>
        }
      />

      <ol className="grid grid-cols-4 gap-2" aria-label="Progresso do tour">
        {NOMES_PASSOS.map((nome, i) => (
          <li key={nome} aria-current={i === passo ? 'step' : undefined} className="min-w-0">
            <div className={`h-1 w-full ${i <= passo ? 'bg-destaque' : 'bg-borda'}`} aria-hidden="true" />
            <span className={`mt-1.5 block truncate font-mono text-[11px] ${i === passo ? 'text-texto' : 'text-texto-fraco'}`}>
              {i < passo ? '✓ ' : ''}{nome}
            </span>
          </li>
        ))}
      </ol>

      {mensagem && <p role="status" className="text-sm text-texto-fraco">{mensagem}</p>}

      {passo === 0 && (
        <Card className="p-4 sm:p-6">
          <p className="text-sm leading-relaxed text-texto-fraco">
            O Resenha acompanha as Partidas de matchmaking do seu grupo — estatísticas,
            ranking, granadas e táticas puxadas direto das suas demos. Esse tour rápido mostra
            como configurar sua conta e onde achar cada coisa no menu.
          </p>
        </Card>
      )}

      {passo === 1 && (
        <Card className="space-y-4 p-4 sm:p-6">
          <h3 className="font-display text-lg font-semibold text-texto">
            Vincular Steam
          </h3>
          <PassoAPassoSteam />
          <form onSubmit={salvarSteam} className="space-y-4 border-t border-borda pt-4">
            <Input
              id="tourAuthCode"
              rotulo="Código de autenticação de histórico"
              value={matchAuthCode}
              onChange={(e) => setMatchAuthCode(e.target.value)}
              className="font-mono"
              placeholder="XXXX-XXXXX-XXXX"
            />
            <Input
              id="tourShareCode"
              rotulo="Share code de partida (ponto de partida da busca)"
              value={lastShareCode}
              onChange={(e) => setLastShareCode(e.target.value)}
              className="font-mono"
              placeholder="CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx"
            />
            <Button type="submit" variante="contorno" className="w-full sm:w-auto">
              Salvar códigos
            </Button>
          </form>
        </Card>
      )}

      {passo === 2 && (
        <Card className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <p className="font-display text-lg font-semibold text-texto">
              FACEIT (opcional)
            </p>
            <p className="mt-1 text-sm text-texto-fraco">
              {jogador?.faceitNick
                ? `Vinculado como ${jogador.faceitNick}.`
                : 'Vincule pra importar suas partidas da FACEIT automaticamente — pode fazer isso depois em Minha conta também.'}
            </p>
          </div>
          {jogador?.faceitNick ? (
            <Badge tom="sucesso">Vinculado</Badge>
          ) : (
            <a href="/api/faceit/login" className={classesBotao({ variante: 'contorno', tamanho: 'sm' })}>
              Vincular
            </a>
          )}
        </Card>
      )}

      {passo === 3 && (
        <Card className="space-y-3 p-4 text-sm leading-relaxed text-texto-fraco sm:p-6">
          <h3 className="font-display text-lg font-semibold text-texto">
            Onde achar cada coisa
          </h3>
          <p><span className="text-texto">Partidas / Ranking</span> — acompanhar seu desempenho e o dos seus amigos.</p>
          <p><span className="text-texto">Enviar demo</span> — subir uma partida que não veio do matchmaking automático (ex.: scrim, campeonato).</p>
          <p><span className="text-texto">Amigos / Comparar</span> — gerenciar amizades e comparações entre jogadores.</p>
          <p><span className="text-texto">Granadas / Táticas</span> — biblioteca de lineups e jogadas.</p>
          <p><span className="text-texto">Minha conta</span> — onde reconfigurar tudo isso (Steam, FACEIT) depois.</p>
        </Card>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-borda pt-4">
        <Button
          variante="secundario"
          onClick={() => setPasso((p) => Math.max(0, p - 1))}
          disabled={passo === 0}
        >
          Voltar
        </Button>
        {passo < TOTAL_PASSOS - 1 ? (
          <Button variante="primario" onClick={() => setPasso((p) => p + 1)}>
            Próximo
          </Button>
        ) : (
          <Button variante="primario" onClick={concluir}>
            Concluir
          </Button>
        )}
      </div>
    </div>
  )
}
