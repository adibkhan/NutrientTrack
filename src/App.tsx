import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import type { CollisionDetection, DragCancelEvent, DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { findCatalogFood, searchCatalog } from './catalog'
import type { CatalogFood } from './catalog/types'
import {
  clearAllData,
  deleteEntry,
  deleteFood,
  deleteWeight,
  exportBackup,
  getEntries,
  onDatabaseEvent,
  getFoods,
  getSettings,
  getWeights,
  importBackup,
  requestPersistentStorage,
  saveEntries,
  saveEntry,
  saveFood,
  saveSettings,
  saveWeight,
} from './lib/db'
import type { DiaryEntry, Food, Goals, MealCategory, Settings, View, WeightEntry } from './types'
import {
  clampPercent,
  formatDateLabel,
  formatInputNumber,
  formatNumber,
  formatShortDate,
  isDateToday,
  newId,
  nowISO,
  shiftDate,
  sumEntries,
  todayISO,
} from './lib/utils'
import { Icon, type IconName } from './components/Icon'
import { Modal } from './components/Modal'
import { CloudSyncPanel } from './components/CloudSyncPanel'
import { hasStoredSession } from './lib/cloud'
import { isSignedInStatus, useCloudSync, type CloudSync } from './lib/useCloudSync'
import { readBackup } from './lib/backup'
import NutritionInsights from './components/NutritionInsights'
import './styles.css'

type ToastTone = 'success' | 'error'
type Toast = { tone: ToastTone; message: string }
type PersistentStatus = 'checking' | 'granted' | 'available'

interface EntryDraft {
  name: string
  meal: MealCategory
  date: string
  time: string
  calories: string
  protein: string
  carbs: string
  fat: string
  grams: string
  foodId?: string
  catalogId?: string
  catalogSource?: CatalogFood['source']
  saveAsFood: boolean
  serving: string
}

interface FoodDraft {
  name: string
  serving: string
  calories: string
  protein: string
  carbs: string
  fat: string
}

interface WeightDraft {
  date: string
  weight: string
  unit: 'lb' | 'kg'
  note: string
}

type ModalState =
  | { type: 'entry'; entry?: DiaryEntry; food?: Food; meal?: MealCategory }
  | { type: 'food'; food?: Food }
  | { type: 'weight'; weight?: WeightEntry }
  | { type: 'move'; entry: DiaryEntry }
  | null

const navItems: Array<{ id: View; label: string; icon: IconName }> = [
  { id: 'diary', label: 'Diary', icon: 'calendar' },
  { id: 'trends', label: 'Trends', icon: 'chart' },
  { id: 'foods', label: 'Foods', icon: 'food' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
]

const emptyEntryDraft: EntryDraft = {
  name: '',
  meal: 'other',
  date: todayISO(),
  time: '',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  grams: '',
  saveAsFood: false,
  serving: '1 serving',
}

/** Optional entry fields the entry form owns: cleared on save when the form leaves them empty. */
const ENTRY_FORM_OPTIONAL_KEYS = ['foodId', 'catalogId', 'catalogSource', 'grams', 'time'] as const

const emptyFoodDraft: FoodDraft = {
  name: '',
  serving: '1 serving',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
}

const emptyWeightDraft: WeightDraft = { date: '', weight: '', unit: 'lb', note: '' }

const toNumber = (value: string): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const numericOrUndefined = (value: string): number | undefined => {
  if (!value.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

const convertWeight = (weight: number, from: 'lb' | 'kg', to: 'lb' | 'kg'): number => {
  if (from === to) return weight
  return from === 'kg' ? weight * 2.2046226218 : weight / 2.2046226218
}

const localTimeNow = (): string => {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

const BACKUP_INITIATED_KEY = 'nutrienttrack-backup-initiated-at'

const readBackupInitiatedAt = (): string | undefined => {
  try {
    return localStorage.getItem(BACKUP_INITIATED_KEY) ?? undefined
  } catch {
    return undefined
  }
}

const formatBackupDate = (value?: string): string | undefined => {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

const timelineHourLabel = (hour: number): string => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour, 0))

const pointerWithinOrCenter: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCenter(args)
  return pointerWithin(args)
}

export default function App() {
  const [view, setView] = useState<View>('diary')
  const [today, setToday] = useState(todayISO)
  const [selectedDate, setSelectedDate] = useState(todayISO)
  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [foods, setFoods] = useState<Food[]>([])
  const [weights, setWeights] = useState<WeightEntry[]>([])
  const [settings, setSettings] = useState<Settings | undefined>()
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [persistentStatus, setPersistentStatus] = useState<PersistentStatus>('checking')
  const [backupInitiatedAt, setBackupInitiatedAt] = useState<string | undefined>(readBackupInitiatedAt)
  const [repeatSavingMeal, setRepeatSavingMeal] = useState<MealCategory | null>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const todayRef = useRef(today)

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const [nextEntries, nextFoods, nextWeights, nextSettings] = await Promise.all([
        getEntries(),
        getFoods(),
        getWeights(),
        getSettings(),
      ])
      setEntries(nextEntries)
      setFoods(nextFoods.sort((a, b) => a.name.localeCompare(b.name)))
      setWeights(nextWeights.sort((a, b) => a.date.localeCompare(b.date)))
      setSettings(nextSettings)
      return true
    } catch {
      setToast({ tone: 'error', message: 'Local data could not be opened. Try reloading this page.' })
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (navigator.storage?.persisted) {
      void navigator.storage.persisted().then((persisted) => setPersistentStatus(persisted ? 'granted' : 'available'))
    } else {
      setPersistentStatus('available')
    }
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('./sw.js').catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    const unsubscribe = onDatabaseEvent((event) => setToast({
      tone: 'error',
      message: event === 'blocked'
        ? 'NutrientTrack is updating. Close its other open tabs to finish.'
        : 'NutrientTrack was updated in another tab. Reload this page to keep saving.',
    }))
    return () => { unsubscribe() }
  }, [])

  useEffect(() => {
    // A long-lived installed app can stay open across midnight; move "today" forward, and follow it only if the user was viewing it.
    const syncToday = () => {
      const next = todayISO()
      const previous = todayRef.current
      if (next === previous) return
      todayRef.current = next
      setToday(next)
      setSelectedDate((selected) => (selected === previous ? next : selected))
    }
    document.addEventListener('visibilitychange', syncToday)
    window.addEventListener('focus', syncToday)
    const interval = window.setInterval(syncToday, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', syncToday)
      window.removeEventListener('focus', syncToday)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!toast || toast.tone === 'error') return undefined
    const timeout = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const dateEntries = useMemo(
    () => entries
      .filter((entry) => entry.date === selectedDate)
      .sort((a, b) => {
        if (a.time && b.time && a.time !== b.time) return a.time.localeCompare(b.time)
        if (a.time && !b.time) return -1
        if (!a.time && b.time) return 1
        return a.createdAt.localeCompare(b.createdAt)
      }),
    [entries, selectedDate],
  )
  const recentEntries = useMemo(
    () => entries.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entries],
  )
  const totals = useMemo(() => sumEntries(dateEntries), [dateEntries])
  const goals = settings?.goals

  const announce = (message: string, tone: ToastTone = 'success') => setToast({ message, tone })
  const cloud = useCloudSync(() => { void refresh() }, announce)

  const attempt = async (failure: string, work: () => Promise<void>) => {
    try {
      await work()
    } catch {
      announce(failure, 'error')
    }
  }

  const saveEntryDraft = async (draft: EntryDraft, existing?: DiaryEntry, food?: Food) => {
    const timestamp = nowISO()
    const fromForm: DiaryEntry = {
      id: existing?.id ?? newId(),
      date: draft.date || existing?.date || selectedDate,
      meal: draft.meal,
      name: draft.name.trim(),
      calories: toNumber(draft.calories),
      protein: toNumber(draft.protein),
      carbs: toNumber(draft.carbs),
      fat: toNumber(draft.fat),
      ...(draft.foodId ? { foodId: draft.foodId } : food ? { foodId: food.id } : existing?.foodId ? { foodId: existing.foodId } : {}),
      ...(draft.catalogId ? { catalogId: draft.catalogId } : {}),
      ...(draft.catalogSource ? { catalogSource: draft.catalogSource } : {}),
      ...(numericOrUndefined(draft.grams) !== undefined ? { grams: numericOrUndefined(draft.grams) } : {}),
      ...(draft.time.trim() ? { time: draft.time.trim() } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    // Start from the stored record so fields this form does not know about (added by other versions) survive an edit.
    const entry: DiaryEntry = { ...existing, ...fromForm }
    for (const key of ENTRY_FORM_OPTIONAL_KEYS) if (!(key in fromForm)) delete entry[key]
    try {
      await saveEntry(entry)
    } catch {
      announce('That entry could not be saved. Try again.', 'error')
      return
    }
    let foodSaved = true
    if (draft.saveAsFood && !existing) {
      try {
        await saveFood({
          id: newId(),
          name: entry.name,
          serving: draft.serving.trim() || (entry.grams ? `${formatNumber(entry.grams, 1)} g` : '1 serving'),
          calories: entry.calories,
          protein: entry.protein,
          carbs: entry.carbs,
          fat: entry.fat,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      } catch {
        foodSaved = false
      }
    }
    await refresh()
    setModal(null)
    if (foodSaved) announce(existing ? 'Entry updated.' : 'Entry added to your diary.')
    else announce('Entry added, but the food could not be saved for quick logging.', 'error')
  }

  const moveEntry = async (entry: DiaryEntry, meal: MealCategory, date: string, time: string, feedback?: string) => {
    const moved: DiaryEntry = { ...entry, meal, date, updatedAt: nowISO() }
    if (time.trim()) moved.time = time.trim()
    else delete moved.time
    try {
      await saveEntry(moved)
    } catch {
      announce('That entry could not be moved. Try again.', 'error')
      return
    }
    await refresh()
    setModal(null)
    announce(feedback ?? (date === entry.date ? `Moved to ${meal === 'snack' ? 'snacks' : meal}.` : 'Entry moved to the new day.'))
  }

  const repeatMeal = async (meal: MealCategory) => {
    if (repeatSavingMeal) return
    const sourceDate = entries
      .filter((entry) => entry.date < selectedDate && entry.meal === meal)
      .reduce<string | undefined>((latest, entry) => (!latest || entry.date > latest ? entry.date : latest), undefined)
    if (!sourceDate) {
      announce(`There is no earlier ${meal === 'snack' ? 'snacks' : meal} to repeat.`, 'error')
      return
    }
    const sourceEntries = entries.filter((entry) => entry.date === sourceDate && entry.meal === meal)
    const targetHasEntries = entries.some((entry) => entry.date === selectedDate && entry.meal === meal)
    if (targetHasEntries && !window.confirm(`Add ${sourceEntries.length} ${sourceEntries.length === 1 ? 'food' : 'foods'} from ${formatShortDate(sourceDate)} to ${formatShortDate(selectedDate)}?`)) return

    setRepeatSavingMeal(meal)
    const timestamp = nowISO()
    const copies = sourceEntries.map((entry) => ({
      ...entry,
      id: newId(),
      date: selectedDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    }))
    try {
      try {
        await saveEntries(copies)
      } catch {
        announce('That meal could not be repeated. Nothing was added.', 'error')
        return
      }
      if (!await refresh()) {
        announce('Meal repeated, but the diary could not refresh. Reload to see it.', 'error')
        return
      }
      announce(`Repeated ${meal === 'snack' ? 'snacks' : meal} from ${formatShortDate(sourceDate)}.`)
    } finally {
      setRepeatSavingMeal(null)
    }
  }

  const handleDeleteEntry = async (entry: DiaryEntry) => {
    if (!window.confirm(`Delete “${entry.name}” from this day?`)) return
    await attempt('That entry could not be deleted. Try again.', async () => {
      await deleteEntry(entry.id)
      await refresh()
      announce('Entry deleted.')
    })
  }

  const saveFoodDraft = async (draft: FoodDraft, existing?: Food) => {
    const timestamp = nowISO()
    try {
      await saveFood({
        ...existing,
        id: existing?.id ?? newId(),
        name: draft.name.trim(),
        serving: draft.serving.trim() || '1 serving',
        calories: toNumber(draft.calories),
        protein: toNumber(draft.protein),
        carbs: toNumber(draft.carbs),
        fat: toNumber(draft.fat),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      })
    } catch {
      announce('That food could not be saved. Try again.', 'error')
      return
    }
    await refresh()
    setModal(null)
    announce(existing ? 'Food updated.' : 'Food saved for quick logging.')
  }

  const handleDeleteFood = async (food: Food) => {
    if (!window.confirm(`Remove “${food.name}” from your saved foods? Existing diary entries are kept.`)) return
    await attempt('That food could not be removed. Try again.', async () => {
      await deleteFood(food.id)
      await refresh()
      announce('Saved food removed.')
    })
  }

  const saveWeightDraft = async (draft: WeightDraft, existing?: WeightEntry) => {
    const timestamp = nowISO()
    const weight = Number(draft.weight)
    if (!draft.date || !Number.isFinite(weight) || weight <= 0) return
    const next: WeightEntry = {
      ...existing,
      id: existing?.id ?? newId(),
      date: draft.date,
      weight,
      unit: draft.unit,
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }
    if (!draft.note.trim()) delete next.note
    try {
      await saveWeight(next)
    } catch {
      announce('That weight could not be saved. Try again.', 'error')
      return
    }
    await refresh()
    setModal(null)
    announce(existing ? 'Weight entry updated.' : 'Weight entry saved.')
  }

  const handleDeleteWeight = async (weight: WeightEntry) => {
    if (!window.confirm(`Delete the ${weight.weight} ${weight.unit} entry from ${formatShortDate(weight.date)}?`)) return
    await attempt('That weight entry could not be deleted. Try again.', async () => {
      await deleteWeight(weight.id)
      await refresh()
      announce('Weight entry deleted.')
    })
  }

  const updateGoals = async (nextGoals: Goals) => {
    const nextSettings: Settings = { ...settings, id: 'profile', goals: { ...settings?.goals, ...nextGoals }, updatedAt: nowISO() }
    await attempt('Goals could not be saved. Try again.', async () => {
      await saveSettings(nextSettings)
      setSettings(nextSettings)
      announce('Goals saved.')
    })
  }

  const downloadBackup = async () => {
    try {
      const backup = await exportBackup()
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `nutrienttrack-backup-${backup.exportedAt.slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      const initiatedAt = nowISO()
      setBackupInitiatedAt(initiatedAt)
      try {
        localStorage.setItem(BACKUP_INITIATED_KEY, initiatedAt)
      } catch {
        // The export can still proceed when browser storage is unavailable.
      }
      announce('Backup export started. Your browser controls whether it is saved.')
    } catch {
      announce('Backup could not be created.', 'error')
    }
  }

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      const result = readBackup(parsed)
      if (!result.ok) {
        announce(result.reason === 'newer'
          ? 'This backup was made by a newer version of NutrientTrack. Reload the app to update, then try again.'
          : 'That file is not a valid NutrientTrack backup.', 'error')
        return
      }
      if (!window.confirm('Restore this backup? It will replace the entries, foods, weight logs, and goals currently stored in this browser.')) return
      await importBackup(result.backup)
      setBackupInitiatedAt(undefined)
      try {
        localStorage.removeItem(BACKUP_INITIATED_KEY)
      } catch {
        // The cue is still cleared for this session.
      }
      await refresh()
      announce('Backup restored.')
    } catch {
      announce('Backup could not be read. Nothing was changed.', 'error')
    }
  }

  const clearLocalData = async () => {
    // A stored session counts even while the status is still 'checking' or the sync code could not load.
    const signedIn = isSignedInStatus(cloud.status) || hasStoredSession()
    if (!window.confirm(signedIn
      ? 'Clear all NutrientTrack data from this browser and sign out of backup here? Your cloud copy is kept; signing in again brings it back.'
      : 'Clear all NutrientTrack data from this browser? This cannot be undone unless you have a backup.')) return
    await attempt('Local data could not be cleared. Nothing was removed.', async () => {
      // Otherwise the next sync would pull the cloud copy straight back.
      if (signedIn) await cloud.signOut()
      await clearAllData()
      setBackupInitiatedAt(undefined)
      try {
        localStorage.removeItem(BACKUP_INITIATED_KEY)
      } catch {
        // The local status cue can still be cleared for this session.
      }
      await refresh()
      announce('Local data cleared.')
    })
  }

  const requestPersistence = async () => {
    await attempt('The browser could not be asked for persistent storage.', async () => {
      const persisted = await requestPersistentStorage()
      setPersistentStatus(persisted ? 'granted' : 'available')
      announce(persisted ? 'This browser will try to keep local data available.' : 'The browser did not grant persistent storage.')
    })
  }

  if (loading) return <LoadingShell />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="sidebar-rule" />
        <p className="nav-label">Your space</p>
        <nav aria-label="Primary navigation" className="primary-nav">
          {navItems.map((item) => (
            <button className={`nav-item ${view === item.id ? 'active' : ''}`} key={item.id} type="button" onClick={() => setView(item.id)}>
              <Icon name={item.icon} size={19} />
              <span>{item.label}</span>
              {item.id === 'diary' && dateEntries.length > 0 && <span className="nav-count">{dateEntries.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="privacy-note"><Icon name="lock" size={16} /><span>Private by default</span></div>
          <p>Your entries stay in this browser. Export a backup before clearing site data or changing devices.</p>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-date">
            <p className="eyebrow">{view === 'diary' ? (isDateToday(selectedDate) ? 'Today' : 'Diary') : 'NutrientTrack'}</p>
            <h1>{view === 'diary' ? <><span className="desktop-date-title">{formatDateLabel(selectedDate, { weekday: 'long' })}</span><span className="mobile-date-title">{formatDateLabel(selectedDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span></> : navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="topbar-actions">
            <span className="offline-chip"><span className="status-dot" />Local only</span>
            <button className="button primary compact" type="button" onClick={() => setModal({ type: 'entry' })}><Icon name="plus" size={17} />Log food</button>
          </div>
        </header>

        {view === 'diary' && (
          <DiaryView
            date={selectedDate}
            entries={dateEntries}
            allEntries={entries}
            foods={foods}
            goals={goals}
            totals={totals}
            onDateChange={setSelectedDate}
            onAdd={() => setModal({ type: 'entry' })}
            onAddMeal={(meal) => setModal({ type: 'entry', meal })}
            onEdit={(entry) => setModal({ type: 'entry', entry })}
            onDelete={handleDeleteEntry}
            onMove={(entry) => setModal({ type: 'move', entry })}
            onDropMove={(entry, meal, time, feedback) => moveEntry(entry, meal, dateEntries.find((item) => item.id === entry.id)?.date ?? selectedDate, time, feedback)}
            onRepeatMeal={repeatMeal}
            repeatSavingMeal={repeatSavingMeal}
            onQuickLog={(food) => setModal({ type: 'entry', food })}
          />
        )}
        {view === 'trends' && <TrendsView entries={entries} goals={goals} weights={weights} unit={goals?.weightUnit ?? 'lb'} onAdd={() => setModal({ type: 'weight' })} onEdit={(weight) => setModal({ type: 'weight', weight })} onDelete={handleDeleteWeight} />}
        {view === 'foods' && <FoodsView foods={foods} onAdd={() => setModal({ type: 'food' })} onEdit={(food) => setModal({ type: 'food', food })} onDelete={handleDeleteFood} onQuickLog={(food) => setModal({ type: 'entry', food })} />}
        {view === 'settings' && (
          <SettingsView
            goals={goals}
            persistentStatus={persistentStatus}
            backupInitiatedAt={backupInitiatedAt}
            hasMeaningfulData={entries.length > 0 || foods.length > 0 || weights.length > 0}
            onSaveGoals={updateGoals}
            onExport={downloadBackup}
            onImport={() => importInputRef.current?.click()}
            onClear={clearLocalData}
            onPersist={requestPersistence}
            cloud={cloud}
          />
        )}
      </main>

      <nav aria-label="Mobile navigation" className="mobile-nav">
        {navItems.map((item) => <button className={view === item.id ? 'active' : ''} key={item.id} type="button" onClick={() => setView(item.id)}><Icon name={item.icon} size={20} /><span>{item.label}</span></button>)}
      </nav>
      <input ref={importInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={importFile} />

      {modal?.type === 'entry' && <EntryModal entry={modal.entry} food={modal.food} defaultMeal={modal.meal} selectedDate={selectedDate} foods={foods} recentEntries={recentEntries} onClose={() => setModal(null)} onSave={saveEntryDraft} />}
      {modal?.type === 'food' && <FoodModal food={modal.food} onClose={() => setModal(null)} onSave={saveFoodDraft} />}
      {modal?.type === 'weight' && <WeightModal weight={modal.weight} defaultDate={today} defaultUnit={goals?.weightUnit ?? 'lb'} onClose={() => setModal(null)} onSave={saveWeightDraft} />}
      {modal?.type === 'move' && <MoveModal entry={modal.entry} onClose={() => setModal(null)} onMove={moveEntry} />}
      <div aria-live="polite" className="toast-region">{toast && <div className={`toast ${toast.tone}`}><Icon name={toast.tone === 'success' ? 'check' : 'info'} size={17} /><span>{toast.message}</span><button type="button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="x" size={14} /></button></div>}</div>
    </div>
  )
}

function Brand() {
  return <div className="brand"><span className="brand-mark"><span /><span /></span><span className="brand-name">Nutrient<span>Track</span></span></div>
}

function LoadingShell() {
  return <div className="loading-shell"><Brand /><div className="loading-card"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-block" /></div></div>
}

interface DiaryViewProps {
  date: string
  entries: DiaryEntry[]
  allEntries: DiaryEntry[]
  foods: Food[]
  goals: Goals | undefined
  totals: ReturnType<typeof sumEntries>
  onDateChange: (date: string) => void
  onAdd: () => void
  onAddMeal: (meal: MealCategory) => void
  onEdit: (entry: DiaryEntry) => void
  onDelete: (entry: DiaryEntry) => void
  onMove: (entry: DiaryEntry) => void
  onDropMove: (entry: DiaryEntry, meal: MealCategory, time: string, feedback: string) => Promise<void>
  onRepeatMeal: (meal: MealCategory) => Promise<void>
  repeatSavingMeal: MealCategory | null
  onQuickLog: (food: Food) => void
}

const diaryMeals: Array<{ key: MealCategory; label: string }> = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
  { key: 'snack', label: 'Snacks' },
  { key: 'other', label: 'Other' },
]

function DiaryView({ date, entries, allEntries, foods, goals, totals, onDateChange, onAdd, onAddMeal, onEdit, onDelete, onMove, onDropMove, onRepeatMeal, repeatSavingMeal, onQuickLog }: DiaryViewProps) {
  const calorieGoal = goals?.calories
  const remaining = calorieGoal === undefined ? undefined : calorieGoal - totals.calories
  const [diaryMode, setDiaryMode] = useState<'meals' | 'timeline'>('meals')
  const [activeEntryId, setActiveEntryId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  )
  const activeEntry = activeEntryId ? entries.find((entry) => entry.id === activeEntryId) : undefined

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveEntryId(String(active.id).replace(/^entry:/, ''))
  }

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveEntryId(null)
  }

  const handleDragEnd = async ({ active, over }: DragEndEvent) => {
    setActiveEntryId(null)
    if (!over) return
    const entryId = String(active.id).replace(/^entry:/, '')
    const entry = entries.find((candidate) => candidate.id === entryId)
    if (!entry) return
    const target = String(over.id)
    if (target.startsWith('meal:')) {
      const meal = target.slice('meal:'.length) as MealCategory
      if (meal === entry.meal) return
      await onDropMove(entry, meal, entry.time ?? '', `Moved ${entry.name} to ${meal === 'snack' ? 'snacks' : meal}.`)
      return
    }
    if (target === 'timeline:untimed') {
      if (!entry.time) return
      await onDropMove(entry, entry.meal, '', `Removed the time from ${entry.name}.`)
      return
    }
    if (!target.startsWith('timeline:')) return
    const hour = Number(target.slice('timeline:'.length))
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return
    const time = `${String(hour).padStart(2, '0')}:00`
    if (entry.time === time) return
    await onDropMove(entry, entry.meal, time, `Moved ${entry.name} to ${timelineHourLabel(hour)}.`)
  }

  return (
    <div className="page diary-page">
      <DateNavigator date={date} onDateChange={onDateChange} />
      <section className="summary-grid" aria-label="Daily nutrition summary">
        <article className="summary-card calorie-card">
          <div className="card-kicker"><span className="kicker-icon coral"><Icon name="flame" size={16} /></span><span>Energy</span><span className="summary-badge">{entries.length ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` : 'No entries'}</span></div>
          <div className="calorie-summary"><ProgressRing value={calorieGoal ? clampPercent((totals.calories / calorieGoal) * 100) : 0} /><div><p className="metric-value">{formatNumber(totals.calories)} <small>kcal</small></p><p className="metric-subtext">{calorieGoal === undefined ? 'Set an energy goal to see your balance.' : remaining === undefined ? '' : remaining >= 0 ? `${formatNumber(remaining)} kcal remaining` : `${formatNumber(Math.abs(remaining))} kcal over goal`}</p></div></div>
          <div className="goal-line"><span>{calorieGoal === undefined ? 'Daily goal' : 'Goal'}</span><strong>{calorieGoal === undefined ? 'Not set' : `${formatNumber(calorieGoal)} kcal`}</strong></div>
        </article>
        <article className="summary-card macro-card">
          <div className="card-kicker"><span className="kicker-icon teal"><Icon name="chart" size={16} /></span><span>Macros</span><span className="summary-badge">grams</span></div>
          <div className="macro-list"><MacroProgress label="Protein" value={totals.protein} goal={goals?.protein} color="teal" /><MacroProgress label="Carbs" value={totals.carbs} goal={goals?.carbs} color="blue" /><MacroProgress label="Fat" value={totals.fat} goal={goals?.fat} color="violet" /></div>
        </article>
      </section>

      <DndContext sensors={sensors} collisionDetection={pointerWithinOrCenter} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
        <div className="content-grid diary-grid">
          <section className="panel diary-panel">
            <div className="panel-header"><div><p className="eyebrow">{entries.length ? 'What you logged' : 'Start with one thing'}</p><h2>{isDateToday(date) ? 'Today’s diary' : `Diary for ${formatShortDate(date)}`}</h2></div><div className="diary-panel-actions"><div className="diary-view-toggle" role="group" aria-label="Diary layout"><button className={diaryMode === 'meals' ? 'active' : ''} aria-pressed={diaryMode === 'meals'} type="button" onClick={() => setDiaryMode('meals')}><Icon name="food" size={15} />Meals</button><button className={diaryMode === 'timeline' ? 'active' : ''} aria-pressed={diaryMode === 'timeline'} type="button" onClick={() => setDiaryMode('timeline')}><Icon name="clock" size={15} />Timeline</button></div><button className="button secondary compact" type="button" onClick={onAdd}><Icon name="plus" size={16} />Add food</button></div></div>
            {entries.length === 0 && <div className="diary-empty-banner"><span className="empty-orb"><Icon name="food" size={20} /></span><div><strong>No foods logged yet</strong><p>Search the local catalog, pick a saved food, or add macros yourself.</p></div><button className="text-button" type="button" onClick={onAdd}>Log your first food <Icon name="arrow-right" size={15} /></button></div>}
            {diaryMode === 'meals' ? <div className="meal-sections">{diaryMeals.map((meal) => {
              const previousDate = allEntries
                .filter((entry) => entry.date < date && entry.meal === meal.key)
                .reduce<string | undefined>((latest, entry) => (!latest || entry.date > latest ? entry.date : latest), undefined)
              return <MealDropSection key={meal.key} meal={meal} entries={entries.filter((entry) => entry.meal === meal.key)} previousDate={previousDate} isDragging={Boolean(activeEntry)} isRepeating={repeatSavingMeal === meal.key} isSavingAny={repeatSavingMeal !== null} onRepeat={() => onRepeatMeal(meal.key)} onAddMeal={onAddMeal} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />
            })}</div> : <TimelineView entries={entries} isDragging={Boolean(activeEntry)} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />}
          </section>
          <section className="panel quick-panel">
            <div className="panel-header"><div><p className="eyebrow">Fast lane</p><h2>Saved foods</h2></div><Icon name="bookmark" size={20} className="panel-header-icon" /></div>
            {foods.length === 0 ? <div className="quick-empty"><span className="empty-orb"><Icon name="food" size={20} /></span><p>Save foods you eat often for one tap logging.</p><button className="text-button" type="button" onClick={onAdd}>Create from log <Icon name="arrow-right" size={15} /></button></div> : <div className="quick-list">{foods.slice(0, 5).map((food) => <button className="quick-food" type="button" key={food.id} onClick={() => onQuickLog(food)}><span className="food-avatar">{food.name.slice(0, 1).toUpperCase()}</span><span className="food-copy"><strong>{food.name}</strong><small>{food.serving} · {formatNumber(food.calories)} kcal</small></span><Icon name="plus" size={17} /></button>)}</div>}
            {foods.length > 5 && <p className="muted-footnote">Showing five saved foods. Open Foods for your full library.</p>}
            <button className="quick-catalog-button" type="button" onClick={onAdd}><span><Icon name="search" size={15} />Search local catalog</span><Icon name="arrow-right" size={15} /></button>
          </section>
        </div>
        <DragOverlay dropAnimation={null}>{activeEntry ? <DragPreview entry={activeEntry} /> : null}</DragOverlay>
      </DndContext>
    </div>
  )
}

function DateNavigator({ date, onDateChange }: { date: string; onDateChange: (date: string) => void }) {
  const days = Array.from({ length: 7 }, (_, index) => shiftDate(date, index - 3))
  return <div className="date-navigator"><div className="date-controls"><button className="icon-button" type="button" aria-label="Previous day" onClick={() => onDateChange(shiftDate(date, -1))}><Icon name="arrow-left" size={18} /></button><button className="date-pill" type="button" onClick={() => onDateChange(todayISO())}><Icon name="calendar" size={16} /><span>{isDateToday(date) ? 'Today' : formatShortDate(date)}</span></button><button className="icon-button" type="button" aria-label="Next day" onClick={() => onDateChange(shiftDate(date, 1))}><Icon name="arrow-right" size={18} /></button></div><div className="date-strip" aria-label="Choose a diary date">{days.map((day) => <button className={`date-strip-day ${day === date ? 'active' : ''}`} aria-current={day === date ? 'date' : undefined} key={day} type="button" onClick={() => onDateChange(day)}><span>{new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(`${day}T12:00:00`)).slice(0, 2)}</span><strong>{new Date(`${day}T12:00:00`).getDate()}</strong>{isDateToday(day) && <i>Today</i>}</button>)}</div>{!isDateToday(date) && <button className="text-button today-button" type="button" onClick={() => onDateChange(todayISO())}>Back to today</button>}</div>
}

function ProgressRing({ value }: { value: number }) {
  const radius = 31
  const circumference = 2 * Math.PI * radius
  return <div className="progress-ring" aria-label={`${Math.round(value)} percent of calorie goal`}><svg viewBox="0 0 80 80"><circle className="ring-track" cx="40" cy="40" r={radius} /><circle className="ring-value" cx="40" cy="40" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference - (circumference * value) / 100} /></svg><span>{value ? `${Math.round(value)}%` : '—'}</span></div>
}

function MacroProgress({ label, value, goal, color }: { label: string; value: number; goal?: number; color: 'teal' | 'blue' | 'violet' }) {
  const percent = goal ? clampPercent((value / goal) * 100) : 0
  return <div className="macro-row"><div className="macro-row-top"><span><i className={`macro-dot ${color}`} />{label}</span><strong>{formatNumber(value)}g <small>{goal === undefined ? '· goal not set' : `/ ${formatNumber(goal)}g`}</small></strong></div><div className="progress-track"><span className={`progress-fill ${color}`} style={{ width: `${goal ? Math.max(value ? 2 : 0, percent) : 0}%` }} /></div></div>
}

function MealDropSection({ meal, entries, previousDate, isDragging, isRepeating, isSavingAny, onRepeat, onAddMeal, onEdit, onDelete, onMove }: { meal: { key: MealCategory; label: string }; entries: DiaryEntry[]; previousDate?: string; isDragging: boolean; isRepeating: boolean; isSavingAny: boolean; onRepeat: () => void; onAddMeal: (meal: MealCategory) => void; onEdit: (entry: DiaryEntry) => void; onDelete: (entry: DiaryEntry) => void; onMove: (entry: DiaryEntry) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `meal:${meal.key}` })
  const subtotal = sumEntries(entries)
  return <section ref={setNodeRef} aria-labelledby={`meal-${meal.key}`} className={`meal-section meal-${meal.key} ${isDragging ? 'drag-target' : ''} ${isOver ? 'is-over' : ''}`}>
    <div className="meal-section-header">
      <div className="meal-heading"><span className="meal-marker" aria-hidden="true" /><div><h3 id={`meal-${meal.key}`}>{meal.label}</h3><span>{entries.length ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` : 'No entries yet'}</span></div></div>
      <div className="meal-section-actions"><span className="meal-subtotal">{entries.length ? `${formatNumber(subtotal.calories)} kcal` : '—'}</span><button className="repeat-meal" type="button" disabled={!previousDate || isSavingAny} title={previousDate ? `Copy foods from ${formatShortDate(previousDate)}` : `No earlier ${meal.label.toLowerCase()} to repeat`} aria-label={`Repeat previous ${meal.label.toLowerCase()}`} onClick={onRepeat}>{isRepeating ? 'Repeating…' : <><span className="repeat-label-full">Repeat previous {meal.label}</span><span className="repeat-label-compact">Repeat</span></>}</button><button className="meal-add" type="button" onClick={() => onAddMeal(meal.key)}><Icon name="plus" size={15} />Add</button></div>
    </div>
    {entries.length > 0 ? <div className="entry-list">{entries.map((entry) => <EntryRow entry={entry} key={entry.id} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />)}</div> : <p className="meal-empty">{isDragging ? 'Drop a food here to move it to this meal.' : 'Add a food to start this section.'}</p>}
  </section>
}

function TimelineView({ entries, isDragging, onEdit, onDelete, onMove }: { entries: DiaryEntry[]; isDragging: boolean; onEdit: (entry: DiaryEntry) => void; onDelete: (entry: DiaryEntry) => void; onMove: (entry: DiaryEntry) => void }) {
  const [showAllHours, setShowAllHours] = useState(false)
  const entriesByHour = new Map<number, DiaryEntry[]>()
  const untimedEntries: DiaryEntry[] = []
  entries.forEach((entry) => {
    if (!entry.time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time)) {
      untimedEntries.push(entry)
      return
    }
    const hour = Number(entry.time.slice(0, 2))
    entriesByHour.set(hour, [...(entriesByHour.get(hour) ?? []), entry])
  })
  const occupiedHours = Array.from(entriesByHour.keys()).sort((left, right) => left - right)
  const visibleHours = showAllHours ? Array.from({ length: 24 }, (_, hour) => hour) : occupiedHours
  return <div className={`timeline-wrap ${showAllHours ? 'all-hours' : 'compact-hours'}`}>
    <div className="timeline-controls"><div><p className="eyebrow">Time of day</p><p className="timeline-help">{showAllHours ? 'All 24 hours are available as drop targets.' : occupiedHours.length ? `${occupiedHours.length} occupied ${occupiedHours.length === 1 ? 'hour' : 'hours'} shown.` : 'Show all hours to place a food at a specific time.'}</p></div><button className="timeline-hours-toggle" type="button" aria-pressed={showAllHours} onClick={() => setShowAllHours((current) => !current)}>{showAllHours ? 'Show compact hours' : 'Show all hours'}</button></div>
    <div className={`timeline-list ${isDragging ? 'is-dragging' : ''}`} aria-label="Diary timeline">
    {(untimedEntries.length > 0 || isDragging) && <TimelineDropZone hour={null} entries={untimedEntries} isDragging={isDragging} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />}
    {visibleHours.map((hour) => <TimelineDropZone key={hour} hour={hour} entries={entriesByHour.get(hour) ?? []} isDragging={isDragging} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />)}
    {visibleHours.length === 0 && !untimedEntries.length && <p className="timeline-empty-note">No timed foods yet. Use “Show all hours” to choose a destination while logging.</p>}
    </div>
  </div>
}

function TimelineDropZone({ hour, entries, isDragging, onEdit, onDelete, onMove }: { hour: number | null; entries: DiaryEntry[]; isDragging: boolean; onEdit: (entry: DiaryEntry) => void; onDelete: (entry: DiaryEntry) => void; onMove: (entry: DiaryEntry) => void }) {
  const id = hour === null ? 'timeline:untimed' : `timeline:${hour}`
  const { setNodeRef, isOver } = useDroppable({ id })
  const label = hour === null ? 'Unscheduled' : timelineHourLabel(hour)
  return <section ref={setNodeRef} className={`timeline-hour ${entries.length === 0 ? 'empty' : ''} ${isDragging ? 'drag-target' : ''} ${isOver ? 'is-over' : ''}`} aria-label={`${label} drop target`}>
    <div className="timeline-hour-header"><span className="timeline-hour-label">{label}</span><span className="timeline-hour-summary">{entries.length ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}` : isDragging ? 'Drop here' : ''}</span></div>
    {entries.length > 0 && <div className="entry-list">{entries.map((entry) => <EntryRow entry={entry} key={entry.id} onEdit={onEdit} onDelete={onDelete} onMove={onMove} />)}</div>}
  </section>
}

function DragPreview({ entry }: { entry: DiaryEntry }) {
  return <div className="drag-preview"><span className="food-avatar large">{entry.name.slice(0, 1).toUpperCase()}</span><span><strong>{entry.name}</strong><small>{entry.time ?? 'No time'} · {formatNumber(entry.calories, 1)} kcal</small></span></div>
}

function EntryRow({ entry, onEdit, onDelete, onMove }: { entry: DiaryEntry; onEdit: (entry: DiaryEntry) => void; onDelete: (entry: DiaryEntry) => void; onMove: (entry: DiaryEntry) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `entry:${entry.id}` })
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined
  return <div ref={setNodeRef} style={style} className={`entry-row ${isDragging ? 'is-dragging' : ''}`}><button className="entry-drag-handle" type="button" aria-label={`Drag ${entry.name}`} {...listeners} {...attributes}><Icon name="grip" size={17} /></button><span className="food-avatar large">{entry.name.slice(0, 1).toUpperCase()}</span><div className="entry-copy"><strong>{entry.name}</strong><span>{entry.time && <><span className="entry-time"><Icon name="clock" size={11} />{entry.time}</span><span className="entry-meta-separator"> · </span></>}<span className="meal-label">{entry.catalogId ? 'Catalog snapshot' : entry.foodId ? 'Saved food' : 'Manual'}</span> · {formatNumber(entry.protein, 1)}g protein · {formatNumber(entry.carbs, 1)}g carbs · {formatNumber(entry.fat, 1)}g fat</span></div><div className="entry-calories"><strong>{formatNumber(entry.calories, 1)}</strong><span>kcal</span></div><div className="row-actions entry-row-actions"><button className="icon-button quiet" type="button" aria-label={`Move ${entry.name}`} onClick={() => onMove(entry)}><Icon name="move" size={16} /></button><button className="icon-button quiet" type="button" aria-label={`Edit ${entry.name}`} onClick={() => onEdit(entry)}><Icon name="edit" size={16} /></button><button className="icon-button quiet danger-hover" type="button" aria-label={`Delete ${entry.name}`} onClick={() => onDelete(entry)}><Icon name="trash" size={16} /></button></div></div>
}

interface TrendsViewProps {
  entries: DiaryEntry[]
  goals: Goals | undefined
  weights: WeightEntry[]
  unit: 'lb' | 'kg'
  onAdd: () => void
  onEdit: (weight: WeightEntry) => void
  onDelete: (weight: WeightEntry) => void
}

type WeightRange = 7 | 30 | 90 | 'all'

const weightRanges: Array<{ value: WeightRange; label: string }> = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
  { value: 'all', label: 'All' },
]

function TrendsView({ entries, goals, weights, unit, onAdd, onEdit, onDelete }: TrendsViewProps) {
  const unitEntries = weights
    .map((entry) => ({ ...entry, weight: convertWeight(entry.weight, entry.unit, unit), unit }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const [range, setRange] = useState<WeightRange>(30)
  const endDate = todayISO()
  const firstDate = unitEntries[0]?.date
  const startDate = range === 'all'
    ? (firstDate && firstDate < endDate ? firstDate : endDate)
    : shiftDate(endDate, -(range - 1))
  const recent = unitEntries.filter((entry) => entry.date >= startDate && entry.date <= endDate)
  return <div className="page"><div className="page-intro"><div><p className="eyebrow">A longer view</p><h2>Your trends</h2><p className="page-description">Small, consistent check-ins are enough to see your direction over time.</p></div><button className="button primary compact" type="button" onClick={onAdd}><Icon name="plus" size={17} />Log weight</button></div><NutritionInsights entries={entries} goals={goals} /><section className="panel trend-panel"><div className="panel-header"><div><p className="eyebrow">Weight</p><h2>{range === 'all' ? 'All time' : `Last ${range} days`}</h2></div><div className="trend-controls"><div className="range-toggle" role="group" aria-label="Trend range">{weightRanges.map((option) => <button aria-pressed={range === option.value} className={range === option.value ? 'active' : ''} key={option.label} type="button" onClick={() => setRange(option.value)}>{option.label}</button>)}</div><span className="unit-chip">{unit}</span></div></div>{recent.length < 2 ? <div className="empty-state compact-empty"><span className="empty-orb"><Icon name="scale" size={21} /></span><h3>{recent.length === 0 ? 'No weight entries in this window.' : 'Add one more check-in.'}</h3><p>{recent.length === 0 ? 'Your first entry will start a truthful trend line.' : 'A line appears after two entries. Days without a check-in stay unplotted.'}</p><button className="button secondary" type="button" onClick={onAdd}><Icon name="plus" size={16} />Log weight</button></div> : <TrendChart entries={recent} unit={unit} startDate={startDate} endDate={endDate} />}</section><section className="panel weight-list-panel"><div className="panel-header"><div><p className="eyebrow">Check-ins</p><h2>Weight log</h2></div><span className="summary-badge">{weights.length} {weights.length === 1 ? 'entry' : 'entries'}</span></div>{weights.length === 0 ? <p className="muted-footnote">Your weight entries will appear here with their date and unit.</p> : <div className="weight-list">{weights.slice().reverse().map((weight) => <div className="weight-row" key={weight.id}><span className="weight-date">{formatShortDate(weight.date)}</span><strong>{formatNumber(weight.weight, 1)} <small>{weight.unit}</small></strong>{weight.note && <span className="weight-note">{weight.note}</span>}<div className="row-actions"><button className="icon-button quiet" type="button" aria-label={`Edit weight from ${formatShortDate(weight.date)}`} onClick={() => onEdit(weight)}><Icon name="edit" size={16} /></button><button className="icon-button quiet danger-hover" type="button" aria-label={`Delete weight from ${formatShortDate(weight.date)}`} onClick={() => onDelete(weight)}><Icon name="trash" size={16} /></button></div></div>)}</div>}</section></div>
}

function TrendChart({ entries, unit, startDate, endDate }: { entries: WeightEntry[]; unit: 'lb' | 'kg'; startDate: string; endDate: string }) {
  const min = Math.min(...entries.map((entry) => entry.weight))
  const max = Math.max(...entries.map((entry) => entry.weight))
  const range = max - min || 1
  const width = 760
  const height = 230
  const padX = 36
  const padY = 32
  const start = new Date(`${startDate}T12:00:00`).getTime()
  const end = new Date(`${endDate}T12:00:00`).getTime()
  const points = entries.map((entry) => {
    const time = new Date(`${entry.date}T12:00:00`).getTime()
    const xRatio = end === start ? 0.5 : (time - start) / (end - start)
    return { entry, x: padX + xRatio * (width - padX * 2), y: padY + (1 - (entry.weight - min) / range) * (height - padY * 2) }
  })
  const line = points.map((point) => `${point.x},${point.y}`).join(' ')
  return <div className="chart-wrap"><div className="chart-summary"><div><strong>{formatNumber(entries.at(-1)?.weight ?? 0, 1)} <small>{unit}</small></strong><span>Latest check-in · {formatShortDate(entries.at(-1)?.date ?? entries[0].date)}</span></div><div className="chart-range"><span>{formatNumber(min, 1)} {unit}</span><span>{formatNumber(max, 1)} {unit}</span></div></div><svg aria-label={`Weight trend from ${formatNumber(min, 1)} to ${formatNumber(max, 1)} ${unit}`} className="trend-chart" role="img" viewBox={`0 0 ${width} ${height}`}><defs><linearGradient id="chart-gradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#2f9e98" /><stop offset="1" stopColor="#2f9e98" stopOpacity="0" /></linearGradient></defs><line className="chart-grid" x1={padX} x2={width - padX} y1={padY} y2={padY} /><line className="chart-grid" x1={padX} x2={width - padX} y1={height / 2} y2={height / 2} /><line className="chart-grid" x1={padX} x2={width - padX} y1={height - padY} y2={height - padY} /><polyline className="chart-line" fill="none" points={line} /><polygon className="chart-area" points={`${padX},${height - padY} ${line} ${width - padX},${height - padY}`} />{points.map((point) => <circle className="chart-point" cx={point.x} cy={point.y} key={point.entry.id} r="5" />)}</svg><div className="chart-labels"><span>{formatShortDate(startDate)}</span><span>Only logged days are plotted</span><span>{formatShortDate(endDate)}</span></div><p className="chart-accessible">Accessible data: {entries.map((entry) => `${formatShortDate(entry.date)} ${formatNumber(entry.weight, 1)} ${unit}`).join(' · ')}.</p></div>
}

interface FoodsViewProps {
  foods: Food[]
  onAdd: () => void
  onEdit: (food: Food) => void
  onDelete: (food: Food) => void
  onQuickLog: (food: Food) => void
}

function FoodsView({ foods, onAdd, onEdit, onDelete, onQuickLog }: FoodsViewProps) {
  return <div className="page"><div className="page-intro"><div><p className="eyebrow">Your library</p><h2>Saved foods</h2><p className="page-description">Keep your repeat foods close. Nutrition is stored per serving, exactly as you enter it.</p></div><button className="button primary compact" type="button" onClick={onAdd}><Icon name="plus" size={17} />Add custom food</button></div><section className="panel foods-panel">{foods.length === 0 ? <div className="empty-state large-empty"><span className="empty-orb large"><Icon name="food" size={27} /></span><h3>A short list is a useful list.</h3><p>Build your own private library of meals, snacks, and staples. Your quick logger also includes the bundled USDA catalog for search.</p><button className="button secondary" type="button" onClick={onAdd}><Icon name="plus" size={16} />Create a food</button></div> : <div className="food-library">{foods.map((food) => <div className="library-row" key={food.id}><span className="food-avatar large">{food.name.slice(0, 1).toUpperCase()}</span><div className="library-copy"><strong>{food.name}</strong><span>{food.serving} · {formatNumber(food.calories)} kcal</span></div><div className="library-macros"><span><i className="macro-dot teal" />{formatNumber(food.protein)}g</span><span><i className="macro-dot blue" />{formatNumber(food.carbs)}g</span><span><i className="macro-dot violet" />{formatNumber(food.fat)}g</span></div><button className="button secondary compact" type="button" onClick={() => onQuickLog(food)}><Icon name="plus" size={15} />Log</button><div className="row-actions"><button className="icon-button quiet" type="button" aria-label={`Edit ${food.name}`} onClick={() => onEdit(food)}><Icon name="edit" size={16} /></button><button className="icon-button quiet danger-hover" type="button" aria-label={`Delete ${food.name}`} onClick={() => onDelete(food)}><Icon name="trash" size={16} /></button></div></div>)}</div>}</section></div>
}

interface SettingsViewProps {
  goals: Goals | undefined
  persistentStatus: PersistentStatus
  backupInitiatedAt?: string
  hasMeaningfulData: boolean
  onSaveGoals: (goals: Goals) => Promise<void>
  onExport: () => Promise<void>
  onImport: () => void
  onClear: () => Promise<void>
  onPersist: () => Promise<void>
  cloud: CloudSync
}

function SettingsView({ goals, persistentStatus, backupInitiatedAt, hasMeaningfulData, onSaveGoals, onExport, onImport, onClear, onPersist, cloud }: SettingsViewProps) {
  const [draft, setDraft] = useState({ calories: formatInputNumber(goals?.calories), protein: formatInputNumber(goals?.protein), carbs: formatInputNumber(goals?.carbs), fat: formatInputNumber(goals?.fat), weightUnit: goals?.weightUnit ?? 'lb' as 'lb' | 'kg' })
  useEffect(() => setDraft({ calories: formatInputNumber(goals?.calories), protein: formatInputNumber(goals?.protein), carbs: formatInputNumber(goals?.carbs), fat: formatInputNumber(goals?.fat), weightUnit: goals?.weightUnit ?? 'lb' }), [goals])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    await onSaveGoals({ calories: numericOrUndefined(draft.calories), protein: numericOrUndefined(draft.protein), carbs: numericOrUndefined(draft.carbs), fat: numericOrUndefined(draft.fat), weightUnit: draft.weightUnit })
  }
  const lastBackupDate = formatBackupDate(backupInitiatedAt)
  return <div className="page settings-page"><div className="page-intro"><div><p className="eyebrow">Your preferences</p><h2>Settings</h2><p className="page-description">Goals and backups live on this device alongside your diary. Cloud backup is optional.</p></div></div><div className="settings-grid"><section className="panel"><div className="panel-header"><div><p className="eyebrow">Daily targets</p><h2>Goals</h2></div><span className="summary-badge">Optional</span></div><form className="goals-form" onSubmit={save}><div className="form-field full"><label htmlFor="goal-calories">Calories <span>kcal</span></label><input id="goal-calories" inputMode="decimal" min="0" placeholder="e.g. 2,000" type="number" value={draft.calories} onChange={(event) => setDraft({ ...draft, calories: event.target.value })} /></div><div className="goal-fields"><div className="form-field"><label htmlFor="goal-protein">Protein <span>g</span></label><input id="goal-protein" inputMode="decimal" min="0" placeholder="e.g. 120" type="number" value={draft.protein} onChange={(event) => setDraft({ ...draft, protein: event.target.value })} /></div><div className="form-field"><label htmlFor="goal-carbs">Carbs <span>g</span></label><input id="goal-carbs" inputMode="decimal" min="0" placeholder="e.g. 220" type="number" value={draft.carbs} onChange={(event) => setDraft({ ...draft, carbs: event.target.value })} /></div><div className="form-field"><label htmlFor="goal-fat">Fat <span>g</span></label><input id="goal-fat" inputMode="decimal" min="0" placeholder="e.g. 65" type="number" value={draft.fat} onChange={(event) => setDraft({ ...draft, fat: event.target.value })} /></div></div><div className="form-field full"><label htmlFor="weight-unit">Weight unit</label><select id="weight-unit" value={draft.weightUnit} onChange={(event) => setDraft({ ...draft, weightUnit: event.target.value as 'lb' | 'kg' })}><option value="lb">Pounds (lb)</option><option value="kg">Kilograms (kg)</option></select></div><button className="button primary" type="submit"><Icon name="check" size={16} />Save goals</button></form><p className="form-note"><Icon name="info" size={15} />NutrientTrack shows only goals you choose to set. It does not infer targets or make health recommendations.</p></section><section className="panel"><div className="panel-header"><div><p className="eyebrow">Your browser</p><h2>Local data</h2></div><span className="storage-status"><i className={persistentStatus === 'granted' ? 'granted' : ''} />{persistentStatus === 'granted' ? 'Protected' : 'Best effort'}</span></div><div className="privacy-card"><span className="privacy-card-icon"><Icon name="lock" size={19} /></span><div><strong>Private by default</strong><p>Entries, foods, goals, and weight logs are kept in IndexedDB on this device. Nothing leaves it unless you turn on backup and sync. There is no analytics or tracking.</p></div></div>{persistentStatus !== 'granted' && <button className="button secondary full-width" type="button" onClick={onPersist}><Icon name="lock" size={16} />Ask browser to keep local data</button>}<div className={`backup-cue ${hasMeaningfulData && !lastBackupDate ? 'reminder' : ''}`}><Icon name="download" size={16} /><div><strong>{lastBackupDate ? `Export started ${lastBackupDate}` : 'Keep a local backup handy'}</strong><p>{lastBackupDate ? 'The export was initiated here; your browser controls whether it is saved.' : hasMeaningfulData ? 'You have local data here. Consider exporting a JSON copy before changing devices or clearing site data.' : 'Export becomes useful after you start logging.'}</p></div></div><div className="data-tools"><div className="tool-row"><div><strong>Backup your data</strong><p>Export a JSON copy before clearing site data or changing devices.</p></div><button className="button secondary compact" type="button" onClick={onExport}><Icon name="download" size={15} />Export</button></div><div className="tool-row"><div><strong>Restore a backup</strong><p>Restoring replaces the data currently in this browser after confirmation.</p></div><button className="button secondary compact" type="button" onClick={onImport}><Icon name="upload" size={15} />Import</button></div></div><div className="danger-zone"><div><strong>Clear local data</strong><p>Remove every diary entry, saved food, weight check-in, and goal from this browser. Your cloud backup, if on, is not affected.</p></div><button className="button danger compact" type="button" onClick={onClear}><Icon name="trash" size={15} />Clear</button></div></section><CloudSyncPanel cloud={cloud} /></div></div>
}

type LoggerMode = 'search' | 'catalog' | 'saved' | 'manual'
type CatalogSearchState = 'idle' | 'loading' | 'ready' | 'error'

interface EntryModalProps {
  entry?: DiaryEntry
  food?: Food
  defaultMeal?: MealCategory
  selectedDate: string
  foods: Food[]
  recentEntries: DiaryEntry[]
  onClose: () => void
  onSave: (draft: EntryDraft, existing?: DiaryEntry, food?: Food) => Promise<void>
}

const catalogValues = (food: CatalogFood, grams: number) => {
  const factor = grams / 100
  return {
    calories: String(Number((food.per100g.calories * factor).toFixed(2))),
    protein: String(Number((food.per100g.protein * factor).toFixed(2))),
    carbs: String(Number((food.per100g.carbs * factor).toFixed(2))),
    fat: String(Number((food.per100g.fat * factor).toFixed(2))),
  }
}

function EntryModal({ entry, food, defaultMeal, selectedDate, foods, recentEntries, onClose, onSave }: EntryModalProps) {
  const initialDraft = (): EntryDraft => entry
    ? { name: entry.name, meal: entry.meal, date: entry.date, time: entry.time ?? '', calories: String(entry.calories), protein: String(entry.protein), carbs: String(entry.carbs), fat: String(entry.fat), grams: entry.grams === undefined ? '' : String(entry.grams), foodId: entry.foodId, catalogId: entry.catalogId, catalogSource: entry.catalogSource, saveAsFood: false, serving: '1 serving' }
    : food
      ? { name: food.name, meal: defaultMeal ?? 'other', date: selectedDate, time: localTimeNow(), calories: String(food.calories), protein: String(food.protein), carbs: String(food.carbs), fat: String(food.fat), grams: '', foodId: food.id, saveAsFood: false, serving: food.serving }
      : { ...emptyEntryDraft, date: selectedDate, meal: defaultMeal ?? 'other', time: localTimeNow() }
  const [draft, setDraft] = useState<EntryDraft>(initialDraft)
  const [mode, setMode] = useState<LoggerMode>(entry ? 'manual' : food ? 'saved' : 'search')
  const [query, setQuery] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogFood[]>([])
  const [searchState, setSearchState] = useState<CatalogSearchState>('idle')
  const [selectedCatalog, setSelectedCatalog] = useState<CatalogFood | undefined>(() => undefined)
  const [servingTouched, setServingTouched] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (mode !== 'search' || !query.trim()) {
      setCatalogResults([])
      setSearchState('idle')
      return undefined
    }
    let cancelled = false
    setSearchState('loading')
    const timer = window.setTimeout(() => {
      void searchCatalog(query.trim(), 20)
        .then((results) => {
          if (cancelled) return
          setCatalogResults(results)
          setSearchState('ready')
        })
        .catch(() => {
          if (cancelled) return
          setCatalogResults([])
          setSearchState('error')
        })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mode, query])

  const chooseCatalog = (catalogFood: CatalogFood) => {
    const grams = 100
    setSelectedCatalog(catalogFood)
    setServingTouched(false)
    setDraft((current) => ({ ...current, name: catalogFood.name, calories: catalogValues(catalogFood, grams).calories, protein: catalogValues(catalogFood, grams).protein, carbs: catalogValues(catalogFood, grams).carbs, fat: catalogValues(catalogFood, grams).fat, grams: String(grams), serving: `${grams} g`, catalogId: catalogFood.id, catalogSource: catalogFood.source, foodId: undefined, saveAsFood: false }))
    setMode('catalog')
    setError('')
  }

  const updateCatalogGrams = (value: string) => {
    setDraft((current) => ({ ...current, grams: value, ...(selectedCatalog && Number.isFinite(Number(value)) && Number(value) >= 0 ? catalogValues(selectedCatalog, Number(value)) : {}), ...(!servingTouched && value.trim() ? { serving: `${value} g` } : {}) }))
  }

  const chooseSnapshot = async (snapshot: Pick<DiaryEntry, 'name' | 'calories' | 'protein' | 'carbs' | 'fat' | 'foodId' | 'catalogId' | 'catalogSource' | 'grams'> | Food) => {
    const savedFoodId = 'serving' in snapshot ? snapshot.id : snapshot.foodId
    const catalogId = 'catalogId' in snapshot ? snapshot.catalogId : undefined
    const catalogSource = 'catalogSource' in snapshot ? snapshot.catalogSource : undefined
    const grams = 'grams' in snapshot ? snapshot.grams : undefined
    if (!('serving' in snapshot) && catalogId && grams !== undefined) {
      try {
        const catalogFood = await findCatalogFood(catalogId, catalogSource)
        if (catalogFood) {
          setSelectedCatalog(catalogFood)
          setServingTouched(false)
          setDraft((current) => ({ ...current, name: snapshot.name, ...catalogValues(catalogFood, grams), grams: String(grams), serving: `${formatNumber(grams, 1)} g`, foodId: undefined, catalogId: catalogFood.id, catalogSource: catalogFood.source, saveAsFood: false }))
          setMode('catalog')
          setError('')
          return
        }
      } catch {
        // Keep the immutable snapshot values when the bundled catalog cannot be opened.
      }
    }
    setSelectedCatalog(undefined)
    setDraft((current) => ({ ...current, name: snapshot.name, calories: String(snapshot.calories), protein: String(snapshot.protein), carbs: String(snapshot.carbs), fat: String(snapshot.fat), grams: grams === undefined ? '' : String(grams), serving: 'serving' in snapshot ? snapshot.serving : current.serving, foodId: savedFoodId, catalogId, catalogSource, saveAsFood: false }))
    setMode('saved')
    setError('')
  }

  const recentLatest = recentEntries.slice(0, 12)
  const recentUnique = recentLatest.filter((item, index, list) => list.findIndex((candidate) => candidate.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()) === index).slice(0, 5)
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matchingRecent = normalizedQuery
    ? recentEntries.filter((item) => item.name.toLocaleLowerCase().includes(normalizedQuery)).filter((item, index, list) => list.findIndex((candidate) => candidate.name.toLocaleLowerCase() === item.name.toLocaleLowerCase()) === index).slice(0, 5)
    : []
  const matchingSaved = normalizedQuery ? foods.filter((saved) => saved.name.toLocaleLowerCase().includes(normalizedQuery)).slice(0, 5) : []

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!draft.name.trim()) { setError('Give this entry a name so you can find it later.'); return }
    if (!draft.date) { setError('Choose a date for this entry.'); return }
    if (mode === 'catalog' && (!draft.grams.trim() || Number(draft.grams) <= 0 || !Number.isFinite(Number(draft.grams)))) { setError('Enter an amount greater than zero grams.'); return }
    if (!draft.calories.trim() || Number(draft.calories) < 0 || !Number.isFinite(Number(draft.calories))) { setError('Add a valid calorie amount.'); return }
    if ([draft.protein, draft.carbs, draft.fat].some((value) => value.trim() && (Number(value) < 0 || !Number.isFinite(Number(value))))) { setError('Macro amounts must be zero or greater.'); return }
    setError('')
    setSaving(true)
    try {
      const draftToSave = (entry?.catalogId || entry?.catalogSource || entry?.grams !== undefined) && mode === 'manual'
        ? { ...draft, catalogId: undefined, catalogSource: undefined, grams: '' }
        : draft
      await onSave(draftToSave, entry, food)
    } finally {
      setSaving(false)
    }
  }

  if (mode === 'search' && !entry && !food) {
    return <Modal eyebrow="Build your diary" title="Log food" onClose={onClose} closeOnBackdrop={false}><div className="logger-search"><div className="logger-search-heading"><div><p className="logger-title">Find a food</p><p className="logger-copy">Search the offline USDA catalog, or pick something you use often.</p></div><span className="local-pill"><span className="status-dot" />Offline</span></div><label className="search-input-wrap" htmlFor="catalog-search"><Icon name="search" size={18} /><input autoFocus id="catalog-search" placeholder="Search foods, like oats or salmon" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="logger-switch"><span>Or add calories and macros yourself</span><button type="button" onClick={() => { setMode('manual'); setSelectedCatalog(undefined); setServingTouched(false); setDraft((current) => ({ ...current, catalogId: undefined, catalogSource: undefined, grams: '', serving: '1 serving' })); setError('') }}>Manual quick add <Icon name="arrow-right" size={14} /></button></div>{query.trim() ? <div className="logger-query-results" aria-live="polite"><div className="logger-result-group"><div className="logger-section-title"><span>Recent entries</span><small>{matchingRecent.length ? 'From your diary' : 'No matching recent entries'}</small></div>{matchingRecent.length > 0 ? <div className="result-list">{matchingRecent.map((recent) => <button className="catalog-result recent-result" key={recent.id} type="button" onClick={() => { void chooseSnapshot(recent) }}><span className="result-avatar recent"><Icon name="clock" size={16} /></span><span className="result-copy"><strong>{recent.name}</strong><small>{recent.grams !== undefined ? formatNumber(recent.grams, 1) + ' g · ' : ''}{formatNumber(recent.calories)} kcal · {formatNumber(recent.protein, 1)}g protein</small></span><Icon name="arrow-right" size={16} /></button>)}</div> : <p className="logger-empty-line">No recent diary entries match “{query.trim()}”.</p>}</div><div className="logger-result-group"><div className="logger-section-title saved-title"><span>Saved foods</span><small>{matchingSaved.length ? 'Your private library' : 'No matching saved foods'}</small></div>{matchingSaved.length > 0 ? <div className="result-list">{matchingSaved.map((saved) => <button className="catalog-result" key={saved.id} type="button" onClick={() => { void chooseSnapshot(saved) }}><span className="result-avatar saved"><Icon name="bookmark" size={16} /></span><span className="result-copy"><strong>{saved.name}</strong><small>{saved.serving} · {formatNumber(saved.calories)} kcal</small></span><Icon name="arrow-right" size={16} /></button>)}</div> : <p className="logger-empty-line">No saved foods match “{query.trim()}”.</p>}</div><div className="logger-result-group catalog-result-group"><div className="logger-section-title"><span>USDA catalog</span><small>Offline results</small></div><div className="catalog-search-results">{searchState === 'loading' && <div className="logger-loading"><span className="loading-spinner" />Searching local foods…</div>}{searchState === 'error' && <div className="logger-message error"><Icon name="info" size={17} /><div><strong>Catalog search is unavailable</strong><p>Try again, or use manual quick add.</p></div></div>}{searchState === 'ready' && catalogResults.length === 0 && <div className="logger-message"><span className="empty-orb"><Icon name="search" size={17} /></span><div><strong>No matching USDA foods</strong><p>Try a shorter search, or add this food manually.</p></div></div>}{searchState === 'ready' && catalogResults.length > 0 && <div className="result-list" aria-label="Catalog results">{catalogResults.map((result) => <button className="catalog-result" key={result.id} type="button" onClick={() => chooseCatalog(result)}><span className="result-avatar"><Icon name="food" size={17} /></span><span className="result-copy"><strong>{result.name}</strong><small>{result.category} · {result.source}</small></span><span className="result-kcal">{formatNumber(result.per100g.calories)}<small>kcal / 100g</small></span><Icon name="arrow-right" size={16} /></button>)}</div>}</div></div></div> : <div className="logger-library" aria-live="polite"><div className="logger-section-title"><span>Recent</span><small>{recentUnique.length ? 'From your diary' : 'Nothing logged yet'}</small></div>{recentUnique.length > 0 ? <div className="result-list">{recentUnique.map((recent) => <button className="catalog-result recent-result" key={recent.id} type="button" onClick={() => { void chooseSnapshot(recent) }}><span className="result-avatar recent"><Icon name="clock" size={16} /></span><span className="result-copy"><strong>{recent.name}</strong><small>{recent.grams !== undefined ? formatNumber(recent.grams, 1) + ' g · ' : ''}{formatNumber(recent.calories)} kcal · {formatNumber(recent.protein, 1)}g protein</small></span><Icon name="arrow-right" size={16} /></button>)}</div> : <p className="logger-empty-line">Your latest foods will appear here for one tap logging.</p>}<div className="logger-section-title saved-title"><span>Saved foods</span><small>{foods.length ? 'Your private library' : 'Create one as you log'}</small></div>{foods.length > 0 ? <div className="result-list">{foods.slice(0, 5).map((saved) => <button className="catalog-result" key={saved.id} type="button" onClick={() => { void chooseSnapshot(saved) }}><span className="result-avatar saved"><Icon name="bookmark" size={16} /></span><span className="result-copy"><strong>{saved.name}</strong><small>{saved.serving} · {formatNumber(saved.calories)} kcal</small></span><Icon name="arrow-right" size={16} /></button>)}</div> : <p className="logger-empty-line">No saved foods yet. Check “Save as reusable food” when logging.</p>}</div>}</div></Modal>
  }

  const modeLabel = mode === 'catalog' ? 'Catalog food' : mode === 'saved' ? 'Saved food' : 'Manual quick add'
  return <Modal eyebrow={entry ? 'Edit entry' : modeLabel} title={entry ? 'Update your food' : 'Log food'} onClose={onClose} closeOnBackdrop={false}><form className="modal-form logger-form" onSubmit={submit}>{!entry && <button className="logger-back" type="button" onClick={() => { setMode('search'); setSelectedCatalog(undefined); setError('') }}><Icon name="arrow-left" size={15} />Back to food search</button>}<div className="logger-selected"><span className={`result-avatar ${mode === 'catalog' ? 'catalog' : 'saved'}`}><Icon name={mode === 'catalog' ? 'food' : mode === 'saved' ? 'bookmark' : 'plus'} size={18} /></span><div><strong>{mode === 'catalog' && selectedCatalog ? selectedCatalog.name : draft.name || 'Manual food'}</strong><span>{mode === 'catalog' && selectedCatalog ? `${selectedCatalog.category} · ${selectedCatalog.source}` : mode === 'saved' ? `Saved food · ${draft.serving}` : 'Enter the values for this entry'}</span></div></div><div className="form-field full"><label htmlFor="entry-name">Food or meal name</label><input autoFocus={mode === 'manual' && !entry} id="entry-name" placeholder="e.g. Greek yogurt & berries" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>{mode === 'catalog' && selectedCatalog && <><div className="grams-field"><label htmlFor="entry-grams"><Icon name="scale" size={15} />Amount</label><div className="input-with-suffix"><input id="entry-grams" inputMode="decimal" min="0.1" step="0.1" type="number" value={draft.grams} onChange={(event) => updateCatalogGrams(event.target.value)} /><span>g</span></div></div><div className="nutrition-preview" aria-live="polite"><div><span>Calories</span><strong>{formatNumber(toNumber(draft.calories), 1)}<small>kcal</small></strong></div><div><span>Protein</span><strong>{formatNumber(toNumber(draft.protein), 1)}<small>g</small></strong></div><div><span>Carbs</span><strong>{formatNumber(toNumber(draft.carbs), 1)}<small>g</small></strong></div><div><span>Fat</span><strong>{formatNumber(toNumber(draft.fat), 1)}<small>g</small></strong></div></div></>}{mode !== 'catalog' && <><div className="form-field full"><label htmlFor="entry-calories">Calories <span>kcal</span></label><input id="entry-calories" inputMode="decimal" min="0" step="any" placeholder="0" type="number" value={draft.calories} onChange={(event) => setDraft({ ...draft, calories: event.target.value })} /></div><div className="macro-input-grid"><NumberField id="entry-protein" label="Protein" unit="g" value={draft.protein} onChange={(value) => setDraft({ ...draft, protein: value })} /><NumberField id="entry-carbs" label="Carbs" unit="g" value={draft.carbs} onChange={(value) => setDraft({ ...draft, carbs: value })} /><NumberField id="entry-fat" label="Fat" unit="g" value={draft.fat} onChange={(value) => setDraft({ ...draft, fat: value })} /></div></>}<div className="logger-meta-grid"><div className="form-field"><label htmlFor="entry-meal">Destination meal</label><select id="entry-meal" value={draft.meal} onChange={(event) => setDraft({ ...draft, meal: event.target.value as MealCategory })}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snacks</option><option value="other">Other</option></select></div><div className="form-field"><label htmlFor="entry-date">Date</label><input id="entry-date" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div></div><div className="form-field full"><label htmlFor="entry-time"><Icon name="clock" size={13} />Local time <span>optional</span></label><input id="entry-time" type="time" value={draft.time} onChange={(event) => setDraft({ ...draft, time: event.target.value })} /></div>{!entry && (mode === 'manual' || mode === 'catalog') && <label className="check-row"><input checked={draft.saveAsFood} type="checkbox" onChange={(event) => setDraft({ ...draft, saveAsFood: event.target.checked })} /><span><strong>Save as reusable food</strong><small>Keep these values in your private quick-log library.</small></span></label>}{draft.saveAsFood && !entry && <div className="form-field full"><label htmlFor="entry-serving">Serving label <span>optional</span></label><input id="entry-serving" placeholder={mode === 'catalog' ? 'e.g. 150 g' : '1 serving'} value={draft.serving} onChange={(event) => { setServingTouched(true); setDraft({ ...draft, serving: event.target.value }) }} /></div>}{error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} type="submit"><Icon name="check" size={16} />{saving ? 'Saving…' : entry ? 'Save changes' : 'Add to diary'}</button></div></form></Modal>
}

