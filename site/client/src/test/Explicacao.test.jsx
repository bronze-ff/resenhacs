import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Explicacao from '../components/ui/Explicacao.jsx'
import { METRICAS } from '../lib/metricas.js'

describe('Explicacao', () => {
  it('clique no rótulo abre o que é, a unidade e a leitura; Escape fecha', () => {
    render(<Explicacao metrica={METRICAS.semTroca}>Mortes sem troca</Explicacao>)
    const rotulo = screen.getByRole('button', { name: 'Mortes sem troca' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(rotulo)
    const painel = screen.getByRole('dialog', { name: 'Mortes sem troca' })
    expect(painel).toHaveTextContent('ninguém do time vingou em até 5 s')
    expect(painel).toHaveTextContent('Unidade')
    expect(painel).toHaveTextContent('Quanto menor, melhor.')
    expect(rotulo).toHaveAttribute('aria-expanded', 'true')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('sem métrica, mostra só o rótulo', () => {
    render(<Explicacao metrica={null}>Algo</Explicacao>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Algo')).toBeInTheDocument()
  })
})
