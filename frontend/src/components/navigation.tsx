'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Calendar, ChefHat, ShoppingCart, Package, Compass, Upload, Settings, BookOpen, Apple } from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { href: '/', label: 'Dashboard', icon: ChefHat },
  { href: '/recipes', label: 'Recipes', icon: BookOpen },
  { href: '/discover', label: 'Discover', icon: Compass },
  { href: '/meal-plan', label: 'Meal Plan', icon: Calendar },
  { href: '/shopping', label: 'Shopping', icon: ShoppingCart },
  { href: '/pantry', label: 'Pantry', icon: Package },
  { href: '/ingredients', label: 'Ingredients', icon: Apple },
]

const secondaryItems = [
  { href: '/import', label: 'Import', icon: Upload },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Navigation() {
  const pathname = usePathname()

  return (
    <nav className="bg-white border-b border-gray-200">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          <Link href="/" className="text-xl font-bold text-gray-900">
            Meal Planner
          </Link>

          <div className="flex items-center gap-4">
            <div className="flex space-x-1">
              {navItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                )
              })}
            </div>

            <div className="h-6 w-px bg-gray-200 hidden sm:block" />

            <div className="flex space-x-1">
              {secondaryItems.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="hidden md:inline">{label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </nav>
  )
}