function MoveModal({ entry, onClose, onMove }: { entry: DiaryEntry; onClose: () => void; onMove: (entry: DiaryEntry, meal: MealCategory, date: string, time: string) => Promise<void> }) {
  const [meal, setMeal] = useState<MealCategory>(entry.meal)
  const [date, setDate] = useState(entry.date)
  const [time, setTime] = useState(entry.time ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!date) { setError('Choose a date for this entry.'); return }
    setError('')
    setSaving(true)
    try { await onMove(entry, meal, date, time) } finally { setSaving(false) }
  }
  return <Modal eyebrow="Organize your diary" title={`Move ${entry.name}`} onClose={onClose} closeOnBackdrop={false}><form className="modal-form move-form" onSubmit={submit}><div className="move-summary"><span className="food-avatar large">{entry.name.slice(0, 1).toUpperCase()}</span><div><strong>{entry.name}</strong><span>{formatNumber(entry.calories, 1)} kcal · {formatNumber(entry.protein, 1)}g protein</span></div></div><div className="form-field full"><label htmlFor="move-meal">Move to meal</label><select id="move-meal" value={meal} onChange={(event) => setMeal(event.target.value as MealCategory)}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snacks</option><option value="other">Other</option></select></div><div className="logger-meta-grid"><div className="form-field"><label htmlFor="move-date">Date</label><input id="move-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><div className="form-field"><label htmlFor="move-time">Time <span>optional</span></label><input id="move-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} /></div></div>{error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}<p className="move-note"><Icon name="lock" size={14} />The nutrition snapshot stays unchanged when you move it.</p><div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} type="submit"><Icon name="move" size={16} />{saving ? 'Moving…' : 'Move entry'}</button></div></form></Modal>
}

