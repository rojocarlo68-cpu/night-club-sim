import Phaser from 'phaser';
import { Character } from './Character';
import { IsoConfig } from '../systems/IsoUtils';
import { Pathfinder, GridPos } from '../systems/Pathfinding';

export interface BartenderData {
  id: string;
  name: string;
  energy: number;
  mood: number;
  skill: number;
  energyDrainPerServe: number;
  energyRegenOnRest: number;
  restDurationMs: number;
  serveDurationMs: number;
  moveSpeed: number;
}

/** Luna idle sheet: 1168×784 → 8 frames of 146×784; feet near y=583. */
export const LUNA_IDLE_FRAME_W = 146;
export const LUNA_IDLE_FRAME_H = 784;
export const LUNA_FEET_ORIGIN_Y = 583 / 784;

export class Bartender extends Character {
  profile: BartenderData;
  selected = false;
  private ring?: Phaser.GameObjects.Ellipse;

  constructor(
    scene: Phaser.Scene,
    texture: string,
    grid: GridPos,
    iso: IsoConfig,
    pathfinder: Pathfinder,
    data: BartenderData
  ) {
    super(scene, texture, grid, iso, pathfinder, data.moveSpeed);
    this.profile = { ...data };
    this.sprite.setInteractive({ useHandCursor: true });
    this.ring = scene.add.ellipse(0, -4, 36, 14, 0xff3ca0, 0.0);
    this.add(this.ring);
    this.ring.setDepth(-1);

    if (texture === 'luna_idle') {
      // Match furniture scale: sofa ~84px tall; Luna standing ~sofa height (not 3× taller)
      const displayH = 88;
      const displayW = (LUNA_IDLE_FRAME_W / LUNA_IDLE_FRAME_H) * displayH;
      this.setupSheetIdle({
        animKey: 'luna-idle',
        originY: LUNA_FEET_ORIGIN_Y,
        displayWidth: displayW,
        displayHeight: displayH,
        // Sink slightly so feet sit in the counter trough (barFront occludes legs)
        y: 6,
      });
      this.ring.setPosition(0, -2);
      this.ring.setSize(18, 8);
    }
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.ring?.setFillStyle(0xff3ca0, v ? 0.45 : 0);
  }

  canServe(): boolean {
    return this.state === 'idle' && this.profile.energy >= this.profile.energyDrainPerServe;
  }

  applyServeDrain(): void {
    this.profile.energy = Math.max(0, this.profile.energy - this.profile.energyDrainPerServe);
    if (this.profile.energy < 30) this.profile.mood = Math.max(0, this.profile.mood - 4);
  }

  applyRest(): void {
    this.profile.energy = Math.min(100, this.profile.energy + this.profile.energyRegenOnRest);
    this.profile.mood = Math.min(100, this.profile.mood + 6);
  }

  get energy(): number {
    return this.profile.energy;
  }
  get mood(): number {
    return this.profile.mood;
  }
  get skill(): number {
    return this.profile.skill;
  }
  get displayName(): string {
    return this.profile.name;
  }
}
