import { MarcadorTipo } from '../granadas/RadarGranadas.jsx'

// Radar em miniatura pro card de tática curada: imagem do mapa + marcador de
// TODAS as granadas de TODOS os papéis da tática (visão geral, sem interação —
// o detalhe interativo por papel é responsabilidade da T3/DetalheTatica).
export default function MiniRadarTatica({ mapa, granadas }) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="block aspect-square w-full border-b border-borda bg-fundo"
      aria-label="Mini radar da tática"
    >
      <image href={`/radars/${mapa}.png`} width="100" height="100" opacity="0.9" />
      {granadas.map((g, i) => (
        <MarcadorTipo key={`${g.id ?? i}-${i}`} tipo={g.tipo} x={g.alvoX * 100} y={g.alvoY * 100} ativo={false} />
      ))}
    </svg>
  )
}
