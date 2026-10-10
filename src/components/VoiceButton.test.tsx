import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VoiceButton, voiceLoggingAvailable } from './VoiceButton'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

class FakeRecognition {
  static last: FakeRecognition | null = null
  lang = ''
  interimResults = false
  continuous = false
  maxAlternatives = 1
  onresult: ((event: { results: Array<Array<{ transcript: string }>> }) => void) | null = null
  onerror: ((event: { error?: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  constructor() { FakeRecognition.last = this }
  start() { this.started = true }
  stop() { this.onend?.() }
  abort() { this.onend?.() }
}

describe('VoiceButton', () => {
  it('renders_nothing_without_speech_recognition', () => {
    render(<VoiceButton onText={() => undefined} onError={() => undefined} />)
    expect(voiceLoggingAvailable()).toBe(false)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('streams_words_then_signals_the_end', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const onText = vi.fn()
    const user = userEvent.setup()
    render(<VoiceButton onText={onText} onError={() => undefined} />)
    await user.click(screen.getByRole('button', { name: 'Say what you ate' }))
    const recognition = FakeRecognition.last as FakeRecognition
    expect(recognition.started).toBe(true)
    expect(recognition.interimResults).toBe(true)
    act(() => recognition.onresult?.({ results: [[{ transcript: 'two eggs ' }], [{ transcript: 'and toast' }]] }))
    expect(onText).toHaveBeenLastCalledWith('two eggs and toast', false)
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeTruthy()
    act(() => recognition.onend?.())
    expect(onText).toHaveBeenLastCalledWith('', true)
    expect(await screen.findByRole('button', { name: 'Say what you ate' })).toBeTruthy()
  })

  it('explains_a_refused_microphone', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition)
    const onError = vi.fn()
    const user = userEvent.setup()
    render(<VoiceButton onText={() => undefined} onError={onError} />)
    await user.click(screen.getByRole('button', { name: 'Say what you ate' }))
    act(() => FakeRecognition.last?.onerror?.({ error: 'not-allowed' }))
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/Microphone access was refused/))
  })
})
