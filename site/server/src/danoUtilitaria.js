// Dano de utilitária em INIMIGO (HE + fogo): o mesmo número que a página da Partida mostra.
// `utility_damage` soma também fogo amigo e dano em si mesmo (coletor/parse.py), então
// recorde, perfil, ranking e prêmios mostravam um valor maior que o da Partida.
// Ele só fica como fallback quando as quatro colunas separadas estão zeradas: Partida
// FACEIT sem Demo (o stat vem da própria FACEIT) e linhas anteriores às migrations 0006/0011.
export const UTIL_INIMIGO_SQL = `(case when mp.he_damage + mp.molotov_damage + mp.he_team_damage + mp.molotov_team_damage > 0
  then mp.he_damage + mp.molotov_damage else mp.utility_damage end)`
