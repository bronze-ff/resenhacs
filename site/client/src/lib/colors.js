// Espelha (à mão, de propósito) os tokens de cor de ../index.css que também precisam
// existir em JS puro — Canvas 2D não lê `var(--...)`, só aceita string de cor literal
// em fillStyle/strokeStyle. Sem isso cada componente que desenha em <canvas> reescrevia
// o mesmo hex separadamente (MapaCalor, ReplayViewer, PosicionamentoAgregado já tinham
// o aviso de calibração e o dourado do clutcher triplicados). Se um tom mudar no CSS,
// muda aqui também — os dois arquivos não se importam entre si, é sincronia manual.
export const CORES = {
  fundo: '#0a0a0c',
  timeA: '#f5a524',
  timeB: '#4fb6ff',
  // Medalhas do ranking (posições 1/2/3).
  ouro: '#facc15',
  prata: '#cbd5e1',
  bronze: '#d97706',
  // Aviso (ex.: mapa sem calibração de radar).
  aviso: '#fbbf24',
}
