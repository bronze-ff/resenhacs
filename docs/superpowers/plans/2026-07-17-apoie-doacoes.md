# Apoie (doações via PIX) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma página `/apoie` no Resenha mostrando uma chave PIX (texto copiável + QR
code) pra quem quiser ajudar a cobrir o custo de infra do sistema, sem cobrar nem rastrear nada.

**Architecture:** 100% client-side, sem rota nova no server nem tabela no banco. Uma função pura
monta o payload PIX (padrão BR Code/EMV do Bacen) a partir de constantes fixas (chave, nome,
cidade); uma página React renderiza esse payload como texto copiável e como QR code (gerado no
próprio navegador via a lib `qrcode`, sem chamada de rede).

**Tech Stack:** React 19 + Vite + Tailwind (client existente), lib nova `qrcode` (geração de QR
code 100% client-side, sem dependência de servidor).

## Global Constraints

- Chave PIX (aleatória): `98dea706-4b3d-4ae4-b96d-e96a6669bb8a`
- Nome do recebedor: `Filippe Faria`
- Cidade: `Aparecida de Goiania`
- Sem variável de ambiente — os 3 valores acima ficam como constantes no código (não são dados
  sensíveis, uma chave PIX é feita pra ser divulgada publicamente).
- Sem rastreio de doação, sem valor fixo/sugerido, sem exibir custos de infra na página.
- As duas formas (copiar-e-colar e QR code) ficam sempre visíveis juntas, nunca uma alternativa
  exclusiva à outra.
- Página protegida (exige sessão), mesmo padrão das demais páginas internas do Resenha.

---

### Task 1: `pix.js` — payload PIX (BR Code/EMV) + CRC16

**Files:**
- Create: `site/client/src/lib/pix.js`
- Test: `site/client/src/test/pix.test.js`

**Interfaces:**
- Produces: `montarPayloadPix({ chave, nome, cidade }) → string` — recebido pela Task 2
  (`Apoie.jsx` chama essa função com as 3 constantes do Global Constraints e usa o retorno tanto
  pro texto copiável quanto pra gerar o QR code).

- [ ] **Step 1: Escrever o teste que falha**

Crie `site/client/src/test/pix.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { montarPayloadPix } from '../lib/pix.js'

describe('montarPayloadPix', () => {
  it('monta o payload BR Code/EMV com GUI maiúsculo, nome/cidade truncados e CRC16 correto', () => {
    const payload = montarPayloadPix({
      chave: '98dea706-4b3d-4ae4-b96d-e96a6669bb8a',
      nome: 'Filippe Faria',
      cidade: 'Aparecida de Goiania',
    })
    expect(payload).toBe(
      '00020101021126580014BR.GOV.BCB.PIX013698dea706-4b3d-4ae4-b96d-e96a6669bb8a' +
      '5204000053039865802BR5913FILIPPE FARIA6015APARECIDA DE GO62070503***63047D11',
    )
  })

  it('trunca nome em 25 caracteres e converte pra maiúsculas', () => {
    const payload = montarPayloadPix({
      chave: 'x',
      nome: 'um nome de recebedor bem grande que passa de vinte e cinco',
      cidade: 'Sao Paulo',
    })
    // campo 59 = "59" + tamanho (2 digitos) + valor; tamanho tem que ser exatamente 25
    const idx = payload.indexOf('59')
    const tamanho = payload.slice(idx + 2, idx + 4)
    const valor = payload.slice(idx + 4, idx + 4 + 25)
    expect(tamanho).toBe('25')
    expect(valor).toBe('UM NOME DE RECEBEDOR BEM ')
    expect(valor.length).toBe(25)
  })

  it('trunca cidade em 15 caracteres e converte pra maiúsculas', () => {
    const payload = montarPayloadPix({
      chave: 'x',
      nome: 'Nome',
      cidade: 'Uma Cidade Com Nome Bem Grande',
    })
    const idx = payload.indexOf('60')
    const tamanho = payload.slice(idx + 2, idx + 4)
    const valor = payload.slice(idx + 4, idx + 4 + 15)
    expect(tamanho).toBe('15')
    expect(valor).toBe('UMA CIDADE COM ')
    expect(valor.length).toBe(15)
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/pix.test.js`
Expected: FAIL — `Failed to resolve import "../lib/pix.js"` (arquivo ainda não existe).

- [ ] **Step 3: Implementar `pix.js`**

Crie `site/client/src/lib/pix.js`:

