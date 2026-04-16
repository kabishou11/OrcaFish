import { useEffect, useState } from 'react'

export function useViewportMatch(maxWidth: number) {
  const getValue = () => {
    if (typeof window === 'undefined') return false
    return window.innerWidth <= maxWidth
  }

  const [matches, setMatches] = useState<boolean>(getValue)

  useEffect(() => {
    const handleResize = () => setMatches(getValue())
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [maxWidth])

  return matches
}

export default useViewportMatch
