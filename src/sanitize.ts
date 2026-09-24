/**
 * Terminal-control sanitization for untrusted text — model output, tool
 * results, file contents, session titles, shell output. The TUI writes
 * pre-styled strings straight to the terminal, so a raw ESC/OSC/C1 byte in any
 * of those would otherwise reach the terminal verbatim and be acted on
 * (clipboard writes via OSC 52, cursor/screen control via CSI, an OSC 0 title
 * break-out via BEL, …). Sanitization runs on the raw string *before* this
 * app's own styling is applied, since afterwards the two can't be told apart.
 * @module @tomowang/dsh-tui/sanitize
 */

// eslint-disable-next-line no-control-regex -- detecting control bytes requires their literal code points.
const NEEDS_SANITIZE_RE = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/

/**
 * One alternation, matched leftmost-first at each position: a complete CSI
 * sequence; a terminated OSC/DCS/SOS/PM/APC string; any other ESC plus its
 * intermediates and final byte (which also consumes just the introducer of an
 * unterminated string/CSI, leaving its payload as harmless plain text); and
 * finally any lone C0 (except tab/newline), DEL, or C1 byte — C1 matters
 * because some terminals treat U+009B/U+009D as 8-bit CSI/OSC.
 */
// eslint-disable-next-line no-control-regex -- matching terminal escape sequences requires their literal control bytes.
const ESCAPE_OR_CONTROL_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b[\]PX^_][^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c)|\x1b[ -/]*[0-~]|[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/** A plain SGR (color/style) sequence — the only escape `terminalOutput` mode keeps, since it can't move the cursor or talk to the host. */
// eslint-disable-next-line no-control-regex -- matching SGR requires the literal ESC byte.
const SGR_RE = /^\x1b\[[0-9;:]*m$/

export interface SanitizeOptions {
  /**
   * Text is a command's terminal output (`!` shell mode): keep SGR colors
   * (`ls --color`, `git diff`) and resolve carriage-return overwrites
   * (progress bars) to what the terminal would have left visible. Otherwise
   * every escape is stripped and a lone `\r` is dropped, so nothing an
   * overwrite would have hidden stays hidden.
   */
  terminalOutput?: boolean
}

/** Keep, per line, only the last non-empty `\r`-separated segment — what a progress-bar redraw leaves on screen. */
function applyCarriageReturns(text: string): string {
  return text
    .split('\n')
    .map(line => line.split('\r').filter(part => part !== '').at(-1) ?? '')
    .join('\n')
}

/**
 * Strip terminal escape sequences and control bytes from untrusted text,
 * keeping tab and newline (CRLF normalizes to LF). Text with no control bytes
 * is returned unchanged, so ordinary prose stays byte-for-byte identical.
 */
export function sanitizeTerminalText(text: string, options: SanitizeOptions = {}): string {
  if (!NEEDS_SANITIZE_RE.test(text)) return text
  const normalized = text.replaceAll('\r\n', '\n')
  const lines = options.terminalOutput === true ? applyCarriageReturns(normalized) : normalized
  return lines.replaceAll(ESCAPE_OR_CONTROL_RE, match => (options.terminalOutput === true && SGR_RE.test(match) ? match : ''))
}

/** Longest title handed to the terminal's OSC 0 or the composer border. */
const TITLE_MAX_LENGTH = 120

/** A single-line, control-free, length-capped title — safe to embed in an OSC 0 string, where a stray BEL would otherwise end the sequence early. */
export function sanitizeTitle(text: string): string {
  return sanitizeTerminalText(text).replaceAll(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH)
}

/**
 * Recursively sanitize every string inside plain objects/arrays (e.g. a
 * session event or a tool's presented view). Anything else — class
 * instances, functions — is returned as-is. Unchanged subtrees keep their
 * identity, so a clean event costs a walk but no allocation.
 */
export function sanitizeDeep<T>(value: T): T {
  if (typeof value === 'string') return sanitizeTerminalText(value) as T
  if (Array.isArray(value)) {
    let changed = false
    const next = value.map((item: unknown) => {
      const clean = sanitizeDeep(item)
      if (clean !== item) changed = true
      return clean
    })
    return (changed ? next : value) as T
  }
  if (value === null || typeof value !== 'object') return value
  const proto = Object.getPrototypeOf(value) as unknown
  if (proto !== Object.prototype && proto !== null) return value
  let changed = false
  const next: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value) as [string, unknown][]) {
    const clean = sanitizeDeep(item)
    if (clean !== item) changed = true
    next[key] = clean
  }
  return (changed ? next : value) as T
}

const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/** `url` when it is safe to embed in an OSC 8 hyperlink (http/https/mailto, no control bytes), else `undefined`. */
export function safeHyperlinkUrl(url: string): string | undefined {
  if (NEEDS_SANITIZE_RE.test(url)) return undefined
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol) ? url : undefined
  } catch {
    return undefined
  }
}
