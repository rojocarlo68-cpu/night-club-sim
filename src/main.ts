import Phaser from 'phaser';
import { BootScene } from './game/scenes/BootScene';
import { ClubScene } from './game/scenes/ClubScene';
import { UIScene } from './game/scenes/UIScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#0a0612',
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 960,
    height: 640,
  },
  scene: [BootScene, ClubScene, UIScene],
  render: {
    antialias: true,
    pixelArt: false,
  },
  input: {
    activePointers: 3,
  },
};

// eslint-disable-next-line no-new
new Phaser.Game(config);
