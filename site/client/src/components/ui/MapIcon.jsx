import { useState } from 'react'
import { nomeMapa } from '../../lib/format.js'

// Ícone oficial do mapa (SVG vetorial em /mapicons/de_*.svg — nítido em qualquer
// tamanho inline, ao contrário do PNG). Se a imagem faltar/quebrar
// (mapa desconhecido, arquivo ausente), cai num fallback com as 3 primeiras letras
// pra não quebrar o layout.
export default function MapIcon({ map, size = 32, className = '' }) {
  const [erro, setErro] = useState(false)
  const nome = nomeMapa(map)

  if (erro || !map) {
    return (
      <span
        title={nome}
        style={{ width: size, height: size }}
        className={`panel-cut-sm inline-flex shrink-0 items-center justify-center border border-borda bg-fundo font-mono text-[10px] font-bold uppercase text-destaque ${className}`}
      >
        {nome.slice(0, 3)}
      </span>
    )
  }

  return (
    <img
      src={`/mapicons/${map}.svg`}
      width={size}
      height={size}
      alt={nome}
      title={nome}
      onError={() => setErro(true)}
      className={`shrink-0 ${className}`}
    />
  )
}
