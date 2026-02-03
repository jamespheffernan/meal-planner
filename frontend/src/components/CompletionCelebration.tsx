'use client'

import { useEffect, useState } from 'react'
import { PartyPopper, Check } from 'lucide-react'

interface CompletionCelebrationProps {
  isComplete: boolean
  mealType: string
}

export function CompletionCelebration({ isComplete, mealType }: CompletionCelebrationProps) {
  const [show, setShow] = useState(false)
  const [hasShown, setHasShown] = useState(false)

  useEffect(() => {
    if (isComplete && !hasShown) {
      setShow(true)
      setHasShown(true)
      const timer = setTimeout(() => setShow(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [isComplete, hasShown])

  if (!show) return null

  return (
    <div className="fixed top-20 right-4 z-50 animate-slide-in-right">
      <div className="bg-gradient-to-r from-green-500 to-emerald-500 text-white px-6 py-4 rounded-lg shadow-xl flex items-center gap-3">
        <PartyPopper className="w-6 h-6 animate-bounce" />
        <div>
          <div className="font-semibold flex items-center gap-2">
            <Check className="w-5 h-5" />
            {mealType} Complete!
          </div>
          <div className="text-sm text-green-50">All slots filled for the week</div>
        </div>
      </div>
    </div>
  )
}