```js
// Monta o payload PIX no padrão BR Code/EMV do Banco Central (o texto do "PIX copia e cola",
// que também vira o conteúdo do QR code). GUI, nome e cidade seguem maiúsculas por convenção
// do padrão — os valores originais continuam com capitalização normal em qualquer outro lugar
// da tela; a conversão é só dentro deste payload.
const GUI_PIX = 'BR.GOV.BCB.PIX'

function campo(id, valor) {
  const tamanho = String(valor.length).padStart(2, '0')
  return `${id}${tamanho}${valor}`
}

// CRC16-CCITT-FALSE: polinômio 0x1021, valor inicial 0xFFFF, sem reflexão, sem XOR final —
// exatamente o algoritmo exigido pelo campo 63 do padrão BR Code.
function crc16CcittFalse(texto) {
  let crc = 0xffff
  const poly = 0x1021
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

export function montarPayloadPix({ chave, nome, cidade }) {
  const nomeTruncado = nome.toUpperCase().slice(0, 25)
  const cidadeTruncada = cidade.toUpperCase().slice(0, 15)

  const contaPix = campo('00', GUI_PIX) + campo('01', chave)

  const semCrc =
    campo('00', '01') + // Payload Format Indicator
    campo('01', '11') + // Point of Initiation Method (estático/reutilizável)
    campo('26', contaPix) + // Merchant Account Information (PIX)
    campo('52', '0000') + // Merchant Category Code
    campo('53', '986') + // Transaction Currency (BRL)
    campo('58', 'BR') + // Country Code
    campo('59', nomeTruncado) + // Merchant Name
    campo('60', cidadeTruncada) + // Merchant City
    campo('62', campo('05', '***')) + // Additional Data Field Template (sem txid específico)
    '6304' // header do campo 63 (CRC16) — o valor vem logo em seguida

  return semCrc + crc16CcittFalse(semCrc)
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/pix.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add site/client/src/lib/pix.js site/client/src/test/pix.test.js
git commit -m "feat: monta payload PIX (BR Code/EMV) pra doacao"
```

---

### Task 2: Página `Apoie.jsx` + nav + rota

**Files:**
- Create: `site/client/src/pages/Apoie.jsx`
- Test: `site/client/src/test/Apoie.test.jsx`
- Modify: `site/client/package.json` (nova dependência `qrcode`)
- Modify: `site/client/src/components/Shell.jsx` (item de menu + renumeração)
- Modify: `site/client/src/App.jsx` (rota nova)

**Interfaces:**
- Consumes: `montarPayloadPix({ chave, nome, cidade }) → string` da Task 1
  (`site/client/src/lib/pix.js`).

- [ ] **Step 1: Instalar a dependência `qrcode`**

Run: `cd site/client && npm install qrcode`

Isso adiciona `qrcode` em `dependencies` no `site/client/package.json` (versão atual do
registro — não precisa fixar manualmente, o `npm install` já grava a versão instalada).

- [ ] **Step 2: Escrever o teste que falha**

Crie `site/client/src/test/Apoie.test.jsx`. A lib `qrcode` usa Canvas 2D pra gerar a imagem —
o jsdom (ambiente de teste) não implementa um Canvas 2D de verdade, então o módulo é
mockado (`vi.mock`) pra não depender disso; o teste só confirma que a página integra a peça
certa (chama a lib com o payload certo e usa o retorno), não a geração real de pixels:

```jsx
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
```

- [ ] **Step 3: Rodar o teste e confirmar que falha**

Run: `cd site/client && npx vitest run src/test/Apoie.test.jsx`
Expected: FAIL — `Failed to resolve import "../pages/Apoie.jsx"` (arquivo ainda não existe).

- [ ] **Step 4: Implementar `Apoie.jsx`**

Crie `site/client/src/pages/Apoie.jsx`:

