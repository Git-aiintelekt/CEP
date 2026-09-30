import type { ReactNode } from 'react'

import { HomeDataContext, type HomeData } from './homeDataContext'

/** The real page passes liveSource and a viewer built from useAuth(); /dev/home passes a sample source and viewer. */
export function HomeDataProvider({ source, viewer, children }: HomeData & { children: ReactNode }) {
  return <HomeDataContext.Provider value={{ source, viewer }}>{children}</HomeDataContext.Provider>
}
