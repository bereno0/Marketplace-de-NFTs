import { http, HttpResponse } from 'msw'
import { nftCatalog } from '../mockData'
import { calculateOrderQuote, isCartItemList } from '../orderValidation'
import type { CartItem, Order, OrderQuote, Wallet } from '../types'

const MOCK_STATE_KEY = 'nft-marketplace-msw-state'

// Estado da API simulada, persistido no navegador; não substitui um backend compartilhado.
type PersistedMockState = {
  orders?: Array<[string, { payload: string; order: Order }]>
  favorites?: Array<[string, string[]]>
  profiles?: Array<[string, string]>
  wallets?: Array<[string, Wallet]>
}

function loadMockState(): PersistedMockState {
  if (typeof localStorage === 'undefined') return {}
  const saved = localStorage.getItem(MOCK_STATE_KEY)
  if (!saved) return {}
  try {
    return JSON.parse(saved) as PersistedMockState
  } catch {
    localStorage.removeItem(MOCK_STATE_KEY)
    return {}
  }
}

const persistedState = loadMockState()
const ordersByKey = new Map(persistedState.orders ?? [])
const favoriteIdsByUser = new Map<string, Set<string>>([
  ['user-01', new Set(['aurora-001', 'vanta-407'])],
  ...(persistedState.favorites ?? []).map(([userId, favoriteIds]) => [
    userId,
    new Set(favoriteIds),
  ] as [string, Set<string>]),
])
const displayNamesByUser = new Map<string, string>([
  ['user-01', 'Breno Rossi'],
  ...(persistedState.profiles ?? []).map(([userId, displayName]) => [
    userId,
    userId === 'user-01' && displayName === 'Ava Ledger' ? 'Breno Rossi' : displayName,
  ] as [string, string]),
])
const primaryWalletByUser = new Map<string, Wallet>([
  [
    'user-01',
    {
      id: 'wallet-primary',
      address: '0xA7f8...C4b2',
      network: 'Ethereum Mainnet',
      primary: true,
    },
  ],
  ...(persistedState.wallets ?? []),
])

function persistMockState() {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(
    MOCK_STATE_KEY,
    JSON.stringify({
      orders: [...ordersByKey],
      favorites: [...favoriteIdsByUser].map(([userId, favorites]) => [
        userId,
        [...favorites],
      ]),
      profiles: [...displayNamesByUser],
      wallets: [...primaryWalletByUser],
    } satisfies PersistedMockState),
  )
}

function getUserId(request: Request) {
  return request.headers.get('X-User-Id')
}

