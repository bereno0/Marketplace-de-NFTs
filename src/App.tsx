import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  useLocation,
  useNavigate,
  useParams,
} from '@tanstack/react-router'
import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createOrder,
  fetchFavorites,
  fetchNftById,
  fetchNfts,
  fetchOrderQuote,
  fetchProfile,
  fetchWallets,
  logoutUser,
  loginUser,
  loginWithGoogle,
  restoreUserSession,
  signUpUser,
  subscribeToSignOut,
  updateFavorite,
  updatePrimaryWallet,
  updateProfile,
} from './api'
import { isSupabaseMode } from './backend'
import { defaultSession, nftCatalog } from './mockData'
import type { CartItem, FilterState, Nft, Order, UserSession } from './types'
import './App.css'

const CART_STORAGE_KEY = 'nft-marketplace-cart'
const SESSION_STORAGE_KEY = 'nft-marketplace-session'
const ORDER_STORAGE_KEY = 'nft-marketplace-last-order'
const ATTEMPT_STORAGE_KEY = 'nft-marketplace-checkout-attempt'
const COUPON_STORAGE_KEY = 'nft-marketplace-coupon'
const DEMO_CART_INITIALIZED_KEY = 'nft-marketplace-demo-cart-initialized'
const SESSION_TTL_MS = 30 * 60 * 1000

type StoredSession = {
  session: UserSession
  expiresAt: number
}

function readStorage<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  const value = localStorage.getItem(key)
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    localStorage.removeItem(key)
    return fallback
  }
}

function writeStorage<T>(key: string, value: T) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

function removeStorage(key: string) {
  if (typeof window === 'undefined') return
  localStorage.removeItem(key)
}

function getCheckoutAttempt(fingerprint: string) {
  const saved = readStorage<{ fingerprint: string; key: string } | null>(
    ATTEMPT_STORAGE_KEY,
    null,
  )
  // Mantém a mesma chave somente se os dados do pedido não mudaram durante uma tentativa.
  if (saved?.fingerprint === fingerprint) return saved.key

  const attempt = { fingerprint, key: crypto.randomUUID() }
  writeStorage(ATTEMPT_STORAGE_KEY, attempt)
  return attempt.key
}

function readStoredSession(): StoredSession | null {
  const stored = readStorage<StoredSession | UserSession | null>(SESSION_STORAGE_KEY, null)
  if (!stored) return null
  if ('session' in stored) {
    if (stored.expiresAt <= Date.now()) return null
    return {
      ...stored,
      session: {
        ...stored.session,
        displayName:
          stored.session.displayName === 'Ava Ledger'
            ? 'Breno Rossi'
            : stored.session.displayName,
      },
    }
  }
  return null
}

type CartContextValue = {
  items: CartItem[]
  addItem: (nft: Nft, quantity?: number) => void
  updateQuantity: (nftId: string, quantity: number, maxAvailable?: number) => void
  removeItem: (nftId: string) => void
  clearCart: () => void
}

const CartContext = React.createContext<CartContextValue | undefined>(undefined)

function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(() => {
    const savedItems = readStorage<CartItem[] | null>(CART_STORAGE_KEY, null)
    const demoCartInitialized =
      typeof window !== 'undefined' &&
      localStorage.getItem(DEMO_CART_INITIALIZED_KEY) === 'true'
    // A sacola de exemplo aparece apenas na primeira visita; depois prevalece o estado salvo.
    if (isSupabaseMode || demoCartInitialized) return savedItems ?? []
    if (savedItems?.length) return savedItems
    return nftCatalog.slice(0, 3).map((nft) => ({
      nftId: nft.id,
      quantity: 1,
      priceEth: nft.priceEth,
    }))
  })

  useEffect(() => {
    writeStorage(CART_STORAGE_KEY, items)
    if (!isSupabaseMode) {
      localStorage.setItem(DEMO_CART_INITIALIZED_KEY, 'true')
    }
  }, [items])

  const addItem: CartContextValue['addItem'] = (nft, quantity = 1) => {
    setItems((current) => {
      const existing = current.find((item) => item.nftId === nft.id)
      const nextQuantity = (existing?.quantity ?? 0) + quantity
      if (!Number.isInteger(quantity) || quantity < 1 || nextQuantity > nft.available) {
        return current
      }
      if (existing) {
        return current.map((item) =>
          item.nftId === nft.id ? { ...item, quantity: nextQuantity } : item,
        )
      }
      return [...current, { nftId: nft.id, quantity, priceEth: nft.priceEth }]
    })
  }

  const updateQuantity = (
    nftId: string,
    quantity: number,
    maxAvailable?: number,
  ) => {
    setItems((current) => {
      const nft = nftCatalog.find((entry) => entry.id === nftId)
      if (quantity <= 0) return current.filter((item) => item.nftId !== nftId)
      const inventory = maxAvailable ?? nft?.available
      if (
        (!isSupabaseMode && !nft) ||
        !Number.isInteger(quantity) ||
        (inventory !== undefined && quantity > inventory)
      ) {
        return current
      }
      return current.map((item) =>
        item.nftId === nftId ? { ...item, quantity } : item,
      )
    })
  }

  const removeItem = (nftId: string) => {
    setItems((current) => current.filter((item) => item.nftId !== nftId))
  }

  const clearCart = () => setItems([])

  return (
    <CartContext.Provider value={{ items, addItem, updateQuantity, removeItem, clearCart }}>
      {children}
    </CartContext.Provider>
  )
}

function useCart() {
  const context = React.useContext(CartContext)
  if (!context) {
    throw new Error('useCart must be used inside CartProvider')
  }
  return context
}

type SessionContextValue = {
  session: UserSession | null
  setSession: React.Dispatch<React.SetStateAction<UserSession | null>>
  isLoading: boolean
  error: string | null
  logout: () => Promise<void>
}

const SessionContext = React.createContext<SessionContextValue | undefined>(undefined)

