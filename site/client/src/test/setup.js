import '@testing-library/jest-dom'
import { configure } from '@testing-library/react'

// Com a suíte inteira rodando em paralelo, o primeiro findBy de um arquivo passava de 1 s
// (o padrão) e falhava sem bug nenhum.
configure({ asyncUtilTimeout: 3000 })
