import { cn } from '@/lib/utils'
import type { GlobeMapType } from '@/types'

interface BasemapAttributionProps {
  mapType: GlobeMapType
  className?: string
}

export function BasemapAttribution({ mapType, className }: BasemapAttributionProps) {
  return (
    <div
      className={cn(
        'absolute bottom-1.5 left-1/2 z-20 max-w-[calc(100%-1rem)] -translate-x-1/2 text-center text-[9px] leading-tight',
        mapType === 'satellite'
          ? 'text-white/70 drop-shadow-[0_1px_2px_rgba(0,0,0,0.45)]'
          : 'text-[rgba(95,99,112,0.55)]',
        className,
      )}
    >
      {mapType === 'satellite' ? (
        <>
          Imagery:{' '}
          <a className="underline-offset-2 hover:underline" href="https://www.esri.com/" target="_blank" rel="noreferrer">
            Esri
          </a>
          , Vantor, Earthstar Geographics, GIS User Community
        </>
      ) : (
        <>
          Basemap:{' '}
          <a className="underline-offset-2 hover:underline" href="https://carto.com/" target="_blank" rel="noreferrer">
            CARTO
          </a>
          {' | '}
          <a
            className="underline-offset-2 hover:underline"
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap contributors
          </a>
        </>
      )}
    </div>
  )
}
