import Phaser from 'phaser';

// A single shared emitter bridging the Phaser battle simulation and the
// React UI shell. Phaser owns the simulation; React only ever reads state
// through events and sends commands the same way — neither side reaches
// into the other's internals directly.
export const EventBus = new Phaser.Events.EventEmitter();

export type BattleEvent =
  | 'battle-ready'
  | 'hud-update'
  | 'wave-complete'
  | 'battle-victory'
  | 'battle-defeat'
  | 'monster-selected'
  | 'monster-deselected'
  | 'wild-encounter'
  | 'toast';
