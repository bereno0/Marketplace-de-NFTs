import { describe, expect, it } from 'vitest'
import { calculateOrderQuote, isCartItemList } from './orderValidation'
import type { CartItem } from './types'

const cartItem = (quantity: number, priceEth = '0.52'): CartItem => ({
  nftId: 'vanta-407',
  quantity,
  priceEth,
})

describe('cart validation', () => {
  it('rejects empty and malformed carts', () => {
    expect(isCartItemList([])).toBe(false)
    expect(isCartItemList([null])).toBe(false)
    expect(isCartItemList([{ nftId: 'vanta-407', quantity: 1, priceEth: 0 }])).toBe(false)
  })

  it('accepts only positive safe-integer quantities', () => {
    expect(isCartItemList([cartItem(1)])).toBe(true)
    expect(isCartItemList([cartItem(0)])).toBe(false)
    expect(isCartItemList([cartItem(Number.MAX_SAFE_INTEGER + 1)])).toBe(false)
  })
})

describe('order quote calculation', () => {
  it('uses the catalog price and includes the network fee', () => {
    const result = calculateOrderQuote([cartItem(1, '999')], '')

    expect(result).toMatchObject({
      quote: {
        subtotalEth: '0.52',
        discountEth: '0.00',
        networkFeeEth: '0.14',
        totalEth: '0.66',
      },
    })
  })

  it('aggregates duplicate NFT lines before validating and quoting stock', () => {
    const result = calculateOrderQuote([cartItem(2), cartItem(3)], '')

    expect(result).toMatchObject({
      quote: {
        items: [{ nftId: 'vanta-407', quantity: 5, priceEth: '0.52' }],
        subtotalEth: '2.60',
      },
    })
  })

  it('rejects duplicate lines that exceed the total available stock', () => {
    expect(calculateOrderQuote([cartItem(3), cartItem(3)], '')).toMatchObject({
      status: 409,
    })
  })

  it('applies the supported coupon and rejects unknown coupons', () => {
    expect(calculateOrderQuote([cartItem(1)], 'PIXEL10')).toMatchObject({
      quote: { discountEth: '0.05', totalEth: '0.61' },
    })
    expect(calculateOrderQuote([cartItem(1)], 'INVALID')).toMatchObject({
      status: 400,
    })
    expect(calculateOrderQuote([cartItem(1)], ' PIXEL10 ')).toMatchObject({
      quote: { discountEth: '0.05' },
    })
  })

  it('rejects NFTs outside the catalog', () => {
    expect(
      calculateOrderQuote([{ ...cartItem(1), nftId: 'unknown' }], ''),
    ).toMatchObject({ status: 409 })
  })
})
