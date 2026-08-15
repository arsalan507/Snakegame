'use strict';

/* --------------------------------------------------------------------------
 * SnakeMania — a dependency-free arcade snake.
 *
 * Game logic is 0-indexed (0..COLS-1); the CSS grid it paints into is
 * 1-indexed, so the board is pre-built once as COLS*ROWS cells and each
 * frame only re-classes the cells that actually changed.
 * ------------------------------------------------------------------------ */

const COLS = 18;
const ROWS = 18;
const START_SPEED = 7;    // moves per second
const MAX_SPEED = 17;
const SPEED_GAIN = 0.4;   // moves per second gained per food eaten
const START_LENGTH = 3;
const MAX_FRAME = 0.25;   // clamp dt so a backgrounded tab can't fast-forward

const STATE = { READY: 'ready', PLAYING: 'playing', PAUSED: 'paused', OVER: 'over' };

const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const KEY_DIRS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  w: 'up', s: 'down', a: 'left', d: 'right',
};

// --- DOM ------------------------------------------------------------------

const board = document.getElementById('board');
const scoreBox = document.getElementById('score');
const bestBox = document.getElementById('best');
const speedBox = document.getElementById('speed');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayBody = document.getElementById('overlay-body');
const overlayAction = document.getElementById('overlay-action');
const muteBtn = document.getElementById('mute');

// --- Audio ----------------------------------------------------------------
// Every play() is fire-and-forget: browsers reject autoplay before the first
// gesture, and an unhandled rejection there would spam the console.

const sound = (() => {
  const tracks = {
    food: new Audio('music/food.mp3'),
    over: new Audio('music/gameover.mp3'),
    turn: new Audio('music/move.mp3'),
    music: new Audio('music/music.mp3'),
  };
  tracks.music.loop = true;
  tracks.music.volume = 0.35;
  tracks.turn.volume = 0.5;

  let muted = localStorage.getItem('snake.muted') === 'true';

  const sync = () => {
    muteBtn.textContent = muted ? '🔇' : '🔊';
    muteBtn.setAttribute('aria-label', muted ? 'Unmute' : 'Mute');
    muteBtn.setAttribute('aria-pressed', String(muted));
  };

  const play = (name) => {
    if (muted) return;
    const track = tracks[name];
    track.currentTime = 0;
    track.play().catch(() => { /* autoplay blocked until first gesture */ });
  };

  sync();

  return {
    play,
    music(on) {
      if (on && !muted) tracks.music.play().catch(() => {});
      else tracks.music.pause();
    },
    toggle() {
      muted = !muted;
      localStorage.setItem('snake.muted', String(muted));
      if (muted) tracks.music.pause();
      else if (state === STATE.PLAYING) tracks.music.play().catch(() => {});
      sync();
    },
  };
})();

// --- Board ----------------------------------------------------------------

const cells = [];
const idx = (x, y) => y * COLS + x;

function buildBoard() {
  board.style.setProperty('--cols', COLS);
  board.style.setProperty('--rows', ROWS);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < COLS * ROWS; i++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cells.push(cell);
    frag.appendChild(cell);
  }
  board.appendChild(frag);
}

let painted = new Set();

function paint() {
  const next = new Map();
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    next.set(idx(seg.x, seg.y), i === 0 ? 'cell head' : 'cell snake');
  }
  if (food) next.set(idx(food.x, food.y), 'cell food');

  for (const i of painted) if (!next.has(i)) cells[i].className = 'cell';
  for (const [i, cls] of next) cells[i].className = cls;
  painted = new Set(next.keys());
}

// --- State ----------------------------------------------------------------

let state = STATE.READY;
let snake = [];
let dir = DIRS.right;
let queued = [];
let food = null;
let score = 0;
let speed = START_SPEED;
let best = Number(localStorage.getItem('snake.best')) || 0;

function spawnFood() {
  const taken = new Set(snake.map((s) => idx(s.x, s.y)));
  const free = [];
  for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
  if (!free.length) return null; // board full — a perfect game
  const i = free[Math.floor(Math.random() * free.length)];
  return { x: i % COLS, y: Math.floor(i / COLS) };
}

function updateHud() {
  scoreBox.textContent = score;
  bestBox.textContent = best;
  speedBox.textContent = `${speed.toFixed(1)}/s`;
}

function reset() {
  const midY = Math.floor(ROWS / 2);
  const midX = Math.floor(COLS / 2);
  snake = [];
  for (let i = 0; i < START_LENGTH; i++) snake.push({ x: midX - i, y: midY });
  dir = DIRS.right;
  queued = [];
  score = 0;
  speed = START_SPEED;
  food = spawnFood();
  updateHud();
  paint();
}

