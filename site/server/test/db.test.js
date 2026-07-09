import { describe, it, expect } from 'vitest'
import { createDb } from '../src/db.js'

describe('createDb', () => {
  it('expõe query e close', () => {
    const db = createDb('postgres://usuario:senha@localhost:5432/fake')
    expect(typeof db.query).toBe('function')
    expect(typeof db.close).toBe('function')
    return db.close()
  })
})
