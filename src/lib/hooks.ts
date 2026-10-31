import { useEffect, useRef, type RefObject } from 'react'

export function useClickOutside<T extends HTMLElement>(
  ref: RefObject<T | null>,
  handler: () => void,
  active = true,
  ignoreRef?: RefObject<HTMLElement | null>,
) {
  const saved = useRef(handler)
  saved.current = handler

  useEffect(() => {
    if (!active) return
    const onPointer = (event: PointerEvent) => {
      const node = ref.current
      if (!node) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (node.contains(target)) return
      if (ignoreRef?.current?.contains(target)) return
      saved.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') saved.current()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [active, ref, ignoreRef])
}
