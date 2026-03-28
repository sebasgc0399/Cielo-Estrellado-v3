import { describe, it, expect, vi } from 'vitest'
import { logError } from './logError.js'

describe('logError', () => {
  it('extrae message de instancias de Error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('test context', new Error('something broke'))
    expect(spy).toHaveBeenCalledWith('test context:', 'something broke')
    spy.mockRestore()
  })

  it('incluye error.code cuando existe', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const firestoreError = Object.assign(new Error('Deadline exceeded'), { code: 'deadline-exceeded' })
    logError('db query', firestoreError)
    expect(spy).toHaveBeenCalledWith('db query:', '[deadline-exceeded] Deadline exceeded')
    spy.mockRestore()
  })

  it('convierte non-Error a string', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('test context', { weird: 'object' })
    expect(spy).toHaveBeenCalledWith('test context:', '[object Object]')
    spy.mockRestore()
  })

  it('maneja null y undefined', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('null error', null)
    expect(spy).toHaveBeenCalledWith('null error:', 'null')
    logError('undefined error', undefined)
    expect(spy).toHaveBeenCalledWith('undefined error:', 'undefined')
    spy.mockRestore()
  })

  it('maneja string directo', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('string error', 'simple message')
    expect(spy).toHaveBeenCalledWith('string error:', 'simple message')
    spy.mockRestore()
  })
})
