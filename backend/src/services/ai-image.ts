import type { PrismaClient } from '@prisma/client'
import { getOpenAIClient } from './openai-client.js'

export async function generateRecipeImage(prisma: PrismaClient, recipeName: string, mealType?: string): Promise<string> {
  const openai = await getOpenAIClient(prisma)

  const prompt = [
    'High-quality food photography.',
    `Dish: ${recipeName}.`,
    mealType ? `Meal type: ${mealType}.` : null,
    'Top-down or 3/4 angle, realistic lighting, appetizing presentation.',
    'No text, no logos, no people, clean background.',
  ]
    .filter(Boolean)
    .join(' ')

  const response = await openai.images.generate({
    model: 'gpt-image-1',
    prompt,
    size: '1024x1024',
    n: 1,
  })

  const base64 = response.data?.[0]?.b64_json
  const url = response.data?.[0]?.url
  if (!base64 && !url) {
    throw new Error('No image data returned from OpenAI')
  }

  if (base64) {
    return `data:image/png;base64,${base64}`
  }

  return url!
}
