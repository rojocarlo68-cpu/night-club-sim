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
/** Full-body display height (furniture-matched); peek uses the same size. */
export const LUNA_DISPLAY_H = 88;

export class Bartender extends Character {
  profile: BartenderData;
  selected = false;
  private ring?: Phaser.GameObjects.Ellipse;
  private frontPeek = false;

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
      const displayH = LUNA_DISPLAY_H;
      const displayW = (LUNA_IDLE_FRAME_W / LUNA_IDLE_FRAME_H) * displayH;
      this.setupSheetIdle({
        animKey: 'luna-idle',
        originY: LUNA_FEET_ORIGIN_Y,
        displayWidth: displayW,
        displayHeight: displayH,
        // Default stand Y; ClubScene nudges slightly at front staffSpot
        y: 6,
      });
      this.ring.setPosition(0, -2);
      this.ring.setSize(18, 8);
    }
  }

  private lunaDisplaySize(): { w: number; h: number } {
    const h = LUNA_DISPLAY_H;
    return { w: (LUNA_IDLE_FRAME_W / LUNA_IDLE_FRAME_H) * h, h };
  }

  /**
   * Front bar (SE/SW): swap to baked peek sheet (head→navel, transparent below)
   * at the SAME display size / feet origin as full Luna — no setCrop shrink.
   * Elsewhere: full luna_idle + clear crop.
   */
  setFrontBarPeek(active: boolean): void {
    const key = this.sprite.texture?.key;
    if (key !== 'luna_idle' && key !== 'luna_idle_peek') return;
    if (this.frontPeek === active) return;
    this.frontPeek = active;

    const { w, h } = this.lunaDisplaySize();
    // Keep current animation frame index when swapping sheets
    const frameName = this.sprite.frame?.name;
    const frameIndex =
      typeof frameName === 'string' && /^\d+$/.test(frameName)
        ? Number(frameName)
        : typeof frameName === 'number'
          ? frameName
          : 0;

    if (active) {
      this.sprite.setCrop();
      this.sprite.setTexture('luna_idle_peek', frameIndex);
      this.sprite.setOrigin(0.5, LUNA_FEET_ORIGIN_Y);
      this.sprite.setDisplaySize(w, h);
      this.idleAnimKey = 'luna-idle-peek';
      if (this.scene.anims.exists('luna-idle-peek')) {
        this.sprite.play('luna-idle-peek', true);
      }
    } else {
      this.sprite.setCrop();
      this.sprite.setTexture('luna_idle', frameIndex);
      this.sprite.setOrigin(0.5, LUNA_FEET_ORIGIN_Y);
      this.sprite.setDisplaySize(w, h);
      this.idleAnimKey = 'luna-idle';
      if (this.scene.anims.exists('luna-idle')) {
        this.sprite.play('luna-idle', true);
      }
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
