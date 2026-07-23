import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,fake') },
}))

import Apoie from '../pages/Apoie.jsx'

describe('Apoie', () => {
  it('mostra a chave PIX, o botão de copiar e o QR code', async () => {
    render(<Apoie />)
    expect(screen.getByText('98dea706-4b3d-4ae4-b96d-e96a6669bb8a')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copiar/i })).toBeInTheDocument()
    const img = await screen.findByRole('img', { name: /qr code/i })
    expect(img).toHaveAttribute('src', 'data:image/png;base64,fake')
  })
})
