import type { ReactNode, SVGProps } from "react";

/**
 * Compact inline icon set. Kept as a data map so nodes/nav/stats all pull
 * from one place. Line icons use stroke, solid icons use fill — baked into
 * each path so the wrapper stays dumb.
 */
export type IconName =
  | "assignment"
  | "log"
  | "chest"
  | "project"
  | "test"
  | "lock"
  | "check"
  | "crown"
  | "star"
  | "flame"
  | "gem"
  | "chevron"
  | "pencil"
  | "plus"
  | "trash"
  | "arrowUp"
  | "arrowDown"
  | "route"
  | "world"
  | "trophy"
  | "gift"
  | "chart"
  | "gear";

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.1,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const PATHS: Record<IconName, ReactNode> = {
  assignment: <path {...stroke} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  log: <path {...stroke} d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2ZM9 7h6M9 11h6" />,
  chest: (
    <g {...stroke}>
      <path d="M3 10a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9H3ZM3 10 5 4h14l2 6M12 8v11" />
      <circle cx="12" cy="13" r="1.3" fill="currentColor" />
    </g>
  ),
  project: (
    <g {...stroke}>
      <path d="M12 2c3.5 2 5 6 5 9l-3 3H10L7 11c0-3 1.5-7 5-9ZM9 17l-2 4 3-1M15 17l2 4-3-1" />
      <circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none" />
    </g>
  ),
  test: (
    <g {...stroke}>
      <path d="M6 4h12v3a6 6 0 0 1-12 0ZM9 13v4M15 13v4M7 20h10" />
      <path d="M4 4h2v2a3 3 0 0 1-2-3ZM20 4h-2v2a3 3 0 0 0 2-3Z" fill="currentColor" stroke="none" />
    </g>
  ),
  lock: (
    <g {...stroke} strokeWidth={2.4}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </g>
  ),
  check: <path {...stroke} strokeWidth={3.2} d="M4 12.5 9.5 18 20 6" />,
  crown: <path fill="currentColor" d="M3 7l4 4 5-6 5 6 4-4-2 12H5Z" />,
  star: <path fill="currentColor" d="M12 2.2l2.95 6.02 6.65.95-4.82 4.66 1.15 6.6L12 18.3l-5.08 2.13 1.15-6.6L3.25 9.17l6.65-.95z" />,
  pencil: <path {...stroke} d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />,
  plus: <path {...stroke} strokeWidth={2.4} d="M12 5v14M5 12h14" />,
  trash: <path {...stroke} d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />,
  arrowUp: <path {...stroke} strokeWidth={2.4} d="M12 19V6M6 11l6-6 6 6" />,
  arrowDown: <path {...stroke} strokeWidth={2.4} d="M12 5v13M6 13l6 6 6-6" />,
  flame: (
    <path
      fill="currentColor"
      d="M12 22a6 6 0 0 0 6-6c0-4-3-5-4-9-.5 3-3 4-3 7 0 1-1 1.5-2 1.5-1 0-1.5-1-1.5-2A6 6 0 0 0 6 16a6 6 0 0 0 6 6Z"
    />
  ),
  gem: <path fill="currentColor" d="M6 3h12l3 5-9 13L3 8Z" />,
  chevron: <path {...stroke} strokeWidth={2.6} d="M7 10l5 5 5-5" />,
  route: (
    <g {...stroke}>
      <circle cx="6" cy="19" r="2.5" />
      <circle cx="18" cy="5" r="2.5" />
      <path d="M8.5 19H14a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h5.5" />
    </g>
  ),
  world: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18" />
    </g>
  ),
  trophy: <path {...stroke} d="M7 4h10v4a5 5 0 0 1-10 0ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M9 18h6M10 14v4M14 14v4M8 21h8" />,
  gift: (
    <g {...stroke}>
      <rect x="3" y="9" width="18" height="12" rx="2" />
      <path d="M3 13h18M12 9v12M12 9c-3-4-7-1-4 0 3-4 7-1 4 0Z" />
    </g>
  ),
  chart: <path {...stroke} d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  gear: (
    <g {...stroke}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </g>
  ),
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden {...props}>
      {PATHS[name]}
    </svg>
  );
}

/** True when `s` is one of the built-in icon names. */
export function isIconName(s: string): s is IconName {
  return Object.prototype.hasOwnProperty.call(PATHS, s);
}

/**
 * Renders any icon value: a built-in icon name, an image URL
 * (http/https, "/path", or data:), or an emoji / short text as a fallback.
 * Lets nodes carry custom art without the renderers caring which kind.
 */
export function Glyph({ icon, className }: { icon: string; className?: string }) {
  if (isIconName(icon)) return <Icon name={icon} className={className} />;
  if (/^(https?:\/\/|\/|data:)/.test(icon)) {
    return <img src={icon} alt="" className={className} style={{ objectFit: "contain" }} />;
  }
  // Emoji / text: size comes from the container's font-size (set per usage).
  return (
    <span className={className} aria-hidden style={{ display: "grid", placeItems: "center", lineHeight: 1 }}>
      {icon}
    </span>
  );
}

/** The Pal mascot that bobs beside the current node. */
export function PalMascot(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden {...props}>
      <path d="M32 10c14 0 21 10 21 24 0 12-9 20-21 20s-21-8-21-20C11 20 18 10 32 10Z" fill="#3de6a6" />
      <path d="M20 14c-3-4-8-4-9 1s4 8 8 6M44 14c3-4 8-4 9 1s-4 8-8 6" fill="#2fd39a" />
      <circle cx="25" cy="33" r="4.4" fill="#0b0c10" />
      <circle cx="39" cy="33" r="4.4" fill="#0b0c10" />
      <circle cx="26.4" cy="31.6" r="1.5" fill="#fff" />
      <circle cx="40.4" cy="31.6" r="1.5" fill="#fff" />
      <path d="M27 42c2 2.5 8 2.5 10 0" fill="none" stroke="#0b0c10" strokeWidth={2.6} strokeLinecap="round" />
      <circle cx="18" cy="40" r="3" fill="#ff9db1" opacity=".6" />
      <circle cx="46" cy="40" r="3" fill="#ff9db1" opacity=".6" />
    </svg>
  );
}
