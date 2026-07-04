import { FIRST_LEVEL } from "./levels";
import type { LevelDefinition, LevelPlanet } from "./level";
import type { InputController } from "./input";
import {
  add,
  clamp,
  cloneVec,
  cross,
  distance,
  length,
  normalize,
  rotate90,
  scale,
  sub,
  type Vec2,
} from "./vector";

export type GamePhase = "menu" | "playing" | "lost" | "won";

export type PlanetState = LevelPlanet & {
  alive: boolean;
  brokenAt: number | null;
};

export type OrbitState = {
  planetId: string;
  radius: number;
  angle: number;
  direction: 1 | -1;
  angularSpeed: number;
};

export type EarthState = {
  position: Vec2;
  velocity: Vec2;
  mass: number;
  radius: number;
  orbit: OrbitState | null;
};

export type FragmentState = {
  id: number;
  position: Vec2;
  velocity: Vec2;
  color: string;
  size: number;
  age: number;
  lifetime: number;
};

export type GameEvent =
  | {
      type: "capture";
      planetId: string;
      planetName: string;
      position: Vec2;
      radius: number;
      color: string;
    }
  | {
      type: "release";
      planetId: string;
      planetName: string;
      position: Vec2;
      radius: number;
      color: string;
      reason: "manual" | "breakthrough";
    }
  | {
      type: "smash";
      planetId: string;
      planetName: string;
      position: Vec2;
      radius: number;
      color: string;
      gainedMass: number;
    }
  | {
      type: "earthCrash";
      planetId: string;
      planetName: string;
      position: Vec2;
      radius: number;
      color: string;
      mass: number;
      shards: number;
    }
  | { type: "lost"; mass: number; shards: number }
  | { type: "won"; mass: number; shards: number };

export type GameStats = {
  smashed: number;
  bestMass: number;
};

export type GameState = {
  phase: GamePhase;
  level: LevelDefinition;
  earth: EarthState;
  planets: PlanetState[];
  fragments: FragmentState[];
  stats: GameStats;
  time: number;
  thrusting: boolean;
  lastMessage: string;
};

const INITIAL_MASS = 1;
const INITIAL_RADIUS = radiusForMass(INITIAL_MASS);
const THRUST_ACCELERATION = 3.55;
const MAX_SPEED = 10.2;
const RELEASE_BOOST = 1.12;
const BREAKTHROUGH_BOOST = 1.3;
const CAPTURE_MASS_MARGIN = 1.04;
const SMASH_MASS_MARGIN = 1.01;
const MASS_GAIN_FACTOR = 0.76;
const EARTH_GRAVITY_BASE = 1.15;
const EARTH_GRAVITY_RADIUS_FACTOR = 3.15;
const EARTH_GRAVITY_PULL = 9.4;

export function radiusForMass(mass: number): number {
  return 0.72 * Math.cbrt(Math.max(0.01, mass));
}

export function diameterRatio(radius: number): number {
  return radius / INITIAL_RADIUS;
}

export function earthAttractionRadius(radius: number): number {
  return EARTH_GRAVITY_BASE + radius * EARTH_GRAVITY_RADIUS_FACTOR;
}

export class Simulation {
  readonly level: LevelDefinition;
  state: GameState;

  private events: GameEvent[] = [];
  private fragmentId = 0;
  private releaseCooldownId: string | null = null;
  private releaseCooldown = 0;

  constructor(level = FIRST_LEVEL) {
    this.level = level;
    this.state = this.createState("menu");
  }

  start(): void {
    this.state = this.createState("playing");
    this.events = [];
    this.releaseCooldownId = null;
    this.releaseCooldown = 0;
  }

  restart(): void {
    this.start();
  }

