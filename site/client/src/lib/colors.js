// Cores de marca de terceiros usadas nos badges de Premier (CS Rating) e FACEIT ELO —
// não fazem parte da paleta do site (essa vive em index.css via @theme), são hex crus
// exigidos pra bater com a cor oficial de cada faixa/nível. Nomeadas aqui pra não
// duplicar o mesmo hex em PremierBadge.jsx e FaceitEloBadge.jsx por coincidência (ex.:
// o amarelo do topo do Premier é o mesmo amarelo do nível 4-7 do FACEIT).
export const AMARELO = { texto: 'text-[#facc15]', borda: 'border-[#facc15]/40', fundo: 'bg-[#facc15]/10' }
export const LARANJA = { texto: 'text-[#fb923c]', borda: 'border-[#fb923c]/40', fundo: 'bg-[#fb923c]/10' }
export const AZUL = { texto: 'text-[#4f7fff]', borda: 'border-[#4f7fff]/40', fundo: 'bg-[#4f7fff]/10' }
export const ROXO = { texto: 'text-[#a855f7]', borda: 'border-[#a855f7]/40', fundo: 'bg-[#a855f7]/10' }
export const ROSA = { texto: 'text-[#ec4899]', borda: 'border-[#ec4899]/40', fundo: 'bg-[#ec4899]/10' }

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