// --- Overlay --------------------------------------------------------------

function showOverlay(title, body, action) {
  overlayTitle.textContent = title;
  overlayBody.innerHTML = body;
  overlayAction.textContent = action;
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
}

// --- Transitions ----------------------------------------------------------

function start() {
  reset();
  state = STATE.PLAYING;
  hideOverlay();
  sound.music(true);
}

function pause() {
  if (state !== STATE.PLAYING) return;
  state = STATE.PAUSED;
  sound.music(false);
  showOverlay('Paused', 'Take your time.', 'Resume');
}

function resume() {
  if (state !== STATE.PAUSED) return;
  state = STATE.PLAYING;
  hideOverlay();
  sound.music(true);
}

function gameOver(won = false) {
  state = STATE.OVER;
  sound.music(false);
  sound.play('over');

  const previousBest = best;
  const isRecord = score > best;
  if (isRecord) {
    best = score;
    localStorage.setItem('snake.best', String(best));
  }
  updateHud();

  const headline = won ? 'Perfect game' : 'Game over';
  const body = won
    ? `You filled the board. Final score <strong>${score}</strong>.`
    : isRecord
      ? `New best — <strong>${score}</strong>, beating ${previousBest}.`
      : `You scored <strong>${score}</strong>. Best is ${best}.`;

  showOverlay(headline, body, 'Play again');
}

// --- Input ----------------------------------------------------------------

function turn(name) {
  const d = DIRS[name];
  if (!d) return;
  // Compare against the last *queued* turn, not the live direction, so two
  // fast taps (right → up → left) can't fold the snake back into itself.
  const last = queued.length ? queued[queued.length - 1] : dir;
  if (d.x === -last.x && d.y === -last.y) return; // no 180s
  if (d.x === last.x && d.y === last.y) return;   // no duplicates
  if (queued.length >= 2) return;                 // at most one turn buffered
  queued.push(d);
  sound.play('turn');
}

function primaryAction() {
  if (state === STATE.PLAYING) pause();
  else if (state === STATE.PAUSED) resume();
  else start();
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'm' || e.key === 'M') { sound.toggle(); return; }

  if (e.key === ' ' || e.key === 'Enter' || e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    primaryAction();
    return;
  }

  const name = KEY_DIRS[e.key];
  if (!name) return;
  e.preventDefault();

  if (state === STATE.READY || state === STATE.OVER) start();
  if (state === STATE.PLAYING) turn(name);
});

overlayAction.addEventListener('click', primaryAction);
muteBtn.addEventListener('click', () => sound.toggle());

// Swipe, so the game is actually playable on a phone.
let touchStart = null;

board.addEventListener('touchstart', (e) => {
  const t = e.changedTouches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });

board.addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;

  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return; // a tap, not a swipe

  if (state === STATE.READY || state === STATE.OVER) start();
  if (state !== STATE.PLAYING) return;

  turn(Math.abs(dx) > Math.abs(dy)
    ? (dx > 0 ? 'right' : 'left')
    : (dy > 0 ? 'down' : 'up'));
}, { passive: true });

// Losing the tab mid-run shouldn't cost a life.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

// --- Simulation -----------------------------------------------------------

function step() {
  if (queued.length) dir = queued.shift();

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
    gameOver();
    return;
  }

  const eating = food && head.x === food.x && head.y === food.y;

  // The tail vacates this tick unless we're growing, so it isn't a collision.
  const body = eating ? snake : snake.slice(0, -1);
  if (body.some((s) => s.x === head.x && s.y === head.y)) {
    gameOver();
    return;
  }

  snake.unshift(head);

  if (eating) {
    score += 1;
    speed = Math.min(MAX_SPEED, speed + SPEED_GAIN);
    sound.play('food');
    food = spawnFood();
    updateHud();
    if (!food) { paint(); gameOver(true); return; }
  } else {
    snake.pop();
  }

  paint();
}

let lastTime = 0;
let accumulator = 0;

function loop(now) {
  requestAnimationFrame(loop);

  if (state !== STATE.PLAYING) { lastTime = now; return; }

  const dt = Math.min((now - lastTime) / 1000, MAX_FRAME);
  lastTime = now;
  accumulator += dt;

  const stepTime = 1 / speed;
  while (accumulator >= stepTime && state === STATE.PLAYING) {
    accumulator -= stepTime;
    step();
  }
}

// --- Boot -----------------------------------------------------------------

buildBoard();
reset();
showOverlay(
  'SnakeMania',
  'Arrow keys or <kbd>WASD</kbd> to steer. <kbd>Space</kbd> pauses.',
  'Play'
);
requestAnimationFrame(loop);