  update(deltaSeconds: number, input: InputController): GameEvent[] {
    const dt = clamp(deltaSeconds, 0, 1 / 30);
    this.events = [];
    this.state.time += dt;

    if (input.restartPressed && this.state.phase !== "menu") {
      this.restart();
    }

    this.state.thrusting = this.state.phase === "playing" && input.thrustDown;

    if (this.state.phase !== "playing") {
      this.updateFragments(dt);
      return this.events;
    }

    if (this.releaseCooldown > 0) {
      this.releaseCooldown -= dt;
      if (this.releaseCooldown <= 0) {
        this.releaseCooldownId = null;
      }
    }

    if (this.state.earth.orbit) {
      this.updateOrbit(dt, input);
    } else {
      this.updateFlight(dt, input);
    }

    this.updateEarthAttraction(dt);
    this.resolvePlanetInteractions();
    this.updateFragments(dt);
    this.updateBestMass();
    this.checkBounds();
    this.checkVictory();

    return this.events;
  }

  private createState(phase: GamePhase): GameState {
    return {
      phase,
      level: this.level,
      earth: {
        position: cloneVec(this.level.startPosition),
        velocity: cloneVec(this.level.startVelocity),
        mass: INITIAL_MASS,
        radius: INITIAL_RADIUS,
        orbit: null,
      },
      planets: this.level.planets.map((planet) => ({
        ...planet,
        position: cloneVec(planet.position),
        alive: true,
        brokenAt: null,
      })),
      fragments: [],
      stats: {
        smashed: 0,
        bestMass: INITIAL_MASS,
      },
      time: 0,
      thrusting: false,
      lastMessage: "航线启动",
    };
  }

  private updateFlight(dt: number, input: InputController): void {
    const earth = this.state.earth;

    if (input.thrustDown) {
      const forward = normalize(earth.velocity);
      earth.velocity = add(earth.velocity, scale(forward, THRUST_ACCELERATION * dt));
    }

    const speed = length(earth.velocity);
    if (speed > MAX_SPEED) {
      earth.velocity = scale(normalize(earth.velocity), MAX_SPEED);
    }

    earth.position = add(earth.position, scale(earth.velocity, dt));

    if (!input.thrustDown) {
      const capture = this.findCapturePlanet();
      if (capture) {
        this.enterOrbit(capture);
      }
    }
  }

  private updateOrbit(dt: number, input: InputController): void {
    const earth = this.state.earth;
    const orbit = earth.orbit;
    if (!orbit) {
      return;
    }

    const planet = this.state.planets.find((candidate) => candidate.id === orbit.planetId);
    if (!planet || !planet.alive) {
      earth.orbit = null;
      return;
    }

    if (planet.mass <= earth.mass * CAPTURE_MASS_MARGIN) {
      this.releaseFromOrbit("breakthrough");
      return;
    }

    orbit.angle += orbit.angularSpeed * orbit.direction * dt;
    const radial = { x: Math.cos(orbit.angle), y: Math.sin(orbit.angle) };
    const tangent = rotate90(radial, orbit.direction);
    earth.position = add(planet.position, scale(radial, orbit.radius));
    earth.velocity = scale(tangent, orbit.angularSpeed * orbit.radius);

    if (input.thrustPressed || input.thrustDown) {
      this.releaseFromOrbit("manual");
    }
  }

  private findCapturePlanet(): PlanetState | null {
    let best: PlanetState | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const earth = this.state.earth;

    for (const planet of this.state.planets) {
      if (!planet.alive || planet.captureRadius <= 0) {
        continue;
      }
      if (planet.id === this.releaseCooldownId) {
        continue;
      }
      if (planet.mass <= earth.mass * CAPTURE_MASS_MARGIN) {
        continue;
      }

      const dist = distance(earth.position, planet.position);
      if (dist <= planet.captureRadius + earth.radius && dist < bestDistance) {
        best = planet;
        bestDistance = dist;
      }
    }

    return best;
  }

  private enterOrbit(planet: PlanetState): void {
    const earth = this.state.earth;
    const offset = sub(earth.position, planet.position);
    const dist = length(offset);
    const radius = clamp(
      dist,
      planet.radius + earth.radius + 0.76,
      Math.max(planet.radius + earth.radius + 0.9, planet.captureRadius * 0.94),
    );
    const angle = Math.atan2(offset.y, offset.x);
    const direction: 1 | -1 = cross(offset, earth.velocity) >= 0 ? 1 : -1;
    const angularSpeed = clamp(length(earth.velocity) / Math.max(radius, 0.1), 0.72, 1.56);

    earth.orbit = {
      planetId: planet.id,
      radius,
      angle,
      direction,
      angularSpeed,
    };
    const radial = { x: Math.cos(angle), y: Math.sin(angle) };
    earth.position = add(planet.position, scale(radial, radius));
    earth.velocity = scale(rotate90(radial, direction), angularSpeed * radius);
    this.state.lastMessage = `进入${planet.name}轨道`;
    this.events.push({
      type: "capture",
      planetId: planet.id,
      planetName: planet.name,
      position: cloneVec(planet.position),
      radius: planet.radius,
      color: planet.palette.glow,
    });
  }

