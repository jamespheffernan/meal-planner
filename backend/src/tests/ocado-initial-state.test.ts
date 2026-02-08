import { describe, it, expect } from 'vitest'
import { extractProductsFromInitialState, extractCartFromInitialState, parseInitialStateFromHtml } from '../services/stores/ocado/ocado-initial-state.js'

describe('Ocado initial state parsing', () => {
  it('extracts products using productIds ordering + entity map', () => {
    const state = {
      search: {
        results: {
          productIds: ['12345678', '99990000'],
        },
      },
      entities: {
        products: {
          '12345678': {
            id: '12345678',
            name: 'Semi-skimmed Milk 2L',
            price: { value: 1.25, currency: 'GBP' },
            images: { primary: { url: 'https://images.ocado.com/milk.jpg' } },
            href: '/products/12345678',
          },
          '99990000': {
            productId: 99990000,
            title: 'Cheddar Cheese 400g',
            // pence as integer
            price: 375,
            imageUrl: 'https://images.ocado.com/cheddar.jpg',
          },
        },
      },
    }

    const res = extractProductsFromInitialState(state, { baseUrl: 'https://www.ocado.com', maxResults: 5 })
    expect(res).toHaveLength(2)
    expect(res[0]).toMatchObject({
      provider: 'ocado',
      providerProductId: '12345678',
      name: 'Semi-skimmed Milk 2L',
      price: 1.25,
      currency: 'GBP',
      imageUrl: 'https://images.ocado.com/milk.jpg',
      productUrl: 'https://www.ocado.com/products/12345678',
    })
    expect(res[1]).toMatchObject({
      provider: 'ocado',
      providerProductId: '99990000',
      name: 'Cheddar Cheese 400g',
      price: 3.75,
      currency: 'GBP',
      imageUrl: 'https://images.ocado.com/cheddar.jpg',
      productUrl: 'https://www.ocado.com/products/99990000',
    })
  })

  it('falls back to best-scored candidates when no ordering array exists', () => {
    const state = {
      foo: {
        bar: [
          {
            productId: '22223333',
            productName: 'Greek Yogurt',
            pricing: { now: { amount: '£2.10' } },
            media: [{ url: 'https://images.ocado.com/yogurt.png' }],
          },
        ],
      },
    }

    const res = extractProductsFromInitialState(state, { baseUrl: 'https://www.ocado.com', maxResults: 3 })
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({
      providerProductId: '22223333',
      name: 'Greek Yogurt',
      price: 2.1,
      imageUrl: 'https://images.ocado.com/yogurt.png',
      productUrl: 'https://www.ocado.com/products/22223333',
    })
  })

  it('parses __INITIAL_STATE__ JSON out of HTML when it is JSON', () => {
    const html = `
      <html><head></head><body>
        <script>window.__INITIAL_STATE__ = {"a": {"b": 1, "c": ["1234"]}};</script>
      </body></html>
    `
    expect(parseInitialStateFromHtml(html)).toEqual({ a: { b: 1, c: ['1234'] } })
  })

  it('extracts cart items + total from a trolley-ish subtree', () => {
    const state = {
      trolley: {
        summary: { total: 42.5, currencyCode: 'GBP' },
        items: [
          { productId: '12345678', name: 'Milk', quantity: 2, price: { value: 1.25 } },
          { productId: 99990000, title: 'Cheddar', qty: 1, price: 375 },
        ],
      },
    }

    const cart = extractCartFromInitialState(state)
    expect(cart?.currency).toBe('GBP')
    expect(cart?.total).toBe(42.5)
    expect(cart?.items.map(i => ({ id: i.providerProductId, q: i.quantity, price: i.price }))).toEqual([
      { id: '12345678', q: 2, price: 1.25 },
      { id: '99990000', q: 1, price: 3.75 },
    ])
  })
})
