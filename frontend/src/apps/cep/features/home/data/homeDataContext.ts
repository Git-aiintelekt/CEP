import { createContext, useContext } from 'react'

import type { HomeDataSource, HomeViewer } from './types'

export interface HomeData {
  source: HomeDataSource
  viewer: HomeViewer
}

export const HomeDataContext = createContext<HomeData | null>(null)

export function useHomeData(): HomeData {
  const value = useContext(HomeDataContext)
  if (!value) throw new Error('useHomeData needs a <HomeDataProvider> above it')
  return value
}
