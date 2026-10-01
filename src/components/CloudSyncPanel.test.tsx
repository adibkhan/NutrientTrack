import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CloudSync } from '../lib/useCloudSync'
import { CloudSyncPanel } from './CloudSyncPanel'

const fakeCloud = (overrides: Partial<CloudSync> = {}): CloudSync => ({
  status: 'off',
  sendLink: vi.fn(async () => undefined),
  resetLink: vi.fn(),
  syncNow: vi.fn(async () => undefined),
  signOut: vi.fn(async () => undefined),
  deleteAccount: vi.fn(async () => undefined),
  ...overrides,
})

afterEach(cleanup)

describe('CloudSyncPanel signed out', () => {
  it('sends the typed email and disables the button while sending', async () => {
    let finish: () => void = () => undefined
    const sendLink = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    render(<CloudSyncPanel cloud={fakeCloud({ sendLink })} />)
    await userEvent.type(screen.getByLabelText('Email'), 'me@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    expect(sendLink).toHaveBeenCalledTimes(1)
    expect(sendLink).toHaveBeenCalledWith('me@example.com')
    const sending = screen.getByRole('button', { name: /sending/i })
    expect(sending).toHaveProperty('disabled', true)
    await userEvent.click(sending)
    expect(sendLink).toHaveBeenCalledTimes(1)

    finish()
    expect(await screen.findByRole('button', { name: /email me a sign-in link/i })).toHaveProperty('disabled', false)
  })

  it('shows the error message', () => {
    render(<CloudSyncPanel cloud={fakeCloud({ message: 'Check the email address and try again.' })} />)
    expect(screen.getByRole('alert').textContent).toContain('Check the email address and try again.')
  })
})

describe('CloudSyncPanel other states', () => {
  it('asks the user to check their email and shows the address', () => {
    render(<CloudSyncPanel cloud={fakeCloud({ status: 'link-sent', email: 'me@example.com' })} />)
    expect(screen.getAllByText('Check your email').length).toBeGreaterThan(0)
    expect(screen.getByText(/me@example\.com/)).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('sends the link again to the same address from the check-your-email state', async () => {
    const cloud = fakeCloud({ status: 'link-sent', email: 'me@example.com' })
    render(<CloudSyncPanel cloud={cloud} />)
    await userEvent.click(screen.getByRole('button', { name: 'Send again' }))
    expect(cloud.sendLink).toHaveBeenCalledTimes(1)
    expect(cloud.sendLink).toHaveBeenCalledWith('me@example.com')
    expect(cloud.resetLink).not.toHaveBeenCalled()
  })

  it('lets the user pick a different email from the check-your-email state', async () => {
    const cloud = fakeCloud({ status: 'link-sent', email: 'me@example.com' })
    render(<CloudSyncPanel cloud={cloud} />)
    await userEvent.click(screen.getByRole('button', { name: 'Use a different email' }))
    expect(cloud.resetLink).toHaveBeenCalledTimes(1)
    expect(cloud.sendLink).not.toHaveBeenCalled()
  })

  it('shows the signed-in email and syncs on request', async () => {
    const cloud = fakeCloud({ status: 'synced', email: 'me@example.com', lastSyncedAt: '2026-09-30T12:00:00.000Z' })
    render(<CloudSyncPanel cloud={cloud} />)
    expect(screen.getByText('Signed in as me@example.com')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Sync' }))
    expect(cloud.syncNow).toHaveBeenCalledTimes(1)
  })

  it('disables Sync while syncing', () => {
    render(<CloudSyncPanel cloud={fakeCloud({ status: 'syncing', email: 'me@example.com' })} />)
    expect(screen.getByRole('button', { name: /syncing/i })).toHaveProperty('disabled', true)
  })

  it('signs out', async () => {
    const cloud = fakeCloud({ status: 'synced', email: 'me@example.com' })
    render(<CloudSyncPanel cloud={cloud} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(cloud.signOut).toHaveBeenCalledTimes(1)
  })

  it.each(['offline', 'error'] as const)('shows the message when status is %s and stays signed in', (status) => {
    render(<CloudSyncPanel cloud={fakeCloud({ status, email: 'me@example.com', message: 'Sync paused. Saved here.' })} />)
    expect(screen.getByText('Sync paused. Saved here.')).toBeTruthy()
    expect(screen.getByText('Signed in as me@example.com')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sync' })).toHaveProperty('disabled', false)
  })
})

describe('CloudSyncPanel account deletion', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('deletes the cloud account only after confirmation', async () => {
    const deleteAccount = vi.fn(async () => undefined)
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<CloudSyncPanel cloud={fakeCloud({ status: 'synced', email: 'me@example.com', deleteAccount })} />)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(String(confirm.mock.calls[0][0])).toMatch(/diary on this device is kept/i)
    expect(deleteAccount).toHaveBeenCalledTimes(1)
  })

  it('does nothing when the confirmation is declined', async () => {
    const deleteAccount = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<CloudSyncPanel cloud={fakeCloud({ status: 'synced', email: 'me@example.com', deleteAccount })} />)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(deleteAccount).not.toHaveBeenCalled()
  })

  it('is not offered when signed out', () => {
    render(<CloudSyncPanel cloud={fakeCloud()} />)
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull()
  })
})
