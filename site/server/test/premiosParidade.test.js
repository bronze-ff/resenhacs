import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { calcularPremios } from '../src/premios.js'

// Mesma fixture que coletor/tests/test_discord.py lê: o Coletor porta 3 prêmios para o
// post da Resenha da semana no Discord e não pode divergir da tela.
const { casos } = JSON.parse(readFileSync(join(process.cwd(), '../../shared/premios/casos-semana.json'), 'utf8'))
const PORTADOS = ['carregou', 'clutch', 'granadeiro']

describe('paridade dos prêmios da semana com o Coletor', () => {
  it.each(casos.map((c) => [c.nome, c]))('%s', (_nome, caso) => {
    const { numeros, premios } = calcularPremios(caso.linhas, 'semana')
    expect({ partidas: numeros.partidas, vitorias: numeros.vitorias, derrotas: numeros.derrotas }).toEqual(caso.esperado.numeros)
    const portados = premios
      .filter((p) => PORTADOS.includes(p.id))
      .map((p) => ({ id: p.id, steamId: p.jogadores[0].steamId, nick: p.jogadores[0].nick, valor: p.valor }))
    expect(portados).toEqual(caso.esperado.premios)
  })
})
