export type Vec2 = {
  x: number;
  y: number;
};

export const vec = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec2, value: number): Vec2 => ({ x: a.x * value, y: a.y * value });

export const length = (a: Vec2): number => Math.hypot(a.x, a.y);

export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

export const normalize = (a: Vec2): Vec2 => {
  const len = length(a);
  if (len < 0.00001) {
    return { x: 1, y: 0 };
  }
  return { x: a.x / len, y: a.y / len };
};

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;

export const rotate90 = (a: Vec2, direction = 1): Vec2 => ({
  x: -a.y * direction,
  y: a.x * direction,
});

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const cloneVec = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
