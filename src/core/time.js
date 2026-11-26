import { DAY_SECONDS, START_HOUR } from './constants.js';
import { smoothstep } from './math.js';

const PHASES = [
  { name: 'night', from: 0, to: 5 },
  { name: 'dawn', from: 5, to: 7 },
  { name: 'day', from: 7, to: 18 },
  { name: 'dusk', from: 18, to: 20.5 },
  { name: 'night', from: 20.5, to: 24 },
];

const WEATHERS = ['clear', 'clear', 'clear', 'cloudy', 'rain', 'fog'];

// In-game clock, day/night and weather. `t` counts game seconds since day 1, 00:00.
export class GameClock {
  constructor(game) {
    this.game = game;
    this.t = (START_HOUR / 24) * DAY_SECONDS;
    this.timeScale = 1;
    this.weather = { type: 'clear', intensity: 0, target: 0, timer: 240 };
    this._phase = this.phase;
    this._day = this.day;
  }

  get dayFraction() {
    return (this.t % DAY_SECONDS) / DAY_SECONDS;
  }

  get hour() {
    return this.dayFraction * 24;
  }

  get minute() {
    return Math.floor((this.hour % 1) * 60);
  }

  get day() {
    return Math.floor(this.t / DAY_SECONDS) + 1;
  }

  get phase() {
    const h = this.hour;
    for (const p of PHASES) if (h >= p.from && h < p.to) return p.name;
    return 'night';
  }

  get isNight() {
    const h = this.hour;
    return h >= 20.5 || h < 5;
  }

  // 0 at deep night, 1 at full day, smooth through dawn and dusk.
  get daylight() {
    const h = this.hour;
    if (h < 12) return smoothstep(4.5, 7.5, h);
    return 1 - smoothstep(17.5, 21, h);
  }

  // Game seconds per in-game hour.
  get secondsPerHour() {
    return DAY_SECONDS / 24;
  }

  timeString() {
    const h = Math.floor(this.hour);
    const m = this.minute;
    const ampm = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  fullString() {
    return `Day ${this.day}, ${this.timeString()}`;
  }

  update(dt) {
    this.t += dt * this.timeScale;
    const phase = this.phase;
    if (phase !== this._phase) {
      this._phase = phase;
      this.game?.bus.emit('time_of_day', { phase, day: this.day, hour: this.hour });
    }
    const day = this.day;
    if (day !== this._day) {
      this._day = day;
      this.game?.bus.emit('new_day', { day });
    }
    this.updateWeather(dt);
  }

  updateWeather(dt) {
    const w = this.weather;
    w.timer -= dt;
    if (w.timer <= 0) {
      const rng = this.game?.rng;
      const next = rng ? rng.pick(WEATHERS) : 'clear';
      w.timer = rng ? rng.range(180, 420) : 300;
      if (next !== w.type) this.setWeather(next);
    }
    // Ease intensity toward its target so rain fades in and out.
    const speed = 0.08 * dt;
    if (w.intensity < w.target) w.intensity = Math.min(w.target, w.intensity + speed);
    else w.intensity = Math.max(w.target, w.intensity - speed);
  }

  setWeather(type) {
    const w = this.weather;
    w.type = type;
    w.target = type === 'rain' ? 1 : type === 'fog' ? 0.8 : type === 'cloudy' ? 0.5 : 0;
    this.game?.bus.emit('weather', { type });
  }

  // Advance to the next time the clock reads `hour` (used when sleeping). A night slept
  // through midnight is a new day like any other: every 'new_day' listener (the calendar's
  // aging, the village, the quests, the murder's morning) hears it once per day crossed,
  // before the 'time_skip' (round 14b leftover: sleep never sent new_day).
  skipTo(hour) {
    const now = this.hour;
    let delta = hour - now;
    if (delta <= 0) delta += 24;
    this.advance(delta);
  }

  // Jump whole days ahead at the same hour (debugging, the aging checks): each day crossed
  // is a 'new_day', once.
  skipDays(n = 1) {
    const days = Math.max(0, Math.floor(n));
    if (days) this.advance(days * 24);
  }

  advance(hours) {
    const from = this.day;
    this.t += hours * this.secondsPerHour;
    this._phase = this.phase;
    const to = this.day;
    this._day = to;
    for (let d = from + 1; d <= to; d++) this.game?.bus.emit('new_day', { day: d, skipped: true });
    this.game?.bus.emit('time_skip', { hours, day: this.day, hour: this.hour });
  }

  serialize() {
    return { t: this.t, weather: { ...this.weather } };
  }

  deserialize(d) {
    if (!d) return;
    this.t = d.t ?? this.t;
    if (d.weather) Object.assign(this.weather, d.weather);
    this._phase = this.phase;
    this._day = this.day;
  }
}