export const handlers = [
  http.get('/api/nfts', ({ request }) => {
    const url = new URL(request.url)
    const category = url.searchParams.get('category') ?? 'all'
    const query = (url.searchParams.get('query') ?? '').toLowerCase()
    const sort = url.searchParams.get('sort') ?? 'popular'
    const requestedPage = Number(url.searchParams.get('page') ?? '1')
    const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
    const pageSize = 4

    const items = nftCatalog.filter((nft) => {
      const matchesCategory = category === 'all' || nft.category === category
      const matchesQuery =
        !query ||
        nft.title.toLowerCase().includes(query) ||
        nft.collection.toLowerCase().includes(query) ||
        nft.creator.toLowerCase().includes(query) ||
        nft.description.toLowerCase().includes(query)
      return matchesCategory && matchesQuery
    })

    const sorted = [...items].sort((a, b) => {
      if (sort === 'price-low') return Number(a.priceEth) - Number(b.priceEth)
      if (sort === 'price-high') return Number(b.priceEth) - Number(a.priceEth)
      if (sort === 'newest') {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt)
      }
      return b.likes - a.likes
    })

    const startIndex = (page - 1) * pageSize
    return HttpResponse.json({
      items: sorted.slice(startIndex, startIndex + pageSize),
      total: sorted.length,
      page,
      pageSize,
    })
  }),

  http.get('/api/nfts/:id', ({ params }) => {
    const nft = nftCatalog.find((entry) => entry.id === params.id)
    if (!nft) {
      return HttpResponse.json({ message: 'NFT não encontrado.' }, { status: 404 })
    }
    return HttpResponse.json(nft)
  }),

  http.post('/api/login', async ({ request }) => {
    const payload = (await request.json()) as { email?: string; password?: string }
    if (
      !payload.email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      !payload.password ||
      payload.password.length < 8
    ) {
      return HttpResponse.json(
        { message: 'Informe um e-mail válido e uma senha com pelo menos 8 caracteres.' },
        { status: 400 },
      )
    }
    const userId =
      payload.email.toLowerCase() === 'collector@pixelvault.io'
        ? 'user-01'
        : `user-${payload.email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    const displayName = displayNamesByUser.get(userId) ??
      (userId === 'user-01' ? 'Breno Rossi' : 'Colecionador KURIO')
    if (!favoriteIdsByUser.has(userId)) favoriteIdsByUser.set(userId, new Set())
    if (!displayNamesByUser.has(userId)) displayNamesByUser.set(userId, displayName)
    if (!primaryWalletByUser.has(userId)) {
      primaryWalletByUser.set(userId, {
        id: 'wallet-primary',
        address: '0xA7f8...C4b2',
        network: 'Ethereum Mainnet',
        primary: true,
      })
    }
    persistMockState()

    return HttpResponse.json({
      id: userId,
      email: payload.email,
      displayName,
      wallet: primaryWalletByUser.get(userId)?.address ?? '0xA7f8...C4b2',
      network: primaryWalletByUser.get(userId)?.network ?? 'Ethereum Mainnet',
      favoriteIds: [...(favoriteIdsByUser.get(userId) ?? [])],
    })
  }),

  http.post('/api/signup', async ({ request }) => {
    const payload = (await request.json()) as {
      name?: string
      email?: string
      password?: string
    }
    if (
      !payload.name ||
      payload.name.trim().length < 2 ||
      payload.name.trim().length > 40 ||
      !payload.email ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ||
      !payload.password ||
      payload.password.length < 8
    ) {
      return HttpResponse.json(
        { message: 'Informe um nome entre 2 e 40 caracteres, um e-mail válido e uma senha com pelo menos 8 caracteres.' },
        { status: 400 },
      )
    }
    if (payload.email.toLowerCase() === 'collector@pixelvault.io') {
      return HttpResponse.json(
        { message: 'Já existe uma conta com este e-mail.' },
        { status: 409 },
      )
    }
    const userId = `user-${payload.email.toLowerCase().replace(/[^a-z0-9]/g, '-')}`
    const displayName = payload.name.trim()
    favoriteIdsByUser.set(userId, new Set())
    displayNamesByUser.set(userId, displayName)
    primaryWalletByUser.set(userId, {
      id: 'wallet-primary',
      address: '0xE3d1...A920',
      network: 'Ethereum Mainnet',
      primary: true,
    })
    persistMockState()
    return HttpResponse.json({
      id: userId,
      email: payload.email,
      displayName,
      wallet: '0xE3d1...A920',
      network: 'Ethereum Mainnet',
      favoriteIds: [],
    })
  }),

  http.get('/api/favorites', ({ request }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    return HttpResponse.json({ favoriteIds: [...(favoriteIdsByUser.get(userId) ?? [])] })
  }),

  http.post('/api/favorites', async ({ request }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    const payload = (await request.json()) as { nftId?: string }
    if (!payload.nftId || !nftCatalog.some((nft) => nft.id === payload.nftId)) {
      return HttpResponse.json({ message: 'NFT não encontrado.' }, { status: 404 })
    }
    const favorites = favoriteIdsByUser.get(userId) ?? new Set<string>()
    favorites.add(payload.nftId)
    favoriteIdsByUser.set(userId, favorites)
    persistMockState()
    return HttpResponse.json({ favoriteIds: [...favorites] })
  }),

  http.delete('/api/favorites/:nftId', ({ request, params }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    const favorites = favoriteIdsByUser.get(userId) ?? new Set<string>()
    favorites.delete(String(params.nftId))
    favoriteIdsByUser.set(userId, favorites)
    persistMockState()
    return HttpResponse.json({ favoriteIds: [...favorites] })
  }),

  http.get('/api/profile', ({ request }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    const displayName = displayNamesByUser.get(userId)
    if (!displayName) return HttpResponse.json({ message: 'Perfil não encontrado.' }, { status: 404 })
    return HttpResponse.json({ displayName })
  }),

  http.patch('/api/profile', async ({ request }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    const payload = (await request.json()) as { displayName?: string }
    const displayName = payload.displayName?.trim()
    if (!displayName || displayName.length < 2 || displayName.length > 40) {
      return HttpResponse.json(
        { message: 'O nome de exibição deve ter entre 2 e 40 caracteres.' },
        { status: 400 },
      )
    }
    displayNamesByUser.set(userId, displayName)
    persistMockState()
    return HttpResponse.json({ displayName })
  }),

  http.get('/api/wallets', ({ request }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    const wallet = primaryWalletByUser.get(userId)
    if (!wallet) return HttpResponse.json({ message: 'Carteira não encontrada.' }, { status: 404 })
    return HttpResponse.json([wallet])
  }),

  http.put('/api/wallets/primary', async ({ request }) => {
    const userId = getUserId(request)
    if (!userId) return HttpResponse.json({ message: 'Entre na sua conta para continuar.' }, { status: 401 })
    const payload = (await request.json()) as { address?: string }
    const address = payload.address?.trim()
    if (!address || !address.startsWith('0x') || address.length < 8 || address.length > 64) {
      return HttpResponse.json({ message: 'Informe um endereço de carteira válido.' }, { status: 400 })
    }
    const previous = primaryWalletByUser.get(userId)
    const wallet: Wallet = {
      id: previous?.id ?? 'wallet-primary',
      address,
      network: previous?.network ?? 'Ethereum Mainnet',
      primary: true,
    }
    primaryWalletByUser.set(userId, wallet)
    persistMockState()
    return HttpResponse.json(wallet)
  }),

  http.post('/api/orders/quote', async ({ request }) => {
    const payload = (await request.json()) as {
      cart?: unknown
      couponCode?: string
    }
    if (!isCartItemList(payload.cart)) {
      return HttpResponse.json({ message: 'Os dados do pedido estão incompletos.' }, { status: 400 })
    }
    const result = calculateOrderQuote(payload.cart, payload.couponCode ?? '')
    if ('error' in result) {
      return HttpResponse.json({ message: result.error }, { status: result.status })
    }
    return HttpResponse.json(result.quote)
  }),

  http.post('/api/orders', async ({ request }) => {
    const userId = getUserId(request)
    if (!userId) {
      return HttpResponse.json({ message: 'É necessário entrar na sua conta.' }, { status: 401 })
    }
    const payload = (await request.json()) as {
      cart?: CartItem[]
      idempotencyKey?: string
      wallet?: string
      network?: string
      couponCode?: string
      expectedQuote?: OrderQuote
    }
    const idempotencyKey =
      request.headers.get('Idempotency-Key') ?? payload.idempotencyKey ?? ''
    const scopedIdempotencyKey = `${userId}:${idempotencyKey}`

    if (
      !idempotencyKey ||
      !payload.wallet?.trim() ||
      !payload.network?.trim() ||
      !isCartItemList(payload.cart)
    ) {
      return HttpResponse.json({ message: 'Os dados do pedido estão incompletos.' }, { status: 400 })
    }

    const requestSnapshot = JSON.stringify({
      cart: payload.cart,
      wallet: payload.wallet,
      network: payload.network,
      couponCode: payload.couponCode ?? '',
      expectedQuote: payload.expectedQuote ?? null,
    })
    const previousAttempt = ordersByKey.get(scopedIdempotencyKey)

    if (previousAttempt) {
      if (previousAttempt.payload !== requestSnapshot) {
        return HttpResponse.json(
          { message: 'Esta chave já foi usada para um pedido com dados diferentes.' },
          { status: 409 },
        )
      }
      return HttpResponse.json(previousAttempt.order)
    }

    if (!payload.expectedQuote) {
      return HttpResponse.json(
        { message: 'Atualize os valores do pedido antes de confirmar a compra.' },
        { status: 400 },
      )
    }

    const quoteResult = calculateOrderQuote(payload.cart, payload.couponCode ?? '')
    if ('error' in quoteResult) {
      return HttpResponse.json({ message: quoteResult.error }, { status: quoteResult.status })
    }
    if (JSON.stringify(payload.expectedQuote) !== JSON.stringify(quoteResult.quote)) {
      return HttpResponse.json(
        { message: 'Os preços ou a disponibilidade mudaram. Revise os valores atualizados antes de confirmar.' },
        { status: 409 },
      )
    }

    const quote = quoteResult.quote
    const order: Order = {
      id: `ord-${crypto.randomUUID()}`,
      status: payload.wallet.toLowerCase() === '0xdecline' ? 'declined' : 'confirmed',
      txHash: payload.wallet.toLowerCase() === '0xdecline' ? '' : '0xC54C...4F12',
      ...quote,
      wallet: payload.wallet,
      network: payload.network,
      createdAt: new Date().toISOString(),
    }

    ordersByKey.set(scopedIdempotencyKey, {
      payload: requestSnapshot,
      order,
    })
    persistMockState()
    return HttpResponse.json(order, { status: 201 })
  }),
]
