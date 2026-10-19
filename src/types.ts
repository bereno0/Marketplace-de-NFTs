export type Nft = {
  id: string
  title: string
  collection: string
  creator: string
  image: string
  priceEth: string
  priceUsd: number
  category: string
  likes: number
  available: number
  createdAt: string
  description: string
  traits: string[]
}

export type NftCatalogResult = {
  items: Nft[]
  total: number
  page: number
  pageSize: number
}

export type UserSession = {
  id: string
  email: string
  displayName: string
  wallet: string
  network: string
  favoriteIds: string[]
}

export type Wallet = {
  id: string
  address: string
  network: string
  primary: boolean
}

export type CartItem = {
  nftId: string
  quantity: number
  priceEth: string
}

export type OrderItem = {
  nftId: string
  title: string
  collection: string
  image: string
  quantity: number
  priceEth: string
}

export type Order = {
  id: string
  status: 'confirmed' | 'declined'
  txHash: string
  items: OrderItem[]
  subtotalEth: string
  discountEth: string
  networkFeeEth: string
  totalEth: string
  wallet: string
  network: string
  createdAt: string
}

export type OrderQuote = {
  items: OrderItem[]
  subtotalEth: string
  discountEth: string
  networkFeeEth: string
  totalEth: string
}

export type FilterState = {
  query: string
  category: string
  sort: 'popular' | 'price-low' | 'price-high' | 'newest'
  page: number
}
