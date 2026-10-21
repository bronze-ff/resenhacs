import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Quadro from '../pages/Quadro.jsx'

const id = '11111111-2222-3333-4444-555555555555'
const resposta = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body })
function preparar(salvar = () => Promise.resolve(resposta({ id }))) {
  const f = vi.fn((url, opts) => {
    if (opts?.method === 'POST') return salvar()
    if (url === '/api/quadros') return Promise.resolve(resposta([{ id, nome: 'Quadro salvo', map: 'de_mirage', qtdPassos: 1 }]))
    return Promise.resolve(resposta({ id, nome: 'Quadro salvo', map: 'de_mirage', meu: true, passos: [] }))
  })
  vi.stubGlobal('fetch', f)
  render(<MemoryRouter><Quadro /></MemoryRouter>)
  fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Rascunho' } })
  return f
}
afterEach(() => vi.unstubAllGlobals())

describe('Quadro — confirmação S4', () => {
  it('Novo preserva alterações ao cancelar com Esc e devolve o foco', async () => {
    preparar()
    const origem = screen.getByRole('button', { name: 'Novo' })
    origem.focus()
    fireEvent.click(origem)
    const dialogo = await screen.findByRole('dialog', { name: 'Alterações não salvas' })
    expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho')
    const ultimo = within(dialogo).getByRole('button', { name: 'Salvar' })
    ultimo.focus()
    await userEvent.tab()
    expect(dialogo).toContainElement(document.activeElement)
    await userEvent.tab({ shift: true })
    expect(ultimo).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho')
    expect(origem).toHaveFocus()
  }, 15000)

  it('Novo só apaga o rascunho depois de Descartar', async () => {
    preparar()
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Descartar' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it.each(['http', 'rede'])('falha ao salvar impede Novo: %s', async (tipo) => {
    preparar(() => tipo === 'rede' ? Promise.reject(new Error('offline')) : Promise.resolve(resposta({}, false)))
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/salvar|offline/i)
    expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('espera o salvamento confirmado antes de Novo', async () => {
    let confirmar
    preparar(() => new Promise((resolve) => { confirmar = resolve }))
    fireEvent.click(screen.getByRole('button', { name: 'Novo' }))
    const dialogo = await screen.findByRole('dialog')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Salvar' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('Rascunho')
    await act(async () => confirmar(resposta({ id })))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('Abrir salvo pede confirmação antes de abrir a lista e substituir', async () => {
    const f = preparar()
    fireEvent.click(screen.getByRole('button', { name: 'Abrir salvo' }))
    const dialogo = await screen.findByRole('dialog', { name: 'Alterações não salvas' })
    expect(f).not.toHaveBeenCalledWith('/api/quadros')
    fireEvent.click(within(dialogo).getByRole('button', { name: 'Descartar' }))
    const lista = await screen.findByRole('dialog', { name: 'Abrir quadro salvo' })
    fireEvent.click(await within(lista).findByRole('button', { name: /Quadro salvo/ }))
    expect(await screen.findByDisplayValue('Quadro salvo')).toBeInTheDocument()
  })
})
