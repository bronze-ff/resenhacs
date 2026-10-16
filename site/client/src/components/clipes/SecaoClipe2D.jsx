import { useState } from 'react'
import { SectionHeader, EstadoVazio } from '../ui'
import SeletorKills from './SeletorKills.jsx'
import GravadorClipe from './GravadorClipe.jsx'

// Aba Clipes da Partida: Clipe 2D com as kills que o Jogador escolhe (uma = clipe,
// várias = montagem), gravado no navegador a partir do Replay 2D. Complementa o
// clipe do jogo da Allstar, que escolhe a jogada sozinho.
export default function SecaoClipe2D({ matchId, replayUrl, mapa, jogadores, viewerSteamId }) {
  const [kills, setKills] = useState([])

  return (
    <div>
      <SectionHeader titulo="Clipe 2D (você escolhe as kills)" margem="pequena" />
      <p className="mb-3 text-sm text-texto-fraco">
        Marque uma kill pra gerar um clipe, ou várias pra uma montagem. O vídeo é gravado
        aqui no navegador a partir do Replay 2D: 3 s antes e 2 s depois de cada kill.
      </p>
      {!replayUrl ? (
        <EstadoVazio
          titulo="Essa Partida não tem Replay 2D"
          descricao="O Clipe 2D é gravado a partir do Replay 2D, que o Coletor gera quando processa a Demo. Sem Demo processada, só dá pra usar o clipe do jogo da Allstar acima."
        />
      ) : (
        <div className="space-y-4">
          <SeletorKills
            matchId={matchId}
            jogadores={jogadores}
            viewerSteamId={viewerSteamId}
            onMudarSelecao={setKills}
          />
          <GravadorClipe
            replayUrl={replayUrl}
            kills={kills}
            nomeArquivo={`resenha-${mapa || 'partida'}-${kills.length > 1 ? 'montagem' : 'clipe'}-2d`}
          />
        </div>
      )}
    </div>
  )
}
