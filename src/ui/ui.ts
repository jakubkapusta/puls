// DOM HUD and screens. Player-facing text is Polish. Hidden screens use `visibility: hidden`
// so they never catch taps.

import type { Game } from '../game/game';
import { SPEEDS, TEST_GROUPS, type SpeedId, type TestSel } from '../game/tuning';

export type UIHandlers = {
  play: () => void;
  pause: () => void;
  resume: () => void;
  menu: () => void;
  again: () => void;
  sound: (on: boolean) => void;
  test: (sel: TestSel) => void;
  speed: (id: SpeedId) => void;
  calibOpen: () => void;
  calibStart: () => void;
  calibTap: (ms: number) => void;
  calibSet: (ms: number) => void;
  calibDone: () => void;
};

export type EndInfo = {
  title: string;
  sub: string;
  passed: boolean;
  score: number;
  best: boolean;
  rows: [string, string][];
};

const $ = <T extends HTMLElement>(root: HTMLElement, sel: string) => root.querySelector(sel) as T;

export class UI {
  private hud: HTMLElement;
  private score: HTMLElement;
  private mult: HTMLElement;
  private lives: HTMLElement;
  private bar: HTMLElement;
  private layers: HTMLElement;
  private groove: HTMLElement;
  private hintEl: HTMLElement;
  private menu: HTMLElement;
  private pauseEl: HTMLElement;
  private end: HTMLElement;
  private calib: HTMLElement;
  private howto: HTMLElement;
  private card: HTMLElement;
  private debug: HTMLElement;
  private fxEl: HTMLElement;
  private fxKey = '';
  private last = { score: -1, mult: -1, lives: -1, layers: -1 };
  private sel: TestSel | null = null;

