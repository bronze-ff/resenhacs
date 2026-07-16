import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import PassoAPassoSteam from '../components/PassoAPassoSteam.jsx'

describe('PassoAPassoSteam', () => {
  it('mostra o link de ajuda da Steam e os dois formatos de código', () => {
    const { getByRole, getByText } = render(<PassoAPassoSteam />)
    const link = getByRole('link', { name: /steam.*ajuda/i })
    expect(link).toHaveAttribute(
      'href',
      'https://help.steampowered.com/en/wizard/HelpWithGameIssue/?appid=730&issueid=128',
    )
    expect(getByText('XXXX-XXXXX-XXXX')).toBeInTheDocument()
    expect(getByText('CSGO-xxxxx-xxxxx-xxxxx-xxxxx-xxxxx')).toBeInTheDocument()
    expect(getByText(/gerenciar meus códigos de autenticação/i)).toBeInTheDocument()
  })
})
