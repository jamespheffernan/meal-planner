'use client'

import { useMemo, useState } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { Check, Plus, X } from 'lucide-react'

type MealType = 'breakfast' | 'lunch' | 'dinner'
type MealStatus = 'planned' | 'cooked' | 'skipped'

type MockMeal = {
  id: string
  date: Date
  mealType: MealType
  title: string
  servings: number
  status: MealStatus
  isLeftover?: boolean
}

const MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function Pill({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'blue' | 'green' | 'amber' | 'gray' | 'red'
}) {
  const tones: Record<typeof tone, string> = {
    blue: 'bg-blue-50 text-blue-800 ring-blue-200',
    green: 'bg-green-50 text-green-800 ring-green-200',
    amber: 'bg-amber-50 text-amber-800 ring-amber-200',
    gray: 'bg-gray-50 text-gray-800 ring-gray-200',
    red: 'bg-red-50 text-red-800 ring-red-200',
  }
  return (
    <span className={classNames('inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ring-1', tones[tone])}>
      {children}
    </span>
  )
}

function MealChip({ meal }: { meal: MockMeal }) {
  const tone =
    meal.status === 'cooked' ? 'green' :
    meal.isLeftover ? 'amber' :
    meal.status === 'skipped' ? 'red' : 'blue'

  return (
    <div className={classNames(
      'rounded-lg px-2 py-1 text-xs leading-tight ring-1',
      tone === 'green' && 'bg-green-50 ring-green-200',
      tone === 'amber' && 'bg-amber-50 ring-amber-200',
      tone === 'red' && 'bg-red-50 ring-red-200',
      tone === 'blue' && 'bg-blue-50 ring-blue-200',
    )}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{meal.title}</div>
          <div className="text-[11px] text-gray-600">{meal.servings} servings</div>
        </div>
        {meal.status === 'cooked' ? (
          <Check className="w-4 h-4 text-green-700 shrink-0" />
        ) : meal.status === 'skipped' ? (
          <X className="w-4 h-4 text-red-700 shrink-0" />
        ) : null}
      </div>
    </div>
  )
}

function EmptyCell() {
  return (
    <div className="h-12 rounded-lg border border-dashed border-gray-200 text-gray-300 flex items-center justify-center">
      <Plus className="w-4 h-4" />
    </div>
  )
}