  constructor(private root: HTMLElement, private h: UIHandlers) {
    root.innerHTML = `
      <div class="hud hidden">
        <div class="hud-l"><div class="score">0</div><div class="mult">×1</div></div>
        <div class="hud-c"><div class="lives"></div><div class="layers"></div></div>
        <button class="icon-btn pause-btn" aria-label="Pauza"><svg viewBox="0 0 16 16"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor"/><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor"/></svg></button>
        <div class="progress"><b></b></div>
      </div>
      <div class="fx"></div>
      <div class="groove">w rytmie</div>
      <div class="hint"></div>
      <div class="pops"></div>
      <div class="debug"></div>

      <div class="screen menu">
        <div class="menu-in">
          <h1 class="logo">Puls</h1>
          <p class="tag">Każdy klocek jest nutą. Utwór powstaje z tego, jak grasz.</p>
          <button class="btn primary play">Graj</button>
          <div class="song-line"></div>
          <div class="speed"><span>Piłka</span><div class="chips speed-chips"></div></div>
          <div class="row-btns">
            <button class="btn small howto-open">Jak grać</button>
            <button class="btn small calib-open">Kalibracja dźwięku</button>
            <button class="btn small sound-btn"></button>
          </div>
          <p class="note">Słuchawki pomagają. Na iPhonie wyłącz tryb cichy (przełącznik z boku), inaczej Web Audio milczy.</p>
          <details class="test">
            <summary>Ustawienia testowe</summary>
            <div class="test-groups"></div>
          </details>
        </div>
      </div>

      <div class="screen pause">
        <div class="panel">
          <h2>Pauza</h2>
          <button class="btn primary resume">Wznów</button>
          <button class="btn to-menu">Menu</button>
        </div>
      </div>

      <div class="screen end">
        <div class="panel">
          <h2 class="end-title"></h2>
          <p class="end-sub"></p>
          <div class="end-score"></div>
          <div class="end-best">Nowy rekord!</div>
          <div class="end-rows"></div>
          <button class="btn primary again">Jeszcze raz</button>
          <button class="btn to-menu">Menu</button>
        </div>
      </div>

      <div class="title-card"><h2></h2><p></p></div>

      <div class="screen howto">
        <div class="panel wide">
          <h2>Jak grać</h2>
          <div class="howto-body">
            <p>Każdy klocek to nuta. Zbity rząd dokłada do utworu nową warstwę, a stracona piłka ją zabiera.</p>
            <p><b>Uderzenie w rytm:</b> gdy piłka spada na paletkę, pchnij palec w górę (na laptopie spacja albo klik). Piłka zawsze spada na bit, więc słuchaj muzyki. Trafienie rozgrzewa piłkę i podbija mnożnik, a seria daje stan „w rytmie”.</p>
            <h3>Klocki specjalne</h3>
            <ul>
              <li><b>Akord</b> — trzy nuty naraz.</li>
              <li><b>Perkusja</b> — od razu nowa ścieżka.</li>
              <li><b>Arpeggiator</b> — rozbija sąsiadów po kolei, w rytmie.</li>
              <li><b>Filtr</b> — zamyka i otwiera brzmienie.</li>
              <li><b>Echo</b> — piłka na chwilę się klonuje.</li>
              <li><b>Metronom</b> — tempo w górę albo w dół.</li>
              <li><b>Twardy</b> — kilka trafień, każde wyżej.</li>
              <li><b>Drop</b> — zbij wszystkie białe, a utwór wybuchnie.</li>
            </ul>
            <h3>Kapsułki (łap paletką)</h3>
            <ul>
              <li><b>Polifonia</b> — dwie dodatkowe piłki.</li>
              <li><b>Laser</b> — paletka strzela na ósemki.</li>
              <li><b>Szeroka paletka</b>, <b>Magnes</b>, <b>Zwolnienie</b> tempa.</li>
            </ul>
          </div>
          <button class="btn primary howto-done">Rozumiem</button>
        </div>
      </div>

      <div class="screen calib">
        <div class="panel">
          <h2>Kalibracja dźwięku</h2>
          <p class="calib-txt">Telefon i słuchawki (zwłaszcza Bluetooth) opóźniają dźwięk. Stukaj w ekran równo z kliknięciami, a gra dopasuje się do tego, co słyszysz.</p>
          <div class="calib-pad">Stukaj tutaj w rytm</div>
          <div class="calib-dots"></div>
          <div class="calib-val"></div>
          <input class="calib-range" type="range" min="-100" max="400" step="5" />
          <button class="btn primary calib-start">Start</button>
          <button class="btn calib-done">Gotowe</button>
        </div>
      </div>`;

    this.hud = $(root, '.hud');
    this.score = $(root, '.score');
    this.mult = $(root, '.mult');
    this.lives = $(root, '.lives');
    this.layers = $(root, '.layers');
    this.bar = $(root, '.progress b');
    this.groove = $(root, '.groove');
    this.hintEl = $(root, '.hint');
    this.menu = $(root, '.menu');
    this.pauseEl = $(root, '.pause');
    this.end = $(root, '.end');
    this.calib = $(root, '.calib');
    this.howto = $(root, '.howto');
    this.card = $(root, '.title-card');
    this.debug = $(root, '.debug');
    this.fxEl = $(root, '.fx');

    const on = (sel: string, f: () => void) =>
      root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => {
        e.stopPropagation();
        f();
      }));
    on('.play', () => h.play());
    on('.pause-btn', () => h.pause());
    on('.resume', () => h.resume());
    on('.to-menu', () => h.menu());
    on('.again', () => h.again());
    on('.calib-open', () => h.calibOpen());
    on('.howto-open', () => this.show(this.howto));
    on('.howto-done', () => this.show(this.menu));
    on('.calib-start', () => h.calibStart());
    on('.calib-done', () => h.calibDone());
    on('.sound-btn', () => {
      const b = $(root, '.sound-btn');
      const next = b.dataset.on !== '1';
      this.setSound(next);
      h.sound(next);
    });
    const pad = $(root, '.calib-pad');
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pad.classList.remove('hit');
      void pad.offsetWidth;
      pad.classList.add('hit');
      h.calibTap(e.timeStamp);
    });
    const range = $<HTMLInputElement>(root, '.calib-range');
    range.addEventListener('input', () => h.calibSet(parseInt(range.value, 10)));
  }

  // ------------------------------------------------------------ screens
  private show(el: HTMLElement | null) {
    for (const s of [this.menu, this.pauseEl, this.end, this.calib, this.howto]) s.classList.toggle('show', s === el);
  }

  showMenu(sel: TestSel, songLine: string, speed: SpeedId) {
    this.sel = sel;
    this.buildSpeed(speed);
    this.show(this.menu);
    this.hudVisible(false);
    $(this.root, '.song-line').innerHTML = songLine;
    this.buildTest();
  }

  private buildSpeed(cur: SpeedId) {
    const box = $(this.root, '.speed-chips');
    box.innerHTML = (Object.keys(SPEEDS) as SpeedId[]).map((id) => {
      const s = SPEEDS[id];
      const extra = s.mul > 1 ? ` <small>+${Math.round((s.mul - 1) * 100)}% pkt</small>` : '';
      return `<button class="chip${id === cur ? ' on' : ''}" data-v="${id}">${s.label}${extra}</button>`;
    }).join('');
    box.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = b.dataset.v as SpeedId;
      this.buildSpeed(id);
      this.h.speed(id);
    }));
  }

  private buildTest() {
    const box = $(this.root, '.test-groups');
    const sel = this.sel!;
    box.innerHTML = TEST_GROUPS.map((g) => `
      <div class="tg"><span>${g.label}</span><div class="chips">${g.opts.map((o) =>
        `<button class="chip${sel[g.key] === o.id ? ' on' : ''}" data-k="${g.key}" data-v="${o.id}">${o.label}</button>`).join('')}</div></div>`).join('');
    box.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      (sel as Record<string, string>)[b.dataset.k!] = b.dataset.v!;
      this.buildTest();
      this.h.test(sel);
    }));
  }

  setSound(on: boolean) {
    const b = $(this.root, '.sound-btn');
    b.dataset.on = on ? '1' : '0';
    b.textContent = on ? 'Dźwięk: wł.' : 'Dźwięk: wył.';
  }

  showPause() {
    this.show(this.pauseEl);
  }

  hideScreens() {
    this.show(null);
  }

  showEnd(e: EndInfo) {
    $(this.root, '.end-title').textContent = e.title;
    $(this.root, '.end-sub').textContent = e.sub;
    $(this.root, '.end-score').textContent = e.score.toLocaleString('pl-PL');
    $(this.root, '.end-best').style.display = e.best ? '' : 'none';
    $(this.root, '.end-rows').innerHTML = e.rows.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    this.end.classList.toggle('passed', e.passed);
    this.show(this.end);
    this.hudVisible(false);
    this.groove.classList.remove('show');
  }

  showCalib(ms: number, latencyMs: number) {
    this.show(this.calib);
    this.hudVisible(false);
    this.calibValue(ms, latencyMs);
    $(this.root, '.calib-dots').innerHTML = '';
  }

  calibValue(ms: number, latencyMs: number) {
    $(this.root, '.calib-val').innerHTML = `Przesunięcie: <b>${Math.round(ms)} ms</b> <small>(+ ${Math.round(latencyMs)} ms zgłaszane przez przeglądarkę)</small>`;
    $<HTMLInputElement>(this.root, '.calib-range').value = String(Math.round(ms / 5) * 5);
  }

  calibDots(n: number, total: number) {
    $(this.root, '.calib-dots').innerHTML = Array.from({ length: total }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
  }

  // ------------------------------------------------------------ HUD
  hudVisible(on: boolean) {
    this.hud.classList.toggle('hidden', !on);
  }

  updateHud(g: Game) {
    const L = this.last;
    const sc = Math.round(g.score);
    if (sc !== L.score) {
      L.score = sc;
      this.score.textContent = sc.toLocaleString('pl-PL');
    }
    if (g.mult !== L.mult) {
      L.mult = g.mult;
      this.mult.textContent = '×' + g.mult;
      this.mult.classList.toggle('hot', g.mult > 1);
      this.mult.classList.remove('bump');
      void this.mult.offsetWidth;
      if (g.mult > 1) this.mult.classList.add('bump');
    }
    if (g.lives !== L.lives) {
      L.lives = g.lives;
      this.lives.innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="${i < g.lives ? 'on' : ''}"></i>`).join('');
    }
    if (g.layers !== L.layers) {
      L.layers = g.layers;
      const n = g.song.layers.length;
      this.layers.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < g.layers ? 'on' : ''}"></i>`).join('');
    }
    this.bar.style.transform = `scaleX(${Math.min(1, Math.max(0, g.t / g.song.length))})`;
  }

  resetHud() {
    this.last = { score: -1, mult: -1, lives: -1, layers: -1 };
    this.groove.classList.remove('show');
    $(this.root, '.pops').innerHTML = '';
    this.setFx([]);
  }

  /** chips for what is active right now; rebuilt only when the set changes */
  setFx(items: { id: string; label: string; k: number; color: string }[]) {
    const key = items.map((i) => i.id + ':' + i.label).join('|');
    if (key !== this.fxKey) {
      this.fxKey = key;
      this.fxEl.innerHTML = items.map((i) => `<div class="chipfx" style="--c:${i.color}"><span>${i.label}</span><i><b></b></i></div>`).join('');
    }
    const bars = this.fxEl.querySelectorAll<HTMLElement>('b');
    items.forEach((it, n) => {
      if (bars[n]) bars[n].style.transform = `scaleX(${it.k})`;
    });
  }

  setGroove(on: boolean) {
    this.groove.classList.toggle('show', on);
  }

  pop(text: string, x: number, y: number, cls = '') {
    const p = document.createElement('div');
    p.className = 'pop ' + cls;
    p.textContent = text;
    p.style.left = Math.min(window.innerWidth - 70, Math.max(70, x)) + 'px';
    p.style.top = y + 'px';
    $(this.root, '.pops').appendChild(p);
    setTimeout(() => p.remove(), 900);
  }

  /** the song's name over the board for a moment at the start */
  titleCard(title: string, sub: string) {
    $(this.root, '.title-card h2').textContent = title;
    $(this.root, '.title-card p').textContent = sub;
    this.card.classList.remove('show');
    void this.card.offsetWidth;
    this.card.classList.add('show');
  }

  hint(text: string | null) {
    if (text) this.hintEl.innerHTML = text;
    this.hintEl.classList.toggle('show', !!text);
  }

  setDebug(s: string | null) {
    this.debug.style.display = s ? 'block' : 'none';
    if (s) this.debug.textContent = s;
  }
}
