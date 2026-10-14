import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Modal from '../components/ui/Modal.jsx'

function DoisModais({ onFecharFora, onFecharDentro }) {
  return (
    <>
      <Modal visivel onFechar={onFecharFora} titulo="Tática">fora</Modal>
      <Modal visivel onFechar={onFecharDentro} titulo="Granada" camada="z-[60]">dentro</Modal>
    </>
  )
}

describe('Modal empilhado', () => {
  it('desmontar os dois juntos devolve o scroll original do body', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(<DoisModais />)
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })

  it('Escape fecha só o modal do topo', () => {
    const fora = vi.fn()
    const dentro = vi.fn()
    const { unmount } = render(<DoisModais onFecharFora={fora} onFecharDentro={dentro} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(dentro).toHaveBeenCalledTimes(1)
    expect(fora).not.toHaveBeenCalled()
    unmount()
  })
})
