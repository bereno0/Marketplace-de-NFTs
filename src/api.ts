import axios from 'axios'
import type { User } from '@supabase/supabase-js'
import { isSupabaseMode, requireSupabaseClient } from './backend'
import type {
  CartItem,
  FilterState,
  Nft,
  NftCatalogResult,
  Order,
  OrderQuote,
  UserSession,
  Wallet,
} from './types'

export const api = axios.create({ baseURL: '/api' })

api.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError<{ message?: string }>(error)) {
      const message = error.response?.data?.message
      if (message) return Promise.reject(new Error(message))
      if (error.message) return Promise.reject(new Error(error.message))
    }
    return Promise.reject(error)
  },
)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type SupabaseNftRow = {
  id: string
  title: string
  collection: string
  creator: string
  image: string
  price_eth: string | number
  price_usd: string | number
  category: string
  likes: number
  available: number
  created_at: string
  description: string
  traits: string[]
}

function mapNft(row: SupabaseNftRow): Nft {
  return {
    id: row.id,
    title: row.title,
    collection: row.collection,
    creator: row.creator,
    image: row.image,
    priceEth: Number(row.price_eth).toFixed(2),
    priceUsd: Number(row.price_usd),
    category: row.category,
    likes: row.likes,
    available: row.available,
    createdAt: row.created_at,
    description: row.description,
    traits: row.traits,
  }
}

async function createUserSession(user: User): Promise<UserSession> {
  const [profile, wallets, favoriteIds] = await Promise.all([
    fetchProfile(user.id),
    fetchWallets(user.id),
    fetchFavorites(user.id),
  ])
  const primaryWallet = wallets.find((wallet) => wallet.primary)
  return {
    id: user.id,
    email: user.email ?? '',
    // O Supabase cria o perfil via gatilho; os metadados cobrem o retorno do OAuth do Google.
    displayName:
      profile.displayName ||
      user.user_metadata.display_name ||
      user.user_metadata.full_name ||
      user.user_metadata.name ||
      user.email?.split('@')[0] ||
      'Colecionador',
    wallet: primaryWallet?.address ?? '',
    network: primaryWallet?.network ?? 'Ethereum Mainnet',
    favoriteIds,
  }
}

function userConfig(userId: string) {
  return { headers: { 'X-User-Id': userId } }
}

export async function fetchFavorites(userId: string): Promise<string[]> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient()
      .from('favorites')
      .select('nft_id')
      .eq('user_id', userId)
    if (error) throw new Error(error.message)
    return (data ?? []).map((favorite) => favorite.nft_id)
  }
  const response = await api.get<{ favoriteIds: string[] }>(
    '/favorites',
    userConfig(userId),
  )
  return response.data.favoriteIds
}

export async function fetchProfile(userId: string): Promise<{ displayName: string }> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient()
      .from('profiles')
      .select('display_name')
      .eq('user_id', userId)
      .single()
    if (error) throw new Error(error.message)
    return { displayName: data.display_name }
  }
  const response = await api.get<{ displayName: string }>('/profile', userConfig(userId))
  return response.data
}

export async function fetchWallets(userId: string): Promise<Wallet[]> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient()
      .from('wallets')
      .select('id, address, network, is_primary')
      .eq('user_id', userId)
      .order('created_at')
    if (error) throw new Error(error.message)
    return (data ?? []).map((wallet) => ({
      id: wallet.id,
      address: wallet.address,
      network: wallet.network,
      primary: wallet.is_primary,
    }))
  }
  const response = await api.get<Wallet[]>('/wallets', userConfig(userId))
  return response.data
}

export async function fetchNfts(filters: FilterState): Promise<NftCatalogResult> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient().rpc('get_catalog_page', {
      p_query: filters.query,
      p_category: filters.category,
      p_sort: filters.sort,
      p_page: filters.page,
      p_page_size: 4,
    })
    if (error) throw new Error(error.message)
    return data
  }
  await sleep(200)
  const response = await api.get<NftCatalogResult>('/nfts', { params: filters })
  return response.data
}

export async function fetchNftById(id: string): Promise<Nft | undefined> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient()
      .from('nfts')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data ? mapNft(data) : undefined
  }
  await sleep(180)
  const response = await api.get<Nft>(`/nfts/${id}`)
  return response.data
}

export async function loginUser(email: string, password: string): Promise<UserSession> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient().auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw new Error('Não foi possível entrar. Confira seu e-mail e sua senha.')
    if (!data.user) throw new Error('A autenticação não retornou uma conta válida.')
    return createUserSession(data.user)
  }
  await sleep(300)
  const response = await api.post<UserSession>('/login', { email, password })
  return response.data
}

