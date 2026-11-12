import { initials, badgeFill, inkFor } from "@/domain/badge/badge";
import type { Hex } from "@/domain/color/contrast";

export type BadgeKind = "team" | "league" | "avatar";
export type BadgeSize = 24 | 40 | 64 | 96 | 160;

type Props = {
  kind: BadgeKind;
  /** Team, league or person name: the accessible label and the source of the initials. */
  name: string;
  /** An uploaded logo or photo. When missing, a generated placeholder is drawn. */
  src?: string | null;
  /** A team's chosen color. Teams without one get a stable color from their name. */
  color?: Hex | null;
  size?: BadgeSize;
};

/**
 * One component for real logos and placeholders, so swapping one for the
 * other changes nothing else on the page (docs/design-system.md, section 7).
 */
export function LogoBadge({ kind, name, src, color, size = 40 }: Props) {
  const label = kind === "avatar" ? name : `${name} logo`;
  const shape = kind === "league" ? "rounded-card" : "rounded-full";

  if (src) {
    return (
      // Uploaded art comes from Blob storage later; a plain img keeps this
      // component free of image-host configuration until then.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={label}
        width={size}
        height={size}
        className={`${shape} bg-surface object-contain`}
      />
    );
  }

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className="shrink-0"
    >
      {kind === "team" && <TeamPlaceholder name={name} color={color} />}
      {kind === "league" && <LeaguePlaceholder name={name} />}
      {kind === "avatar" && <AvatarPlaceholder name={name} />}
    </svg>
  );
}

const textProps = {
  x: 50,
  textAnchor: "middle",
  dominantBaseline: "central",
  fontWeight: 800,
  className: "font-display",
} as const;

function TeamPlaceholder({
  name,
  color,
}: {
  name: string;
  color?: Hex | null | undefined;
}) {
  const fill = badgeFill(name, color);
  const ink = inkFor(fill);
  return (
    <>
      <circle cx="50" cy="50" r="48" fill={fill} />
      <circle
        cx="50"
        cy="50"
        r="41"
        fill="none"
        stroke={ink}
        strokeOpacity="0.35"
        strokeWidth="2"
      />
      <text {...textProps} y={51} fontSize={38} fill={ink}>
        {initials(name, 2)}
      </text>
    </>
  );
}

/** A pennant in the brand color, waving a little, with up to three initials. */
function LeaguePlaceholder({ name }: { name: string }) {
  const letters = initials(name, 3);
  return (
    <>
      <path
        d="M8 12 L92 50 L8 88 Z"
        className="fill-brand"
        strokeLinejoin="round"
      />
      <rect x="4" y="8" width="7" height="88" rx="3" className="fill-accent" />
      <text
        {...textProps}
        x={42}
        y={50}
        fontSize={letters.length > 2 ? 22 : 28}
        className="fill-on-brand font-display"
      >
        {letters}
      </text>
    </>
  );
}

function AvatarPlaceholder({ name }: { name: string }) {
  return (
    <>
      <circle
        cx="50"
        cy="50"
        r="48"
        className="fill-surface-2 stroke-border"
        strokeWidth="2"
      />
      <text
        {...textProps}
        y={51}
        fontSize={36}
        className="fill-text font-display"
      >
        {initials(name, 2)}
      </text>
    </>
  );
}
