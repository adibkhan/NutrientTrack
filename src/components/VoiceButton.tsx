import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

type Recognition = {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((event: { error?: string }) => void) | null
  onend: (() => void) | null
}
type RecognitionConstructor = new () => Recognition

const recognitionConstructor = (): RecognitionConstructor | undefined => {
  if (typeof window === 'undefined') return undefined
  const candidate = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor }
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition
}

export const voiceLoggingAvailable = (): boolean => recognitionConstructor() !== undefined

interface VoiceButtonProps {
  /** Called with the words as they are heard, then once more with the final text. */
  onText: (text: string, final: boolean) => void
  onError: (message: string) => void
}

/**
 * Say a meal instead of typing it. Uses the browser's own speech recognition, which on most phones sends the audio to
 * the browser maker's speech service, so the button says so the first time and stays off until tapped.
 */
export function VoiceButton({ onText, onError }: VoiceButtonProps) {
  const [listening, setListening] = useState(false)
  const recognition = useRef<Recognition | null>(null)
  useEffect(() => () => recognition.current?.abort(), [])
  if (!voiceLoggingAvailable()) return null

  const start = () => {
    const Constructor = recognitionConstructor()
    if (!Constructor) return
    const instance = new Constructor()
    instance.lang = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US'
    instance.interimResults = true
    instance.continuous = false
    instance.maxAlternatives = 1
    instance.onresult = (event) => {
      let text = ''
      for (let index = 0; index < event.results.length; index += 1) text += event.results[index][0]?.transcript ?? ''
      onText(text.trim(), false)
    }
    instance.onerror = (event) => {
      setListening(false)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') onError('Microphone access was refused. Allow it in your browser settings to log by voice.')
      else if (event.error !== 'aborted' && event.error !== 'no-speech') onError('Voice logging did not work just now. Try again or type the meal.')
    }
    instance.onend = () => {
      setListening(false)
      recognition.current = null
      onText('', true)
    }
    recognition.current = instance
    setListening(true)
    try {
      instance.start()
    } catch {
      setListening(false)
      onError('Voice logging is not available here.')
    }
  }
  const stop = () => recognition.current?.stop()

  return (
    <button className={`voice-button ${listening ? 'is-listening' : ''}`} type="button" aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Say what you ate'} title="Say what you ate, like “two eggs and toast”. Your browser’s speech service hears it." onClick={listening ? stop : start}>
      <Icon name="mic" size={18} />
      {listening && <span className="voice-pulse" aria-hidden="true" />}
    </button>
  )
}
