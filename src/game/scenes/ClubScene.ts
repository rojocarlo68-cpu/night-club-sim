import Phaser from 'phaser';
import { IsoConfig, tileToScreen, depthForTile } from '../systems/IsoUtils';
import { Pathfinder } from '../systems/Pathfinding';
import { Bartender, BartenderData } from '../entities/Bartender';
import { Patron, PatronData } from '../entities/Patron';

interface Drink {
  id: string;
  name: string;
  price: number;
  serveTimeMs: number;
}

interface FurnitureDef {
  id: string;
  type: string;
  sprite: string;
  tile: [number, number];
  footprint: [number, number];
  interact?: [number, number];
  staffSpot?: [number, number];
  restSpot?: [number, number];
}

interface Scenario {
  id: string;
  title: string;
  startingMoney: number;
  nightDurationSec: number;
  patronSpawnCount: [number, number];
  spawnIntervalMs: number;
  map: { cols: number; rows: number; tileWidth: number; tileHeight: number };
  blocked: [number, number][];
  furniture: FurnitureDef[];
  spawnTile: [number, number];
  exitTile: [number, number];
  drinks: Drink[];
}

interface CharactersFile {
  bartender: BartenderData & { sprite: string; role: string };
  patrons: PatronData[];
}

export type NightPhase = 'prep' | 'open' | 'summary';

export class ClubScene extends Phaser.Scene {
  iso!: IsoConfig;
  pathfinder!: Pathfinder;
  scenario!: Scenario;
  chars!: CharactersFile;
  bartender!: Bartender;
  patrons: Patron[] = [];
  money = 0;
  nightEarned = 0;
  servedCount = 0;
  phase: NightPhase = 'prep';
  nightTimer = 0;
  private spawnLeft = 0;
  private queueTiles: Set<string> = new Set();
  private barInteract!: { col: number; row: number };
  private sofaRest!: { col: number; row: number };
  private staffSpot!: { col: number; row: number };
  private drinks: Drink[] = [];

  constructor() {
    super('ClubScene');
  }

