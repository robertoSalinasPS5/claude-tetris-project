'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7aa2f7', // J - blue
  '#ffb74d', // L - orange
  '#f06292', // + cruz - rosa
  '#4db6ac', // U herradura - turquesa
  '#9575cd', // Y - lavanda
  '#ffd700', // 1x1 single - dorado
  '#90a4ae', // dona / marco hueco - gris azulado
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[0,8,0],[8,8,8],[0,8,0]],                  // + cruz pentominó (5)
  [[9,0,9],[9,9,9],[0,0,0]],                  // U herradura (5)
  [[10,0,10],[0,10,0],[0,10,0]],              // Y (4)
  [[11]],                                      // 1x1 single
  [[12,12,12],[12,0,12],[12,12,12]],          // dona / marco hueco (8)
];

// Las piezas no estándar salen ocasionalmente; el 1x1 no entra en el sorteo,
// se otorga sólo como recompensa por un Tetris (4 líneas de golpe).
const STANDARD_TYPES = [1, 2, 3, 4, 5, 6, 7];
const RARE_TYPES = [8, 9, 10, 12];
const SINGLE_TYPE = 11;
const RARE_CHANCE = 0.12;

const LINE_SCORES = [0, 100, 300, 500, 800];
// T-Spin: indexado por líneas limpiadas (0 = giro sin líneas, que también puntúa)
const TSPIN_SCORES = [400, 800, 1200, 1600];
const T_TYPE = 3;
const B2B_MULTIPLIER = 1.5;
const PERFECT_CLEAR_BONUS = 2000;
const COMBO_BONUS_PER_LEVEL = 50;

const GRID_COLORS = { dark: '#22222e', light: '#dcdfe8' };

// Colores de los popups; no dependen del tema porque se pintan sobre el tablero
const FX_COLORS = {
  combo: '#ffd54f',
  tetris: '#4dd0e1',
  tspin: '#ba68c8',
  b2b: '#ffb74d',
  perfect: '#81c784',
};

const MAX_PARTICLES = 240;
const PARTICLES_PER_ROW = 7;
const PARTICLE_GRAVITY = 400;   // px/s²
const POPUP_RISE = 30;          // px/s
const POPUP_TTL = 1200;         // ms
const MAX_DT = 100;             // ms; acota el salto tras cambiar de pestaña

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeSwitch = document.getElementById('theme-switch');
const comboEl = document.getElementById('combo');
const b2bSection = document.getElementById('b2b-section');   // el texto es fijo; sólo se muestra/oculta
const soundBtn = document.getElementById('sound-btn');

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let pendingSingle;
// combo/B2B sobreviven entre piezas, no entre partidas: init() los resetea
let comboCount, b2bActive, lastMoveWasRotation;
let theme;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  const pool = Math.random() < RARE_CHANCE ? RARE_TYPES : STANDARD_TYPES;
  return makePiece(pool[Math.floor(Math.random() * pool.length)]);
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      // marca de T-Spin: sólo cuenta si la rotación es el último movimiento antes del bloqueo
      lastMoveWasRotation = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

// Sólo borra filas. Devuelve las filas borradas con su contenido *antes* del splice:
// los colores hacen falta para las partículas y se perderían al desplazar el tablero.
// La puntuación y el resto de efectos los resuelve resolveClear().
function clearLines() {
  const rows = [];
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      rows.push({ y: r, cells: board[r].slice() });
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      r++;
    }
  }
  return { cleared: rows.length, rows };
}

function isBoardEmpty() {
  return board.every(row => row.every(v => v === 0));
}

// Combo x1 = 1x, x2 = 1.5x, x3 = 2x, x4+ escalado progresivo con tope
function comboMultiplier(n) {
  if (n <= 1) return 1;
  if (n === 2) return 1.5;
  if (n === 3) return 2;
  return Math.min(2 + 0.5 * (n - 3), 4);
}

function tspinName(cleared) {
  return ['T-SPIN!', 'T-SPIN SIMPLE!', 'T-SPIN DOBLE!', 'T-SPIN TRIPLE!'][cleared];
}