function SessionProvider({ children }: { children: React.ReactNode }) {
  const [sessionRecord, setSessionRecord] = useState<StoredSession | null>(() =>
    isSupabaseMode ? null : readStoredSession(),
  )
  const [isLoading, setIsLoading] = useState(isSupabaseMode)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const session = sessionRecord?.session ?? null
  const clearPrivateState = useCallback(() => {
    removeStorage(ORDER_STORAGE_KEY)
    removeStorage(ATTEMPT_STORAGE_KEY)
    queryClient.removeQueries({
      predicate: (query) =>
        ['favorites', 'profile', 'wallets', 'orders', 'session'].includes(
          String(query.queryKey[0]),
        ),
    })
  }, [queryClient])

  const setSession: SessionContextValue['setSession'] = (nextSession) => {
    setError(null)
    setSessionRecord((current) => {
      const resolved =
        typeof nextSession === 'function'
          ? nextSession(current?.session ?? null)
          : nextSession
      return resolved
        ? {
            session: resolved,
            expiresAt: isSupabaseMode ? Number.MAX_SAFE_INTEGER : Date.now() + SESSION_TTL_MS,
          }
        : null
    })
  }

  useEffect(() => {
    const unsubscribe = subscribeToSignOut(() => {
      setSession(null)
      clearPrivateState()
    })

    if (isSupabaseMode) {
      let active = true
      // Após o retorno do OAuth, o Supabase já guardou a sessão no navegador.
      void restoreUserSession()
        .then((restoredSession) => {
          if (active) {
            setSession(restoredSession)
            if (restoredSession && window.location.pathname === '/login') {
              redirectAfterAuthentication()
            }
          }
        })
        .catch((restoreError: unknown) => {
          if (active) {
            setError(
              restoreError instanceof Error
                ? restoreError.message
                : 'Não foi possível restaurar sua sessão.',
            )
          }
        })
        .finally(() => {
          if (active) setIsLoading(false)
        })

      return () => {
        active = false
        unsubscribe()
      }
    }

    return unsubscribe
  }, [clearPrivateState])

  useEffect(() => {
    if (!sessionRecord) {
      removeStorage(SESSION_STORAGE_KEY)
      return
    }

    if (isSupabaseMode) return

    writeStorage(SESSION_STORAGE_KEY, sessionRecord)
    const remainingTime = Math.max(0, sessionRecord.expiresAt - Date.now())
    const timerId = window.setTimeout(() => {
      setSessionRecord((current) =>
        current?.expiresAt === sessionRecord.expiresAt ? null : current,
      )
    }, remainingTime)
    return () => window.clearTimeout(timerId)
  }, [sessionRecord])

  const logout = async () => {
    await logoutUser()
    setSession(null)
    clearPrivateState()
  }

  return (
    <SessionContext.Provider value={{ session, setSession, isLoading, error, logout }}>
      {children}
    </SessionContext.Provider>
  )
}

function useSession() {
  const context = React.useContext(SessionContext)
  if (!context) {
    throw new Error('useSession must be used inside SessionProvider')
  }
  return context
}

function useToggleFavorite() {
  const { session, setSession } = useSession()
  const queryClient = useQueryClient()
  const favoritesQueryKey = ['favorites', session?.id]

  return useMutation({
    mutationFn: async ({ nftId, favorite }: { nftId: string; favorite: boolean }) => {
      if (!session) throw new Error('Entre na sua conta para gerenciar favoritos.')
      return updateFavorite(session.id, nftId, favorite)
    },
    onMutate: ({ nftId, favorite }) => {
      if (!session) return { previous: null as string[] | null }
      const previous =
        queryClient.getQueryData<string[]>(favoritesQueryKey) ??
        session.favoriteIds ??
        []
      const next = favorite
        ? [...new Set([...previous, nftId])]
        : previous.filter((id) => id !== nftId)
      setSession((current) => (current ? { ...current, favoriteIds: next } : current))
      queryClient.setQueryData(favoritesQueryKey, next)
      return { previous }
    },
    onError: (_error, _nftId, context) => {
      if (!session || !context?.previous) return
      setSession((current) =>
        current ? { ...current, favoriteIds: context.previous ?? [] } : current,
      )
      queryClient.setQueryData(favoritesQueryKey, context.previous)
    },
    onSuccess: (favoriteIds) => {
      if (!session) return
      setSession((current) => (current ? { ...current, favoriteIds } : current))
      queryClient.setQueryData(favoritesQueryKey, favoriteIds)
    },
  })
}

function formatEth(value: string) {
  return `${Number(value).toFixed(2)} ETH`
}

function formatNetwork(network: string) {
  const labels: Record<string, string> = {
    'Ethereum Mainnet': 'Rede principal do Ethereum',
    Base: 'Base',
    Polygon: 'Polygon',
  }
  return labels[network] ?? network
}

