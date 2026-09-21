import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    const initialValue = window.innerWidth < MOBILE_BREAKPOINT
    const timer = window.setTimeout(() => setIsMobile(initialValue), 0)
    return () => {
      window.clearTimeout(timer)
      mql.removeEventListener("change", onChange)
    }
  }, [])

  return !!isMobile
}