// Punto único donde se resuelve todo lo que ocurre al bloquear una pieza:
// combo, B2B, Perfect Clear, puntuación, nivel, velocidad, FX, audio y HUD.
function resolveClear({ cleared, rows }, tspin) {
  if (!cleared) {
    // el combo se rompe con cualquier pieza que no limpie; el B2B no se toca
    comboCount = 0;
    if (tspin) {
      score += TSPIN_SCORES[0] * level;
      addPopup('T-SPIN!', FX_COLORS.tspin);
      sfxSpecial();
      addShake(4);
    }
    updateHUD();
    return;
  }

  comboCount++;
  lines += cleared;

  const difficult = cleared === 4 || tspin;
  const b2bChain = difficult && b2bActive;
  const perfect = isBoardEmpty();

  let pts = ((tspin ? TSPIN_SCORES[cleared] : LINE_SCORES[cleared]) || 0) * level;
  if (b2bChain) pts *= B2B_MULTIPLIER;
  pts *= comboMultiplier(comboCount);
  if (comboCount >= 2) pts += comboCount * COMBO_BONUS_PER_LEVEL * level;
  if (perfect) pts += PERFECT_CLEAR_BONUS * level;
  score += Math.floor(pts);

  b2bActive = difficult;

  // Tetris: la siguiente pieza en NEXT será el 1x1 como recompensa
  if (cleared === 4) pendingSingle = true;
  level = Math.floor(lines / 10) + 1;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);

  // ---- feedback ----
  spawnParticles(rows);

  if (tspin) {
    addPopup(tspinName(cleared), FX_COLORS.tspin);
    sfxSpecial();
    addShake(5);
  } else if (cleared === 4) {
    addPopup('TETRIS!', FX_COLORS.tetris);
    sfxSpecial();
    addShake(5);
  } else {
    sfxClear(cleared);
    if (cleared === 3) addShake(2);
  }

  if (b2bChain) addPopup(`BACK-TO-BACK x${B2B_MULTIPLIER}`, FX_COLORS.b2b, 16);

  if (comboCount >= 2) {
    addPopup(`COMBO x${comboCount}!`, FX_COLORS.combo, 18);
    sfxCombo(comboCount);
    if (comboCount >= 4) addShake(3);
  }

  if (perfect) {
    addPopup('¡PERFECT CLEAR!', FX_COLORS.perfect, 24);
    sfxPerfect();
    addShake(8);
  }

  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  // si la pieza ya estaba apoyada no hay desplazamiento, así que un giro previo
  // sigue siendo el último movimiento válido para el T-Spin
  if (gy > current.y) lastMoveWasRotation = false;
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveWasRotation = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

// T-Spin estándar de 3 esquinas: la pieza debe ser la T, el último movimiento una
// rotación y al menos 3 de las 4 diagonales del centro deben estar bloqueadas.
// Se llama ANTES de merge(), para leer el tablero sin la propia pieza.
function detectTSpin() {
  if (current.type !== T_TYPE || !lastMoveWasRotation) return false;
  // rotateCW (transpose + reverse) conserva el centro de la matriz 3x3 en [1][1]
  const cx = current.x + 1;
  const cy = current.y + 1;
  let blocked = 0;
  for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const x = cx + dx;
    const y = cy + dy;
    // fuera por arriba NO cuenta como bloqueado: regalaría T-Spins al aparecer la pieza
    if (y < 0) continue;
    if (x < 0 || x >= COLS || y >= ROWS || board[y][x]) blocked++;
  }
  return blocked >= 3;
}

function lockPiece() {
  const tspin = detectTSpin();
  merge();
  resolveClear(clearLines(), tspin);
  spawn();
}

