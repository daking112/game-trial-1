import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { ArenaScene } from './scenes/ArenaScene';
import { ARENA_VIEW_WIDTH, ARENA_VIEW_HEIGHT } from './arenaConfig';
import { arenaInit } from './arenaInit';

interface Props {
  speciesId: string;
  stars: number;
  runToken: number; // bump to force a fresh arena instance
}

export function ArenaGame({ speciesId, stars, runToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    arenaInit.speciesId = speciesId;
    arenaInit.stars = stars;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: ARENA_VIEW_WIDTH,
      height: ARENA_VIEW_HEIGHT,
      parent: containerRef.current,
      backgroundColor: '#1b2a1f',
      scene: [ArenaScene],
      physics: {
        default: 'arcade',
        arcade: { gravity: { x: 0, y: 0 }, debug: false },
      },
      pixelArt: false,
    });
    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken]);

  return <div id="phaser-root" ref={containerRef} />;
}