```jsx
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { Card, SectionHeader } from '../components/ui'
import { montarPayloadPix } from '../lib/pix.js'

const CHAVE_PIX = '98dea706-4b3d-4ae4-b96d-e96a6669bb8a'
const NOME_PIX = 'Filippe Faria'
const CIDADE_PIX = 'Aparecida de Goiania'

export default function Apoie() {
  const payload = montarPayloadPix({ chave: CHAVE_PIX, nome: NOME_PIX, cidade: CIDADE_PIX })
  const [qrCodeUrl, setQrCodeUrl] = useState(null)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let cancelado = false
    QRCode.toDataURL(payload).then((url) => {
      if (!cancelado) setQrCodeUrl(url)
    })
    return () => {
      cancelado = true
    }
  }, [payload])

  async function copiar() {
    try {
      await navigator.clipboard.writeText(payload)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // clipboard indisponível (ex.: contexto não-HTTPS) — o texto já fica visível na tela
      // pra seleção manual, então não precisa de tratamento além de não quebrar a página.
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader titulo="Apoie o Resenha" />
      <Card className="p-6 text-center">
        <p className="mb-6 text-sm text-texto-fraco">
          O Resenha é mantido de graça pro grupo. Se ele te ajuda e você quiser contribuir com o
          custo de manter tudo no ar, qualquer valor via PIX é bem-vindo — sem pressão nenhuma.
        </p>
        {qrCodeUrl && (
          <img
            src={qrCodeUrl}
            alt="QR code PIX para doação"
            className="mx-auto mb-6 h-56 w-56 border border-borda"
          />
        )}
        <p className="mb-2 text-xs uppercase tracking-wide text-texto-fraco">Chave PIX (aleatória)</p>
        <p className="mb-4 break-all font-mono text-sm text-texto">{CHAVE_PIX}</p>
        <button
          type="button"
          onClick={copiar}
          className="panel-cut-sm border border-borda px-4 py-2 text-xs uppercase tracking-wide text-texto-fraco transition-colors hover:border-destaque/50 hover:text-destaque"
        >
          {copiado ? 'Copiado!' : 'Copiar chave PIX'}
        </button>
      </Card>
    </div>
  )
}
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `cd site/client && npx vitest run src/test/Apoie.test.jsx`
Expected: PASS.

- [ ] **Step 6: Adicionar a rota em `App.jsx`**

Em `site/client/src/App.jsx`, adicione o import logo abaixo da linha 25
(`import Tour from './pages/Tour.jsx'`):

```jsx
import Apoie from './pages/Apoie.jsx'
```

E adicione a rota logo abaixo da linha 70 (`<Route path="/conta" element={<RotaProtegida><Perfil /></RotaProtegida>} />`),
antes da rota `/admin`:

```jsx
          <Route path="/apoie" element={<RotaProtegida><Apoie /></RotaProtegida>} />
```

- [ ] **Step 7: Adicionar o item de menu em `Shell.jsx`**

Em `site/client/src/components/Shell.jsx`, o array `ITENS` (linhas 9-23) termina com:

```js
  { to: '/conta', label: 'Minha conta', num: '10', icone: 'perfil' },
]
```

Troque por (novo item `apoie`, número `11` — os dois itens de admin logo abaixo, que hoje usam
`11`/`12`, precisam subir pra `12`/`13` pra não duplicar número):

```js
  { to: '/conta', label: 'Minha conta', num: '10', icone: 'perfil' },
  { to: '/apoie', label: 'Apoie', num: '11', icone: 'apoie' },
]
```

No objeto `NAV_ICONES` (linhas 28-114), adicione o ícone `apoie` (um coração, mesmo estilo de
traço dos outros ícones) — insira logo antes da chave `admin:` (linha 93):

```js
  apoie: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
      <path d="M12 20C12 20 4 15 4 9.5C4 6.5 6.5 4 9.5 4C11 4 12 5 12 5C12 5 13 4 14.5 4C17.5 4 20 6.5 20 9.5C20 15 12 20 12 20Z" />
    </svg>
  ),
```

Nas duas `NavLink` de admin (linhas 210-234), troque os números pra não colidir com o novo
`11` de Apoie — a de `/admin` (linha 220, hoje `>11<`) vira:

```jsx
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>12</span>
```

E a de `/partidas-pro` (linha 231, hoje `>12<`) vira:

```jsx
                <span className={`font-mono text-[10px] text-texto-fraco/70 group-hover:text-destaque ${colapsada ? 'lg:hidden' : ''}`}>13</span>
```

- [ ] **Step 8: Rodar a suíte completa do client**

Run: `cd site/client && npx vitest run`
Expected: PASS (todos os testes existentes + os novos de `pix.js`/`Apoie.jsx`, zero regressão).

- [ ] **Step 9: Commit**

```bash
git add site/client/package.json site/client/package-lock.json site/client/src/pages/Apoie.jsx site/client/src/test/Apoie.test.jsx site/client/src/components/Shell.jsx site/client/src/App.jsx
git commit -m "feat: pagina Apoie (doacoes via PIX) com link no menu"
```
