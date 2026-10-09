// Small inline icons (24×24, stroke = currentColor) so the bottom bar needs no icon library.
import type { SVGProps } from 'react'

const base: SVGProps<SVGSVGElement> = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
}

export const HomeIcon = () => (
  <svg {...base}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h5v-6h4v6h5V9.5" />
  </svg>
)

export const LeaderboardIcon = () => (
  <svg {...base}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z" />
    <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
  </svg>
)

export const ReportIcon = () => (
  <svg {...base}>
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  </svg>
)

export const ProfileIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
  </svg>
)

export const HelpIcon = () => (
  <svg {...base} width={20} height={20}>
    <circle cx="12" cy="12" r="10" />
    <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5" />
    <path d="M12 17.5h.01" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...base} width={20} height={20}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)