function AppShell() {
  const { cartCount } = useCartCounter()
  const { session, logout } = useSession()
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const location = useLocation()
  const navigate = useNavigate()

  const navLinks = [
    { to: '/', label: 'Início' },
    { to: '/#catalog', label: 'Mercado' },
    { to: '/#creators', label: 'Criadores' },
    { to: '/#learn', label: 'Aprenda' },
  ]
  const mobileNavLinks = [
    { to: '/', label: 'Início' },
    { to: '/#catalog', label: 'Mercado' },
    { to: '/cart', label: 'Carrinho' },
    { to: '/profile', label: 'Perfil' },
    { to: '/wallets', label: 'Carteiras' },
  ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-wrap">
          <div className="brand-mark">K</div>
          <p className="brand-name">KURIO</p>
        </div>

        <nav className="main-nav" aria-label="Navegação principal">
          {navLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              className={
                (link.to === '/'
                  ? location.pathname === '/' && !location.hash
                  : location.pathname === '/' && location.hash === link.to.slice(1))
                  ? 'nav-link active'
                  : 'nav-link'
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="header-actions">
          <Link to="/#catalog" className="header-search" aria-label="Buscar na coleção">
            ⌕
          </Link>
          <Link to="/cart" className="icon-pill" aria-label="Abrir carrinho">
            Sacola <span>{cartCount}</span>
          </Link>
          {session ? (
            <>
              <Link to="/profile" className="account-button">
                {session.displayName}
              </Link>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setLogoutError(null)
                  void logout()
                    .then(() => navigate({ to: '/' }))
                    .catch((logoutFailure: unknown) =>
                      setLogoutError(
                        logoutFailure instanceof Error
                          ? logoutFailure.message
                          : 'Não foi possível encerrar sua sessão.',
                      ),
                    )
                }}
              >
                Sair
              </button>
            </>
          ) : (
            <Link to="/login" className="primary-button small">
              Entrar
            </Link>
          )}
        </div>
      </header>
      <nav className="mobile-nav" aria-label="Navegação móvel">
        {mobileNavLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className={
              (link.to === '/'
                ? location.pathname === '/' && !location.hash
                : link.to === '/#catalog'
                  ? location.pathname === '/' && location.hash === '#catalog'
                  : location.pathname === link.to)
                ? 'nav-link active'
                : 'nav-link'
            }
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <main className="page-shell">
        {!isSupabaseMode ? (
          <p className="demo-banner" role="status">
            Demonstração: os dados ficam neste navegador. Nenhum pagamento ou transação real é realizado.
          </p>
        ) : null}
        {logoutError ? <p className="status-card error" role="alert">{logoutError}</p> : null}
        <Outlet />
      </main>
    </div>
  )
}

const LOGIN_REDIRECT_KEY = 'nft-marketplace-login-redirect'

function RequireSession({ children }: { children: React.ReactNode }) {
  const { session, isLoading, error } = useSession()
  const location = useLocation()

  if (isLoading) {
    return <div className="status-card" role="status">Verificando sua sessão...</div>
  }
  if (error) {
    return <div className="status-card error" role="alert">{error}</div>
  }

  if (!session) {
    return (
      <div className="status-card">
        <h2>Entre na sua conta</h2>
        <p>Faça login para acessar seu perfil e seus pedidos.</p>
        <Link
          to="/login"
          className="primary-button"
          onClick={() =>
            writeStorage(
              LOGIN_REDIRECT_KEY,
              `${location.pathname}${location.searchStr}${location.hash}`,
            )
          }
        >
          Ir para o login
        </Link>
      </div>
    )
  }

  return <>{children}</>
}

function redirectAfterAuthentication() {
  const target = readStorage<string>(LOGIN_REDIRECT_KEY, '/')
  removeStorage(LOGIN_REDIRECT_KEY)

  // Aceita somente caminhos internos para não redirecionar a pessoa para outro domínio.
  if (target.startsWith('/') && !target.startsWith('//') && !['/login', '/signup'].includes(target)) {
    router.history.push(target)
    return
  }
  router.history.push('/')
}

function requestLogin(returnTo: string) {
  writeStorage(LOGIN_REDIRECT_KEY, returnTo)
  void router.navigate({ to: '/login' })
}

function useCartCounter() {
  const { items } = useCart()
  const cartCount = useMemo(
    () => items.reduce((total, item) => total + item.quantity, 0),
    [items],
  )

  return { cartCount }
}

function parseCatalogPage(value: string | null) {
  const page = Number(value)
  return Number.isSafeInteger(page) && page > 0 && page <= 2147483647 ? page : 1
}

function buildHomepageUrl(current: FilterState, next: Partial<FilterState>) {
  const resolved = { ...current, ...next }
  const nextParams = new URLSearchParams()
  if (resolved.query) nextParams.set('query', resolved.query)
  if (resolved.category && resolved.category !== 'all') nextParams.set('category', resolved.category)
  if (resolved.sort && resolved.sort !== 'popular') nextParams.set('sort', resolved.sort)
  if (resolved.page && resolved.page > 1) nextParams.set('page', String(resolved.page))

  const search = nextParams.toString()
  return search ? `/?${search}` : '/'
}

function HomePage() {
  const searchStr = useLocation({ select: (location) => location.searchStr })
  const filters = useMemo<FilterState>(() => {
    const params = new URLSearchParams(searchStr)
    return {
      query: params.get('query') ?? '',
      category: params.get('category') ?? 'all',
      sort: (params.get('sort') as FilterState['sort']) ?? 'popular',
      page: parseCatalogPage(params.get('page')),
    }
  }, [searchStr])
  const navigate = useNavigate()
  const { items, addItem } = useCart()
  const { session } = useSession()
  const toggleFavorite = useToggleFavorite()
  const featuredQuery = useQuery({
    queryKey: ['nft-detail', 'vanta-407'],
    queryFn: () => fetchNftById('vanta-407'),
    staleTime: 30000,
  })
  const featuredNft =
    featuredQuery.data ??
    nftCatalog.find((nft) => nft.id === 'vanta-407') ??
    nftCatalog[0]

  const nftQuery = useQuery({
    queryKey: ['nfts', filters],
    queryFn: () => fetchNfts(filters),
    staleTime: 30000,
  })

  const favoritesQuery = useQuery({
    queryKey: ['favorites', session?.id],
    queryFn: () => fetchFavorites(session!.id),
    enabled: Boolean(session),
    staleTime: 30000,
  })

  const totalItems = nftQuery.data?.total ?? 0
  const pageItems = nftQuery.data?.items ?? []
  const totalPages = nftQuery.data
    ? Math.max(1, Math.ceil(nftQuery.data.total / nftQuery.data.pageSize))
    : 1

  useEffect(() => {
    if (nftQuery.data && filters.page > totalPages) {
      void navigate({
        to: buildHomepageUrl(filters, { page: totalPages }),
        replace: true,
      })
    }
  }, [
    filters.category,
    filters.page,
    filters.query,
    filters.sort,
    filters,
    navigate,
    nftQuery.data,
    totalPages,
  ])

  return (
    <div className="stacked-page">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">Coleções selecionadas</p>
          <h1>Seja dono do futuro da arte digital.</h1>
          <p className="subtle-copy">
            Descubra NFTs de criadores independentes e encontre peças que contam a sua história.
          </p>
          <div className="hero-actions">
            <Link to="/#catalog" className="primary-button">
              Explorar coleção
            </Link>
            <Link to="/profile" className="secondary-button">
              Minha coleção
            </Link>
          </div>
        </div>

        <Link to={`/nft/${featuredNft.id}`} className="hero-feature">
          <img src={featuredNft.image} alt={featuredNft.title} />
          <span className="hero-feature-copy">
            <span className="metric-label">NFT em destaque · {featuredNft.collection}</span>
            <strong>{featuredNft.title}</strong>
            <span>{formatEth(featuredNft.priceEth)}</span>
          </span>
        </Link>
      </section>

      <div className="catalog-layout">
        <aside className="catalog-sidebar">
          <section className="toolbar-panel" id="catalog">
            <p className="eyebrow filter-heading">Encontre sua próxima peça</p>
        <div className="toolbar-group">
          <label>
            <span>Buscar NFTs</span>
            <input
              type="search"
              value={filters.query}
              placeholder="Nome, coleção ou criador"
              onChange={(event) => navigate({ to: buildHomepageUrl(filters, { query: event.target.value, page: 1 }) })}
            />
          </label>
        </div>

        <div className="toolbar-group inline">
          <label>
            <span>Categoria</span>
            <select
              value={filters.category}
              onChange={(event) => navigate({ to: buildHomepageUrl(filters, { category: event.target.value, page: 1 }) })}
            >
              <option value="all">Todas</option>
              <option value="art">Arte</option>
              <option value="gaming">Games</option>
              <option value="music">Música</option>
              <option value="photography">Fotografia</option>
              <option value="utility">Utilidade</option>
              <option value="fashion">Moda</option>
            </select>
          </label>

          <label>
            <span>Ordenar</span>
            <select
              value={filters.sort}
              onChange={(event) => navigate({ to: buildHomepageUrl(filters, { sort: event.target.value as FilterState['sort'], page: 1 }) })}
            >
              <option value="popular">Em alta</option>
              <option value="price-low">Menor preço</option>
              <option value="price-high">Maior preço</option>
              <option value="newest">Mais recentes</option>
            </select>
          </label>
        </div>
      </section>

        </aside>
        <section className="catalog-main">
          <section className="catalog-header">
        <div>
          <p className="eyebrow">Mercado</p>
          <h2>{totalItems} {totalItems === 1 ? 'NFT disponível' : 'NFTs disponíveis'}</h2>
        </div>
        <div className="chip-row">
          <span className="chip">Criadores verificados</span>
          <span className="chip">Drops ativos</span>
          <span className="chip">Compra segura</span>
        </div>
      </section>

      {nftQuery.isLoading ? <div className="status-card">Carregando coleção...</div> : null}
      {nftQuery.isError ? <div className="status-card error">Não foi possível carregar a coleção.</div> : null}
      {favoritesQuery.isError ? (
        <div className="status-card error" role="alert">Não foi possível carregar seus favoritos.</div>
      ) : null}
      {toggleFavorite.isError ? (
        <div className="status-card error" role="alert">{toggleFavorite.error.message}</div>
      ) : null}
      {!nftQuery.isLoading && !nftQuery.isError && pageItems.length === 0 ? (
        <div className="status-card">Nenhum NFT encontrado com esses filtros.</div>
      ) : null}
      {!nftQuery.isLoading && !nftQuery.isError && pageItems.length > 0 ? (
        <section className="nft-grid">
          {pageItems.map((nft) => {
            const favoriteIds = favoritesQuery.data ?? session?.favoriteIds ?? []
            const isFavorite = favoriteIds.includes(nft.id)
            const inCart = items.find((item) => item.nftId === nft.id)?.quantity ?? 0

            return (
              <article className="nft-card" key={nft.id}>
                <div className="card-image-wrap">
                  <img src={nft.image} alt={nft.title} className="card-image" />
                  <button
                    type="button"
                    className={isFavorite ? 'favorite-button active' : 'favorite-button'}
                    disabled={Boolean(session) && (favoritesQuery.isLoading || toggleFavorite.isPending)}
                    onClick={() => {
                      if (!session) {
                        requestLogin(`${window.location.pathname}${window.location.search}`)
                        return
                      }
                      toggleFavorite.mutate({ nftId: nft.id, favorite: !isFavorite })
                    }}
                    aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                    aria-pressed={isFavorite}
                  >
                    ♥
                  </button>
                </div>
                <div className="card-body">
                  <div className="card-headline">
                    <div>
                      <p className="card-collection">{nft.collection}</p>
                      <h3>{nft.title}</h3>
                    </div>
                    <span className="card-likes">{nft.likes}</span>
                  </div>
                  <p className="card-meta">Por {nft.creator}</p>
                  <div className="card-footer">
                    <div>
                      <span className="price-label">Preço atual</span>
                      <strong>{formatEth(nft.priceEth)}</strong>
                    </div>
                    <div className="card-actions">
                      <Link to={`/nft/${nft.id}`} className="secondary-button compact">
                        Detalhes
                      </Link>
                      <button
                        type="button"
                        className="primary-button compact"
                        disabled={inCart >= nft.available}
                        onClick={() => addItem(nft, 1)}
                      >
                        {inCart >= nft.available ? 'Esgotado' : inCart > 0 ? `Adicionar (${inCart})` : 'Adicionar'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      ) : null}
      {!nftQuery.isLoading && !nftQuery.isError && totalPages > 1 ? (
        <nav className="pagination" aria-label="Páginas da coleção">
          <button
            type="button"
            className="secondary-button compact"
            disabled={filters.page <= 1}
            onClick={() => navigate({ to: buildHomepageUrl(filters, { page: filters.page - 1 }) })}
          >
            Anterior
          </button>
          <span>Página {filters.page} de {totalPages}</span>
          <button
            type="button"
            className="secondary-button compact"
            disabled={filters.page >= totalPages}
            onClick={() => navigate({ to: buildHomepageUrl(filters, { page: filters.page + 1 }) })}
          >
            Próxima
          </button>
        </nav>
      ) : null}
        </section>
      </div>
    </div>
  )
}

function NFTDetailPage() {
  const { nftId } = useParams({ strict: false })
  const navigate = useNavigate()
  const { items, addItem } = useCart()
  const { session } = useSession()
  const toggleFavorite = useToggleFavorite()
  const favoritesQuery = useQuery({
    queryKey: ['favorites', session?.id],
    queryFn: () => fetchFavorites(session!.id),
    enabled: Boolean(session),
    staleTime: 30000,
  })
  const nftQuery = useQuery({
    queryKey: ['nft-detail', nftId],
    queryFn: () => fetchNftById(nftId ?? ''),
    enabled: Boolean(nftId),
  })

  if (!nftId) {
    return <div className="status-card error">NFT não encontrado.</div>
  }

  if (nftQuery.isLoading) return <div className="status-card">Carregando NFT...</div>
  if (nftQuery.isError || !nftQuery.data) return <div className="status-card error">NFT não encontrado.</div>

  const nft = nftQuery.data
  const isFavorite =
    (favoritesQuery.data ?? session?.favoriteIds ?? []).includes(nft.id)
  const quantityInCart = items.find((item) => item.nftId === nft.id)?.quantity ?? 0

  return (
    <div className="detail-page">
      <button type="button" className="back-link" onClick={() => navigate({ to: '/' })}>
        ← Voltar à coleção
      </button>

      <section className="detail-layout">
        <div className="detail-image-panel">
          <img src={nft.image} alt={nft.title} />
        </div>

        <div className="detail-info">
          <p className="eyebrow">{nft.collection}</p>
          <h1>{nft.title}</h1>
          <p className="detail-creator">Criado por {nft.creator}</p>
          <p className="detail-description">{nft.description}</p>

          <div className="trait-row">
            {nft.traits.map((trait) => (
              <span key={trait} className="trait-pill">
                {trait}
              </span>
            ))}
          </div>

          <div className="pricing-box">
            <div>
              <span>Preço</span>
              <strong>{formatEth(nft.priceEth)}</strong>
            </div>
            <div>
              <span>Disponível</span>
              <strong>{nft.available} edições</strong>
            </div>
          </div>

          <div className="detail-actions">
            <button
              type="button"
              className="primary-button"
              disabled={quantityInCart >= nft.available}
              onClick={() => addItem(nft, 1)}
            >
              {quantityInCart >= nft.available ? 'Limite atingido' : 'Adicionar à sacola'}
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-pressed={isFavorite}
              disabled={Boolean(session) && (favoritesQuery.isLoading || toggleFavorite.isPending)}
              onClick={() => {
                if (!session) {
                  requestLogin(`${window.location.pathname}${window.location.search}`)
                  return
                }
                toggleFavorite.mutate({ nftId: nft.id, favorite: !isFavorite })
              }}
            >
              {isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            </button>
          </div>
          {toggleFavorite.isError ? (
            <p className="status-card error" role="alert">{toggleFavorite.error.message}</p>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function CartPage() {
  const { items, addItem, removeItem, updateQuantity } = useCart()
  const { session } = useSession()
  const [coupon, setCoupon] = useState('')
  const [appliedCoupon, setAppliedCoupon] = useState(() =>
    readStorage<string>(COUPON_STORAGE_KEY, ''),
  )
  const [couponMessage, setCouponMessage] = useState('')
  const [newsletterMessage, setNewsletterMessage] = useState('')

  const nftQueries = useQueries({
    queries: items.map((item) => ({
      queryKey: ['nft-cart', item.nftId],
      queryFn: () => fetchNftById(item.nftId),
      staleTime: 30000,
    })),
  })
  const cartDetails = items.flatMap((item, index) => {
    const nft =
      nftQueries[index]?.data ??
      (isSupabaseMode
        ? undefined
        : nftCatalog.find((entry) => entry.id === item.nftId))
    return nft ? [{ ...item, nft }] : []
  })

  const quoteQuery = useQuery({
    queryKey: ['cart-quote', items, appliedCoupon],
    queryFn: () => fetchOrderQuote(items, appliedCoupon),
    enabled: items.length > 0,
    staleTime: 0,
  })
  const recommendedNfts = nftCatalog.slice(0, 5)

  return (
    <div className="reference-cart-page">
      <div className="cart-breadcrumb">
        <Link to="/">Início</Link><span>/</span><Link to="/#catalog">Mercado</Link><span>/</span>
        <strong>Carrinho</strong>
      </div>

      <div className="reference-cart-layout">
        <section className="reference-cart-main" aria-labelledby="cart-title">
          <div className="reference-cart-heading">
            <div>
              <p className="eyebrow">Clube da Copa</p>
              <h1 id="cart-title">Seu carrinho</h1>
            </div>
            <span>{items.length} {items.length === 1 ? 'NFT' : 'NFTs'}</span>
          </div>

          {cartDetails.length === 0 ? (
            <div
              className={nftQueries.some((query) => query.isError) ? 'status-card error' : 'status-card'}
              role={nftQueries.some((query) => query.isError) ? 'alert' : undefined}
            >
              {items.length > 0 && nftQueries.some((query) => query.isLoading)
                ? 'Carregando itens da sacola...'
                : items.length > 0
                  ? nftQueries.find((query) => query.isError)?.error?.message ??
                    'Não foi possível carregar os itens da sacola.'
                  : 'Sua sacola está vazia. Explore a coleção e encontre seu próximo personagem.'}
            </div>
          ) : (
            <div className="reference-cart-table">
              <div className="reference-cart-columns" aria-hidden="true">
                <span>NFT</span><span>Preço</span><span>Edições</span><span>Total</span><span />
              </div>
              <div className="cart-list">
                {cartDetails.map((item) => {
                  const quotedItem = quoteQuery.data?.items.find((entry) => entry.nftId === item.nftId)
                  return (
                    <article className="cart-row" key={item.nftId}>
                      <Link to={`/nft/${item.nftId}`} className="cart-item-info">
                        <img src={item.nft.image} alt={item.nft.title} />
                        <span className="cart-copy">
                          <strong>{item.nft.title}</strong>
                          <small>{item.nft.collection} · por {item.nft.creator}</small>
                        </span>
                      </Link>
                      <span className="cart-unit-price">{formatEth(item.nft.priceEth)}</span>
                      <div className="cart-quantity" aria-label={`Quantidade de ${item.nft.title}`}>
                        <button
                          type="button"
                          aria-label={`Diminuir quantidade de ${item.nft.title}`}
                          onClick={() => updateQuantity(item.nftId, item.quantity - 1, item.nft.available)}
                        >
                          −
                        </button>
                        <span>{item.quantity}</span>
                        <button
                          type="button"
                          aria-label={`Aumentar quantidade de ${item.nft.title}`}
                          disabled={item.quantity >= item.nft.available}
                          onClick={() => updateQuantity(item.nftId, item.quantity + 1, item.nft.available)}
                        >
                          +
                        </button>
                      </div>
                      <strong className="cart-line-total">
                        {formatEth(quotedItem?.priceEth
                          ? String(Number(quotedItem.priceEth) * item.quantity)
                          : String(Number(item.nft.priceEth) * item.quantity))}
                      </strong>
                      <button
                        type="button"
                        className="cart-remove-button"
                        aria-label={`Remover ${item.nft.title} da sacola`}
                        onClick={() => removeItem(item.nftId)}
                      >
                        ×
                      </button>
                    </article>
                  )
                })}
              </div>
            </div>
          )}
          {quoteQuery.isLoading ? (
            <p className="helper-text" role="status">Consultando preços e disponibilidade...</p>
          ) : null}
          {quoteQuery.isError ? (
            <p className="status-card error" role="alert">
              {quoteQuery.error instanceof Error
                ? quoteQuery.error.message
                : 'Não foi possível consultar os valores atuais da sacola.'}
            </p>
          ) : null}
          {!isSupabaseMode ? (
            <p className="cart-demo-note">Demonstração: nenhum pagamento real será realizado.</p>
          ) : null}
        </section>

        <aside className="reference-cart-summary" aria-label="Resumo da carteira">
          <p className="eyebrow">Resumo da carteira</p>
          <div className="reference-coupon">
            <label htmlFor="cart-coupon">Código promocional</label>
            <div className="reference-coupon-input">
              <input
                id="cart-coupon"
                value={coupon}
                onChange={(event) => setCoupon(event.target.value)}
                placeholder="Digite seu código"
              />
              <button
                type="button"
                className="primary-button compact"
                onClick={() => {
                  if (coupon.trim().toUpperCase() === 'PIXEL10') {
                    setAppliedCoupon('PIXEL10')
                    writeStorage(COUPON_STORAGE_KEY, 'PIXEL10')
                    setCouponMessage('Cupom aplicado: 10% de desconto.')
                  } else {
                    setAppliedCoupon('')
                    removeStorage(COUPON_STORAGE_KEY)
                    setCouponMessage('Este cupom é inválido ou expirou.')
                  }
                }}
              >
                Aplicar
              </button>
            </div>
          </div>
          {couponMessage ? <p className="helper-text" role="status">{couponMessage}</p> : null}
          <div className="reference-summary-lines">
            <div className="summary-line">
              <span>Subtotal</span><strong>{formatEth(quoteQuery.data?.subtotalEth ?? '0')}</strong>
            </div>
            <div className="summary-line">
              <span>Desconto do lançamento</span><strong>-{formatEth(quoteQuery.data?.discountEth ?? '0')}</strong>
            </div>
            <div className="summary-line">
              <span>Taxa de rede</span><strong>{formatEth(quoteQuery.data?.networkFeeEth ?? '0')}</strong>
            </div>
            <div className="summary-total">
              <span>Total</span><strong>{formatEth(quoteQuery.data?.totalEth ?? '0')}</strong>
            </div>
          </div>
          {session ? (
            <Link to="/checkout" className="primary-button wide">Conectar e finalizar</Link>
          ) : (
            <Link to="/login" className="primary-button wide">Conectar e finalizar</Link>
          )}
          <Link to="/#catalog" className="summary-continue">Continuar explorando</Link>
        </aside>
      </div>

      <section className="cart-recommendations" aria-labelledby="recommendations-title">
        <div className="cart-section-heading">
          <div>
            <p className="eyebrow">Feitos para colecionar</p>
            <h2 id="recommendations-title">Colecionadores também viram</h2>
          </div>
          <Link to="/#catalog">Ver coleção <span aria-hidden="true">→</span></Link>
        </div>
        <div className="recommendation-grid">
          {recommendedNfts.map((nft) => (
            <article className="recommendation-card" key={nft.id}>
              <Link to={`/nft/${nft.id}`} className="recommendation-art">
                <img src={nft.image} alt={nft.title} />
              </Link>
              <div className="recommendation-copy">
                <Link to={`/nft/${nft.id}`}><strong>{nft.title}</strong></Link>
                <span>{formatEth(nft.priceEth)}</span>
              </div>
              <button type="button" onClick={() => addItem(nft)}>
                {items.some((item) => item.nftId === nft.id) ? 'Adicionar outra edição' : 'Adicionar à sacola'}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="cart-promo-strip" aria-label="Vantagens KURIO">
        <article><span className="promo-icon">W</span><div><strong>Segurança da carteira</strong><p>Proteja sua coleção com cuidado e confiança.</p></div></article>
        <article><span className="promo-icon">C</span><div><strong>Criadores em destaque</strong><p>Conheça artistas e histórias de cada personagem.</p></div></article>
        <article><span className="promo-icon">D</span><div><strong>Alertas de lançamento</strong><p>Fique por dentro das novas edições do Clube da Copa.</p></div></article>
        <form
          className="promo-newsletter"
          onSubmit={(event) => {
            event.preventDefault()
            setNewsletterMessage('Inscrição de demonstração registrada.')
          }}
        >
          <label htmlFor="newsletter-email">Antecipe-se ao próximo lançamento</label>
          <div><input id="newsletter-email" type="email" required placeholder="Digite seu e-mail..." /><button type="submit">Enviar</button></div>
          <small>{newsletterMessage || 'Receba novidades e histórias da coleção.'}</small>
        </form>
      </section>

      <footer className="marketplace-footer">
        <div className="footer-brand"><strong>KURIO</strong><span>Feito para colecionadores, criadores e cultura.</span></div>
        <div><strong>Meu perfil</strong><Link to="/profile">Meu perfil</Link><Link to="/wallets">Minhas carteiras</Link><Link to="/#catalog">Coleção</Link></div>
        <div><strong>Central de ajuda</strong><Link to="/#catalog">Como comprar</Link><Link to="/cart">Carrinho e segurança</Link><Link to="/signup">Criar conta</Link></div>
        <div><strong>Coleções</strong><Link to="/#catalog">Arte digital</Link><Link to="/#catalog">Clube da Copa</Link><Link to="/#catalog">Mais vistos</Link></div>
        <div className="footer-social"><strong>Redes sociais</strong><span>Uma comunidade de arte e colecionismo.</span><strong>Carteiras compatíveis</strong><span>Ethereum · Base · Polygon</span></div>
        <small className="footer-copyright">© 2026 KURIO. Projeto demonstrativo para todos.</small>
      </footer>
    </div>
  )
}

function CheckoutPage() {
  const { items, updateQuantity } = useCart()
  const { session } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [wallet, setWallet] = useState(
    session?.wallet ?? (isSupabaseMode ? '' : '0xA7f8...C4b2'),
  )
  const [network, setNetwork] = useState(session?.network ?? 'Ethereum Mainnet')
  const [reviewedQuote, setReviewedQuote] = useState<string | null>(null)
  const [couponCode] = useState(() => readStorage<string>(COUPON_STORAGE_KEY, ''))
  const quoteQuery = useQuery({
    queryKey: ['order-quote', items, couponCode],
    queryFn: () => fetchOrderQuote(items, couponCode),
    enabled: Boolean(session) && items.length > 0,
    staleTime: 0,
  })
  const unavailableItem = items.find((item) => {
    if (isSupabaseMode) return false
    const nft = nftCatalog.find((entry) => entry.id === item.nftId)
    return !nft || item.quantity > nft.available
  })
  const fingerprint = JSON.stringify({
    items,
    wallet,
    network,
    couponCode,
    quote: quoteQuery.data,
  })
  const quoteFingerprint = quoteQuery.data ? JSON.stringify(quoteQuery.data) : null
  // Exige nova revisão se o servidor atualizar preços, estoque ou taxas da cotação.
  const reviewed = quoteFingerprint !== null && reviewedQuote === quoteFingerprint

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      if (!session) throw new Error('Entre na sua conta antes de fazer um pedido.')
      if (!quoteQuery.data) throw new Error('Aguarde a consulta dos valores atuais antes de confirmar.')
      return createOrder({
        userId: session.id,
        cart: items,
        idempotencyKey: getCheckoutAttempt(fingerprint),
        wallet,
        network,
        couponCode,
        expectedQuote: quoteQuery.data,
      })
    },
    onError: () => {
      setReviewedQuote(null)
      void queryClient.invalidateQueries({ queryKey: ['order-quote', items, couponCode] })
    },
    onSuccess: (order) => {
      if (order.status !== 'confirmed') return
      writeStorage(ORDER_STORAGE_KEY, order)
      removeStorage(ATTEMPT_STORAGE_KEY)
      removeStorage(COUPON_STORAGE_KEY)
      for (const item of items) updateQuantity(item.nftId, 0)
      navigate({ to: '/confirmation' })
    },
  })

  if (!session) {
    return <div className="status-card error">Entre na sua conta para finalizar a compra.</div>
  }
  if (items.length === 0) {
    return (
      <div className="status-card">
        Sua sacola está vazia. <Link to="/">Voltar ao mercado</Link>
      </div>
    )
  }

  return (
    <div className="two-column-layout">
      <section className="panel-box">
        <div className="section-header">
          <div>
            <p className="eyebrow">Pagamento</p>
            <h2>Revise seu pedido</h2>
          </div>
        </div>

        <div className="form-grid">
          <label>
            <span>Carteira</span>
            <input value={wallet} onChange={(event) => setWallet(event.target.value)} />
          </label>
          <label>
            <span>Rede</span>
            <select value={network} onChange={(event) => setNetwork(event.target.value)}>
              <option value="Ethereum Mainnet">Rede principal do Ethereum</option>
              <option value="Base">Base</option>
              <option value="Polygon">Polygon</option>
            </select>
          </label>
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={reviewed}
            disabled={!quoteQuery.data || quoteQuery.isFetching || Boolean(unavailableItem)}
            onChange={(event) => {
              setReviewedQuote(event.target.checked ? quoteFingerprint : null)
            }}
          />
          <span>Confirmo que os dados do pedido e da transação estão corretos.</span>
        </label>
        {quoteQuery.isLoading ? (
          <p className="status-card" role="status">Consultando valores atuais do pedido...</p>
        ) : null}
        {quoteQuery.isError ? (
          <p className="status-card error" role="alert">
            {quoteQuery.error instanceof Error
              ? quoteQuery.error.message
              : 'Não foi possível consultar os valores atuais do pedido.'}
          </p>
        ) : null}
        {unavailableItem ? (
          <p className="status-card error" role="alert">
            Um item da sacola não está mais disponível nessa quantidade. Atualize sua sacola antes de pagar.
          </p>
        ) : null}
        {!isSupabaseMode ? (
          <p className="status-card" role="status">
            Modo demonstração: a compra é simulada. Nenhum pagamento será cobrado e nenhuma transação será enviada à blockchain.
          </p>
        ) : null}
        {isSupabaseMode ? (
          <p className="status-card" role="status">
            O catálogo e sua conta estão conectados ao Supabase. A confirmação de pagamentos
            continuará indisponível até a integração de verificação da blockchain.
          </p>
        ) : null}
        {checkoutMutation.isError ? (
          <p className="status-card error" role="alert">
            {checkoutMutation.error instanceof Error
              ? checkoutMutation.error.message
              : 'Não foi possível confirmar o pedido. Sua sacola foi preservada.'}
          </p>
        ) : null}
        {checkoutMutation.data?.status === 'declined' ? (
          <p className="status-card error" role="alert">
            A carteira recusou a transação simulada. Sua sacola não foi alterada; conecte outra carteira para tentar novamente.
          </p>
        ) : null}
      </section>

      <aside className="panel-box summary-box">
        <p className="eyebrow">Total do pedido</p>
        <div className="summary-line">
          <span>Itens</span>
          <strong>{formatEth(quoteQuery.data?.subtotalEth ?? '0')}</strong>
        </div>
        <div className="summary-line">
          <span>Desconto{couponCode ? ` (${couponCode})` : ''}</span>
          <strong>-{formatEth(quoteQuery.data?.discountEth ?? '0')}</strong>
        </div>
        <div className="summary-line">
          <span>Taxa de rede</span>
          <strong>{formatEth(quoteQuery.data?.networkFeeEth ?? '0')}</strong>
        </div>
        <div className="summary-line total-box">
          <span>Total a pagar</span>
          <strong>{formatEth(quoteQuery.data?.totalEth ?? '0')}</strong>
        </div>

        <button
          type="button"
          className="primary-button wide"
          onClick={() => checkoutMutation.mutate()}
          disabled={
            !reviewed ||
            checkoutMutation.isPending ||
            !quoteQuery.data ||
            quoteQuery.isFetching ||
            Boolean(unavailableItem) ||
            isSupabaseMode
          }
        >
          {checkoutMutation.isPending ? 'Processando...' : 'Confirmar compra'}
        </button>
      </aside>
    </div>
  )
}

function ConfirmationPage() {
  if (isSupabaseMode) {
    return (
      <div className="confirmation-box">
        <p className="eyebrow">Pagamento ainda não habilitado</p>
        <h1>A confirmação on-chain ainda não está integrada.</h1>
        <p>Nenhum pedido será exibido como pago sem a verificação da transação na blockchain.</p>
        <Link to="/" className="primary-button">Voltar ao mercado</Link>
      </div>
    )
  }

  const order = readStorage<Order | null>(ORDER_STORAGE_KEY, null)

  if (!order || order.status !== 'confirmed') {
    return (
      <div className="confirmation-box">
        <p className="eyebrow">Nenhum pedido confirmado</p>
        <h1>Não há uma compra concluída para exibir.</h1>
        <Link to="/" className="primary-button">Voltar ao mercado</Link>
      </div>
    )
  }

  return (
    <div className="confirmation-box">
      <p className="eyebrow success">Pedido simulado</p>
      <h1>Simulação concluída.</h1>
      <p>Este comprovante é apenas demonstrativo: não houve cobrança nem transação na blockchain.</p>
      <div className="receipt-box">
        <span>Pedido {order.id}</span>
        <strong>{formatEth(order.totalEth)}</strong>
        {Number(order.discountEth) > 0 ? (
          <p>Desconto do cupom: −{formatEth(order.discountEth)}</p>
        ) : null}
        {order.items.map((item) => (
          <p key={item.nftId}>{item.quantity} × {item.title} — {formatEth(item.priceEth)}</p>
        ))}
        <span>Carteira: {order.wallet} · {formatNetwork(order.network)}</span>
        <span>Identificador fictício de transação</span>
        <strong>{order.txHash}</strong>
      </div>
      <Link to="/" className="primary-button">
        Voltar ao mercado
      </Link>
    </div>
  )
}

function LoginPage() {
  const { setSession } = useSession()
  const [email, setEmail] = useState(isSupabaseMode ? '' : 'collector@pixelvault.io')
  const [password, setPassword] = useState(isSupabaseMode ? '' : 'demo-pass')
  const googleLoginMutation = useMutation({
    mutationFn: () => loginWithGoogle(`${window.location.origin}/login`),
  })

  const loginMutation = useMutation({
    mutationFn: async () => loginUser(email, password),
    onSuccess: (nextSession) => {
      setSession(nextSession)
      redirectAfterAuthentication()
    },
  })

  return (
    <div className="auth-panel">
      <form
        className="panel-box auth-box"
        onSubmit={(event) => {
          event.preventDefault()
          loginMutation.mutate()
        }}
      >
        <p className="eyebrow">Bem-vindo de volta</p>
        <h1>Entrar</h1>
        <label>
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {loginMutation.isError ? (
          <p className="status-card error" role="alert">{loginMutation.error.message}</p>
        ) : null}
        <button type="submit" className="primary-button wide" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Entrando...' : 'Entrar'}
        </button>
        {googleLoginMutation.isError ? (
          <p className="status-card error" role="alert">
            {googleLoginMutation.error.message}
          </p>
        ) : null}
        <div className="auth-divider"><span>ou</span></div>
        <button
          type="button"
          className="secondary-button wide"
          disabled={!isSupabaseMode || googleLoginMutation.isPending}
          onClick={() => googleLoginMutation.mutate()}
        >
          <span aria-hidden="true">G</span> Continuar com Google
        </button>
        {!isSupabaseMode ? (
          <p className="helper-text">
            O acesso com Google exige a configuração do Supabase e do provedor Google.
          </p>
        ) : null}
        <p className="helper-text">
          Ainda não tem uma conta? <Link to="/signup">Criar conta</Link>
        </p>
      </form>
    </div>
  )
}

function SignupPage() {
  const { setSession } = useSession()
  const [name, setName] = useState(isSupabaseMode ? '' : 'Breno Rossi')
  const [email, setEmail] = useState(isSupabaseMode ? '' : 'ava@example.com')
  const [password, setPassword] = useState(isSupabaseMode ? '' : 'StrongPass123!')
  const [signupMessage, setSignupMessage] = useState<string | null>(null)

  const signupMutation = useMutation({
    mutationFn: async () => signUpUser({ name, email, password }),
    onSuccess: (nextSession) => {
      if (!nextSession) {
        setSignupMessage('Conta criada. Confira seu e-mail para confirmar o cadastro e entrar.')
        return
      }
      setSignupMessage(null)
      setSession(nextSession)
      redirectAfterAuthentication()
    },
  })

  return (
    <div className="auth-panel">
      <form
        className="panel-box auth-box"
        onSubmit={(event) => {
          event.preventDefault()
          signupMutation.mutate()
        }}
      >
        <p className="eyebrow">Crie sua conta</p>
        <h1>Cadastrar</h1>
        <label>
          <span>Nome</span>
          <input
            autoComplete="name"
            minLength={2}
            maxLength={40}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          <span>Senha</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {signupMutation.isError ? (
          <p className="status-card error" role="alert">{signupMutation.error.message}</p>
        ) : null}
        {signupMessage ? <p className="status-card" role="status">{signupMessage}</p> : null}
        <button type="submit" className="primary-button wide" disabled={signupMutation.isPending}>
          {signupMutation.isPending ? 'Criando conta...' : 'Criar conta'}
        </button>
        <p className="helper-text">
          Já tem uma conta? <Link to="/login">Entrar</Link>
        </p>
      </form>
    </div>
  )
}

function ProfilePage() {
  const { session, setSession } = useSession()
  const queryClient = useQueryClient()
  const [name, setName] = useState(session?.displayName ?? 'Colecionador')
  const profileQuery = useQuery({
    queryKey: ['profile', session?.id],
    queryFn: () => fetchProfile(session!.id),
    enabled: Boolean(session),
    initialData: session ? { displayName: session.displayName } : undefined,
  })
  const profileMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('Entre na sua conta para atualizar seu perfil.')
      return updateProfile(session.id, name)
    },
    onSuccess: (profile) => {
      setSession((current) =>
        current ? { ...current, displayName: profile.displayName } : current,
      )
      queryClient.setQueryData(['profile', session?.id], profile)
    },
  })

  return (
    <div className="profile-layout">
      <section className="panel-box profile-card">
        <div>
          <p className="eyebrow">Perfil</p>
          <h2>{profileQuery.data?.displayName ?? name}</h2>
          <p>{session?.email ?? defaultSession.email}</p>
        </div>
      </section>

      <section className="panel-box">
        <div className="section-header">
          <div>
            <p className="eyebrow">Conta</p>
            <h2>Editar perfil</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            <span>Nome de exibição</span>
            <input
              minLength={2}
              maxLength={40}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>E-mail</span>
            <input value={session?.email ?? defaultSession.email} readOnly />
          </label>
        </div>
        {profileMutation.isError ? (
          <p className="status-card error" role="alert">{profileMutation.error.message}</p>
        ) : null}
        <button
          type="button"
          className="primary-button"
          disabled={profileMutation.isPending}
          onClick={() => profileMutation.mutate()}
        >
          {profileMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
        {profileMutation.isSuccess ? (
          <p className="helper-text" role="status">Alterações do perfil salvas.</p>
        ) : null}
      </section>
    </div>
  )
}

function WalletsPage() {
  const { session, setSession } = useSession()
  const queryClient = useQueryClient()
  const [wallet, setWallet] = useState(
    session?.wallet ?? (isSupabaseMode ? '' : '0xA7f8...C4b2'),
  )
  const [network, setNetwork] = useState(session?.network ?? 'Ethereum Mainnet')
  const walletsQuery = useQuery({
    queryKey: ['wallets', session?.id],
    queryFn: () => fetchWallets(session!.id),
    enabled: Boolean(session),
    initialData: session && (!isSupabaseMode || session.wallet)
      ? [{
          id: 'wallet-primary',
          address: session.wallet,
          network: session.network,
          primary: true,
        }]
      : undefined,
  })
  const walletMutation = useMutation({
    mutationFn: () => {
      if (!session) throw new Error('Entre na sua conta para atualizar sua carteira.')
      return updatePrimaryWallet(session.id, wallet, network)
    },
    onSuccess: (updatedWallet) => {
      setSession((current) =>
        current
          ? {
              ...current,
              wallet: updatedWallet.address,
              network: updatedWallet.network,
            }
          : current,
      )
      queryClient.setQueryData(['wallets', session?.id], [updatedWallet])
    },
  })

  return (
    <div className="panel-box">
      <div className="section-header">
        <div>
          <p className="eyebrow">Carteiras</p>
          <h2>Carteira principal</h2>
        </div>
      </div>
      <div className="form-grid">
        <label>
          <span>Endereço</span>
          <input
            minLength={8}
            maxLength={42}
            pattern="^0x[0-9a-fA-F]{40}$"
            placeholder="0x…"
            required
            value={wallet}
            onChange={(event) => setWallet(event.target.value)}
          />
        </label>
        <label>
          <span>Rede</span>
          <select value={network} onChange={(event) => setNetwork(event.target.value)}>
            <option value="Ethereum Mainnet">Rede principal do Ethereum</option>
            <option value="Base">Base</option>
            <option value="Polygon">Polygon</option>
          </select>
        </label>
      </div>
      {walletMutation.isError ? (
        <p className="status-card error" role="alert">{walletMutation.error.message}</p>
      ) : null}
      {walletsQuery.isError ? (
        <p className="status-card error" role="alert">Não foi possível carregar a lista de carteiras.</p>
      ) : null}
      <button
        type="button"
        className="primary-button"
        disabled={walletMutation.isPending}
        onClick={() => walletMutation.mutate()}
      >
        {walletMutation.isPending ? 'Atualizando...' : 'Atualizar carteira'}
      </button>
      {walletMutation.isSuccess ? (
        <p className="helper-text" role="status">
          Carteira principal atualizada: {walletsQuery.data?.[0]?.address ?? wallet}
        </p>
      ) : null}
    </div>
  )
}

function RootLayout() {
  return (
    <SessionProvider>
      <CartProvider>
        <AppShell />
      </CartProvider>
    </SessionProvider>
  )
}

const rootRoute = createRootRoute({ component: RootLayout })
const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: HomePage })
const nftDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/nft/$nftId',
  component: NFTDetailPage,
})
const cartRoute = createRoute({ getParentRoute: () => rootRoute, path: '/cart', component: CartPage })
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/checkout',
  component: () => (
    <RequireSession>
      <CheckoutPage />
    </RequireSession>
  ),
})
const confirmationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/confirmation',
  component: () => (
    <RequireSession>
      <ConfirmationPage />
    </RequireSession>
  ),
})
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginPage })
const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signup',
  component: SignupPage,
})
const profileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/profile',
  component: () => (
    <RequireSession>
      <ProfilePage />
    </RequireSession>
  ),
})
const walletsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/wallets',
  component: () => (
    <RequireSession>
      <WalletsPage />
    </RequireSession>
  ),
})
const notFoundRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '*',
  component: () => <div className="status-card error">Esta página não existe.</div>,
})

const routeTree = rootRoute.addChildren([
  homeRoute,
  nftDetailRoute,
  cartRoute,
  checkoutRoute,
  confirmationRoute,
  loginRoute,
  signupRoute,
  profileRoute,
  walletsRoute,
  notFoundRoute,
])

const router = createRouter({ routeTree })

export default function App() {
  return <RouterProvider router={router} />
}