function FoodModal({ food, onClose, onSave }: { food?: Food; onClose: () => void; onSave: (draft: FoodDraft, existing?: Food) => Promise<void> }) {
  const [draft, setDraft] = useState<FoodDraft>(() => food ? { name: food.name, serving: food.serving, calories: String(food.calories), protein: String(food.protein), carbs: String(food.carbs), fat: String(food.fat) } : emptyFoodDraft)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!draft.name.trim()) { setError('Give this saved food a name.'); return }
    if (!draft.calories.trim() || Number(draft.calories) < 0 || !Number.isFinite(Number(draft.calories))) { setError('Add a valid calorie amount.'); return }
    if ([draft.protein, draft.carbs, draft.fat].some((value) => value.trim() && (Number(value) < 0 || !Number.isFinite(Number(value))))) { setError('Macro amounts must be zero or greater.'); return }
    setSaving(true)
    try { await onSave(draft, food) } finally { setSaving(false) }
  }
  return <Modal eyebrow={food ? 'Edit saved food' : 'Your library'} title={food ? 'Update food' : 'Create a food'} onClose={onClose} closeOnBackdrop={false}><form className="modal-form" onSubmit={submit}><div className="form-field full"><label htmlFor="food-name">Food name</label><input autoFocus id="food-name" placeholder="e.g. Overnight oats" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div><div className="form-field full"><label htmlFor="food-serving">Serving label</label><input id="food-serving" placeholder="1 bowl" value={draft.serving} onChange={(event) => setDraft({ ...draft, serving: event.target.value })} /></div><div className="form-field full"><label htmlFor="food-calories">Calories <span>kcal per serving</span></label><input id="food-calories" inputMode="decimal" min="0" placeholder="0" type="number" value={draft.calories} onChange={(event) => setDraft({ ...draft, calories: event.target.value })} /></div><div className="macro-input-grid"><NumberField id="food-protein" label="Protein" unit="g" value={draft.protein} onChange={(value) => setDraft({ ...draft, protein: value })} /><NumberField id="food-carbs" label="Carbs" unit="g" value={draft.carbs} onChange={(value) => setDraft({ ...draft, carbs: value })} /><NumberField id="food-fat" label="Fat" unit="g" value={draft.fat} onChange={(value) => setDraft({ ...draft, fat: value })} /></div>{error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} type="submit"><Icon name="check" size={16} />{saving ? 'Saving…' : food ? 'Save food' : 'Create food'}</button></div></form></Modal>
}

