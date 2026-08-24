import { useState } from 'react';
import type { MonsterDefinition } from '@shared/types';

interface Props {
  species: MonsterDefinition;
  size?: number;
}

// Renders real sprite art (crisp, unfiltered pixel scaling) when it exists
// under /monsters/<spriteKey>.png, and falls back to a colored circle +
// initial for species that don't have art yet. Species get real art one at
// a time as it's produced, so this fallback is expected to be hit often.
export function MonsterSprite({ species, size = 40 }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className="sprite-fallback"
        style={{ width: size, height: size, background: `${species.color}33`, borderColor: species.color }}
      >
        {species.name[0]}
      </div>
    );
  }

  return (
    <img
      className="sprite-img"
      src={`/monsters/${species.spriteKey}.png`}
      alt={species.name}
      width={size}
      height={size}
      onError={() => setFailed(true)}
    />
  );
}
