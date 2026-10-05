import type { SVGProps } from 'react'

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'bookmark'
  | 'calendar'
  | 'chart'
  | 'check'
  | 'chevron-down'
  | 'clock'
  | 'download'
  | 'edit'
  | 'flame'
  | 'food'
  | 'grip'
  | 'info'
  | 'lock'
  | 'more'
  | 'move'
  | 'plus'
  | 'search'
  | 'scale'
  | 'scan'
  | 'settings'
  | 'star'
  | 'trash'
  | 'upload'
  | 'x'

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
  size?: number
}

const paths: Record<IconName, JSX.Element> = {
  'arrow-left': <path d="m14 18-6-6 6-6M8 12h12" />,
  'arrow-right': <path d="m10 18 6-6-6-6M16 12H4" />,
  bookmark: <path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-3.6L6 21V4.8Z" />,
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  chart: <path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7" />,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />,
  edit: <path d="m4 16.5-.6 3.1 3.1-.6L18.4 7.1a2.12 2.12 0 0 0-3-3L4 16.5ZM14 6l4 4" />,
  flame: <path d="M12 21a6 6 0 0 0 6-6c0-3.9-3.2-5.8-4.8-8.5-.6 2.1-2 3.4-3.2 4.2.1-2.7-1-4.9-2-6.7C7.6 7.6 6 10 6 13.8A6.3 6.3 0 0 0 12 21Z" />,
  food: <path d="M4 3v8a3 3 0 0 0 3 3V3M4 7h3m0 4V3m8 0v18m0-18c3 1.2 4 3.2 4 5.6v.7a3.7 3.7 0 0 1-4 3.7" />,
  grip: <><circle cx="8" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="17" r="1" fill="currentColor" stroke="none" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  lock: <path d="M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3" />,
  more: <><circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" /></>,
  move: <><path d="M8 5 5 8l3 3" /><path d="M5 8h8a4 4 0 0 1 4 4v1" /><path d="m16 19 3-3-3-3" /><path d="M19 16h-8a4 4 0 0 1-4-4v-1" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  search: <><circle cx="10.8" cy="10.8" r="6.2" /><path d="m16 16 4.3 4.3" /></>,
  scale: <path d="M4 19h16M6 19V8m12 11V8M4 8h16M8 8l4-4 4 4M9 13h6m-4-3v3" />,
  star: <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />,
  scan: <><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 9v6M11 9v6M14 9v6M16.5 9v6" /></>,
  settings: <><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a2 2 0 0 1-4 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a2 2 0 0 1 0-4h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.8 1.8 0 0 0 3-.9V1.9a2 2 0 0 1 4 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.8 1.8 0 0 0 .9 3h.2a2 2 0 0 1 0 4h-.2a1.8 1.8 0 0 0-.9 3Z" /></>,
  trash: <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  upload: <path d="M12 15V3m0 0L8 7m4-4 4 4M4 19h16" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
}

export function Icon({ name, size = 20, strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
