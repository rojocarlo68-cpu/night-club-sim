import Phaser from 'phaser';
import { IsoConfig, tileToScreen, depthForCharacter } from '../systems/IsoUtils';
import { GridPos, Pathfinder } from '../systems/Pathfinding';

export type CharacterState = 'idle' | 'walking' | 'busy' | 'resting';
export type IsoFacing = 'se' | 'sw' | 'ne' | 'nw';

export class Character extends Phaser.GameObjects.Container {
  grid: GridPos;
  state: CharacterState = 'idle';
  moveSpeed: number;
  public sprite: Phaser.GameObjects.Sprite;
  protected bobTween?: Phaser.Tweens.Tween;
  protected useSheetIdle = false;
  protected idleAnimKey: string | null = null;
  /** When set, randomly pick among these idle anims after each loop. */
  protected idleAnimPool: string[] | null = null;
  /** Prefix for directional walk anims: `${prefix}-${facing}` e.g. patron-walk-se */
  protected walkAnimPrefix: string | null = null;
  /** Prefix for directional idle: `${prefix}-${facing}`; falls back to idleAnimKey. */
  protected idleAnimPrefix: string | null = null;
  /** Persist display size across texture swaps (idle ↔ walk ↔ serve). */
  protected sheetDisplayW = 0;
  protected sheetDisplayH = 0;
  facing: IsoFacing = 'se';
  private path: GridPos[] = [];
  private pathIndex = 0;
  private onArrive?: () => void;

  constructor(
    scene: Phaser.Scene,
    texture: string,
    grid: GridPos,
    protected iso: IsoConfig,
    protected pathfinder: Pathfinder,
    moveSpeed = 90
  ) {
    const pos = tileToScreen(grid.col, grid.row, iso);
    super(scene, pos.x, pos.y);
    this.grid = { ...grid };
    this.moveSpeed = moveSpeed;
    this.sprite = scene.add.sprite(0, -20, texture);
    this.sprite.setOrigin(0.5, 0.85);
    this.add(this.sprite);
    scene.add.existing(this);
    this.setDepth(depthForCharacter(grid.col, grid.row));
    this.startBob();
  }

  /** Configure Luna (or other) spritesheet idle: feet origin + scale + loop anim. */
  setupSheetIdle(opts: {
    animKey: string;
    /** Extra idle anim keys; when present, randomly alternate after each loop. */
    altAnimKeys?: string[];
    originX?: number;
    originY: number;
    displayWidth: number;
    displayHeight: number;
    y?: number;
    walkAnimPrefix?: string;
    idleAnimPrefix?: string;
  }): void {
    this.useSheetIdle = true;
    this.idleAnimKey = opts.animKey;
    this.idleAnimPool =
      opts.altAnimKeys && opts.altAnimKeys.length > 0
        ? [opts.animKey, ...opts.altAnimKeys]
        : null;
    this.walkAnimPrefix = opts.walkAnimPrefix ?? null;
    this.idleAnimPrefix = opts.idleAnimPrefix ?? null;
    this.sheetDisplayW = opts.displayWidth;
    this.sheetDisplayH = opts.displayHeight;
    this.bobTween?.stop();
    this.bobTween = undefined;
    this.sprite.setOrigin(opts.originX ?? 0.5, opts.originY);
    this.bindDisplaySizeGuard();
    this.reapplyDisplaySize();
    this.sprite.y = opts.y ?? 0;
    this.sprite.off('animationcomplete', this.onSheetIdleComplete, this);
    if (this.idleAnimPool) {
      this.sprite.on('animationcomplete', this.onSheetIdleComplete, this);
    }
    this.playSheetIdle(true);
  }

  /** Re-apply sheet display size after setTexture/play (Phaser can reset to frame size / scale 1). */
  reapplyDisplaySize(): void {
    if (this.sheetDisplayW > 0 && this.sheetDisplayH > 0) {
      // Prefer setDisplaySize over setScale(1) — native frames (e.g. 112×192) look huge.
      this.sprite.setDisplaySize(this.sheetDisplayW, this.sheetDisplayH);
    }
  }

  /** Keep display size locked across every animation frame / texture swap. */
  protected bindDisplaySizeGuard(): void {
    this.sprite.off('animationupdate', this.reapplyDisplaySize, this);
    this.sprite.off('animationstart', this.reapplyDisplaySize, this);
    this.sprite.on('animationupdate', this.reapplyDisplaySize, this);
    this.sprite.on('animationstart', this.reapplyDisplaySize, this);
  }

