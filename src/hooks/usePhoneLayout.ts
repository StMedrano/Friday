import { useEffect, useState } from 'react'

const PHONE_QUERY = '(max-width: 700px)'

export function usePhoneLayout() {
  const getMatch = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false
  const [phone, setPhone] = useState(getMatch)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(PHONE_QUERY)
    const onChange = (event: MediaQueryListEvent) => setPhone(event.matches)
    setPhone(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return phone
}
