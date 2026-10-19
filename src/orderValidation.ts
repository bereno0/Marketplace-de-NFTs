import { nftCatalog } from './mockData'
import type { CartItem, OrderQuote } from './types'

export function isCartItemList(value: unknown): value is CartItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item: unknown) => {
      if (typeof item !== 'object' || item === null) return false
      const cartItem = item as Record<string, unknown>
      return (
        typeof cartItem.nftId === 'string' &&
        typeof cartItem.priceEth === 'string' &&
        Number.isSafeInteger(cartItem.quantity) &&
        Number(cartItem.quantity) > 0
      )
    })
  )
}

export function calculateOrderQuote(
  cart: CartItem[],
  couponCode: string,
): { quote: OrderQuote } | { error: string; status: number } {
  const normalizedCoupon = couponCode.trim().toUpperCase()
  if (normalizedCoupon && normalizedCoupon !== 'PIXEL10') {
    return { error: 'O cupom é inválido ou expirou.', status: 400 }
  }

  const items: OrderQuote['items'] = []
  const requestedQuantities = new Map<string, number>()
  let subtotal = 0

  // Agrega linhas repetidas antes de validar estoque, evitando contornar o limite por divisão de itens.
  for (const item of cart) {
    const requestedQuantity =
      (requestedQuantities.get(item.nftId) ?? 0) + item.quantity
    if (!Number.isSafeInteger(requestedQuantity)) {
      return { error: 'A quantidade solicitada é inválida.', status: 400 }
    }
    requestedQuantities.set(item.nftId, requestedQuantity)
  }

  for (const [nftId, quantity] of requestedQuantities) {
    const nft = nftCatalog.find((entry) => entry.id === nftId)
    if (!nft || quantity > nft.available) {
      return {
        error: 'Um NFT não está disponível ou a quantidade solicitada excede o estoque.',
        status: 409,
      }
    }

    // O valor vem do catálogo, nunca do preço enviado pelo navegador.
    subtotal += Number(nft.priceEth) * quantity
    items.push({
      nftId: nft.id,
      title: nft.title,
      collection: nft.collection,
      image: nft.image,
      quantity,
      priceEth: nft.priceEth,
    })
  }

  const discount = normalizedCoupon ? subtotal * 0.1 : 0
  const networkFee = 0.14
  return {
    quote: {
      items,
      subtotalEth: subtotal.toFixed(2),
      discountEth: discount.toFixed(2),
      networkFeeEth: networkFee.toFixed(2),
      totalEth: (subtotal - discount + networkFee).toFixed(2),
    },
  }
}
