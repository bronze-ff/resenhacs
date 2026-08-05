import { FaceitIcon } from './icones.jsx'
import Chip from './Chip.jsx'
import { AMARELO, LARANJA } from '../../lib/colors.js'

// Badge de ELO FACEIT — cores dos níveis oficiais (1 cinza, 2-3 verde, 4-7 amarelo,
// 8-9 laranja, 10 vermelho). `level` vem da API; se faltar, deriva do elo pelos
// thresholds oficiais. Não renderiza nada sem elo (mesma regra do PremierBadge).
// TEXTO separado do chip completo: o hero do perfil (JogadorPerfil) pinta só o número
// grande, sem borda/fundo — o chip continua compondo texto+borda+fundo a partir daqui.
export const TEXTO_POR_NIVEL = {
  1: 'text-texto-fraco', 2: 'text-sucesso', 3: 'text-sucesso',
  4: AMARELO.texto, 5: AMARELO.texto, 6: AMARELO.texto, 7: AMARELO.texto,
  8: LARANJA.texto, 9: LARANJA.texto, 10: 'text-perigo',
}
const CORES_POR_NIVEL = {
  1: `${TEXTO_POR_NIVEL[1]} border-borda bg-superficie-alta`,
  2: `${TEXTO_POR_NIVEL[2]} border-sucesso/40 bg-sucesso/10`,
  3: `${TEXTO_POR_NIVEL[3]} border-sucesso/40 bg-sucesso/10`,
  4: `${TEXTO_POR_NIVEL[4]} ${AMARELO.borda} ${AMARELO.fundo}`,
  5: `${TEXTO_POR_NIVEL[5]} ${AMARELO.borda} ${AMARELO.fundo}`,
  6: `${TEXTO_POR_NIVEL[6]} ${AMARELO.borda} ${AMARELO.fundo}`,
  7: `${TEXTO_POR_NIVEL[7]} ${AMARELO.borda} ${AMARELO.fundo}`,
  8: `${TEXTO_POR_NIVEL[8]} ${LARANJA.borda} ${LARANJA.fundo}`,
  9: `${TEXTO_POR_NIVEL[9]} ${LARANJA.borda} ${LARANJA.fundo}`,
  10: `${TEXTO_POR_NIVEL[10]} border-perigo/40 bg-perigo/10`,
}
const THRESHOLDS = [500, 750, 900, 1050, 1200, 1350, 1530, 1750, 2000]

export function nivelDoElo(elo) {
  const idx = THRESHOLDS.findIndex((t) => elo <= t)
  return idx === -1 ? 10 : idx + 1
}

// Classes completas do chip (texto+borda+fundo) — pro chip "NÍVEL X" do hero do perfil.
export function corChipDoNivel(nivel) {
  return CORES_POR_NIVEL[nivel] ?? CORES_POR_NIVEL[1]
}

export default function FaceitEloBadge({ elo, level }) {
  if (elo == null) return null
  const nivel = level ?? nivelDoElo(elo)
  const cor = CORES_POR_NIVEL[nivel] ?? CORES_POR_NIVEL[1]
  return (
    <Chip
      toneClassName={cor}
      size="normal"
      icon={<FaceitIcon className="h-3.5 w-3.5 shrink-0" />}
      className="text-sm font-bold tabular-nums"
      title={`FACEIT nível ${nivel} — ${elo} de ELO`}
    >
      {Math.round(elo)}
    </Chip>
  )
}
