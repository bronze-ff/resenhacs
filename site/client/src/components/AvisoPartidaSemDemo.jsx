import EnviarDemoDaPartida from './EnviarDemoDaPartida.jsx'

// Aviso da Partida FACEIT que entrou só com as estatísticas da API (sem Demo). Todo
// mundo que abre a Partida vê o aviso; o botão de envio (EnviarDemoDaPartida) só
// aparece pra quem jogou. Partida com Demo, ou de outra origem, não mostra nada.
export default function AvisoPartidaSemDemo({ partida, euSteamId, onEnviado }) {
  if (partida.temDemo || partida.source !== 'faceit') return null
  return (
    <section
      aria-label="Partida sem demo"
      className="space-y-3 border border-borda bg-superficie px-4 py-3"
    >
      <div className="space-y-1">
        <p className="font-display text-sm font-semibold text-texto">
          Partida da FACEIT sem demo — estatísticas básicas
        </p>
        <p className="text-sm text-texto-fraco">
          Placar, K/D, dano, HS e MVPs vieram da FACEIT. Sem a demo não há KAST, rating,
          economia, Replay 2D nem clipes. O Coletor tenta baixar a demo sozinho, uma vez por
          dia, por até 4 semanas depois da partida.
        </p>
      </div>
      <EnviarDemoDaPartida partida={partida} euSteamId={euSteamId} onEnviado={onEnviado} />
    </section>
  )
}
