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
/** Full-body display height (furniture-matched). Frame height — Luna/Nova sheets have large transparent padding, so visible body is ~47–54px. */
export const LUNA_DISPLAY_H = 88;
/** Alias used by patrons / asserts (same value as LUNA_DISPLAY_H). */
export const STAFF_DISPLAY_H = LUNA_DISPLAY_H;

/** Nova idle sheet: same 1168×784 / 8×146 layout; feet near y=610. */
export const NOVA_IDLE_FRAME_W = 146;
export const NOVA_IDLE_FRAME_H = 784;
export const NOVA_FEET_ORIGIN_Y = 610 / 784;

export type StaffAiJob = 'none' | 'serve' | 'clean' | 'rest' | 'wander' | 'player';

export class Bartender extends Character {
  profile: BartenderData;
  selected = false;
  /** Player tap-move / bar menu / Descansar — AI pauses until cleared. */
  playerCommanded = false;
  aiJob: StaffAiJob = 'none';
  /** Next time (scene.time.now) this staff may pick a new AI job. */
  aiNextThinkAt = 0;
  /** Drink id currently being prepared (cerveza, etc.), or null. */
  servingDrinkId: string | null = null;
  private ring?: Phaser.GameObjects.Ellipse;
  private serveLabel?: Phaser.GameObjects.Text;

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
        y: 6,
      });
      this.ring.setPosition(0, -2);
      this.ring.setSize(18, 8);
    } else if (texture === 'nova_idle' || texture === 'nova') {
      // Hireable maid — same on-screen height as Luna (~88px), idle sheet preferred
      const displayH = LUNA_DISPLAY_H;
      const displayW = (NOVA_IDLE_FRAME_W / NOVA_IDLE_FRAME_H) * displayH;
      if (texture === 'nova_idle') {
        this.setupSheetIdle({
          animKey: 'nova-idle',
          originY: NOVA_FEET_ORIGIN_Y,
          displayWidth: displayW,
          displayHeight: displayH,
          y: 6,
        });
      } else {
        this.sprite.setOrigin(0.5, 0.92);
        this.sprite.setDisplaySize(displayW, displayH);
        this.sprite.y = -2;
      }
      this.ring.setPosition(0, -2);
      this.ring.setSize(18, 8);
    }
    // Hit area must match display size (sheet frames are ~146×784 — raw hitbox
    // was huge / misaligned). Call after setupSheetIdle / setDisplaySize.
    this.refreshHitArea();
  }

  /**
   * Phaser hit tests use unscaled frame space with (0,0)=top-left
   * (after adding displayOrigin). Do NOT use displayWidth/origin offsets —
   * that misaligns the rect and makes staff untappable.
   * Expand in source pixels so the on-screen zone is fat-finger friendly.
   */
  refreshHitArea(): void {
    const fw = this.sprite.width;
    const fh = this.sprite.height;
    const sx = Math.abs(this.sprite.scaleX) || 1;
    const sy = Math.abs(this.sprite.scaleY) || 1;
    // Target ~64×120 screen px (generous mobile hit)
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
    this.ring?.setFillStyle(0xff3ca0, v ? 0.45 : 0);
  }

  canServe(): boolean {
    return (
      !this.playerCommanded &&
      this.state === 'idle' &&
      this.aiJob === 'none' &&
      this.profile.energy >= this.profile.energyDrainPerServe
    );
  }

  /** True when AI may assign a new autonomous job. */
  isAiAvailable(): boolean {
    return (
      !this.playerCommanded &&
      this.aiJob === 'none' &&
      (this.state === 'idle' || this.state === 'walking')
    );
  }

  beginPlayerCommand(job: StaffAiJob = 'player'): void {
    this.playerCommanded = true;
    this.aiJob = job;
  }

  clearPlayerCommand(): void {
    this.playerCommanded = false;
    if (this.aiJob === 'player') this.aiJob = 'none';
  }

  clearAiJob(): void {
    this.aiJob = 'none';
    this.playerCommanded = false;
    this.servingDrinkId = null;
    this.clearServeLabel();
  }

  /** Panel / roster state key (Spanish labels live in UIScene). */
  getAiStateKey(): string {
    if (this.playerCommanded && this.state === 'walking') return 'walking';
    switch (this.aiJob) {
      case 'serve':
        if (this.servingDrinkId === 'cerveza') return 'serving_cerveza';
        if (this.servingDrinkId) return 'serving_drink';
        return 'serving';
      case 'clean':
        return 'cleaning';
      case 'rest':
        return this.state === 'resting' ? 'resting' : 'walking';
      case 'wander':
        return 'wandering';
      case 'player':
        return this.state === 'walking' ? 'walking' : this.state;
      default:
        return this.state;
    }
  }

  /** Floating prep label above head (Spanish). */
  setServeLabel(text: string | null): void {
    if (!text) {
      this.clearServeLabel();
      return;
    }
    const y = -(this.sheetDisplayH || LUNA_DISPLAY_H) - 10;
    if (!this.serveLabel) {
      this.serveLabel = this.scene.add
        .text(0, y, text, {
          fontSize: '11px',
          color: '#ffe066',
          fontStyle: 'bold',
          stroke: '#1a0a22',
          strokeThickness: 3,
        })
        .setOrigin(0.5);
      this.add(this.serveLabel);
    } else {
      this.serveLabel.setText(text);
      this.serveLabel.setY(y);
      this.serveLabel.setVisible(true);
    }
  }

  clearServeLabel(): void {
    if (this.serveLabel) {
      this.serveLabel.destroy();
      this.serveLabel = undefined;
    }
  }

  /**
   * Play beer-pour sheet (~2s) for Luna or Nova. Returns false if sheet/anim
   * missing (falls back to idle bob).
   */
  playServeBeerAnim(): boolean {
    const tex = this.sprite.texture.key;
    const isLuna =
      this.profile.id === 'bartender_luna' || tex.startsWith('luna');
    const isNova =
      this.profile.id === 'staff_nova' || tex.startsWith('nova');

    let key: string | null = null;
    let originY = LUNA_FEET_ORIGIN_Y;
    if (isLuna) {
      key = 'luna-serve-beer';
      if (!this.scene.anims.exists(key) || !this.scene.textures.exists('luna_serve_beer')) {
        return false;
      }
      originY = LUNA_FEET_ORIGIN_Y;
    } else if (isNova) {
      key = 'nova-serve-beer';
      if (!this.scene.anims.exists(key) || !this.scene.textures.exists('nova_serve_beer')) {
        return false;
      }
      // Same idle-tuned feet origin (~610/784); displayH 88
      originY = NOVA_FEET_ORIGIN_Y;
    } else {
      return false;
    }

    this.bobTween?.stop();
    this.bobTween = undefined;
    this.sprite.play(key, true);
    this.reapplyDisplaySize();
    this.sprite.setOrigin(0.5, originY);
    return true;
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
