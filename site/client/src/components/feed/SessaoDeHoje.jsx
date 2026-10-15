import { Link } from 'react-router-dom'
import { corRating } from '../../lib/format.js'
import { Avatar, Button, Card } from '../ui'

// Uma Resenha (sessão) conta como "de hoje" se terminou há menos de 12h — cobre a noite
// que vira madrugada sem depender do fuso de quem abre.
const JANELA_MS = 12 * 60 * 60 * 1000

export function sessaoDeHoje(sessoes, agora = Date.now()) {
  const s = sessoes?.[0]
  if (!s?.fim) return null
  return agora - new Date(s.fim).getTime() <= JANELA_MS ? s : null
}

const COR_BARRA = { vitoria: 'bg-sucesso', derrota: 'bg-perigo' }

// Card lateral do Feed: placar da noite (V/D), uma barrinha por Partida na ordem em que
// foram jogadas e quem carregou. `resultados` mapeia matchId → resultado do grupo, a
// partir das Partidas que o Feed já carregou (as que não estiverem na página atual
// ficam cinza, sem pedir nada ao servidor).
export default function SessaoDeHoje({ sessao, resultados, onVerSessao }) {
  if (!sessao) return null
  const placar = [
    sessao.vitorias > 0 && <span key="v" className="text-sucesso">{sessao.vitorias}V</span>,
    sessao.derrotas > 0 && <span key="d" className="text-perigo">{sessao.derrotas}D</span>,
    sessao.empates > 0 && <span key="e" className="text-texto-fraco">{sessao.empates}E</span>,
  ].filter(Boolean)
  return (
    <Card className="p-4">
      <div className="rotulo">Sessão de hoje</div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="flex gap-3 font-mono text-3xl font-medium tabular-nums">{placar.length ? placar : '–'}</span>
        <span className="text-[13px] text-texto-fraco">
          em {sessao.partidas} partida{sessao.partidas === 1 ? '' : 's'}
        </span>
      </div>
      <div className="mt-3 flex gap-1" aria-hidden="true">
        {sessao.matchIds.map((id) => (
          <span key={id} className={`h-1.5 flex-1 rounded-full ${COR_BARRA[resultados.get(id)] ?? 'bg-borda-forte'}`} />
        ))}
      </div>
      {sessao.destaque && (
        <div className="mt-4 flex items-center gap-2 border-t border-borda pt-3 text-[13px]">
          <span className="text-texto-fraco">Carregou a sessão</span>
          <Link to={`/jogador/${sessao.destaque.steamId}`} className="ml-auto flex min-w-0 items-center gap-2 text-texto hover:text-destaque">
            <Avatar p={sessao.destaque} size={20} />
            <span className="truncate">{sessao.destaque.nick}</span>
          </Link>
          <span className={`font-mono ${corRating(sessao.destaque.ratingMedio)}`}>{sessao.destaque.ratingMedio.toFixed(2)}</span>
        </div>
      )}
      <Button variante="secundario" tamanho="sm" larguraTotal className="mt-4" onClick={() => onVerSessao(sessao)}>
        Ver só as Partidas de hoje
      </Button>
    </Card>
  )
}
