import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setupServer } from 'msw/node'
import { api, loginWithGoogle } from './api'
import { handlers } from './mocks/handlers'
import type { CartItem, OrderQuote } from './types'

const server = setupServer(...handlers)
const cart: CartItem[] = [{ nftId: 'vanta-407', quantity: 1, priceEth: '999.99' }]

beforeAll(() => {
  vi.stubGlobal('location', new URL('http://localhost'))
  api.defaults.baseURL = 'http://localhost/api'
  server.listen()
})

afterEach(() => server.resetHandlers())

afterAll(() => {
  server.close()
  api.defaults.baseURL = '/api'
  vi.unstubAllGlobals()
})

describe('mock marketplace API', () => {
  it('does not pretend Google authentication is available in demo mode', async () => {
    await expect(loginWithGoogle('http://localhost:5173/login')).rejects.toThrow(
      'O acesso com Google exige que o backend Supabase esteja configurado.',
    )
  })

  it('uses Breno Rossi for the demonstration account', async () => {
    const response = await api.post('/login', {
      email: 'collector@pixelvault.io',
      password: 'demo-pass',
    })

    expect(response.data.displayName).toBe('Breno Rossi')
    expect(response.data).not.toHaveProperty('avatar')
  })

  it('quotes catalog prices instead of trusting the submitted cart price', async () => {
    const response = await api.post<OrderQuote>('/orders/quote', {
      cart,
      couponCode: '',
    })

    expect(response.status).toBe(200)
    expect(response.data.items[0]).toMatchObject({
      nftId: 'vanta-407',
      priceEth: '0.52',
    })
    expect(response.data.totalEth).toBe('0.66')
  })

  it('returns the existing order for an idempotent retry', async () => {
    const userId = `api-test-${crypto.randomUUID()}`
    const idempotencyKey = crypto.randomUUID()
    const { data: expectedQuote } = await api.post<OrderQuote>('/orders/quote', {
      cart,
      couponCode: '',
    })
    const payload = {
      userId,
      cart,
      idempotencyKey,
      wallet: '0x1234567890abcdef',
      network: 'Base',
      couponCode: '',
      expectedQuote,
    }
    const config = {
      headers: {
        'X-User-Id': userId,
        'Idempotency-Key': idempotencyKey,
      },
    }

    const first = await api.post('/orders', payload, config)
    const retry = await api.post('/orders', payload, config)

    expect(first.status).toBe(201)
    expect(retry.status).toBe(200)
    expect(retry.data.id).toBe(first.data.id)
  })

  it('rejects a stale quote without creating an order', async () => {
    const userId = `api-test-${crypto.randomUUID()}`
    const idempotencyKey = crypto.randomUUID()
    const { data: currentQuote } = await api.post<OrderQuote>('/orders/quote', {
      cart,
      couponCode: '',
    })
    const staleQuote = { ...currentQuote, totalEth: '99.99' }

    await expect(
      api.post(
        '/orders',
        {
          userId,
          cart,
          idempotencyKey,
          wallet: '0x1234567890abcdef',
          network: 'Base',
          couponCode: '',
          expectedQuote: staleQuote,
        },
        {
          headers: {
            'X-User-Id': userId,
            'Idempotency-Key': idempotencyKey,
          },
        },
      ),
    ).rejects.toThrow('Os preços ou a disponibilidade mudaram.')
  })

  it('rejects duplicate NFT lines that together exceed the inventory', async () => {
    await expect(
      api.post('/orders/quote', {
        cart: [
          { nftId: 'vanta-407', quantity: 3, priceEth: '0.52' },
          { nftId: 'vanta-407', quantity: 3, priceEth: '0.52' },
        ],
        couponCode: '',
      }),
    ).rejects.toThrow('excede o estoque')
  })
})
