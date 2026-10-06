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
  songs: () => void;
  pick: (id: string, bot?: boolean) => void;
  album: (id: string) => void;
  daily: () => void;
  jam: () => void;
  next: () => void;
  listen: () => void;
  stopListen: () => void;
};

/** the song list as the menu shows it */
export type AlbumView = {
  id: string; title: string; sub: string; locked: boolean; lockNote: string;
  songs: { id: string; title: string; meta: string; stars: number; best: number; locked: boolean }[];
  /** samples: no stars, a "Bot" button to just listen */
  lab?: boolean;
};

export type EndInfo = {
  title: string;
  sub: string;
  passed: boolean;
  score: number;
  best: boolean;
  rows: [string, string][];
  /** -1: no stars (Jam, daily shows them too) */
  stars: number;
  canNext: boolean;
  canListen: boolean;
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
  private songsEl: HTMLElement;
  private replayEl: HTMLElement;
  private albums: AlbumView[] = [];
  private albumId = '';
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
          <div class="modes">
            <button class="mode daily-btn"><b>Utwór dnia</b><span class="daily-sub"></span></button>
            <button class="mode jam-btn"><b>Jam</b><span class="jam-sub"></span></button>
          </div>
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
          <div class="end-stars"></div>
          <div class="end-score"></div>
          <div class="end-best">Nowy rekord!</div>
          <div class="end-rows"></div>
          <button class="btn primary next-btn">Dalej</button>
          <button class="btn again">Jeszcze raz</button>
          <button class="btn listen-btn">Posłuchaj swojej wersji</button>
          <button class="btn to-songs">Utwory</button>
        </div>
      </div>

      <div class="title-card"><h2></h2><p></p></div>

      <div class="screen songs">
        <div class="songs-in">
          <div class="songs-head">
            <button class="icon-btn back-btn" aria-label="Wróć"><svg viewBox="0 0 16 16"><path d="M10 2 4 8l6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg></button>
            <h2>Utwory</h2>
            <div class="stars-total"></div>
          </div>
          <div class="album-tabs"></div>
          <div class="album-sub"></div>
          <div class="song-list"></div>
        </div>
      </div>

      <div class="screen replay">
        <div class="panel">
          <h2>Twoja wersja</h2>
          <p class="replay-title"></p>
          <div class="replay-bar"><b></b></div>
          <button class="btn stop-listen">Zatrzymaj</button>
        </div>
      </div>

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
    this.songsEl = $(root, '.songs');
    this.replayEl = $(root, '.replay');
    this.howto = $(root, '.howto');
    this.card = $(root, '.title-card');
    this.debug = $(root, '.debug');
    this.fxEl = $(root, '.fx');

    const on = (sel: string, f: () => void) =>
      root.querySelectorAll(sel).forEach((el) => el.addEventListener('click', (e) => {
        e.stopPropagation();
        f();
      }));
    on('.play', () => h.songs());
    on('.back-btn', () => h.menu());
    on('.to-songs', () => h.songs());
    on('.daily-btn', () => h.daily());
    on('.jam-btn', () => h.jam());
    on('.next-btn', () => h.next());
    on('.listen-btn', () => h.listen());
    on('.stop-listen', () => h.stopListen());
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
    for (const s of [this.menu, this.pauseEl, this.end, this.calib, this.howto, this.songsEl, this.replayEl]) s.classList.toggle('show', s === el);
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

  /** the menu's daily and Jam lines */
  setModes(daily: string, jam: string) {
    $(this.root, '.daily-sub').textContent = daily;
    $(this.root, '.jam-sub').textContent = jam;
  }

  showSongs(albums: AlbumView[], albumId: string, totalStars: number) {
    this.albums = albums;
    this.albumId = albumId;
    $(this.root, '.stars-total').textContent = `★ ${totalStars}`;
    this.renderSongs();
    this.show(this.songsEl);
    this.hudVisible(false);
  }

  private renderSongs() {
    const tabs = $(this.root, '.album-tabs');
    tabs.innerHTML = this.albums.map((a) => `<button class="tab${a.id === this.albumId ? ' on' : ''}${a.locked ? ' locked' : ''}" data-id="${a.id}">${a.title}</button>`).join('');
    tabs.querySelectorAll<HTMLButtonElement>('.tab').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      this.albumId = b.dataset.id!;
      this.renderSongs();
      this.h.album(this.albumId);
    }));
    const a = this.albums.find((x) => x.id === this.albumId) ?? this.albums[0];
    $(this.root, '.album-sub').textContent = a.locked ? a.lockNote : a.sub;
    const stars = (n: number) => '<i class="on">★</i>'.repeat(n) + '<i>★</i>'.repeat(3 - n);
    const list = $(this.root, '.song-list');
    list.innerHTML = a.songs.map((sg, i) => `
      <button class="song${sg.locked ? ' locked' : ''}" data-id="${sg.id}" ${sg.locked ? 'disabled' : ''}>
        <span class="n">${i + 1}</span>
        <span class="t"><b>${sg.title}</b><small>${sg.meta}</small></span>
        <span class="r">${sg.locked ? '<span class="lock">🔒</span>' : a.lab ? '<span class="botbtn" data-bot="1">Bot</span>' : `<span class="stars">${stars(sg.stars)}</span><small>${sg.best ? sg.best.toLocaleString('pl-PL') : '—'}</small>`}</span>
      </button>`).join('');
    list.classList.toggle('dim', a.locked);
    list.querySelectorAll<HTMLButtonElement>('.song:not(.locked)').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      const bot = (e.target as HTMLElement).closest('[data-bot]');
      if (!a.locked) this.h.pick(b.dataset.id!, !!bot);
    }));
  }

  showReplay(title: string) {
    $(this.root, '.replay-title').textContent = title;
    this.replayProgress(0);
    this.show(this.replayEl);
  }

  replayProgress(k: number) {
    $(this.root, '.replay-bar b').style.transform = `scaleX(${k})`;
  }

  showEnd(e: EndInfo) {
    const st = $(this.root, '.end-stars');
    st.style.display = e.stars < 0 ? 'none' : '';
    st.innerHTML = [0, 1, 2].map((i) => `<i class="${i < e.stars ? 'on' : ''}" style="animation-delay:${0.25 + i * 0.22}s">★</i>`).join('');
    $(this.root, '.next-btn').style.display = e.canNext ? '' : 'none';
    $(this.root, '.again').classList.toggle('primary', !e.canNext);
    $(this.root, '.listen-btn').style.display = e.canListen ? '' : 'none';
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
    this.bar.style.transform = `scaleX(${g.endless ? 0 : Math.min(1, Math.max(0, g.t / g.length))})`;
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