function spawn() {
  current = next;
  lastMoveWasRotation = false;
  if (pendingSingle) {
    next = makePiece(SINGLE_TYPE);
    pendingSingle = false;
  } else {
    next = randomPiece();
  }
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
  comboEl.textContent = comboCount >= 2 ? `x${comboCount}` : '—';
  comboEl.classList.toggle('idle', comboCount < 2);
  b2bSection.classList.toggle('hidden', !b2bActive);
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = GRID_COLORS[theme];
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

/* ========================= EFECTOS (FX) ========================= */

// Se actualizan por tiempo desde loop() y se pintan dentro de draw(), así que
// se congelan solos en pausa / game over (el bucle retorna tras dibujar).
const popups = [];
const particles = [];
const shake = { mag: 0, life: 0, ttl: 1 };
let shakeX = 0, shakeY = 0;

function addPopup(text, color, size = 22) {
  popups.push({ text, color, size, y: canvas.height * 0.35, life: POPUP_TTL, ttl: POPUP_TTL });
}

function addShake(mag) {
  // el impacto más fuerte manda: un temblor flojo no debe cortar uno en curso
  if (mag <= shake.mag * (shake.life / shake.ttl)) return;
  shake.mag = mag;
  shake.ttl = 300;
  shake.life = 300;
}

function spawnParticles(rows) {
  for (const row of rows) {
    for (let i = 0; i < PARTICLES_PER_ROW; i++) {
      if (particles.length >= MAX_PARTICLES) return;
      const c = Math.floor(Math.random() * COLS);
      particles.push({
        x: c * BLOCK + Math.random() * BLOCK,
        y: row.y * BLOCK + Math.random() * BLOCK,
        vx: (Math.random() - 0.5) * 220,
        vy: -60 - Math.random() * 160,
        life: 700,
        ttl: 700,
        size: 2 + Math.random() * 3,
        color: COLORS[row.cells[c]] || '#ffffff',
      });
    }
  }
}

function updateFX(dt) {
  const s = dt / 1000;

  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    p.life -= dt;
    p.y -= POPUP_RISE * s;
    if (p.life <= 0) popups.splice(i, 1);
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    p.vy += PARTICLE_GRAVITY * s;
    p.x += p.vx * s;
    p.y += p.vy * s;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (shake.life > 0) {
    shake.life -= dt;
    const amp = shake.mag * Math.max(shake.life, 0) / shake.ttl;
    shakeX = (Math.random() * 2 - 1) * amp;
    shakeY = (Math.random() * 2 - 1) * amp;
    if (shake.life <= 0) {
      shake.mag = 0;
      shakeX = 0;
      shakeY = 0;
    }
  }
}

function drawFX() {
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.life / p.ttl);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  popups.forEach((p, i) => {
    // se apilan por índice: T-SPIN + B2B + COMBO llegan a la vez y no deben solaparse
    ctx.globalAlpha = Math.min(1, p.life / (p.ttl * 0.4));
    ctx.font = `800 ${p.size}px system-ui, -apple-system, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.strokeText(p.text, canvas.width / 2, p.y + i * 30);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, canvas.width / 2, p.y + i * 30);
  });
  ctx.globalAlpha = 1;
}

function resetFX() {
  popups.length = 0;
  particles.length = 0;
  shake.mag = 0;
  shake.life = 0;
  shakeX = 0;
  shakeY = 0;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (shakeX || shakeY) ctx.translate(shakeX, shakeY);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawFX();
  ctx.restore();
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  // se centra el bounding box de celdas llenas, no la matriz: las matrices
  // tienen filas/columnas vacías (T, U, Y...) y descentrarían el dibujo
  let minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      if (shape[r][c]) {
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
      }
  // offsets fraccionarios: drawBlock sólo hace x * size, así que admite decimales
  const offX = (nextCanvas.width / NB - (maxC - minC + 1)) / 2 - minC;
  const offY = (nextCanvas.height / NB - (maxR - minR + 1)) / 2 - minR;
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

/* =================== AUDIO (Web Audio API) =================== */

// Sin archivos de audio: todo son osciladores sintetizados. El AudioContext sólo
// puede crearse dentro de un gesto del usuario (política de autoplay del navegador),
// de ahí que ensureAudio() sea perezoso y se llame desde keydown/click.
let audioCtx = null;
let masterGain = null;
let soundOn = localStorage.getItem('tetris-sound') !== 'off';

function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = soundOn ? 0.3 : 0;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, delay, dur, type = 'triangle', peak = 0.3) {
  if (!audioCtx || !soundOn) return;
  const t0 = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(masterGain);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
  // sin esto se acumulan cientos de nodos huérfanos a lo largo de una partida
  osc.onended = () => { osc.disconnect(); gain.disconnect(); };
}

// arpegio ascendente cuya tónica sube un tono por escalón de combo (con techo)
function sfxCombo(n) {
  const base = 440 * Math.pow(2, Math.min(n - 1, 8) * 2 / 12);
  [0, 4, 7].forEach((semi, i) => tone(base * Math.pow(2, semi / 12), i * 0.055, 0.18, 'triangle', 0.35));
}

function sfxClear(cleared) {
  tone(320 + cleared * 60, 0, 0.12, 'square', 0.16);
}

// acorde brillante (mayor add9) para Tetris y T-Spin
function sfxSpecial() {
  [523.25, 659.25, 783.99, 1174.66].forEach((f, i) => tone(f, i * 0.04, 0.5, 'triangle', 0.3));
}

function sfxPerfect() {
  [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98]
    .forEach((f, i) => tone(f, i * 0.07, 0.6, 'triangle', 0.3));
  tone(1046.5, 0.5, 1.1, 'sine', 0.26);
}

function applySound(on) {
  soundOn = on;
  localStorage.setItem('tetris-sound', on ? 'on' : 'off');
  soundBtn.textContent = on ? '🔊' : '🔇';
  soundBtn.setAttribute('aria-pressed', String(on));
  if (masterGain) masterGain.gain.value = on ? 0.3 : 0;
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  animId = 0;
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastMoveWasRotation = false;
    } else {
      lockPiece();
    }
  }
  updateFX(Math.min(dt, MAX_DT));
  draw();
  // lockPiece() puede terminar la partida a mitad del frame: si no se comprueba aquí,
  // se reagenda un frame que el cancelAnimationFrame de endGame() ya no puede detener
  if (gameOver || paused) return;
  animId = requestAnimationFrame(loop);
}

function applyTheme(t) {
  theme = t;
  document.body.classList.toggle('light', t === 'light');
  localStorage.setItem('tetris-theme', t);
  themeSwitch.checked = t === 'light';
  if (board) draw();
  if (next) drawNext();
}

// theme is a UI preference, not game state, so init() intentionally leaves it untouched
function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  pendingSingle = false;
  comboCount = 0;
  b2bActive = false;
  lastMoveWasRotation = false;
  resetFX();
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  ensureAudio();   // primer gesto del usuario: es el único momento válido para crearlo
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) {
        current.x--;
        lastMoveWasRotation = false;
      }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) {
        current.x++;
        lastMoveWasRotation = false;
      }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', () => { ensureAudio(); init(); });
themeSwitch.addEventListener('change', () => applyTheme(themeSwitch.checked ? 'light' : 'dark'));
soundBtn.addEventListener('click', () => {
  ensureAudio();
  applySound(!soundOn);
  if (soundOn) tone(880, 0, 0.12, 'triangle', 0.25);   // confirmación audible
});

applyTheme(localStorage.getItem('tetris-theme') || 'dark');
applySound(soundOn);
init();
