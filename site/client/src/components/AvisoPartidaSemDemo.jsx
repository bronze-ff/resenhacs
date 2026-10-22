import EnviarDemoDaPartida from './EnviarDemoDaPartida.jsx'
import { hrefSeguro } from '../lib/urlSegura.js'

const FACEIT_MATCH_ID_RE = /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Aviso da Partida FACEIT que entrou só com as estatísticas da API (sem Demo). Todo
// mundo que abre a Partida vê o aviso; o botão de envio (EnviarDemoDaPartida) só
// aparece pra quem jogou. Partida com Demo, ou de outra origem, não mostra nada.
export default function AvisoPartidaSemDemo({ partida, euSteamId, onEnviado }) {
  if (partida.temDemo || partida.source !== 'faceit') return null
  const sala = typeof partida.faceitMatchId === 'string' && FACEIT_MATCH_ID_RE.test(partida.faceitMatchId)
    ? hrefSeguro(`https://www.faceit.com/en/cs2/room/${partida.faceitMatchId}`)
    : undefined
  return (
    <section
      aria-label="Partida sem demo"
      className="space-y-3 border border-borda bg-superficie px-4 py-3"
    >
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold text-texto">
          Partida FACEIT sem Demo: kills, mortes por round e clipes precisam do arquivo .dem
        </p>
        <p className="text-sm text-texto-fraco">
          Placar, K/D, dano, HS, MVPs e multi-kills vieram da FACEIT. Sem a demo não há KAST, rating,
          economia, Replay 2D nem novos Clipes. O download automático depende da liberação da FACEIT.
        </p>
        {sala && (
          <p className="text-sm text-texto-fraco">
            Na <a href={sala} target="_blank" rel="noopener noreferrer" className="text-texto underline underline-offset-2">sala da FACEIT</a>,
            {' '}clique em Watch Demo e envie aqui o arquivo .dem ou .dem.gz.
          </p>
        )}
      </div>
      <EnviarDemoDaPartida partida={partida} euSteamId={euSteamId} onEnviado={onEnviado} />
    </section>
  )
}
