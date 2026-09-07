import Phaser from 'phaser';
import { IsoConfig, tileToScreen, depthForTile } from '../systems/IsoUtils';
import { GridPos, Pathfinder } from '../systems/Pathfinding';

export type CharacterState = 'idle' | 'walking' | 'busy' | 'resting';

export class Character extends Phaser.GameObjects.Container {
  grid: GridPos;
  state: CharacterState = 'idle';
  moveSpeed: number;
  public sprite: Phaser.GameObjects.Image;
  protected bobTween?: Phaser.Tweens.Tween;
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
    this.sprite = scene.add.image(0, -20, texture);
    this.sprite.setOrigin(0.5, 0.85);
    this.add(this.sprite);
    scene.add.existing(this);
    this.setDepth(depthForTile(grid.col, grid.row, 5));
    this.startBob();
  }

  startBob(): void {
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
    this.bobTween?.stop();
    this.sprite.y = -20;
  }

  walkTo(target: GridPos, onArrive?: () => void): boolean {
    const path = this.pathfinder.findPath(this.grid, target);
    if (path.length < 2) {
      if (path.length === 1 && path[0].col === target.col && path[0].row === target.row) {
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
    const screen = tileToScreen(next.col, next.row, this.iso);
    const dist = Phaser.Math.Distance.Between(this.x, this.y, screen.x, screen.y);
    const duration = Math.max(120, (dist / this.moveSpeed) * 1000);
    this.stopBob();
    this.scene.tweens.add({
      targets: this,
      x: screen.x,
      y: screen.y,
      duration,
      ease: 'Linear',
      onUpdate: () => {
        this.setDepth(depthForTile(next.col, next.row, 5));
      },
      onComplete: () => {
        this.grid = { ...next };
        this.setDepth(depthForTile(this.grid.col, this.grid.row, 5));
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
    this.setDepth(depthForTile(grid.col, grid.row, 5));
  }
}