  private releaseFromOrbit(reason: "manual" | "breakthrough"): void {
    const earth = this.state.earth;
    const orbit = earth.orbit;
    if (!orbit) {
      return;
    }

    const planet = this.state.planets.find((candidate) => candidate.id === orbit.planetId);
    const radial = { x: Math.cos(orbit.angle), y: Math.sin(orbit.angle) };
    const tangent = rotate90(radial, orbit.direction);
    const baseSpeed = Math.max(length(earth.velocity), 4.35);
    const boost = reason === "breakthrough" ? BREAKTHROUGH_BOOST : RELEASE_BOOST;
    earth.velocity = scale(tangent, clamp(baseSpeed * boost, 4.45, MAX_SPEED));
    earth.orbit = null;
    this.releaseCooldownId = orbit.planetId;
    this.releaseCooldown = reason === "breakthrough" ? 1.2 : 0.58;
    this.state.lastMessage = reason === "breakthrough" ? "质量突破引力束缚" : "切线喷射";

    if (planet) {
      this.events.push({
        type: "release",
        planetId: planet.id,
        planetName: planet.name,
        position: cloneVec(planet.position),
        radius: planet.radius,
        color: planet.palette.glow,
        reason,
      });
    }
  }

  private updateEarthAttraction(dt: number): void {
    const earth = this.state.earth;

    for (const planet of this.state.planets) {
      if (!planet.alive) {
        continue;
      }

      if (planet.id === earth.orbit?.planetId) {
        continue;
      }

      if (planet.mass >= earth.mass * SMASH_MASS_MARGIN) {
        continue;
      }

      const dist = distance(earth.position, planet.position);
      const pullRange = earthAttractionRadius(earth.radius) + planet.radius;
      if (dist > pullRange) {
        continue;
      }

      const pullDirection = normalize(sub(earth.position, planet.position));
      const rangeT = 1 - clamp(dist / Math.max(0.001, pullRange), 0, 1);
      const pullSpeed = (EARTH_GRAVITY_PULL * rangeT + length(earth.velocity) * 0.22) * dt;
      planet.position = add(planet.position, scale(pullDirection, Math.min(pullSpeed, dist)));
    }
  }

  private resolvePlanetInteractions(): void {
    const earth = this.state.earth;

    for (const planet of this.state.planets) {
      if (!planet.alive) {
        continue;
      }

      if (planet.id === earth.orbit?.planetId) {
        continue;
      }

      const dist = distance(earth.position, planet.position);
      const hitDistance = (earth.radius + planet.radius) * 1.05;
      if (dist > hitDistance) {
        continue;
      }

      if (planet.mass < earth.mass * SMASH_MASS_MARGIN) {
        this.smashPlanet(planet);
      } else {
        this.crashIntoPlanet(planet);
      }
    }
  }

  private crashIntoPlanet(planet: PlanetState): void {
    if (this.state.phase !== "playing") {
      return;
    }

    const earth = this.state.earth;
    this.state.phase = "lost";
    earth.orbit = null;
    this.state.lastMessage = `撞上${planet.name}`;
    this.spawnFragments({
      id: "earth-crash",
      name: "地球",
      role: "minor",
      position: cloneVec(earth.position),
      mass: earth.mass,
      radius: earth.radius,
      captureRadius: 0,
      palette: { base: "#4fe4ff", accent: "#57c46d", glow: "#8af5ff" },
      alive: false,
      brokenAt: this.state.time,
    });
    this.events.push({
      type: "earthCrash",
      planetId: planet.id,
      planetName: planet.name,
      position: cloneVec(earth.position),
      radius: earth.radius,
      color: "#8af5ff",
      mass: earth.mass,
      shards: this.state.stats.smashed,
    });
  }

