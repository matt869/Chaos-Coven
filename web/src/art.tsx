// Hand-drawn Halloween art as inline SVG: no image requests, crisp at any size.
// Everything here is decorative and hidden from assistive technology.
import { useId } from 'react';

export type Mood = 'calm' | 'worried' | 'scared' | 'happy' | 'sad' | 'boo';

const INK = '#232733';
const BLUSH = '#f4a6b0';

/** The ghost's face for each mood: eyes, brows, mouth and blush. */
function Face({ mood }: { mood: Mood }) {
  const eyes =
    mood === 'happy' ? (
      // ^ ^ eyes
      <g stroke={INK} strokeWidth="4" strokeLinecap="round" fill="none">
        <path d="M38 60q7-9 14 0" />
        <path d="M65 60q7-9 14 0" />
      </g>
    ) : mood === 'scared' || mood === 'boo' ? (
      <g className="eyes">
        <ellipse cx="45" cy="57" rx="8" ry="11" fill={INK} />
        <ellipse cx="72" cy="57" rx="8" ry="11" fill={INK} />
        <circle cx="47.5" cy="53" r="2.6" fill="#fff" />
        <circle cx="74.5" cy="53" r="2.6" fill="#fff" />
      </g>
    ) : (
      <g className="eyes">
        <ellipse cx="45" cy="58" rx="6" ry={mood === 'sad' ? 7 : 9} fill={INK} />
        <ellipse cx="72" cy="58" rx="6" ry={mood === 'sad' ? 7 : 9} fill={INK} />
        <circle cx="47" cy="55" r="2" fill="#fff" />
        <circle cx="74" cy="55" r="2" fill="#fff" />
      </g>
    );

  const brows =
    mood === 'worried' || mood === 'sad' ? (
      <g stroke={INK} strokeWidth="3" strokeLinecap="round">
        {/* raised in the middle: worried, not cross */}
        <path d="M37 47l12-5" />
        <path d="M80 47l-12-5" />
      </g>
    ) : null;

  const mouth = {
    calm: <path d="M51 76q7.5 7 15 0" stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none" />,
    happy: <path d="M48 74q10.5 14 21 0z" fill={INK} />,
    worried: <path d="M50 80q4-4 8 0t8 0" stroke={INK} strokeWidth="3" strokeLinecap="round" fill="none" />,
    scared: <ellipse cx="58.5" cy="82" rx="6" ry="8" fill={INK} />,
    sad: <path d="M51 82q7.5-7 15 0" stroke={INK} strokeWidth="3.5" strokeLinecap="round" fill="none" />,
    boo: <ellipse cx="58.5" cy="82" rx="9" ry="11" fill={INK} />,
  }[mood];

  const blush = mood === 'calm' || mood === 'happy' || mood === 'boo' ? (
    <g fill={BLUSH} opacity="0.6">
      <ellipse cx="34" cy="72" rx="6" ry="3.5" />
      <ellipse cx="83" cy="72" rx="6" ry="3.5" />
    </g>
  ) : null;

  return (
    <>
      {eyes}
      {brows}
      {mouth}
      {blush}
    </>
  );
}

/**
 * The Witching Hour ghost. `mood` changes its face; `candle` adds the candle it holds
 * in the hero. Ids are per-instance so several ghosts can share a page.
 */
export function Ghost({ className, mood = 'calm', candle = false }: { className?: string; mood?: Mood; candle?: boolean }) {
  const flame = useId();
  return (
    <svg className={className} viewBox="0 0 120 150" aria-hidden="true" focusable="false">
      {candle && (
        <>
          <defs>
            <radialGradient id={flame} cx="50%" cy="60%" r="60%">
              <stop offset="0%" stopColor="#fff3c4" />
              <stop offset="45%" stopColor="#f0a33a" />
              <stop offset="100%" stopColor="#f0a33a" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="96" cy="44" r="26" fill={`url(#${flame})`} opacity="0.55" className="glow" />
        </>
      )}
      {/* body */}
      <path
        d="M60 8c-26 0-44 20-44 48v70l11-9 11 10 11-10 11 10 11-10 11 10 11-10 11 9V56C104 28 86 8 60 8z"
        fill="#ece6d8"
      />
      <path d="M60 8c-26 0-44 20-44 48v70l11-9V58C27 34 40 15 60 12z" fill="#d6cfbd" opacity="0.6" />
      <Face mood={mood} />
      {candle && (
        <>
          <path d="M96 78c8-4 10-12 6-20" stroke="#ece6d8" strokeWidth="9" strokeLinecap="round" fill="none" />
          <rect x="91" y="50" width="10" height="18" rx="2" fill="#f4e7c8" />
          <path d="M96 36c4 5 4 10 0 13-4-3-4-8 0-13z" fill="#f0a33a" className="flame" />
        </>
      )}
    </svg>
  );
}

