// Avatar do jogador (panel-cut-sm + border + object-cover) com fallback pra quem nunca
// logou no site (avatarUrl null — comum, ~metade do placar de uma partida costuma ser
// adversário sem conta): mostra a inicial do nick tingida na cor do time em vez de
// sumir/quebrar o layout. Compartilhado entre Scoreboard, Economia, Utilitária e Feed.
export default function Avatar({ p, size = 24, className = '' }) {
  const titulo = p?.nick || p?.steamId || '?'
  const estilo = { width: size, height: size }
  if (p?.avatarUrl) {
    return (
      <img
        src={p.avatarUrl}
        alt=""
        title={titulo}
        style={estilo}
        className={`panel-cut-sm flex-shrink-0 border border-borda object-cover ${className}`}
      />
    )
  }
  const inicial = titulo.charAt(0).toUpperCase()
  const cor =
    p?.team === 'A'
      ? 'border-time-a/50 bg-time-a/10 text-time-a'
      : p?.team === 'B'
        ? 'border-time-b/50 bg-time-b/10 text-time-b'
        : 'border-borda bg-superficie-alta text-texto-fraco'
  return (
    <span
      title={titulo}
      style={{ ...estilo, fontSize: Math.round(size * 0.42) }}
      className={`panel-cut-sm flex flex-shrink-0 items-center justify-center border font-display font-bold ${cor} ${className}`}
    >
      {inicial}
    </span>
  )
}
