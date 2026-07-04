import * as THREE from "three";
import type { LevelDefinition, LevelPlanet, PlanetPalette } from "../game/level";
import { earthAttractionRadius, type FragmentState, type GameEvent, type GameState, type PlanetState } from "../game/simulation";
import { normalize, type Vec2 } from "../game/vector";

type PlanetView = {
  group: THREE.Group;
  body: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  atmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  captureField: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial> | null;
  captureRing: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> | null;
  ring: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null;
  glow: THREE.Sprite;
  massLabel: MassLabel;
};

type MassLabel = {
  sprite: THREE.Sprite;
  updateText: (text: string) => void;
};

type FragmentView = {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
};

type Spark = {
  mesh: THREE.Mesh<THREE.IcosahedronGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  age: number;
  lifetime: number;
};

type Shockwave = {
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  lifetime: number;
  radius: number;
};

type Flash = {
  sprite: THREE.Sprite;
  age: number;
  lifetime: number;
  baseScale: number;
};

const WORLD_Z = 0;

export class UniverseRenderer {
  private readonly mount: HTMLElement;
  private readonly level: LevelDefinition;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly planetViews = new Map<string, PlanetView>();
  private readonly fragmentViews = new Map<number, FragmentView>();
  private readonly sparks: Spark[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private readonly flashes: Flash[] = [];
  private readonly earthGroup = new THREE.Group();
  private readonly earthBody: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  private readonly earthClouds: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly earthAtmosphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly earthMassLabel: MassLabel;
  private readonly earthGravityRing: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly flame: THREE.Sprite;
  private readonly trailGeometry = new THREE.BufferGeometry();
  private readonly trailLine: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly trailPoints: THREE.Vector3[] = [];
  private readonly clockSeed = Math.random() * 1000;

  private time = 0;
  private earthDestroyed = false;

  constructor(mount: HTMLElement, level: LevelDefinition) {
    this.mount = mount;
    this.level = level;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setClearColor(0x02030a, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.mount.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 0, 58);
    this.camera.lookAt(0, 0, 0);

    this.buildBackground();
    this.buildLights();
    this.buildBounds();
    this.buildPlanets();

    this.earthBody = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.MeshStandardMaterial({
        map: createEarthTexture(),
        roughness: 0.82,
        metalness: 0.02,
        emissive: new THREE.Color("#0b2f5d"),
        emissiveIntensity: 0.18,
      }),
    );
    this.earthClouds = new THREE.Mesh(
      new THREE.SphereGeometry(1.035, 48, 24),
      new THREE.MeshBasicMaterial({
        map: createCloudTexture(),
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.earthAtmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1.1, 48, 24),
      new THREE.MeshBasicMaterial({
        color: "#4fe4ff",
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.earthGroup.add(this.earthAtmosphere, this.earthBody, this.earthClouds);
    this.earthGroup.position.z = 0.74;
    this.scene.add(this.earthGroup);

    this.earthMassLabel = createMassLabel("M 1.00", "#8af5ff", true);
    this.earthMassLabel.sprite.position.z = 2.6;
    this.scene.add(this.earthMassLabel.sprite);

    this.earthGravityRing = createCircleLine(1, "#4fe4ff", 0.34);
    this.earthGravityRing.position.z = 0.18;
    this.scene.add(this.earthGravityRing);

    this.flame = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createFlameTexture(),
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.flame.position.z = 1.1;
    this.scene.add(this.flame);

    this.trailLine = new THREE.Line(
      this.trailGeometry,
      new THREE.LineBasicMaterial({
        color: "#63f4ff",
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);

    window.addEventListener("resize", this.resize);
    this.resize();
  }

  update(state: GameState, events: GameEvent[], dt: number): void {
    this.time += dt;
    if (state.phase === "playing" || state.phase === "menu") {
      this.earthDestroyed = false;
    }
    this.updatePlanets(state.planets, state.earth.mass);
    this.updateEarth(state, dt);
    this.updateFragments(state.fragments);
    this.applyEvents(events);
    this.updateEffects(dt);
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    window.removeEventListener("resize", this.resize);
    this.renderer.dispose();
    this.mount.replaceChildren();
  }

  private readonly resize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspect = width / Math.max(1, height);
    const worldWidth = this.level.bounds.x * 2 + 1.6;
    const worldHeight = this.level.bounds.y * 2 + 1.2;
    const worldAspect = worldWidth / worldHeight;
    let viewWidth = worldWidth;
    let viewHeight = worldHeight;

    if (aspect > worldAspect) {
      viewWidth = worldHeight * aspect;
    } else {
      viewHeight = worldWidth / aspect;
    }

    this.camera.left = -viewWidth / 2;
    this.camera.right = viewWidth / 2;
    this.camera.top = viewHeight / 2;
    this.camera.bottom = -viewHeight / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  };

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight("#6b88bd", 0.72));
    const key = new THREE.DirectionalLight("#fff3d6", 2.2);
    key.position.set(-9, -7, 22);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#5ceaff", 1.25);
    rim.position.set(12, 9, 16);
    this.scene.add(rim);
    const magenta = new THREE.PointLight("#e96cff", 15, 40);
    magenta.position.set(-18, 11, 7);
    this.scene.add(magenta);
  }

  private buildBackground(): void {
    this.scene.add(createStarField(this.level.bounds, 1300, 1));
    this.scene.add(createStarField({ x: this.level.bounds.x * 1.24, y: this.level.bounds.y * 1.24 }, 520, 2));

    const nebulas = [
      { x: -13.5, y: 8.8, scale: 18, colors: ["#2449ff", "#35e6ff"] },
      { x: 13.4, y: -8.4, scale: 20, colors: ["#ff3f8e", "#ffc85a"] },
      { x: 7.8, y: 8.3, scale: 14, colors: ["#42ff9e", "#6a6bff"] },
    ];

    for (const nebula of nebulas) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: createNebulaTexture(nebula.colors[0], nebula.colors[1]),
          transparent: true,
          opacity: 0.43,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      sprite.position.set(nebula.x, nebula.y, -8);
      sprite.scale.set(nebula.scale * 1.35, nebula.scale, 1);
      this.scene.add(sprite);
    }
  }

  private buildBounds(): void {
    const { x, y } = this.level.bounds;
    const points = [
      new THREE.Vector3(-x, -y, -0.2),
      new THREE.Vector3(x, -y, -0.2),
      new THREE.Vector3(x, y, -0.2),
      new THREE.Vector3(-x, y, -0.2),
    ];
    const line = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({
        color: "#5bd7ff",
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.scene.add(line);
  }

  private buildPlanets(): void {
    for (const planet of this.level.planets) {
      const view = this.createPlanetView(planet);
      this.planetViews.set(planet.id, view);
      this.scene.add(view.group);
    }
  }

  private createPlanetView(planet: LevelPlanet): PlanetView {
    const group = new THREE.Group();
    group.position.set(planet.position.x, planet.position.y, WORLD_Z);

    const body = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.MeshStandardMaterial({
        map: createPlanetTexture(planet.palette, hashString(planet.id)),
        roughness: 0.78,
        metalness: planet.role === "anchor" ? 0.08 : 0.02,
        emissive: new THREE.Color(planet.palette.base),
        emissiveIntensity: planet.role === "anchor" ? 0.06 : 0.03,
      }),
    );
    body.scale.setScalar(planet.radius);
    body.position.z = planet.radius * 0.12;
    group.add(body);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.MeshBasicMaterial({
        color: planet.palette.glow,
        transparent: true,
        opacity: planet.role === "anchor" ? 0.16 : 0.1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    atmosphere.scale.setScalar(planet.radius * 1.14);
    atmosphere.position.z = planet.radius * 0.12 + 0.02;
    group.add(atmosphere);

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(planet.palette.glow),
        transparent: true,
        opacity: planet.role === "anchor" ? 0.4 : 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.scale.setScalar(planet.radius * (planet.role === "anchor" ? 5.2 : 3.1));
    glow.position.z = -0.04;
    group.add(glow);

    const captureRing =
      planet.captureRadius > 0
        ? createCircleLine(planet.captureRadius, planet.palette.glow, planet.role === "anchor" ? 0.28 : 0.18)
        : null;
    const captureField =
      planet.captureRadius > 0
        ? new THREE.Mesh(
            new THREE.CircleGeometry(planet.captureRadius, 128),
            new THREE.MeshBasicMaterial({
              color: planet.palette.glow,
              transparent: true,
              opacity: 0.024,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            }),
          )
        : null;
    if (captureField) {
      captureField.position.z = -0.08;
      group.add(captureField);
    }
    if (captureRing) {
      captureRing.position.z = -0.05;
      group.add(captureRing);
    }

    const ring = planet.hasRing
      ? new THREE.Mesh(
          new THREE.TorusGeometry(planet.radius * 1.42, planet.radius * 0.035, 8, 128),
          new THREE.MeshBasicMaterial({
            color: planet.palette.glow,
            transparent: true,
            opacity: 0.46,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        )
      : null;
    if (ring) {
      ring.scale.y = 0.34;
      ring.rotation.z = hashString(planet.id) * 0.001;
      ring.position.z = planet.radius * 0.18 + 0.04;
      group.add(ring);
    }

    const massLabel = createMassLabel(`M ${planet.mass.toFixed(2)}`, planet.palette.glow, planet.role === "anchor");
    massLabel.sprite.position.set(0, planet.radius + (planet.role === "anchor" ? 0.72 : 0.56), 2.35);
    group.add(massLabel.sprite);

    return { group, body, atmosphere, captureField, captureRing, ring, glow, massLabel };
  }

  private updatePlanets(planets: PlanetState[], earthMass: number): void {
    for (const planet of planets) {
      const view = this.planetViews.get(planet.id);
      if (!view) {
        continue;
      }

      view.group.visible = planet.alive;
      view.body.rotation.y += 0.0026 + planet.radius * 0.0008;
      view.body.rotation.x = Math.sin(this.time * 0.22 + planet.radius) * 0.12;
      view.atmosphere.rotation.z -= 0.0016;

      if (view.captureRing) {
        const canCapture = planet.mass > earthMass * 1.04;
        view.captureRing.material.opacity = canCapture ? 0.16 + Math.sin(this.time * 2.2) * 0.035 : 0.035;
        view.captureRing.material.color.set(canCapture ? planet.palette.glow : "#ffffff");
      }

      if (view.captureField) {
        const canCapture = planet.mass > earthMass * 1.04;
        view.captureField.material.opacity = canCapture ? 0.02 + Math.sin(this.time * 2.2) * 0.006 : 0.008;
        view.captureField.material.color.set(canCapture ? planet.palette.glow : "#ffffff");
      }

      const canSmash = planet.mass < earthMass * 1.01;
      view.glow.material.opacity =
        (planet.role === "anchor" ? 0.28 : 0.15) + (canSmash ? 0.18 + Math.sin(this.time * 5) * 0.04 : 0);
    }
  }

  private updateEarth(state: GameState, dt: number): void {
    const earth = state.earth;
    this.earthGroup.visible = !this.earthDestroyed;
    this.earthGroup.position.x = earth.position.x;
    this.earthGroup.position.y = earth.position.y;
    this.earthGroup.scale.setScalar(earth.radius);
    this.earthMassLabel.updateText(`M ${earth.mass.toFixed(2)}`);
    this.earthMassLabel.sprite.position.set(earth.position.x, earth.position.y + earth.radius + 0.78, 2.7);
    this.earthMassLabel.sprite.visible = state.phase !== "menu" && !this.earthDestroyed;
    const gravityRadius = earthAttractionRadius(earth.radius);
    this.earthGravityRing.position.x = earth.position.x;
    this.earthGravityRing.position.y = earth.position.y;
    this.earthGravityRing.scale.setScalar(gravityRadius);
    this.earthGravityRing.visible = state.phase === "playing";
    this.earthGravityRing.material.opacity = 0.12 + Math.sin(this.time * 4.4) * 0.035;
    this.earthBody.rotation.y += dt * 0.8 + length2(earth.velocity) * dt * 0.04;
    this.earthClouds.rotation.z -= dt * 0.14;
    this.earthAtmosphere.material.opacity = state.thrusting ? 0.26 : 0.17;

    const velocity = normalize(earth.velocity);
    const flameMaterial = this.flame.material as THREE.SpriteMaterial;
    const flamePulse = 0.78 + Math.sin(this.time * 32 + this.clockSeed) * 0.18;
    flameMaterial.opacity = state.thrusting && state.phase === "playing" ? flamePulse : 0;
    flameMaterial.rotation = Math.atan2(velocity.y, velocity.x) - Math.PI / 2;
    this.flame.position.set(
      earth.position.x - velocity.x * earth.radius * 1.42,
      earth.position.y - velocity.y * earth.radius * 1.42,
      1.2,
    );
    this.flame.scale.set(earth.radius * 1.15, earth.radius * (state.thrusting ? 2.7 : 1.6), 1);

    if (state.phase === "playing") {
      this.trailPoints.push(new THREE.Vector3(earth.position.x, earth.position.y, 0.16));
      while (this.trailPoints.length > 110) {
        this.trailPoints.shift();
      }
    } else if (this.trailPoints.length > 0) {
      this.trailPoints.shift();
    }
    this.trailGeometry.setFromPoints(this.trailPoints);
    this.trailLine.material.opacity = state.phase === "playing" ? 0.34 : 0.18;
  }

  private updateFragments(fragments: FragmentState[]): void {
    const activeIds = new Set<number>();

    for (const fragment of fragments) {
      activeIds.add(fragment.id);
      let view = this.fragmentViews.get(fragment.id);
      if (!view) {
        view = {
          mesh: new THREE.Mesh(
            new THREE.IcosahedronGeometry(1, 1),
            new THREE.MeshBasicMaterial({
              color: fragment.color,
              transparent: true,
              opacity: 0.95,
              blending: THREE.AdditiveBlending,
            }),
          ),
        };
        this.fragmentViews.set(fragment.id, view);
        this.scene.add(view.mesh);
      }

      const t = Math.min(1, Math.max(0, fragment.age / fragment.lifetime));
      view.mesh.position.set(fragment.position.x, fragment.position.y, 0.9 + t * 0.45);
      view.mesh.scale.setScalar(fragment.size * (1.2 - t * 0.72));
      view.mesh.rotation.x += 0.09;
      view.mesh.rotation.y += 0.13;
      view.mesh.material.opacity = Math.max(0, 1 - t);
    }

    for (const [id, view] of this.fragmentViews.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(view.mesh);
        view.mesh.geometry.dispose();
        view.mesh.material.dispose();
        this.fragmentViews.delete(id);
      }
    }
  }

  private applyEvents(events: GameEvent[]): void {
    for (const event of events) {
      if (event.type === "smash") {
        this.spawnExplosion(event.position, event.radius, event.color, 72 + event.radius * 32);
      }

      if (event.type === "earthCrash") {
        this.earthDestroyed = true;
        this.earthGroup.visible = false;
        this.earthMassLabel.sprite.visible = false;
        this.spawnExplosion(event.position, event.radius * 1.28, event.color, 110 + event.radius * 42);
      }

      if (event.type === "capture") {
        this.spawnShockwave(event.position, event.radius * 1.7, event.color, 0.55);
      }

      if (event.type === "release") {
        this.spawnShockwave(event.position, event.radius * 2.05, event.color, event.reason === "breakthrough" ? 0.78 : 0.42);
      }
    }
  }

  private spawnExplosion(position: Vec2, radius: number, color: string, count: number): void {
    this.spawnFlash(position, radius, color);
    this.spawnShockwave(position, radius * 2.8, color, 0.7);
    this.spawnShockwave(position, radius * 4.1, "#ffffff", 0.48);
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 4.2 + Math.random() * 12.4;
      const mesh = new THREE.Mesh(
        geometry.clone(),
        new THREE.MeshBasicMaterial({
          color: Math.random() > 0.18 ? color : "#ffffff",
          transparent: true,
          opacity: 1,
          blending: THREE.AdditiveBlending,
        }),
      );
      mesh.position.set(position.x, position.y, 1.05);
      mesh.scale.setScalar(0.055 + Math.random() * 0.16);
      this.scene.add(mesh);
      this.sparks.push({
        mesh,
        velocity: new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0.9 + Math.random() * 2.4),
        age: 0,
        lifetime: 0.58 + Math.random() * 0.72,
      });
    }
  }

  private spawnFlash(position: Vec2, radius: number, color: string): void {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: createGlowTexture(color),
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sprite.position.set(position.x, position.y, 1.4);
    const baseScale = radius * 7.6;
    sprite.scale.setScalar(baseScale);
    this.scene.add(sprite);
    this.flashes.push({ sprite, age: 0, lifetime: 0.34, baseScale });
  }

  private spawnShockwave(position: Vec2, radius: number, color: string, lifetime: number): void {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 128),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.position.set(position.x, position.y, 0.2);
    this.scene.add(mesh);
    this.shockwaves.push({ mesh, age: 0, lifetime, radius });
  }

  private updateEffects(dt: number): void {
    for (const spark of this.sparks) {
      spark.age += dt;
      const t = spark.age / spark.lifetime;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      spark.velocity.multiplyScalar(0.91);
      spark.mesh.scale.multiplyScalar(0.978);
      spark.mesh.material.opacity = Math.max(0, 1 - t);
    }

    for (let index = this.sparks.length - 1; index >= 0; index -= 1) {
      const spark = this.sparks[index];
      if (spark.age >= spark.lifetime) {
        this.scene.remove(spark.mesh);
        spark.mesh.geometry.dispose();
        spark.mesh.material.dispose();
        this.sparks.splice(index, 1);
      }
    }

    for (const flash of this.flashes) {
      flash.age += dt;
      const t = Math.min(1, flash.age / flash.lifetime);
      const scale = flash.baseScale * (0.55 + t * 1.45);
      flash.sprite.scale.setScalar(scale);
      (flash.sprite.material as THREE.SpriteMaterial).opacity = Math.max(0, (1 - t) * 0.95);
    }

    for (let index = this.flashes.length - 1; index >= 0; index -= 1) {
      const flash = this.flashes[index];
      if (flash.age >= flash.lifetime) {
        this.scene.remove(flash.sprite);
        const material = flash.sprite.material as THREE.SpriteMaterial;
        material.map?.dispose();
        material.dispose();
        this.flashes.splice(index, 1);
      }
    }

    for (const shockwave of this.shockwaves) {
      shockwave.age += dt;
      const t = shockwave.age / shockwave.lifetime;
      const eased = 1 - Math.pow(1 - Math.min(1, t), 3);
      shockwave.mesh.scale.setScalar(0.08 + eased * shockwave.radius);
      shockwave.mesh.material.opacity = Math.max(0, (1 - t) * 0.76);
    }

    for (let index = this.shockwaves.length - 1; index >= 0; index -= 1) {
      const wave = this.shockwaves[index];
      if (wave.age >= wave.lifetime) {
        this.scene.remove(wave.mesh);
        wave.mesh.geometry.dispose();
        wave.mesh.material.dispose();
        this.shockwaves.splice(index, 1);
      }
    }
  }
}

function createCircleLine(radius: number, color: string, opacity: number): THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial> {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 160; index += 1) {
    const angle = (index / 160) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
    }),
  );
}

