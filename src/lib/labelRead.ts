import { parseLabel, type ParsedLabel } from './labelParse'
import { prepareCanvas, rotateCanvas } from './labelImage'
import { recognizeText, type OcrLine, type OcrProgress } from './labelOcr'

export interface LabelReading { parsed: ParsedLabel; text: string; lines: OcrLine[]; rotation: 0 | 90 | 270; ms: number }

/**
 * Photo to numbers. Tries the photo as taken; only when no "Calories" turns up does it try quarter turns (a label
 * photographed sideways), 90 then 270. Returns the first reading with calories, else the reading that found the most nutrients.
 */
export const readLabelPhoto = async (file: Blob, onProgress?: (progress: OcrProgress & { pass: number }) => void): Promise<LabelReading> => {
  const started = Date.now()
  const prepared = await prepareCanvas(file)
  const turns: Array<0 | 90 | 270> = [0, 90, 270]
  let best: LabelReading | undefined
  for (const [pass, rotation] of turns.entries()) {
    const canvas = rotation === 0 ? prepared : rotateCanvas(prepared, rotation)
    const result = await recognizeText(canvas, (progress) => onProgress?.({ ...progress, pass }))
    const reading: LabelReading = { parsed: parseLabel(result.lines), text: result.text, lines: result.lines, rotation, ms: Date.now() - started }
    if (reading.parsed.hasCalories) return reading
    if (!best || Object.keys(reading.parsed.values).length > Object.keys(best.parsed.values).length) best = reading
  }
  return { ...(best as LabelReading), ms: Date.now() - started }
}
