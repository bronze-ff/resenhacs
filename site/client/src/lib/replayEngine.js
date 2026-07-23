// Lógica pura da reprodução (o desenho no canvas fica no ReplayViewer).

export function frameIndexAt(elapsedSeconds, tickRate, frameCount) {
  if (frameCount <= 0) return 0
  const idx = Math.floor(elapsedSeconds * tickRate)
  if (idx < 0) return 0
  if (idx >= frameCount) return frameCount - 1
  return idx
}

export function duracaoSegundos(frameCount, tickRate) {
  if (tickRate <= 0) return 0
  return frameCount / tickRate
}

export const COR_TIME = { A: '#f5a524', B: '#4fb6ff' }
