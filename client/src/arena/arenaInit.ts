// A tiny mutable handoff object: the React wrapper fills this in right
// before instantiating the Phaser.Game, and the scene reads it in create().
// Avoids threading data through Phaser's scene-start data API for a value
// that's only ever needed once per game instance.
export const arenaInit: { speciesId: string; stars: number } = { speciesId: '', stars: 1 };
