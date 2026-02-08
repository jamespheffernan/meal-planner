/**
 * Search for a food image using Brave Search API
 * Returns a URL to a relevant food image
 */
export async function searchFoodImage(dishName: string): Promise<string | null> {
  const braveKey = process.env.BRAVE_API_KEY

  if (!braveKey) {
    console.error('BRAVE_API_KEY not set')
    return null
  }

  try {
    const query = encodeURIComponent(`${dishName} food recipe`)
    const response = await fetch(
      `https://api.search.brave.com/res/v1/images/search?q=${query}&count=5&safesearch=strict`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': braveKey,
        },
      }
    )

    if (!response.ok) {
      console.error('Brave API error:', response.status, await response.text())
      return null
    }

    const data: any = await response.json()

    if (data.results?.length > 0) {
      // Return the first image result
      return data.results[0].properties?.url || data.results[0].thumbnail?.src
    }

    return null
  } catch (error) {
    console.error('Error searching Brave:', error)
    return null
  }
}

/**
 * Generate a placeholder image URL based on meal type
 */
export function getPlaceholderImage(mealType: string): string {
  // Static fallback images from Pexels (known working URLs)
  const images: Record<string, string> = {
    breakfast: 'https://images.pexels.com/photos/103124/pexels-photo-103124.jpeg?auto=compress&cs=tinysrgb&w=800',
    lunch: 'https://images.pexels.com/photos/1640777/pexels-photo-1640777.jpeg?auto=compress&cs=tinysrgb&w=800',
    dinner: 'https://images.pexels.com/photos/699953/pexels-photo-699953.jpeg?auto=compress&cs=tinysrgb&w=800',
    snack: 'https://images.pexels.com/photos/1132047/pexels-photo-1132047.jpeg?auto=compress&cs=tinysrgb&w=800',
  }

  return images[mealType] || images.dinner
}
