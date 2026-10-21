// Os filtros de período (?from/?to=YYYY-MM-DD) são dias de BRASÍLIA, não UTC. O grupo joga
// à noite: uma Partida das 22h30 de 20/10 (01h30 UTC de 21/10) caía no dia 21 e sumia do
// filtro "até 20/10". `p` é o placeholder do parâmetro (ex.: '$2').
export const FUSO = 'America/Sao_Paulo'
export const inicioDoDiaSql = (p) => `(${p}::date::timestamp at time zone '${FUSO}')`
export const fimDoDiaSql = (p) => `((${p}::date + 1)::timestamp at time zone '${FUSO}')`

// Mesmo corte em JS (filtros feitos fora do SQL). shortcut: offset fixo -03:00, válido
// porque o Brasil não tem horário de verão desde 2019; se voltar, usar Intl com FUSO.
export const inicioDoDiaMs = (dia) => Date.parse(`${dia}T00:00:00-03:00`)
