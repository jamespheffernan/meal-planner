const tails = new Map<string, Promise<void>>()

// Serialize automation actions per provider to avoid concurrent Playwright sessions
// stepping on each other's carts/sessions.
export async function withProviderLock<T>(provider: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(provider) ?? Promise.resolve()

  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })

  const chained = prev.then(() => current)
  tails.set(provider, chained)

  await prev
  try {
    return await fn()
  } finally {
    release()
    // Best-effort cleanup: if nobody queued behind us, drop the tail.
    if (tails.get(provider) === chained) {
      tails.delete(provider)
    }
  }
}