  private smashPlanet(planet: PlanetState): void {
    const gainedMass = planet.mass * MASS_GAIN_FACTOR;
    planet.alive = false;
    planet.brokenAt = this.state.time;
    this.state.stats.smashed += 1;
    this.state.earth.mass += gainedMass;
    this.state.earth.radius = radiusForMass(this.state.earth.mass);
    this.state.lastMessage = `吸收${planet.name}`;
    this.spawnFragments(planet);
    this.events.push({
      type: "smash",
      planetId: planet.id,
      planetName: planet.name,
      position: cloneVec(planet.position),
      radius: planet.radius,
      color: planet.palette.glow,
      gainedMass,
    });

    const orbitId = this.state.earth.orbit?.planetId;
    if (orbitId) {
      const orbitPlanet = this.state.planets.find((candidate) => candidate.id === orbitId);
      if (orbitPlanet && orbitPlanet.mass <= this.state.earth.mass * CAPTURE_MASS_MARGIN) {
        this.releaseFromOrbit("breakthrough");
      }
    }
  }

  private spawnFragments(planet: PlanetState): void {
    const count = Math.ceil(24 + planet.radius * 26);
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + this.randomSigned(0.22);
      const speed = 2.8 + Math.random() * 6.8;
      const out = { x: Math.cos(angle), y: Math.sin(angle) };
      this.state.fragments.push({
        id: this.fragmentId,
        position: add(planet.position, scale(out, planet.radius * (0.35 + Math.random() * 0.65))),
        velocity: scale(out, speed),
        color: Math.random() > 0.4 ? planet.palette.base : planet.palette.accent,
        size: clamp(planet.radius * (0.09 + Math.random() * 0.14), 0.06, 0.24),
        age: -Math.random() * 0.08,
        lifetime: 0.78 + Math.random() * 0.78,
      });
      this.fragmentId += 1;
    }
  }

  private updateFragments(dt: number): void {
    const earth = this.state.earth;
    for (const fragment of this.state.fragments) {
      fragment.age += dt;
      const t = clamp(fragment.age / fragment.lifetime, 0, 1);
      const seek = normalize(sub(earth.position, fragment.position));
      const swirl = rotate90(seek, fragment.id % 2 === 0 ? 1 : -1);
      fragment.velocity = add(fragment.velocity, scale(seek, (13 + 17 * t) * dt));
      fragment.velocity = add(fragment.velocity, scale(swirl, 3.2 * (1 - t) * dt));
      fragment.velocity = scale(fragment.velocity, 0.965);
      fragment.position = add(fragment.position, scale(fragment.velocity, dt));
    }

    this.state.fragments = this.state.fragments.filter((fragment) => fragment.age < fragment.lifetime);
  }

  private checkBounds(): void {
    const { position, radius } = this.state.earth;
    const { bounds } = this.level;
    const margin = radius + 0.55;

    if (
      position.x < -bounds.x - margin ||
      position.x > bounds.x + margin ||
      position.y < -bounds.y - margin ||
      position.y > bounds.y + margin
    ) {
      this.state.phase = "lost";
      this.state.lastMessage = "飞出屏幕";
      this.events.push({
        type: "lost",
        mass: this.state.earth.mass,
        shards: this.state.stats.smashed,
      });
    }
  }

  private checkVictory(): void {
    if (this.state.phase !== "playing") {
      return;
    }

    if (this.state.earth.mass >= this.level.goalMass || this.state.stats.smashed >= this.level.goalShards) {
      this.state.phase = "won";
      this.state.lastMessage = "关卡完成";
      this.events.push({
        type: "won",
        mass: this.state.earth.mass,
        shards: this.state.stats.smashed,
      });
    }
  }

  private updateBestMass(): void {
    this.state.stats.bestMass = Math.max(this.state.stats.bestMass, this.state.earth.mass);
  }

  private randomSigned(amount: number): number {
    return (Math.random() * 2 - 1) * amount;
  }
}