  /** Pick a random idle from the pool (or the single / facing key) and play it. */
  protected playSheetIdle(force = false): void {
    const pool = this.idleAnimPool;
    let key = this.idleAnimKey;
    if (this.idleAnimPrefix) {
      const facingKey = `${this.idleAnimPrefix}-${this.facing}`;
      if (this.scene.anims.exists(facingKey)) key = facingKey;
    }
    if (pool && pool.length > 0) {
      key = pool[Math.floor(Math.random() * pool.length)] ?? key;
    }
    if (!key || !this.scene.anims.exists(key)) return;
    this.idleAnimKey = key;
    this.sprite.play(key, force);
    this.reapplyDisplaySize();
  }

  private onSheetIdleComplete(
    anim: Phaser.Animations.Animation,
    _frame: Phaser.Animations.AnimationFrame
  ): void {
    if (!this.useSheetIdle || !this.idleAnimPool) return;
    if (!this.idleAnimPool.includes(anim.key)) return;
    if (this.state === 'walking') return;
    this.playSheetIdle(true);
  }

  protected facingFromStep(from: GridPos, to: GridPos): IsoFacing {
    const dc = to.col - from.col;
    const dr = to.row - from.row;
    if (Math.abs(dc) >= Math.abs(dr)) {
      return dc >= 0 ? 'se' : 'nw';
    }
    return dr >= 0 ? 'sw' : 'ne';
  }

  protected playWalkFacing(facing: IsoFacing): void {
    this.facing = facing;
    if (!this.walkAnimPrefix) return;
    const key = `${this.walkAnimPrefix}-${facing}`;
    if (this.scene.anims.exists(key)) {
      this.sprite.play(key, true);
      this.reapplyDisplaySize();
    }
  }

  startBob(): void {
    if (this.useSheetIdle && (this.idleAnimKey || this.idleAnimPrefix)) {
      this.playSheetIdle(true);
      return;
    }
    this.bobTween?.stop();
    this.bobTween = this.scene.tweens.add({
      targets: this.sprite,
      y: -22,
      duration: 700,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  stopBob(): void {
    if (this.useSheetIdle) {
      this.sprite.stop();
      // Keep current frame (walk mid-stride or idle) — don't force frame 0
      return;
    }
    this.bobTween?.stop();
    this.sprite.y = -20;
  }

  /** Cancel in-flight path tweens so a new walkTo can take over. */
  cancelWalk(): void {
    this.path = [];
    this.pathIndex = 0;
    this.onArrive = undefined;
    this.scene.tweens.killTweensOf(this);
  }

  walkTo(target: GridPos, onArrive?: () => void): boolean {
    this.cancelWalk();
    const path = this.pathfinder.findPath(this.grid, target);
    if (path.length < 2) {
      if (path.length === 1) {
        onArrive?.();
        return true;
      }
      return false;
    }
    this.path = path.slice(1);
    this.pathIndex = 0;
    this.onArrive = onArrive;
    this.state = 'walking';
    this.followPath();
    return true;
  }

  private followPath(): void {
    if (this.pathIndex >= this.path.length) {
      this.state = 'idle';
      this.startBob();
      const cb = this.onArrive;
      this.onArrive = undefined;
      cb?.();
      return;
    }
    const next = this.path[this.pathIndex++];
    const facing = this.facingFromStep(this.grid, next);
    this.playWalkFacing(facing);
    const screen = tileToScreen(next.col, next.row, this.iso);
    const dist = Phaser.Math.Distance.Between(this.x, this.y, screen.x, screen.y);
    const duration = Math.max(120, (dist / this.moveSpeed) * 1000);
    if (!this.walkAnimPrefix) this.stopBob();
    else {
      this.bobTween?.stop();
      this.bobTween = undefined;
    }
    this.scene.tweens.add({
      targets: this,
      x: screen.x,
      y: screen.y,
      duration,
      ease: 'Linear',
      onUpdate: () => {
        this.setDepth(depthForCharacter(next.col, next.row));
      },
      onComplete: () => {
        this.grid = { ...next };
        this.setDepth(depthForCharacter(this.grid.col, this.grid.row));
        this.followPath();
      },
    });
  }

  setPathfinder(pf: Pathfinder): void {
    this.pathfinder = pf;
  }

  snapTo(grid: GridPos): void {
    this.grid = { ...grid };
    const p = tileToScreen(grid.col, grid.row, this.iso);
    this.setPosition(p.x, p.y);
    this.setDepth(depthForCharacter(grid.col, grid.row));
  }
}