function createStarField(bounds: Vec2, count: number, layer: number): THREE.Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    positions[offset] = (Math.random() * 2 - 1) * bounds.x;
    positions[offset + 1] = (Math.random() * 2 - 1) * bounds.y;
    positions[offset + 2] = -7 - layer * 1.4 + Math.random() * 0.4;
    color.set(Math.random() > 0.82 ? "#ffdca8" : Math.random() > 0.48 ? "#8defff" : "#ffffff");
    color.multiplyScalar(0.55 + Math.random() * 0.75);
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: layer === 1 ? 0.045 : 0.075,
      vertexColors: true,
      transparent: true,
      opacity: layer === 1 ? 0.84 : 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
}

function createNebulaTexture(colorA: string, colorB: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const gradient = context.createRadialGradient(256, 256, 10, 256, 256, 256);
  gradient.addColorStop(0, rgba(colorA, 0.58));
  gradient.addColorStop(0.36, rgba(colorB, 0.24));
  gradient.addColorStop(1, rgba(colorB, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 512);
  for (let index = 0; index < 900; index += 1) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const alpha = Math.random() * 0.08;
    context.fillStyle = Math.random() > 0.5 ? rgba(colorA, alpha) : rgba(colorB, alpha);
    context.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createGlowTexture(color: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const gradient = context.createRadialGradient(128, 128, 5, 128, 128, 128);
  gradient.addColorStop(0, rgba(color, 0.86));
  gradient.addColorStop(0.35, rgba(color, 0.3));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createMassLabel(initialText: string, color: string, primary = false): MassLabel {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: primary ? 0.96 : 0.9,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(primary ? 2.25 : 1.82, primary ? 0.72 : 0.58, 1);

  let currentText = "";
  const draw = (text: string): void => {
    if (text === currentText) {
      return;
    }

    currentText = text;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = rgba(color, 0.74);
    context.shadowBlur = primary ? 16 : 12;
    context.fillStyle = "rgba(2, 8, 18, 0.58)";
    drawRoundedRect(context, 30, 22, 196, 52, 16);
    context.fill();
    context.shadowBlur = 0;
    context.fillStyle = "#f6fbff";
    context.font = `${primary ? 800 : 700} ${primary ? 34 : 31}px Inter, Segoe UI, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(text, 128, 49);
    texture.needsUpdate = true;
  };

  draw(initialText);
  return { sprite, updateText: draw };
}

function drawRoundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const right = x + width;
  const bottom = y + height;
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(right - radius, y);
  context.quadraticCurveTo(right, y, right, y + radius);
  context.lineTo(right, bottom - radius);
  context.quadraticCurveTo(right, bottom, right - radius, bottom);
  context.lineTo(x + radius, bottom);
  context.quadraticCurveTo(x, bottom, x, bottom - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}

function createFlameTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const gradient = context.createRadialGradient(80, 40, 4, 80, 120, 150);
  gradient.addColorStop(0, "rgba(255,255,210,0.98)");
  gradient.addColorStop(0.18, "rgba(110,245,255,0.82)");
  gradient.addColorStop(0.54, "rgba(45,105,255,0.36)");
  gradient.addColorStop(1, "rgba(45,105,255,0)");
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(80, 0);
  context.bezierCurveTo(132, 70, 150, 200, 80, 320);
  context.bezierCurveTo(10, 200, 28, 70, 80, 0);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPlanetTexture(palette: PlanetPalette, seed: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const random = seeded(seed);
  const gradient = context.createLinearGradient(0, 0, 512, 256);
  gradient.addColorStop(0, palette.base);
  gradient.addColorStop(0.5, palette.accent);
  gradient.addColorStop(1, palette.base);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 256);

  for (let band = 0; band < 16; band += 1) {
    const y = random() * 256;
    const height = 5 + random() * 26;
    context.fillStyle = random() > 0.5 ? rgba(palette.accent, 0.22) : rgba("#ffffff", 0.12);
    context.beginPath();
    context.ellipse(256, y, 320 + random() * 160, height, random() * 0.08, 0, Math.PI * 2);
    context.fill();
  }

  for (let spot = 0; spot < 70; spot += 1) {
    context.fillStyle = random() > 0.44 ? rgba(palette.glow, 0.12) : rgba("#000000", 0.1);
    context.beginPath();
    context.ellipse(random() * 512, random() * 256, 4 + random() * 28, 2 + random() * 12, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createEarthTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const ocean = context.createLinearGradient(0, 0, 512, 256);
  ocean.addColorStop(0, "#0b53b8");
  ocean.addColorStop(0.5, "#19c8d9");
  ocean.addColorStop(1, "#08357e");
  context.fillStyle = ocean;
  context.fillRect(0, 0, 512, 256);
  const random = seeded(421);
  for (let land = 0; land < 34; land += 1) {
    context.fillStyle = random() > 0.5 ? "#57c46d" : "#d0ba72";
    context.beginPath();
    const x = random() * 512;
    const y = random() * 256;
    const rx = 18 + random() * 58;
    const ry = 8 + random() * 28;
    context.ellipse(x, y, rx, ry, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createCloudTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas is not available");
  }
  const random = seeded(99);
  context.clearRect(0, 0, 512, 256);
  for (let cloud = 0; cloud < 110; cloud += 1) {
    context.fillStyle = `rgba(255,255,255,${0.08 + random() * 0.16})`;
    context.beginPath();
    context.ellipse(random() * 512, random() * 256, 8 + random() * 46, 2 + random() * 10, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hashString(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) + 1;
}

function seeded(seed: number): () => number {
  let value = seed;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, alpha: number): string {
  const color = new THREE.Color(hex);
  return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${alpha})`;
}

function length2(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}
