'use client'

import { Coffee, Salad, UtensilsCrossed } from 'lucide-react'

interface MealProgress {
  breakfast: { filled: number; needed: number }
  lunch: { filled: number; needed: number }
  dinner: { filled: number; needed: number }
}

interface MealProgressTrackerProps {
  progress: MealProgress
}

export function MealProgressTracker({ progress }: MealProgressTrackerProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Weekly Progress</h2>
      
      <ProgressBar
        icon={Coffee}
        label="Breakfast"
        filled={progress.breakfast.filled}
        needed={progress.breakfast.needed}
        color="orange"
      />
      
      <ProgressBar
        icon={Salad}
        label="Lunch"
        filled={progress.lunch.filled}
        needed={progress.lunch.needed}
        color="green"
      />
      
      <ProgressBar
        icon={UtensilsCrossed}
        label="Dinner"
        filled={progress.dinner.filled}
        needed={progress.dinner.needed}
        color="blue"
      />
    </div>
  )
}

interface ProgressBarProps {
  icon: React.ElementType
  label: string
  filled: number
  needed: number
  color: 'orange' | 'green' | 'blue'
}

function ProgressBar({ icon: Icon, label, filled, needed, color }: ProgressBarProps) {
  const percentage = Math.min((filled / needed) * 100, 100)
  const remaining = Math.max(needed - filled, 0)
  const isComplete = filled >= needed
  
  const colorClasses = {
    orange: {
      bg: 'bg-orange-500',
      text: 'text-orange-600',
      lightBg: 'bg-orange-50',
      icon: 'text-orange-500',
    },
    green: {
      bg: 'bg-green-500',
      text: 'text-green-600',
      lightBg: 'bg-green-50',
      icon: 'text-green-500',
    },
    blue: {
      bg: 'bg-blue-500',
      text: 'text-blue-600',
      lightBg: 'bg-blue-50',
      icon: 'text-blue-500',
    },
  }
  
  const colors = colorClasses[color]
  
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={`w-5 h-5 ${colors.icon}`} />
          <span className="font-medium text-gray-900">{label}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-sm font-semibold ${colors.text}`}>
            {filled}/{needed}
          </span>
          {!isComplete && (
            <span className="text-xs text-gray-500">
              ({remaining} more)
            </span>
          )}
          {isComplete && (
            <span className="text-xs text-green-600 font-medium">
              ✓ Complete
            </span>
          )}
        </div>
      </div>
      
      <div className="relative h-3 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${colors.bg} transition-all duration-700 ease-out rounded-full relative`}
          style={{ width: `${percentage}%` }}
        >
          {isComplete && (
            <>
              <div className="absolute inset-0 animate-pulse opacity-30 bg-white" />
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-40 animate-shimmer" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
