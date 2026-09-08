import Phaser from 'phaser';
import { Character } from './Character';
import { IsoConfig } from '../systems/IsoUtils';
import { Pathfinder, GridPos } from '../systems/Pathfinding';
import { STAFF_DISPLAY_H } from './Bartender';

export interface PatronData {
  id: string;
  name: string;
  sprite: string;
  preferredDrink: string;
  tipChance: number;
  patience: number;
  /** Optional future traits (kept extensible). */
  mood?: number;
  traits?: string[];
}

export type PatronGoal = 'bar' | 'sofa' | 'leave';

/** Male client walk/idle sheets: 112×192 frames, feet near bottom. */
export const PATRON_FRAME_W = 112;
export const PATRON_FRAME_H = 192;
export const PATRON_FEET_ORIGIN_Y = (PATRON_FRAME_H - 2) / PATRON_FRAME_H;
/**
 * Luna/Nova sheets are 784px tall with ~half transparent padding, so
 * STAFF_DISPLAY_H=88 yields only ~47px of *visible* body. Patron frames
 * fill nearly the whole 192px — PATRON_DISPLAY_H=88 left clients ~1.8×
 * taller than Luna on screen. Match Luna's visible body height:
 *   88 * (417/784) * (192/188) ≈ 48
 */
export const LUNA_CONTENT_H = 417;
export const LUNA_FRAME_H_FOR_SCALE = 784;
export const PATRON_CONTENT_H = 188;
export const PATRON_DISPLAY_H = Math.round(
  STAFF_DISPLAY_H * (LUNA_CONTENT_H / LUNA_FRAME_H_FOR_SCALE) * (PATRON_FRAME_H / PATRON_CONTENT_H)
);

export class Patron extends Character {
  profile: PatronData;
  goal: PatronGoal = 'bar';
  waiting = false;
  served = false;
  /** Remaining patience while waiting (seconds). */
  patienceRemaining: number;
  preferredDrinkName: string;
  selected = false;
  label?: Phaser.GameObjects.Text;
  private ring?: Phaser.GameObjects.Ellipse;

  constructor(
    scene: Phaser.Scene,
    texture: string,
    grid: GridPos,
    iso: IsoConfig,
    pathfinder: Pathfinder,
    data: PatronData,
    drinkDisplayName?: string
  ) {
    // Prefer animated sheets when available
    const startTex =
      scene.textures.exists('patron_idle')
        ? 'patron_idle'
        : scene.textures.exists('patron_walk')
          ? 'patron_walk'
          : texture;
    super(scene, startTex, grid, iso, pathfinder, 75);
    this.profile = { ...data };
    this.patienceRemaining = data.patience;
    this.preferredDrinkName = drinkDisplayName || data.preferredDrink;

    // Content-matched height vs Luna (~48), not raw STAFF_DISPLAY_H (88).
    // Walk/idle must use setDisplaySize — never raw 112×192 (looks huge),
    // and never setScale(1) which undoes setDisplaySize.
    const displayH = PATRON_DISPLAY_H;
    const displayW = (PATRON_FRAME_W / PATRON_FRAME_H) * displayH;

    if (scene.textures.exists('patron_idle') || scene.textures.exists('patron_walk')) {
      this.setupSheetIdle({
        animKey: 'patron-idle-se',
        originY: PATRON_FEET_ORIGIN_Y,
        displayWidth: displayW,
        displayHeight: displayH,
        y: 6,
        walkAnimPrefix: 'patron-walk',
        idleAnimPrefix: 'patron-idle',
      });
    } else {
      this.sprite.setOrigin(0.5, 0.92);
      this.sheetDisplayW = displayW;
      this.sheetDisplayH = displayH;
      this.bindDisplaySizeGuard();
      this.sprite.setDisplaySize(displayW, displayH);
      this.sprite.y = -2;
    }
    // Belt-and-suspenders: re-assert after any texture bind / first play
    this.reapplyDisplaySize();
    if (Math.abs(this.sprite.displayHeight - PATRON_DISPLAY_H) > 0.5) {
      console.warn(
        `[Patron] displayHeight ${this.sprite.displayHeight} !== PATRON_DISPLAY_H ${PATRON_DISPLAY_H}`
      );
      this.reapplyDisplaySize();
    }

    this.refreshHitArea();
    this.ring = scene.add.ellipse(0, -2, 18, 8, 0x2ad6ff, 0.0);
    this.add(this.ring);
    this.ring.setDepth(-1);
    this.label = scene.add
      .text(0, -displayH - 8, data.name, {
        fontSize: '11px',
        color: '#ffe6ff',
        stroke: '#1a0a22',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.add(this.label);
  }

  /** Same Phaser frame-space hit area as Luna/Nova (generous mobile). */
  refreshHitArea(): void {
    const fw = this.sprite.width;
    const fh = this.sprite.height;
    const sx = Math.abs(this.sprite.scaleX) || 1;
    const sy = Math.abs(this.sprite.scaleY) || 1;
    const padX = Math.max(0, (64 / sx - fw) / 2);
    const padY = Math.max(0, (120 / sy - fh) / 2);
    const hit = new Phaser.Geom.Rectangle(-padX, -padY, fw + padX * 2, fh + padY * 2);
    this.sprite.setInteractive({
      hitArea: hit,
      hitAreaCallback: Phaser.Geom.Rectangle.Contains,
      useHandCursor: true,
    });
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.ring?.setFillStyle(0x2ad6ff, v ? 0.45 : 0);
  }

  showBubble(text: string): void {
    if (!this.label) return;
    this.label.setText(text);
    this.scene.time.delayedCall(1800, () => {
      if (this.label && this.active) this.label.setText(this.profile.name);
    });
  }

  /** Drain patience while waiting; returns true if patience ran out. */
  tickPatience(dtSec: number): boolean {
    if (!this.waiting || this.served) return false;
    this.patienceRemaining = Math.max(0, this.patienceRemaining - dtSec);
    return this.patienceRemaining <= 0;
  }

  /** 0–100 “ánimo de la noche” from remaining patience. */
  get nightMood(): number {
    const max = Math.max(1, this.profile.patience);
    return Math.round((this.patienceRemaining / max) * 100);
  }

  get displayName(): string {
    return this.profile.name;
  }

  /** Spanish-friendly action key for the info panel. */
  getActionKey(): string {
    if (this.goal === 'leave') return 'leaving';
    if (this.state === 'walking') return 'walking';
    if (this.served) return 'drinking';
    if (this.waiting) {
      return this.goal === 'sofa' ? 'relaxing' : 'waiting';
    }
    if (this.state === 'busy') return 'busy';
    return 'idle';
  }
}
