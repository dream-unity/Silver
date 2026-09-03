import { useEffect, useState } from 'react'
import {
  getDeletedMemoryCount,
  openSharedDeletedMemories,
  subscribeDeletedMemories,
} from '../lib/deleted-memories'

export function DeletedMemoriesButton() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let active = true
    const refresh = () => {
      getDeletedMemoryCount()
        .then((value) => {
          if (active) setCount(value)
        })
        .catch(() => {
          if (active) setCount(0)
        })
    }
    refresh()
    const unsubscribe = subscribeDeletedMemories(refresh)
    const expiryCheck = window.setInterval(refresh, 60 * 60 * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      active = false
      unsubscribe()
      window.clearInterval(expiryCheck)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  const label = count
    ? `Deleted Memories, ${count} recoverable ${count === 1 ? 'item' : 'items'}`
    : 'Deleted Memories'

  return (
    <button
      type="button"
      className="deleted-memories-launcher"
      onClick={openSharedDeletedMemories}
      aria-label={label}
      title="Deleted Memories"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" />
      </svg>
      <span>Deleted Memories</span>
      {count > 0 ? <b>{count}</b> : null}
    </button>
  )
}
