import Phaser from 'phaser';
import { Character } from './Character';
import { IsoConfig } from '../systems/IsoUtils';
import { Pathfinder, GridPos } from '../systems/Pathfinding';
import { STAFF_DISPLAY_H } from './Bartender';
import { AI_TUNABLES, scaledPatienceSeconds, STATUS_ES } from '../systems/AiTunables';

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

export type PatronGoal = 'wander' | 'sofa' | 'bar' | 'beer_tap' | 'leave';

/** Male client walk/idle sheets: 112×192 frames, feet near bottom. */
export const PATRON_FRAME_W = 112;
export const PATRON_FRAME_H = 192;
export const PATRON_FEET_ORIGIN_Y = (PATRON_FRAME_H - 2) / PATRON_FRAME_H;
/**
 * Luna/Nova sheets are 784px tall with large transparent padding, so
 * STAFF_DISPLAY_H is frame height (158) while *visible* body is ~84px.
 * Patron frames fill nearly the whole 192px — match Luna's visible body:
 *   158 * (417/784) * (192/188) ≈ 86
 */
export const LUNA_CONTENT_H = 417;
export const LUNA_FRAME_H_FOR_SCALE = 784;
export const PATRON_CONTENT_H = 188;
export const PATRON_DISPLAY_H = Math.round(
  STAFF_DISPLAY_H * (LUNA_CONTENT_H / LUNA_FRAME_H_FOR_SCALE) * (PATRON_FRAME_H / PATRON_CONTENT_H)
);

/** Sitting pose (sofa): single image at the hi-res idle's px scale (960 px frame = PATRON_DISPLAY_H). */
const CLIENT_SIT_TEX = 'client_hoodie_sit';
const CLIENT_SIT_PX_PER_DISPLAY_H = 960;
/** Buttocks-on-cushion anchor, from scripts/process_client_hoodie_sit.py. */
const CLIENT_SIT_ORIGIN_X = 0.7321;
const CLIENT_SIT_ORIGIN_Y = 0.568;
/** Fraction of the way from the front tile to the sofa footprint tile (screen space). */
const CLIENT_SIT_TOWARD_BACK = 0.62;
/** Cushion height above the floor in screen px (~0.45 m at 84 px per 1.75 m). */
const CLIENT_SIT_SEAT_H = 16;

export class Patron extends Character {
  profile: PatronData;
  goal: PatronGoal = 'wander';
  waiting = false;
  served = false;
  /** Sitting on a claimed sofa/chair seat (setter swaps in the sitting pose on the cushion). */
  private _seated = false;
  get seated(): boolean {
    return this._seated;
  }
  set seated(v: boolean) {
    if (this._seated === v) return;
    this._seated = v;
    this.applySitPose(v);
  }
  /** Sitting pose (client_hoodie_sit) shown on the sofa cushion while seated; the standing sprite is hidden. */
  private sitImage?: Phaser.GameObjects.Image;
  /** Left angry after patience ran out (no pay / low tip). */
  angry = false;
  /** Waiting too long — tip penalty + Impaciente label. */
  impatient = false;
  /** Claimed seat/queue tile key `col,row`. */
  claimedSlotKey: string | null = null;
  /** Furniture id when seated. */
  seatedFurnitureId: string | null = null;
  /** Remaining patience (seconds, scaled). Only drains while `waiting` (queued at the bar for a drink). */
  patienceRemaining: number;
  /** Max patience this visit (scaled from profile). */
  patienceMax: number;
  preferredDrinkName: string;
  /** Prompt A Phase 4: drink they most wanted this visit. */
  wantedDrinkId: string | null = null;
  /** Prompt A Phase 4: drink actually served (null if left empty-handed). */
  servedDrinkId: string | null = null;
  /** Prompt A Phase 4: preferred (or all) drinks were out of stock. */
  wasOutOfStock = false;
  /** Beer service preference hook: tap / bar / indifferent. */
  beerServicePref: 'tap' | 'bar' | 'indifferent' = 'indifferent';
  /** True when cerveza was served at the beer tap this visit. */
  servedAtBeerTap = false;
  /** True when this visit consumed botanas at a table. */
  ateSnack = false;
  selected = false;
  /** Staff who served this visit's drink (affinity goodbye thought). */
  servedByStaffId: string | null = null;
  /** scene.time.now when they started waiting for a drink (0 = not waiting). */
  waitSince = 0;
  /** Thought bubble (temporary, only on significant perceived events). */
  private thoughtBox?: Phaser.GameObjects.Container;
  private thoughtTimer?: Phaser.Time.TimerEvent;
  label?: Phaser.GameObjects.Text;
  /** Persistent Spanish status (Esperando, Impaciente, Sentado, …). */
  statusLabel?: Phaser.GameObjects.Text;
  private ring?: Phaser.GameObjects.Ellipse;
  private lastHitFw = 0;
  private lastHitFh = 0;

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
    this.patienceMax = scaledPatienceSeconds(data.patience);
    this.patienceRemaining = this.patienceMax;
    this.preferredDrinkName = drinkDisplayName || data.preferredDrink;

