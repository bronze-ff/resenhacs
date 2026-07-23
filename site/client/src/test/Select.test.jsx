import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Select from '../components/ui/Select.jsx'

// <option> direto como filhos, igual a todo uso real no site (inline ou via .map()) —
// nunca atrás de um componente/constante wrapper: Select lê `children` sem renderizá-lo,
// então um Fragment pré-montado passado como filho único não seria aberto por
// Children.toArray (fica opaco), diferente de <option> literais/array como aqui.
function renderSelect(props) {
  return render(
    <Select {...props}>
      <option value="">Todos</option>
      <option value="a">Alfa</option>
      <option value="b">Beta</option>
    </Select>,
  )
}

// Regressão do bug encontrado ao trocar de <select> nativo pra dropdown customizado:
// o painel só existe no DOM um commit depois de `aberto` virar true (espera a posição
// ser calculada), então o foco tinha que esperar por isso também — senão Escape/setas
// ficavam mortas depois de abrir (achado testando ao vivo no navegador).
describe('Select (dropdown customizado)', () => {
  it('mostra o rótulo da opção selecionada no trigger', () => {
    renderSelect({ value: 'a', onChange: () => {} })
    expect(screen.getByRole('button')).toHaveTextContent('Alfa')
  })

  it('abre o painel ao clicar e fecha com Escape', () => {
    renderSelect({ value: '', onChange: () => {} })
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
    fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('chama onChange com o valor da opção clicada (evento no formato do <select> nativo) e fecha o painel', () => {
    const onChange = vi.fn()
    renderSelect({ value: '', onChange })
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'b' } })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('navega com seta pra baixo e seleciona com Enter', () => {
    const onChange = vi.fn()
    renderSelect({ value: '', onChange })
    fireEvent.click(screen.getByRole('button'))
    const listbox = screen.getByRole('listbox')
    fireEvent.keyDown(listbox, { key: 'ArrowDown' })
    fireEvent.keyDown(listbox, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith({ target: { value: 'a' } })
  })
})
