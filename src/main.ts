import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { ClubScene } from './game/scenes/ClubScene';
import { UIScene } from './game/scenes/UIScene';
import { TitleScene } from './game/scenes/TitleScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#1a1411',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 640,
  },
  scene: [BootScene, ClubScene, UIScene, TitleScene],
  render: {
    antialias: true,
    pixelArt: false,
  },
  input: {
    activePointers: 3,
  },
};

// eslint-disable-next-line no-new
const __ncGame = new Phaser.Game(config);
(window as unknown as { __NC_GAME__: Phaser.Game }).__NC_GAME__ = __ncGame;