    // Content-matched height vs Luna (~84 visible), not raw STAFF_DISPLAY_H (158).
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
    // Idle SE/SW use a hi-res 560×960 sheet, walk/NE/NW use 112×192: the hit area lives in frame pixels,
    // so re-fit it whenever the texture (frame size) changes.
    this.sprite.on('animationstart', this.syncHitArea, this);
    this.sprite.on('animationupdate', this.syncHitArea, this);
    // The hoodie walk sheet only has the SE (semi-right) cycle: SW plays the same frames mirrored. Every other
    // anim (idle SW is a pre-mirrored frame, patron_walk has its own SW/NE/NW rows) must not be flipped.
    this.sprite.on('animationstart', this.syncWalkFlip, this);
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

    this.statusLabel = scene.add
      .text(0, -displayH + 6, '', {
        fontSize: '10px',
        color: '#9ef0ff',
        fontStyle: 'bold',
        stroke: '#1a0a22',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setVisible(false);
    this.add(this.statusLabel);
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

  private syncWalkFlip(anim: Phaser.Animations.Animation): void {
    const tex = anim?.frames?.[0]?.textureKey;
    this.sprite.setFlipX(anim?.key === 'patron-walk-sw' && tex === 'client_hoodie_walk');
  }

  /** Keep the click area at the same on-screen size when the frame size changes (see constructor). */
  private syncHitArea(): void {
    const rect = this.sprite.input?.hitArea as Phaser.Geom.Rectangle | undefined;
    if (!rect || this.sheetDisplayW <= 0) return;
    const fw = this.sprite.width;
    const fh = this.sprite.height;
    if (fw <= 0 || fh <= 0) return;
    if (rect.width > 0 && Math.abs(this.lastHitFw - fw) < 0.5 && Math.abs(this.lastHitFh - fh) < 0.5) return;
    const sx = this.sheetDisplayW / fw;
    const sy = this.sheetDisplayH / fh;
    const padX = Math.max(0, (64 / sx - fw) / 2);
    const padY = Math.max(0, (120 / sy - fh) / 2);
    rect.setTo(-padX, -padY, fw + padX * 2, fh + padY * 2);
    this.lastHitFw = fw;
    this.lastHitFh = fh;
  }

  /**
   * Seated: the patron stands on the sofa's FRONT tile (row + 1 = SW side), so the cushion is one tile
   * up-right on screen (+tileW/2, -tileH/2). Put the buttocks ~70% of the way there (toward the seat front)
   * and lift them by the seat height. Legs hang toward SW = the sofa's facing. Depth stays the front tile's
   * character depth, which already draws above the sofa.
   */
  private applySitPose(on: boolean): void {
    if (!this.scene || !this.scene.textures.exists(CLIENT_SIT_TEX)) return;
    if (on) {
      if (!this.sitImage) {
        this.sitImage = this.scene.add
          .image(0, 0, CLIENT_SIT_TEX)
          .setOrigin(CLIENT_SIT_ORIGIN_X, CLIENT_SIT_ORIGIN_Y)
          .setScale(PATRON_DISPLAY_H / CLIENT_SIT_PX_PER_DISPLAY_H);
        this.sitImage.setInteractive({ useHandCursor: true });
        // Forward taps so selection works exactly like on the standing sprite.
        this.sitImage.on('pointerdown', (...a: unknown[]) => this.sprite.emit('pointerdown', ...a));
        this.sitImage.on('pointerup', (...a: unknown[]) => this.sprite.emit('pointerup', ...a));
        this.addAt(this.sitImage, Math.max(0, this.getIndex(this.sprite)));
      }
      const hw = this.iso.tileWidth / 2;
      const hh = this.iso.tileHeight / 2;
      this.sitImage.setPosition(hw * CLIENT_SIT_TOWARD_BACK, -hh * CLIENT_SIT_TOWARD_BACK - CLIENT_SIT_SEAT_H);
      this.sitImage.setVisible(true);
      this.sprite.setVisible(false);
    } else {
      this.sitImage?.setVisible(false);
      this.sprite.setVisible(true);
    }
  }

  setSelected(v: boolean): void {
    this.selected = v;
    this.ring?.setFillStyle(0x2ad6ff, v ? 0.45 : 0);
  }

  /** True while a thought bubble is visible. */
  get thoughtVisible(): boolean {
    return !!this.thoughtBox && this.thoughtBox.visible;
  }

  /** Temporary thought bubble (text + emoji) above the head; replaces any previous one. */
  showThought(text: string, emoji: string, ms = 3400, tone: 'pos' | 'neg' | 'neutral' = 'neutral'): void {
    if (!this.scene || !this.active) return;
    this.clearThought();
    const y = -PATRON_DISPLAY_H - 34;
    const box = this.scene.add.container(0, y);
    const txt = this.scene.add
      .text(0, 0, text, {
        fontSize: '10px',
        color: '#1a0a22',
        wordWrap: { width: 132 },
        align: 'center',
      })
      .setOrigin(0.5, 1);
    const w = Math.min(150, txt.width + 14);
    const h = txt.height + 8;
    const border = tone === 'neg' ? 0xff6b6b : tone === 'pos' ? 0x6bdc8a : 0xbfa8ff;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0xfff8ee, 0.96);
    bg.lineStyle(2, border, 1);
    bg.fillRoundedRect(-w / 2, -h - 2, w, h, 7);
    bg.strokeRoundedRect(-w / 2, -h - 2, w, h, 7);
    bg.fillStyle(0xfff8ee, 0.96);
    bg.fillCircle(-6, 3, 3);
    bg.fillCircle(-2, 8, 2);
    txt.setY(-6);
    const emo = this.scene.add.text(w / 2 - 2, -h - 6, emoji, { fontSize: '18px' }).setOrigin(0.5, 0.5);
    box.add([bg, txt, emo]);
    this.add(box);
    this.thoughtBox = box;
    box.setAlpha(0);
    this.scene.tweens.add({ targets: box, alpha: 1, y: y - 4, duration: 220 });
    this.thoughtTimer = this.scene.time.delayedCall(ms, () => this.clearThought());
  }

  clearThought(): void {
    this.thoughtTimer?.remove(false);
    this.thoughtTimer = undefined;
    if (this.thoughtBox) {
      if (this.scene) this.scene.tweens.killTweensOf(this.thoughtBox);
      this.thoughtBox.destroy();
      this.thoughtBox = undefined;
    }
  }

  showBubble(text: string): void {
    if (!this.label) return;
    this.label.setText(text);
    this.scene.time.delayedCall(1800, () => {
      if (this.label && this.active) this.label.setText(this.profile.name);
    });
  }

  /**
   * Drain patience while waiting for bar service (not seated / served / leaving).
   * Marks Impaciente below ratio; returns true when patience hits 0 (Enfadado).
   */
  tickPatience(dtSec: number): boolean {
    if (!this.waiting || this.served || this.seated || this.angry || this.goal === 'leave') {
      return false;
    }
    this.patienceRemaining = Math.max(0, this.patienceRemaining - dtSec);
    const ratio = this.patienceRemaining / Math.max(0.01, this.patienceMax);
    if (this.patienceRemaining <= 0) {
      this.angry = true;
      this.impatient = true;
      this.refreshStatusLabel();
      return true;
    }
    this.impatient = ratio < AI_TUNABLES.impatientAtRatio;
    this.refreshStatusLabel();
    return false;
  }

  /** 0–100 “ánimo de la noche” from remaining patience. */
  get nightMood(): number {
    if (this.angry) return 12;
    const max = Math.max(1, this.patienceMax);
    return Math.round((this.patienceRemaining / max) * 100);
  }

  get displayName(): string {
    return this.profile.name;
  }

  /** Spanish-friendly action key for the info panel / floating status. */
  getActionKey(): string {
    if (this.angry) return 'angry';
    if (this.goal === 'leave') return 'leaving';
    if (this.state === 'walking' && !this.waiting && !this.seated) return 'walking';
    if (this.served) return 'drinking';
    if (this.seated) return 'seated';
    if (this.waiting) {
      if (this.impatient) return 'impatient';
      return this.goal === 'sofa' ? 'seated' : 'waiting';
    }
    if (this.state === 'busy') return 'waiting';
    return 'idle';
  }

  /** Update floating Spanish status under the name. */
  refreshStatusLabel(): void {
    if (!this.statusLabel) return;
    const key = this.getActionKey();
    const text = STATUS_ES[key] || '';
    const show =
      key === 'waiting' ||
      key === 'impatient' ||
      key === 'angry' ||
      key === 'seated' ||
      key === 'drinking' ||
      key === 'relaxing';
    if (!show || !text) {
      this.statusLabel.setVisible(false);
      return;
    }
    this.statusLabel.setText(text);
    this.statusLabel.setVisible(true);
    if (key === 'angry') this.statusLabel.setColor('#ff6b6b');
    else if (key === 'impatient') this.statusLabel.setColor('#ffb347');
    else if (key === 'seated' || key === 'relaxing') this.statusLabel.setColor('#b8f7c0');
    else if (key === 'waiting') this.statusLabel.setColor('#9ef0ff');
    else this.statusLabel.setColor('#ffe066');
  }
}