  create(): void {
    this.scenario = this.cache.json.get('scenario') as Scenario;
    this.chars = this.cache.json.get('characters') as CharactersFile;
    this.money = this.scenario.startingMoney;
    this.nightEarned = 0;
    this.servedCount = 0;
    this.phase = 'prep';
    this.patrons = [];
    this.drinks = this.scenario.drinks;

    const { cols, rows, tileWidth, tileHeight } = this.scenario.map;
    const originX = this.cameras.main.width / 2;
    const originY = 90;
    this.iso = { tileWidth, tileHeight, originX, originY };

    const blocked = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
    this.scenario.furniture.forEach((f) => {
      for (let dc = 0; dc < f.footprint[0]; dc++) {
        for (let dr = 0; dr < f.footprint[1]; dr++) {
          blocked.add(`${f.tile[0] + dc},${f.tile[1] + dr}`);
        }
      }
    });
    this.pathfinder = new Pathfinder(cols, rows, blocked);

    this.drawRoom(cols, rows);
    this.placeFurniture();

    const bar = this.scenario.furniture.find((f) => f.type === 'bar')!;
    const sofa = this.scenario.furniture.find((f) => f.type === 'sofa')!;
    this.barInteract = { col: bar.interact![0], row: bar.interact![1] };
    this.staffSpot = { col: bar.staffSpot![0], row: bar.staffSpot![1] };
    this.sofaRest = { col: sofa.restSpot![0], row: sofa.restSpot![1] };

    const bd = this.chars.bartender;
    this.bartender = new Bartender(
      this,
      bd.sprite || 'bartender',
      { ...this.staffSpot },
      this.iso,
      this.pathfinder,
      bd
    );
    this.bartender.sprite.on('pointerdown', () => {
      this.bartender.setSelected(true);
      this.game.events.emit('select-bartender', this.bartender);
    });

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) return;
      // deselect if clicking empty
    });

    this.cameras.main.setBackgroundColor('#0a0612');
    // Ambient neon glow
    this.add
      .rectangle(originX, originY + 180, 520, 360, 0xff3ca0, 0.04)
      .setDepth(0);

    this.game.events.emit('club-ready', this.getHudState());
    this.game.events.on('cmd-open-night', this.openNight, this);
    this.game.events.on('cmd-close-night', this.closeNight, this);
    this.game.events.on('cmd-rest', this.orderRest, this);
  }

  private drawRoom(cols: number, rows: number): void {
    const blockedWall = new Set(this.scenario.blocked.map(([c, r]) => `${c},${r}`));
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const { x, y } = tileToScreen(col, row, this.iso);
        const isWall = blockedWall.has(`${col},${row}`);
        const edge =
          col === 0 || row === 0 || col === cols - 1 || row === rows - 1;
        if (isWall && edge) {
          const wall = this.add.image(x, y - 8, 'tile_wall');
          wall.setDepth(depthForTile(col, row, 1));
        } else if (!isWall) {
          const tile = this.add.image(x, y, 'tile_floor');
          tile.setDepth(depthForTile(col, row, 0));
          // warm bar light tint near bar
          if (col >= 5 && row <= 5) tile.setTint(0xffe0cc);
        }
      }
    }
  }

  private placeFurniture(): void {
    for (const f of this.scenario.furniture) {
      const { x, y } = tileToScreen(f.tile[0], f.tile[1], this.iso);
      const key = f.type === 'bar' ? 'furn_bar' : 'furn_sofa';
      const img = this.add.image(x, y - 10, key);
      img.setDepth(depthForTile(f.tile[0], f.tile[1], 3));
      if (f.type === 'bar') {
        // warm light
        const glow = this.add.circle(x, y - 20, 40, 0xffaa44, 0.12);
        glow.setDepth(depthForTile(f.tile[0], f.tile[1], 2));
      }
    }
  }

  openNight = (): void => {
    if (this.phase !== 'prep' && this.phase !== 'summary') return;
    if (this.phase === 'summary') {
      this.resetForNewNight();
    }
    this.phase = 'open';
    this.nightEarned = 0;
    this.servedCount = 0;
    this.nightTimer = this.scenario.nightDurationSec;
    const [min, max] = this.scenario.patronSpawnCount;
    this.spawnLeft = Phaser.Math.Between(min, max);
    this.game.events.emit('night-started', this.getHudState());
    this.scheduleSpawns();
  };

  private resetForNewNight(): void {
    this.patrons.forEach((p) => p.destroy());
    this.patrons = [];
    this.bartender.snapTo(this.staffSpot);
    this.bartender.state = 'idle';
    this.bartender.profile.energy = Math.min(100, this.bartender.profile.energy + 25);
    this.bartender.startBob();
  }

  private scheduleSpawns(): void {
    if (this.phase !== 'open' || this.spawnLeft <= 0) return;
    this.time.delayedCall(400, () => this.spawnPatron());
    for (let i = 1; i < this.spawnLeft; i++) {
      this.time.delayedCall(400 + i * this.scenario.spawnIntervalMs, () => {
        if (this.phase === 'open') this.spawnPatron();
      });
    }
  }

  private spawnPatron(): void {
    if (this.spawnLeft <= 0 || this.phase !== 'open') return;
    this.spawnLeft--;
    const pool = this.chars.patrons;
    const pdata = { ...pool[Phaser.Math.Between(0, pool.length - 1)] };
    pdata.id = `${pdata.id}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const spawn = {
      col: this.scenario.spawnTile[0],
      row: this.scenario.spawnTile[1],
    };
    const patron = new Patron(
      this,
      pdata.sprite,
      spawn,
      this.iso,
      this.pathfinder,
      pdata
    );
    this.patrons.push(patron);

    const goSofa = Math.random() < 0.35;
    if (goSofa) {
      patron.goal = 'sofa';
      const spot = this.findFreeNear(this.sofaRest);
      patron.walkTo(spot, () => {
        patron.waiting = true;
        patron.showBubble('😌');
        this.time.delayedCall(4000 + Math.random() * 3000, () => {
          if (!patron.active || this.phase !== 'open') return;
          this.sendPatronHome(patron);
        });
      });
    } else {
      patron.goal = 'bar';
      const spot = this.findFreeNear(this.barInteract);
      patron.walkTo(spot, () => {
        patron.waiting = true;
        const drink = this.drinks.find((d) => d.id === pdata.preferredDrink) || this.drinks[0];
        patron.showBubble(drink.name);
        this.tryServe(patron, drink);
      });
    }
  }

  private findFreeNear(center: { col: number; row: number }): { col: number; row: number } {
    const candidates = [
      center,
      { col: center.col - 1, row: center.row },
      { col: center.col, row: center.row + 1 },
      { col: center.col - 1, row: center.row + 1 },
      { col: center.col + 1, row: center.row },
    ];
    for (const c of candidates) {
      const k = `${c.col},${c.row}`;
      if (this.pathfinder.isWalkable(c.col, c.row) && !this.queueTiles.has(k)) {
        this.queueTiles.add(k);
        return c;
      }
    }
    return center;
  }

  private releaseTile(pos: { col: number; row: number }): void {
    this.queueTiles.delete(`${pos.col},${pos.row}`);
  }

  private tryServe(patron: Patron, drink: Drink): void {
    if (this.phase !== 'open' || !patron.active) return;
    if (!this.bartender.canServe()) {
      // wait and retry
      this.time.delayedCall(800, () => {
        if (patron.active && patron.waiting && !patron.served) this.tryServe(patron, drink);
      });
      return;
    }
    if (this.bartender.state !== 'idle') {
      this.time.delayedCall(600, () => {
        if (patron.active && patron.waiting && !patron.served) this.tryServe(patron, drink);
      });
      return;
    }

    this.bartender.state = 'busy';
    this.bartender.walkTo(this.staffSpot, () => {
      this.bartender.stopBob();
      const skillBonus = this.bartender.skill / 200;
      const serveTime = drink.serveTimeMs * (1 - skillBonus * 0.3);
      this.time.delayedCall(serveTime, () => {
        if (!patron.active || this.phase !== 'open') {
          this.bartender.state = 'idle';
          this.bartender.startBob();
          return;
        }
        this.bartender.applyServeDrain();
        let earned = drink.price;
        if (Math.random() < patron.profile.tipChance) {
          earned += Math.ceil(drink.price * 0.25);
          patron.showBubble('¡Propina!');
        } else {
          patron.showBubble('¡Gracias!');
        }
        this.money += earned;
        this.nightEarned += earned;
        this.servedCount++;
        patron.served = true;
        patron.waiting = false;
        this.releaseTile(patron.grid);
        this.bartender.state = 'idle';
        this.bartender.startBob();
        this.game.events.emit('stats-updated', this.getHudState());

        this.time.delayedCall(600, () => this.sendPatronHome(patron));
      });
    });
  }

  private sendPatronHome(patron: Patron): void {
    if (!patron.active) return;
    patron.waiting = false;
    this.releaseTile(patron.grid);
    patron.goal = 'leave';
    const exit = {
      col: this.scenario.exitTile[0],
      row: this.scenario.exitTile[1],
    };
    patron.walkTo(exit, () => {
      this.patrons = this.patrons.filter((p) => p !== patron);
      patron.destroy();
    });
  }

  orderRest = (): void => {
    if (!this.bartender || this.bartender.state === 'walking' || this.bartender.state === 'busy') {
      return;
    }
    if (this.bartender.state === 'resting') return;
    this.bartender.setSelected(true);
    this.game.events.emit('select-bartender', this.bartender);
    this.bartender.state = 'busy';
    this.bartender.walkTo(this.sofaRest, () => {
      this.bartender.state = 'resting';
      this.bartender.stopBob();
      const dur = this.bartender.profile.restDurationMs;
      this.game.events.emit('bartender-resting', true);
      this.time.delayedCall(dur, () => {
        this.bartender.applyRest();
        this.bartender.state = 'idle';
        this.bartender.startBob();
        this.bartender.walkTo(this.staffSpot, () => {
          this.game.events.emit('stats-updated', this.getHudState());
          this.game.events.emit('bartender-resting', false);
        });
      });
    });
  };

  closeNight = (): void => {
    if (this.phase !== 'open') return;
    this.finishNight();
  };

  private finishNight(): void {
    this.phase = 'summary';
    this.patrons.forEach((p) => {
      this.releaseTile(p.grid);
      p.destroy();
    });
    this.patrons = [];
    this.queueTiles.clear();
    this.bartender.state = 'idle';
    this.bartender.snapTo(this.staffSpot);
    this.bartender.startBob();
    this.game.events.emit('night-summary', {
      ...this.getHudState(),
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
    });
  }

  getHudState() {
    return {
      money: this.money,
      phase: this.phase,
      nightTimer: Math.ceil(this.nightTimer),
      bartender: this.bartender
        ? {
            name: this.bartender.displayName,
            energy: Math.round(this.bartender.energy),
            mood: Math.round(this.bartender.mood),
            skill: Math.round(this.bartender.skill),
            state: this.bartender.state,
          }
        : null,
      nightEarned: this.nightEarned,
      servedCount: this.servedCount,
    };
  }

  update(_t: number, dt: number): void {
    if (this.phase !== 'open') return;
    this.nightTimer -= dt / 1000;
    if (Math.floor(this.nightTimer * 2) !== Math.floor((this.nightTimer + dt / 1000) * 2)) {
      this.game.events.emit('stats-updated', this.getHudState());
    }
    if (this.nightTimer <= 0) {
      this.nightTimer = 0;
      this.finishNight();
    }
  }

  shutdown(): void {
    this.game.events.off('cmd-open-night', this.openNight, this);
    this.game.events.off('cmd-close-night', this.closeNight, this);
    this.game.events.off('cmd-rest', this.orderRest, this);
  }
}