export async function loginWithGoogle(redirectTo: string): Promise<void> {
  if (!isSupabaseMode) {
    throw new Error('O acesso com Google exige que o backend Supabase esteja configurado.')
  }

  // O Supabase redireciona ao provedor e retorna para o endereço autorizado no painel.
  const { error } = await requireSupabaseClient().auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) {
    throw new Error(`Não foi possível iniciar o acesso com o Google: ${error.message}`)
  }
}

export async function signUpUser(
  form: { name: string; email: string; password: string },
): Promise<UserSession | null> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient().auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: { display_name: form.name.trim() } },
    })
    if (error) {
      if (error.message.toLowerCase().includes('already registered')) {
        throw new Error('Já existe uma conta com este e-mail.')
      }
      throw new Error('Não foi possível criar a conta. Confira os dados e tente novamente.')
    }
    return data.session && data.user ? createUserSession(data.user) : null
  }
  await sleep(350)
  const response = await api.post<UserSession>('/signup', form)
  return response.data
}

export async function restoreUserSession(): Promise<UserSession | null> {
  if (!isSupabaseMode) return null
  const { data, error } = await requireSupabaseClient().auth.getSession()
  if (error) throw new Error('Não foi possível restaurar sua sessão.')
  return data.session?.user ? createUserSession(data.session.user) : null
}

export async function logoutUser(): Promise<void> {
  if (!isSupabaseMode) return
  const { error } = await requireSupabaseClient().auth.signOut()
  if (error) throw new Error('Não foi possível encerrar sua sessão.')
}

export function subscribeToSignOut(onSignOut: () => void) {
  if (!isSupabaseMode) return () => {}
  const {
    data: { subscription },
  } = requireSupabaseClient().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') onSignOut()
  })
  return () => subscription.unsubscribe()
}

export async function updateFavorite(
  userId: string,
  nftId: string,
  favorite: boolean,
): Promise<string[]> {
  if (isSupabaseMode) {
    const client = requireSupabaseClient()
    const result = favorite
      ? await client.from('favorites').upsert({ nft_id: nftId })
      : await client
          .from('favorites')
          .delete()
          .eq('user_id', userId)
          .eq('nft_id', nftId)
    if (result.error) throw new Error(result.error.message)
    return fetchFavorites(userId)
  }
  const response = favorite
    ? await api.post<{ favoriteIds: string[] }>(
        '/favorites',
        { nftId },
        userConfig(userId),
      )
    : await api.delete<{ favoriteIds: string[] }>(
        `/favorites/${encodeURIComponent(nftId)}`,
        userConfig(userId),
      )
  return response.data.favoriteIds
}

export async function updateProfile(
  userId: string,
  displayName: string,
): Promise<{ displayName: string }> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient()
      .from('profiles')
      .update({ display_name: displayName.trim() })
      .eq('user_id', userId)
      .select('display_name')
      .single()
    if (error) throw new Error(error.message)
    return { displayName: data.display_name }
  }
  const response = await api.patch<{ displayName: string }>(
    '/profile',
    { displayName },
    userConfig(userId),
  )
  return response.data
}

export async function updatePrimaryWallet(
  userId: string,
  address: string,
  network = 'Ethereum Mainnet',
): Promise<Wallet> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient().rpc('set_primary_wallet', {
      p_address: address.trim(),
      p_network: network,
    })
    if (error) throw new Error(error.message)
    return {
      id: data.id,
      address: data.address,
      network: data.network,
      primary: data.primary,
    }
  }
  const response = await api.put<Wallet>(
    '/wallets/primary',
    { address },
    userConfig(userId),
  )
  return response.data
}

export async function fetchOrderQuote(
  cart: CartItem[],
  couponCode: string,
): Promise<OrderQuote> {
  if (isSupabaseMode) {
    const { data, error } = await requireSupabaseClient().rpc('calculate_order_quote', {
      p_cart: cart,
      p_coupon_code: couponCode,
    })
    if (error) throw new Error(error.message)
    return data
  }
  const response = await api.post<OrderQuote>('/orders/quote', { cart, couponCode })
  return response.data
}

export type CreateOrderPayload = {
  userId: string
  cart: CartItem[]
  idempotencyKey: string
  wallet: string
  network: string
  couponCode: string
  expectedQuote: OrderQuote
}

export async function createOrder(payload: CreateOrderPayload): Promise<Order> {
  if (isSupabaseMode) {
    throw new Error(
      'O backend está conectado, mas a confirmação real de pagamentos ainda depende da integração com a blockchain.',
    )
  }
  await sleep(500)
  const response = await api.post<Order>('/orders', payload, {
    headers: {
      ...userConfig(payload.userId).headers,
      'Idempotency-Key': payload.idempotencyKey,
    },
  })
  return response.data
}
