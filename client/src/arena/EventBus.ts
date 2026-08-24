import Phaser from 'phaser';

// A single shared emitter bridging the Phaser arena simulation and the React
// UI shell. Phaser owns the simulation; React only ever reads state through
// events and sends commands the same way — neither side reaches into the
// other's internals directly.
export const EventBus = new Phaser.Events.EventEmitter();

export type ArenaEvent =
  | 'arena-ready'
  | 'hud-update'
  | 'level-up'
  | 'run-over'
  | 'allocate-stat'
  | 'toast';
