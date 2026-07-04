import type { Vec2 } from "./vector";

export type PlanetRole = "anchor" | "minor";

export type PlanetPalette = {
  base: string;
  accent: string;
  glow: string;
};

export type PlanetOrbitPath = {
  center: Vec2;
  radius: number;
  phase: number;
  angularSpeed: number;
  direction?: 1 | -1;
};

export type LevelPlanet = {
  id: string;
  name: string;
  role: PlanetRole;
  position: Vec2;
  mass: number;
  radius: number;
  captureRadius: number;
  palette: PlanetPalette;
  hasRing?: boolean;
  orbitPath?: PlanetOrbitPath;
};

export type LevelDefinition = {
  id: string;
  name: string;
  bounds: Vec2;
  startPosition: Vec2;
  startVelocity: Vec2;
  goalMass: number;
  goalShards: number;
  planets: LevelPlanet[];
};
