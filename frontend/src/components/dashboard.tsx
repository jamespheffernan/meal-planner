'use client'

import { useQuery } from '@tanstack/react-query'
import { mealPlans, pantry } from '@/lib/api'
import { format, addDays } from 'date-fns'
import Link from 'next/link'
import { Calendar, AlertTriangle, ChefHat, ShoppingCart } from 'lucide-react'

export function Dashboard() {
  const today = new Date()
  const weekEnd = addDays(today, 7)

  const { data: upcomingMeals, isLoading: mealsLoading } = useQuery({
    queryKey: ['mealPlans', 'upcoming'],
    queryFn: () => mealPlans.list({
      fromDate: format(today, 'yyyy-MM-dd'),
      toDate: format(weekEnd, 'yyyy-MM-dd'),
    }),
  })

  const { data: expiringItems, isLoading: expiringLoading } = useQuery({
    queryKey: ['pantry', 'expiring'],
    queryFn: () => pantry.expiring(5),
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <QuickAction
          href="/discover"
          icon={ChefHat}
          title="Discover Recipes"
          description="Swipe to approve new recipes"
        />
        <QuickAction
          href="/meal-plan"
          icon={Calendar}
          title="Plan Meals"
          description="Plan your week"
        />
        <QuickAction
          href="/shopping"
          icon={ShoppingCart}
          title="Shopping List"
          description="Generate your grocery list"
        />
        <QuickAction
          href="/recipes/new"
          icon={ChefHat}
          title="Add Recipe"
          description="Add a new recipe"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Meals */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Upcoming Meals
          </h2>
          {mealsLoading ? (
            <p className="text-gray-500">Loading...</p>
          ) : upcomingMeals && upcomingMeals.length > 0 ? (
            <div className="space-y-3">
              {upcomingMeals.slice(0, 5).map((meal) => (
                <div key={meal.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{meal.recipe?.name || 'Unknown'}</p>
                    <p className="text-sm text-gray-500">
                      {format(new Date(meal.plannedDate), 'EEE, MMM d')} - {meal.mealType}
                    </p>
                  </div>
                  <span className={`px-2 py-1 text-xs rounded-full ${
                    meal.status === 'cooked' ? 'bg-green-100 text-green-800' :
                    meal.status === 'skipped' ? 'bg-gray-100 text-gray-600' :
                    'bg-blue-100 text-blue-800'
                  }`}>
                    {meal.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No meals planned yet. <Link href="/meal-plan" className="text-blue-600 hover:underline">Start planning</Link></p>
          )}
        </div>

        {/* Expiring Items */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" />
            Expiring Soon
          </h2>
          {expiringLoading ? (
            <p className="text-gray-500">Loading...</p>
          ) : expiringItems && expiringItems.length > 0 ? (
            <div className="space-y-3">
              {expiringItems.slice(0, 5).map((item) => (
                <div key={item.id} className="flex justify-between items-center p-3 bg-amber-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">{item.ingredient.name}</p>
                    <p className="text-sm text-gray-500">
                      {item.quantity} {item.unit}
                    </p>
                  </div>
                  <span className="text-sm text-amber-600">
                    Expires {item.expirationDate ? format(new Date(item.expirationDate), 'MMM d') : 'soon'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500">No items expiring soon.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickAction({ href, icon: Icon, title, description }: {
  href: string
  icon: React.ElementType
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="bg-white rounded-lg shadow p-4 hover:shadow-md transition-shadow"
    >
      <Icon className="w-8 h-8 text-gray-700 mb-2" />
      <h3 className="font-medium text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500">{description}</p>
    </Link>
  )
}
