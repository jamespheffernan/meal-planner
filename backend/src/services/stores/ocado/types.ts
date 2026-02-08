export interface OcadoProductResult {
  provider: 'ocado'
  providerProductId: string
  name: string
  price: number | null
  currency: string
  imageUrl: string | null
  productUrl: string | null
}

export interface OcadoCartItem {
  name: string
  providerProductId?: string | null
  quantity: number
  price: number | null
  lineTotal: number | null
}

export interface OcadoCartSummary {
  currency: string
  total: number | null
  items: OcadoCartItem[]
  _meta?: { source: 'initial_state' | 'dom' }
  _status?: {
    belowMinimum?: { minimum: number | null; message?: string }
  }
}
