// Player e rótulos de Clipe da Allstar, compartilhados entre o card da página
// Clipes (CardClipe.jsx) e o seletor de clipes da Competição — as duas telas
// mostram o mesmo iframe com o mesmo poster, e a terceira cópia ia nascer aqui.
// (Partida.jsx tem um painel próprio, fora do escopo desta unificação.)
import { DOMINIOS_IFRAME_CLIPE, hostPermitido, hrefSeguro } from '../../lib/urlSegura.js'

const NOME_KIND = {
  ace: 'ACE', quad: 'QUAD KILL', triple: 'TRIPLE KILL',
  clutch_1v5: 'CLUTCH 1v5', clutch_1v4: 'CLUTCH 1v4', clutch_1v3: 'CLUTCH 1v3',
  clutch_1v2: 'CLUTCH 1v2', clutch_1v1: 'CLUTCH 1v1',
}

// kind vem null quando o round que a Allstar escolheu (gerar clipe por JOGADOR, não
// mais por highlight) não bate com nenhum Highlight nosso pra esse jogador/round — só
// afeta o rótulo exibido, a pontuação (clipesScore.js) não depende de kind.
export function nomeDoKind(kind) {
  if (!kind) return 'MOMENTO'
  return NOME_KIND[kind] ?? kind
}

export function SnapshotPlaceholder() {
  return (
    <div className="mt-3 flex aspect-video w-full items-center justify-center border border-borda bg-superficie-alta text-texto-fraco">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
        <rect x="3" y="5" width="18" height="14" rx="1" />
        <path d="M9 9L15 12L9 15V9Z" fill="currentColor" stroke="none" />
      </svg>
    </div>
  )
}

// `location` é telemetria da Allstar e difere por tela — a página Clipes manda
// 'melhoresClipes', o seletor da Competição manda 'selecaoCompeticao'.
// Iframe só para host da Allstar; outra URL (linha antiga com provider 'other') vira link.
export function PlayerClipe({ clipUrl, viewerSteamId, titulo, location = 'melhoresClipes' }) {
  if (!hostPermitido(clipUrl, DOMINIOS_IFRAME_CLIPE)) {
    const href = hrefSeguro(clipUrl)
    if (!href) return null
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm text-destaque underline underline-offset-2">
        Abrir clipe em outra aba
      </a>
    )
  }
  return (
    <div className="mt-3 aspect-video w-full">
      <iframe
        src={`${clipUrl}&UID=${encodeURIComponent(viewerSteamId ?? '')}&location=${location}`}
        sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
        allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
        allowFullScreen
        className="h-full w-full border border-borda"
        title={titulo ?? 'Clipe Allstar'}
      />
    </div>
  )
}
