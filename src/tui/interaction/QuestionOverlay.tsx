/**
 * In-terminal answerer for one question from `ctx.userQuestions`
 * (`@deepseek-ai/dsh-user-questions`): the `ask_user_question` tool, or
 * `dsh-plan-mode`'s `exit_plan_mode` review (`approveLabel` set). A cursor
 * moves over the offered options plus a trailing "Other…" row that opens a
 * free-text field (`ink-text-input`, mirroring `ProviderForm`'s focused-row
 * pattern); a request with no options starts directly in that field. Space
 * toggles a row for a multi-select question; Enter always submits the
 * current toggled/typed answer.
 * @module @tomowang/dsh-tui/tui/interaction/QuestionOverlay
 */

import { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import type { TuiActions } from '../PromptInput.js'
import { theme } from '../theme.js'
import type { QuestionPromptState } from './types.js'

export interface QuestionOverlayProps {
  readonly question: QuestionPromptState
  readonly actions: TuiActions
}

/** Detail (e.g. a plan-review's plan markdown) line cap — a permanent Ink frame, not a scrollable pager. */
const MAX_DETAIL_LINES = 60

function capDetailLines(detail: string): string[] {
  const lines = detail.split('\n')
  if (lines.length <= MAX_DETAIL_LINES) return lines
  const omitted = lines.length - MAX_DETAIL_LINES
  return [...lines.slice(0, MAX_DETAIL_LINES), `… +${omitted} more line${omitted === 1 ? '' : 's'}`]
}

export function QuestionOverlay({ question, actions }: QuestionOverlayProps) {
  const { header, question: text, detail, options, multiSelect, approveLabel, progress } = question
  const otherIndex = options.length
  const [cursor, setCursor] = useState(0)
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set())
  const [customMode, setCustomMode] = useState(options.length === 0)
  const [customText, setCustomText] = useState('')

  function submit(): void {
    const custom = customText.trim()
    if (multiSelect) {
      const selected = [...toggled].sort((a, b) => a - b).map(index => options[index].label)
      actions.answerQuestion({ selected, custom: custom === '' ? undefined : custom })
      return
    }
    if (customMode) {
      actions.answerQuestion({ selected: [], custom })
      return
    }
    actions.answerQuestion({ selected: [options[cursor].label], custom: undefined })
  }

  useInput((input, key) => {
    if (customMode) {
      if (key.escape) {
        if (options.length > 0) setCustomMode(false)
        else actions.answerQuestion({ selected: [], custom: undefined })
      }
      return
    }
    if (key.escape) {
      actions.answerQuestion({ selected: [], custom: undefined })
      return
    }
    if (options.length === 0) return
    if (key.upArrow) {
      setCursor(current => (current - 1 + options.length + 1) % (options.length + 1))
      return
    }
    if (key.downArrow) {
      setCursor(current => (current + 1) % (options.length + 1))
      return
    }
    if (input === ' ' && multiSelect && cursor < options.length) {
      setToggled(prev => {
        const next = new Set(prev)
        if (next.has(cursor)) next.delete(cursor)
        else next.add(cursor)
        return next
      })
      return
    }
    if (key.return) {
      if (cursor === otherIndex) {
        setCustomMode(true)
        return
      }
      submit()
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color={theme.secondary}>
        {header ?? 'Question'}
        {progress === undefined ? '' : ` — ${progress}`}
      </Text>
      <Text>{text}</Text>
      {detail === undefined ? null : (
        <Box flexDirection="column" marginTop={1} marginBottom={1}>
          {capDetailLines(detail).map((line, index) => (
            <Text key={index} color={theme.muted}>{line}</Text>
          ))}
        </Box>
      )}
      {options.map((option, index) => (
        <Box key={option.label} flexDirection="column">
          <Text inverse={!customMode && cursor === index}>
            {!customMode && cursor === index ? '› ' : '  '}
            {multiSelect ? (toggled.has(index) ? '[x] ' : '[ ] ') : ''}
            {option.label}
            {approveLabel === option.label ? ' (approve)' : ''}
          </Text>
          {option.description === undefined ? null : <Text color={theme.muted}>    {option.description}</Text>}
        </Box>
      ))}
      {options.length === 0 ? null : (
        <Text inverse={!customMode && cursor === otherIndex}>
          {!customMode && cursor === otherIndex ? '› ' : '  '}Other…
        </Text>
      )}
      {customMode ? (
        <Box>
          <Text>{'> '}</Text>
          <TextInput value={customText} onChange={setCustomText} onSubmit={submit} />
        </Box>
      ) : null}
      <Text color={theme.muted}>
        {multiSelect ? '↑↓ move · space toggle · enter submit' : '↑↓ move · enter select'}
        {options.length === 0 ? '' : ' · "Other…" for free text'}
        {' · esc skip'}
      </Text>
    </Box>
  )
}
