import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { BattleScene } from './scenes/BattleScene';
import { MAP_WIDTH, MAP_HEIGHT } from './mapConfig';
import type { MonsterInstance } from '@shared/types';
import { battleInit } from './battleInit';

interface Props {
  team: MonsterInstance[];
  runToken: number; // bump to force a fresh battle instance
}

export function PhaserGame({ team, runToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    battleInit.team = team;

    const game = new Phaser.Game({
      type: Phaser.AUTO,
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      parent: containerRef.current,
      backgroundColor: '#152018',
      scene: [BattleScene],
      render: { antialias: true },
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
