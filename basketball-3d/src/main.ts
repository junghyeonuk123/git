import { Game } from '@/core/Game';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;
const loadingBarFill = document.getElementById('loading-bar-fill') as HTMLDivElement;
const loadingStatus = document.getElementById('loading-status') as HTMLDivElement;

const game = new Game(canvas);

game
  .start((fraction, statusText) => {
    loadingBarFill.style.width = `${Math.round(fraction * 100)}%`;
    loadingStatus.textContent = statusText;
  })
  .then(() => {
    loadingScreen.classList.add('hidden');
  })
  .catch((error: unknown) => {
    loadingStatus.textContent = 'Failed to start — see console.';
    console.error(error);
  });
