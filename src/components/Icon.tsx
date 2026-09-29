import type { SVGProps } from 'react'

export type IconName =
  | 'arrow-left'
  | 'arrow-right'
  | 'calendar'
  | 'chart'
  | 'check'
  | 'chevron-down'
  | 'download'
  | 'edit'
  | 'flame'
  | 'food'
  | 'info'
  | 'lock'
  | 'plus'
  | 'scale'
  | 'settings'
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
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  chart: <path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7" />,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  download: <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16" />,
  edit: <path d="m4 16.5-.6 3.1 3.1-.6L18.4 7.1a2.12 2.12 0 0 0-3-3L4 16.5ZM14 6l4 4" />,
  flame: <path d="M12 21a6 6 0 0 0 6-6c0-3.9-3.2-5.8-4.8-8.5-.6 2.1-2 3.4-3.2 4.2.1-2.7-1-4.9-2-6.7C7.6 7.6 6 10 6 13.8A6.3 6.3 0 0 0 12 21Z" />,
  food: <path d="M4 3v8a3 3 0 0 0 3 3V3M4 7h3m0 4V3m8 0v18m0-18c3 1.2 4 3.2 4 5.6v.7a3.7 3.7 0 0 1-4 3.7" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  lock: <path d="M6 10h12v10H6zM8 10V7a4 4 0 0 1 8 0v3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  scale: <path d="M4 19h16M6 19V8m12 11V8M4 8h16M8 8l4-4 4 4M9 13h6m-4-3v3" />,
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
