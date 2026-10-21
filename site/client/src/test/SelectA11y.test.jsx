// site/client/src/test/SelectA11y.test.jsx
// Onda 1, S3b (R23): o Select anuncia nome e opção ativa para leitor de tela.
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Select from '../components/ui/Select.jsx'

function montar(props = {}) {
  return render(
    <Select value="b" onChange={() => {}} {...props}>
      <option value="a">Alfa</option>
      <option value="b">Bravo</option>
      <option value="c">Charlie</option>
    </Select>,
  )
}

describe('Select — acessibilidade', () => {
  it('repassa aria-label e id ao botão', () => {
    montar({ 'aria-label': 'Mapa', id: 'filtro-mapa' })
    const botao = screen.getByRole('button', { name: 'Mapa' })
    expect(botao).toHaveAttribute('id', 'filtro-mapa')
  })

  it('aceita <label htmlFor> via id', () => {
    render(
      <>
        <label htmlFor="sel-round">Round</label>
        <Select id="sel-round" value="" onChange={() => {}}><option value="">Todos</option></Select>
      </>,
    )
    expect(screen.getByRole('button', { name: 'Round' })).toBeInTheDocument()
  })

  it('listbox aberto tem nome, liga o botão e anuncia a opção ativa ao usar as setas', async () => {
    montar({ 'aria-label': 'Mapa' })
    const botao = screen.getByRole('button', { name: 'Mapa' })
    fireEvent.click(botao)
    const lista = await screen.findByRole('listbox', { name: 'Mapa' })
    expect(botao).toHaveAttribute('aria-controls', lista.id)
    const opcoes = screen.getAllByRole('option')
    expect(lista).toHaveAttribute('aria-activedescendant', opcoes[1].id)
    fireEvent.keyDown(lista, { key: 'ArrowDown' })
    expect(lista).toHaveAttribute('aria-activedescendant', opcoes[2].id)
    expect(new Set(opcoes.map((o) => o.id)).size).toBe(3)
  })
})