function WeightModal({ weight, defaultDate, defaultUnit, onClose, onSave }: { weight?: WeightEntry; defaultDate: string; defaultUnit: 'lb' | 'kg'; onClose: () => void; onSave: (draft: WeightDraft, existing?: WeightEntry) => Promise<void> }) {
  const [draft, setDraft] = useState<WeightDraft>(() => weight ? { date: weight.date, weight: String(weight.weight), unit: weight.unit, note: weight.note ?? '' } : { ...emptyWeightDraft, date: defaultDate, unit: defaultUnit })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    if (!draft.date || !draft.weight || Number(draft.weight) <= 0 || !Number.isFinite(Number(draft.weight))) { setError('Add a valid date and weight.'); return }
    setSaving(true)
    try { await onSave(draft, weight) } finally { setSaving(false) }
  }
  return <Modal eyebrow={weight ? 'Edit check-in' : 'New check-in'} title="Log weight" onClose={onClose} closeOnBackdrop={false}><form className="modal-form" onSubmit={submit}><div className="form-field full"><label htmlFor="weight-date">Date</label><input id="weight-date" type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })} /></div><div className="weight-input-row"><div className="form-field"><label htmlFor="weight-value">Weight</label><input autoFocus inputMode="decimal" id="weight-value" min="0" step="0.1" placeholder="0.0" type="number" value={draft.weight} onChange={(event) => setDraft({ ...draft, weight: event.target.value })} /></div><div className="form-field"><label htmlFor="weight-unit">Unit</label><select id="weight-unit" value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value as 'lb' | 'kg' })}><option value="lb">lb</option><option value="kg">kg</option></select></div></div><div className="form-field full"><label htmlFor="weight-note">Note <span>optional</span></label><input id="weight-note" placeholder="e.g. morning check-in" value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></div>{error && <p className="form-error" role="alert"><Icon name="info" size={15} />{error}</p>}<div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>Cancel</button><button className="button primary" disabled={saving} type="submit"><Icon name="check" size={16} />{saving ? 'Saving…' : 'Save check-in'}</button></div></form></Modal>
}

function NumberField({ id, label, unit, value, onChange }: { id: string; label: string; unit: string; value: string; onChange: (value: string) => void }) {
  return <div className="form-field"><label htmlFor={id}>{label} <span>{unit}</span></label><input id={id} inputMode="decimal" min="0" step="any" placeholder="0" type="number" value={value} onChange={(event) => onChange(event.target.value)} /></div>
}
