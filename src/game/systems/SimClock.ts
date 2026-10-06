/**
 * Pause-aware simulation clock for ClubScene.
 *
 * Phaser's Clock sets `scene.time.now = game.loop.time` (wall clock) every frame, so any
 * `startedAt + duration <= scene.time.now` timer would "jump" after a pause. Timer events and
 * tweens already advance by delta (pause-safe); this patch makes `scene.time.now` itself advance
 * only by the deltas the scene actually simulates. A paused / sleeping scene does not update, so
 * the sim clock freezes exactly — every timestamp-based timer (spoilage, technicians, café,
 * cooldowns, closing nudge…) stays frozen too, with zero changes to the code that reads it.
 *
 * The value is also saved / restored with a save slot so saved timestamps remain valid.
 */
import Phaser from 'phaser';

type PatchedClock = Phaser.Time.Clock & { __simNow?: number; __simPatched?: boolean };

export function installSimClock(scene: Phaser.Scene, startAt?: number): void {
  const clock = scene.time as PatchedClock;
  if (clock.__simPatched) return;
  clock.__simPatched = true;
  clock.__simNow = typeof startAt === 'number' && Number.isFinite(startAt) ? startAt : clock.now;
  clock.now = clock.__simNow;
  const protoUpdate = Phaser.Time.Clock.prototype.update;
  const patched = (_time: number, delta: number) => {
    const d = Number.isFinite(delta) ? Math.max(0, delta) : 0;
    clock.__simNow = (clock.__simNow ?? 0) + d;
    protoUpdate.call(clock, clock.__simNow, delta);
  };
  // Clock.start() already subscribed the prototype method to the scene UPDATE event: swap the
  // listener (Clock.shutdown unsubscribes `this.update`, i.e. the patched one, so it stays clean).
  const events = scene.sys.events;
  events.off(Phaser.Scenes.Events.UPDATE, protoUpdate, clock);
  clock.update = patched;
  events.on(Phaser.Scenes.Events.UPDATE, patched, clock);
}

export function getSimNow(scene: Phaser.Scene): number {
  const clock = scene.time as PatchedClock;
  return clock.__simNow ?? clock.now;
}

/** Restore a saved sim time (save slots): timestamps saved with it stay comparable. */
export function setSimNow(scene: Phaser.Scene, t: number): void {
  if (!Number.isFinite(t)) return;
  const clock = scene.time as PatchedClock;
  clock.__simNow = t;
  clock.now = t;
}
