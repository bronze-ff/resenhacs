// Reordena o placar pra perspectiva do grupo: nosso placar sempre primeiro — não numa
// posição fixa "Time A", que pode não ser o lado do grupo naquela Partida.
export function orientarPlacar(scoreA, scoreB, resultado) {
  let a = scoreA
  let b = scoreB
  if (resultado === 'vitoria') [a, b] = [Math.max(scoreA, scoreB), Math.min(scoreA, scoreB)]
  if (resultado === 'derrota') [a, b] = [Math.min(scoreA, scoreB), Math.max(scoreA, scoreB)]
  return { a, b }
}