export default function MealPlanLayoutsMockPage() {
  const [variant, setVariant] = useState<'compact-grid' | 'day-cards' | 'rows-by-day'>('compact-grid')

  const weekStart = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), [])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  const meals = useMemo<MockMeal[]>(() => {
    // Intentional mix of short/long names + leftovers + cooked
    return [
      { id: 'm1', date: days[0], mealType: 'breakfast', title: 'Fluffy Scrambled Eggs', servings: 2, status: 'planned' },
      { id: 'm2', date: days[0], mealType: 'dinner', title: 'Lemon Herb Chicken + Veg', servings: 4, status: 'planned' },
      { id: 'm3', date: days[1], mealType: 'lunch', title: 'Turkey Sandwich', servings: 2, status: 'cooked' },
      { id: 'm4', date: days[1], mealType: 'dinner', title: 'Leftover Lemon Chicken', servings: 2, status: 'planned', isLeftover: true },
      { id: 'm5', date: days[2], mealType: 'dinner', title: 'Spicy Peanut Noodles', servings: 4, status: 'planned' },
      { id: 'm6', date: days[3], mealType: 'breakfast', title: 'Greek Yogurt + Berries', servings: 2, status: 'planned' },
      { id: 'm7', date: days[4], mealType: 'lunch', title: 'Big Salad (Pantry Cleanout)', servings: 2, status: 'skipped' },
      { id: 'm8', date: days[5], mealType: 'dinner', title: 'Sheet Pan Sausage + Peppers', servings: 4, status: 'planned' },
      { id: 'm9', date: days[6], mealType: 'breakfast', title: 'Banana-Almond Butter Oats', servings: 2, status: 'cooked' },
    ]
  }, [days])

  const bySlot = useMemo(() => {
    const map = new Map<string, MockMeal>()
    for (const m of meals) {
      map.set(`${format(m.date, 'yyyy-MM-dd')}:${m.mealType}`, m)
    }
    return map
  }, [meals])

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Weekly Schedule Layouts (Mock)</h1>
          <div className="mt-1 text-sm text-gray-600">
            {format(days[0], 'MMM d')} - {format(days[6], 'MMM d, yyyy')}
          </div>
        </div>

        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          <button
            type="button"
            onClick={() => setVariant('compact-grid')}
            className={classNames('px-3 py-2 text-sm font-medium rounded-md', variant === 'compact-grid' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900')}
          >
            Compact grid
          </button>
          <button
            type="button"
            onClick={() => setVariant('day-cards')}
            className={classNames('px-3 py-2 text-sm font-medium rounded-md', variant === 'day-cards' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900')}
          >
            Day cards
          </button>
          <button
            type="button"
            onClick={() => setVariant('rows-by-day')}
            className={classNames('px-3 py-2 text-sm font-medium rounded-md', variant === 'rows-by-day' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-600 hover:text-gray-900')}
          >
            Rows by day
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Pill tone="blue">Planned</Pill>
        <Pill tone="green">Cooked</Pill>
        <Pill tone="amber">Leftover</Pill>
        <Pill tone="red">Skipped</Pill>
        <Pill tone="gray">Empty slot</Pill>
      </div>

      {variant === 'compact-grid' ? (
        <div className="bg-white rounded-xl shadow overflow-auto">
          <table className="min-w-[860px] w-full">
            <thead className="sticky top-0 bg-white z-10 border-b border-gray-200">
              <tr>
                <th className="sticky left-0 bg-white z-20 w-14 p-2 text-left text-xs font-medium text-gray-500"> </th>
                {days.map(d => (
                  <th key={d.toISOString()} className="p-2 text-center text-xs font-semibold text-gray-900">
                    <div className="uppercase tracking-wide">{format(d, 'EEE')}</div>
                    <div className="text-gray-500 font-normal">{format(d, 'M/d')}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MEAL_TYPES.map(mt => (
                <tr key={mt} className="border-b border-gray-100">
                  <td className="sticky left-0 bg-white z-10 p-2 text-xs font-semibold text-gray-600">
                    {mt === 'breakfast' ? 'B' : mt === 'lunch' ? 'L' : 'D'}
                  </td>
                  {days.map(d => {
                    const key = `${format(d, 'yyyy-MM-dd')}:${mt}`
                    const meal = bySlot.get(key)
                    return (
                      <td key={key} className="p-1 align-top">
                        {meal ? <MealChip meal={meal} /> : <EmptyCell />}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : variant === 'day-cards' ? (
        <div className="grid grid-cols-7 gap-3 overflow-auto">
          {days.map(d => (
            <div key={d.toISOString()} className="min-w-[220px] bg-white rounded-xl shadow p-3">
              <div className="flex items-baseline justify-between">
                <div className="font-semibold text-gray-900">{format(d, 'EEE')}</div>
                <div className="text-sm text-gray-500">{format(d, 'M/d')}</div>
              </div>
              <div className="mt-3 space-y-3">
                {MEAL_TYPES.map(mt => {
                  const key = `${format(d, 'yyyy-MM-dd')}:${mt}`
                  const meal = bySlot.get(key)
                  return (
                    <div key={key} className="space-y-1">
                      <div className="text-[11px] uppercase tracking-wide text-gray-500">
                        {mt}
                      </div>
                      {meal ? <MealChip meal={meal} /> : <EmptyCell />}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow overflow-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[120px_1fr] border-b border-gray-200 sticky top-0 bg-white z-10">
              <div className="p-3 text-xs font-medium text-gray-500">Day</div>
              <div className="grid grid-cols-3 gap-3 p-3 text-xs font-medium text-gray-500">
                <div>Breakfast</div>
                <div>Lunch</div>
                <div>Dinner</div>
              </div>
            </div>

            {days.map(d => (
              <div key={d.toISOString()} className="grid grid-cols-[120px_1fr] border-b border-gray-100">
                <div className="p-3">
                  <div className="text-sm font-semibold text-gray-900">{format(d, 'EEE')}</div>
                  <div className="text-xs text-gray-500">{format(d, 'MMM d')}</div>
                </div>
                <div className="grid grid-cols-3 gap-3 p-3">
                  {MEAL_TYPES.map(mt => {
                    const key = `${format(d, 'yyyy-MM-dd')}:${mt}`
                    const meal = bySlot.get(key)
                    return meal ? <MealChip key={key} meal={meal} /> : <EmptyCell key={key} />
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-sm text-gray-600">
        Open this mock at <span className="font-mono">/meal-plan/layouts</span>.
      </div>
    </div>
  )
}