export function CandyCorn({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 24" aria-hidden="true" focusable="false">
      <path d="M10 1C6 1 1 18 2 21c1 2 15 2 16 0 1-3-4-20-8-20z" fill="#fff4dc" />
      <path d="M3.3 14c-.8 3-1.4 6-1.3 7 1 2 15 2 16 0 .1-1-.5-4-1.3-7z" fill="#f0a33a" />
      <path d="M2.2 19.2c-.2.9-.3 1.5-.2 1.8 1 2 15 2 16 0 .1-.3 0-.9-.2-1.8z" fill="#f6d36b" />
    </svg>
  );
}

export function Bat({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 28" aria-hidden="true" focusable="false">
      <path
        d="M32 9c2-4 4-5 6-5-1 2-1 4 0 5 6-6 15-8 26-4-6 2-9 6-9 11-4-3-8-3-11 1-2-3-5-4-8-3-1 3-3 5-4 7-1-2-3-4-4-7-3-1-6 0-8 3-3-4-7-4-11-1 0-5-3-9-9-11 11-4 20-2 26 4 1-1 1-3 0-5 2 0 4 1 6 5z"
        fill="#11131a"
      />
      {/* cute eyes and tiny fangs */}
      <circle cx="29.5" cy="11" r="1.3" fill="#f0a33a" />
      <circle cx="34.5" cy="11" r="1.3" fill="#f0a33a" />
      <path d="M30.5 14l.6 1.4.6-1.4M32.3 14l.6 1.4.6-1.4" stroke="#ece6d8" strokeWidth=".6" fill="none" />
    </svg>
  );
}

/** A jack-o'-lantern. `lit` ones glow; the rest are outlines (difficulty meter). */
export function Pumpkin({ lit, size = 22 }: { lit: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={lit ? 'pumpkin lit' : 'pumpkin'}>
      <path d="M16 6c0-2 1-4 3-4" stroke="#7a9a5a" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <path
        d="M16 7c-3-2-8-2-11 2-3 4-3 12 0 16 3 4 8 5 11 3 3 2 8 1 11-3 3-4 3-12 0-16-3-4-8-4-11-2z"
        fill={lit ? '#f0a33a' : 'none'}
        stroke={lit ? '#c97a1c' : '#5d6478'}
        strokeWidth="1.6"
      />
      {lit && (
        <>
          <path d="M9 14l3 3h-4zM23 14l1 3h-4z" fill="#3a1f05" />
          <path d="M9 21c3 3 11 3 14 0l-2 1-1-1-2 1-2-1-2 1-2-1-1 1z" fill="#3a1f05" />
        </>
      )}
    </svg>
  );
}

export function Moon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="moonFace" cx="40%" cy="38%" r="70%">
          <stop offset="0%" stopColor="#fff1d2" />
          <stop offset="70%" stopColor="#f3d6a0" />
          <stop offset="100%" stopColor="#e2b673" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="78" fill="url(#moonFace)" />
      <circle cx="74" cy="82" r="12" fill="#e3c08a" opacity="0.7" />
      <circle cx="122" cy="118" r="17" fill="#e3c08a" opacity="0.55" />
      <circle cx="110" cy="70" r="7" fill="#e3c08a" opacity="0.6" />
      <circle cx="82" cy="128" r="6" fill="#e3c08a" opacity="0.5" />
    </svg>
  );
}

export function Cobweb({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1">
      <path d="M0 0L100 100M0 0L100 40M0 0L40 100M0 0L100 0M0 0L0 100" />
      <path d="M0 22c8 2 14 8 22 0M22 0c-2 8 4 14 0 22" />
      <path d="M0 46c16 4 30 16 46 0M46 0c-4 16 10 30 0 46" />
      <path d="M0 72c24 6 46 24 72 0M72 0c-6 24 16 46 0 72" />
    </svg>
  );
}

/** The fixed night sky behind every page: moon, stars, drifting fog and the odd bat. */
export function NightSky() {
  return (
    <div className="night" aria-hidden="true">
      <div className="stars" />
      <Moon className="moon-art" />
      <Bat className="bat bat-1" />
      <Bat className="bat bat-2" />
      <Bat className="bat bat-3" />
      <div className="fog fog-1" />
      <div className="fog fog-2" />
    </div>
  );
}
