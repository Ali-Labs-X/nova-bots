import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FALLBACK_SIDEBAR_WIDTH } from './frame-layout.js'

// -------------------------------------------------------------------------
// Overlays: new chat, bot exchange, details drawer, context menu

// Escape closes only the newest open layer, so a dialog over the details pane does
// not take the pane down with it.
const escapeLayers = []
const onEscapeKey = (event) => { if (event.key === 'Escape') escapeLayers.at(-1)?.current() }
export function useEscape(onClose) {
  const ref = useRef(onClose)
  ref.current = onClose
  useEffect(() => {
    if (escapeLayers.length === 0) window.addEventListener('keydown', onEscapeKey)
    escapeLayers.push(ref)
    return () => {
      escapeLayers.splice(escapeLayers.indexOf(ref), 1)
      if (escapeLayers.length === 0) window.removeEventListener('keydown', onEscapeKey)
    }
  }, [])
}

// New chat, voice and Bot exchanges show in place of the conversation, so they start
// where its column does. The shell's own sidebar is collapsed in the Bot view and says
// nothing about ours.
export function usePaneLeft() {
  const [paneLeft, setPaneLeft] = useState(FALLBACK_SIDEBAR_WIDTH)
  useLayoutEffect(() => {
    const column = document.querySelector('[class*="_centerCol"]')
    if (!column) return undefined
    const measure = () => setPaneLeft(Math.round(column.getBoundingClientRect().left))
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(column)
    return () => observer?.disconnect()
  }, [])
  return paneLeft
}
