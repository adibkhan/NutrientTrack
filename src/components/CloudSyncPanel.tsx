import { useState, type FormEvent } from 'react'
import { isSignedInStatus, type CloudSync } from '../lib/useCloudSync'
import { Icon } from './Icon'

const statusLabel: Record<CloudSync['status'], string> = {
  off: 'Off',
  checking: 'Checking…',
  'link-sent': 'Check your email',
  syncing: 'Syncing…',
  synced: 'On',
  offline: 'Waiting for connection',
  error: 'Paused',
}

const formatTime = (value?: string) =>
  value ? new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : undefined

export function CloudSyncPanel({ cloud }: { cloud: CloudSync }) {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const signedIn = isSignedInStatus(cloud.status)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (sending || !email.trim()) return
    setSending(true)
    try {
      await cloud.sendLink(email)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="panel cloud-panel" aria-labelledby="cloud-heading">
      <div className="panel-header">
        <div><p className="eyebrow">Optional</p><h2 id="cloud-heading">Backup &amp; sync</h2></div>
        <span className={`storage-status ${cloud.status === 'synced' ? 'synced' : ''}`}><i className={cloud.status === 'synced' ? 'granted' : ''} />{statusLabel[cloud.status]}</span>
      </div>
      {signedIn ? (
        <>
          <div className="privacy-card">
            <span className="privacy-card-icon"><Icon name="lock" size={19} /></span>
            <div>
              <strong>Signed in as {cloud.email ?? 'your account'}</strong>
              <p>{cloud.lastSyncedAt ? `Last synced at ${formatTime(cloud.lastSyncedAt)}.` : 'Your diary is being copied to your account.'} Sign in with the same email on another device to see the same diary.</p>
            </div>
          </div>
          {cloud.message && <p className="form-note" role="status"><Icon name="info" size={15} />{cloud.message}</p>}
          <div className="data-tools">
            <div className="tool-row">
              <div><strong>Sync now</strong><p>Changes sync automatically; use this after being offline.</p></div>
              <button className="button secondary compact" disabled={cloud.status === 'syncing'} type="button" onClick={() => { void cloud.syncNow() }}><Icon name="upload" size={15} />{cloud.status === 'syncing' ? 'Syncing…' : 'Sync'}</button>
            </div>
            <div className="tool-row">
              <div><strong>Sign out on this device</strong><p>Your diary stays on this device and in your account.</p></div>
              <button className="button secondary compact" type="button" onClick={() => { void cloud.signOut() }}>Sign out</button>
            </div>
          </div>
          <div className="danger-zone">
            <div><strong>Delete my cloud account</strong><p>Permanently delete your account and its copy of your diary. The diary on this device is kept.</p></div>
            <button className="button danger compact" type="button" onClick={() => {
              if (window.confirm('Delete your NutrientTrack cloud account and its copy of your diary? This cannot be undone. The diary on this device is kept.')) void cloud.deleteAccount()
            }}><Icon name="trash" size={15} />Delete</button>
          </div>
        </>
      ) : cloud.status === 'link-sent' ? (
        <div className="privacy-card" role="status">
          <span className="privacy-card-icon"><Icon name="check" size={19} /></span>
          <div>
            <strong>Check your email</strong>
            <p>We sent a sign-in link to {cloud.email}. Open it on this device to turn on backup and sync. It expires in an hour.</p>
          </div>
        </div>
      ) : (
        <>
          <p className="panel-copy">Keep a copy of your diary in your account and use it on more than one device. Without this, everything stays only in this browser.</p>
          <form className="cloud-form" onSubmit={submit}>
            <div className="form-field full">
              <label htmlFor="cloud-email">Email</label>
              <input autoComplete="email" id="cloud-email" inputMode="email" placeholder="you@example.com" required type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            <button className="button primary full-width" disabled={sending} type="submit"><Icon name="arrow-right" size={16} />{sending ? 'Sending…' : 'Email me a sign-in link'}</button>
          </form>
          {cloud.message && <p className="form-error" role="alert"><Icon name="info" size={15} />{cloud.message}</p>}
          <p className="form-note"><Icon name="info" size={15} />No password. Your entries, foods, weights and goals are stored in your account so you can restore them. You can keep using NutrientTrack without signing in.</p>
        </>
      )}
    </section>
  )
}
