import Phaser from 'phaser';
import { Character } from './Character';
import { IsoConfig } from '../systems/IsoUtils';
import { Pathfinder, GridPos } from '../systems/Pathfinding';

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
    super(scene, texture, grid, iso, pathfinder, 75);
    this.profile = { ...data };
    this.patienceRemaining = data.patience;
    this.preferredDrinkName = drinkDisplayName || data.preferredDrink;
    this.sprite.setInteractive({ useHandCursor: true });
    this.ring = scene.add.ellipse(0, -4, 36, 14, 0x2ad6ff, 0.0);
    this.add(this.ring);
    this.ring.setDepth(-1);
    this.label = scene.add
      .text(0, -52, data.name, {
        fontSize: '11px',
        color: '#ffe6ff',
        stroke: '#1a0a22',
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    this.add(this.label);
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
