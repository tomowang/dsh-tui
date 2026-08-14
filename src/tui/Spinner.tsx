/**
 * A small braille spinner for the status bar's running indicator.
 * @module @tomowang/dsh-tui/tui/Spinner
 */

import { useEffect, useState } from 'react'
import { Text } from 'ink'

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const INTERVAL_MS = 80

export function Spinner() {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame(current => (current + 1) % FRAMES.length)
    }, INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  return <Text>{FRAMES[frame]}</Text>
}
