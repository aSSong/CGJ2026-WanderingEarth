import "./styles.css";
import { InputController } from "./game/input";
import { LEVELS } from "./game/levels";
import { Simulation } from "./game/simulation";
import { UniverseRenderer } from "./render/UniverseRenderer";
import { Hud } from "./ui/Hud";

const mount = document.getElementById("game");
const touchButton = document.getElementById("touchThrust") as HTMLButtonElement | null;

if (!mount) {
  throw new Error("Missing #game mount");
}

const gameMount = mount;
const input = new InputController(touchButton);
let selectedLevelIndex = 0;
let currentLevel = LEVELS[selectedLevelIndex];
let simulation = new Simulation(currentLevel);
let renderer = new UniverseRenderer(gameMount, currentLevel);
let lastTime = performance.now();
let hud: Hud;

function loadLevel(index: number, startImmediately: boolean): void {
  if (!LEVELS[index]) {
    return;
  }

  selectedLevelIndex = index;
  currentLevel = LEVELS[selectedLevelIndex];
  renderer.dispose();
  simulation = new Simulation(currentLevel);
  renderer = new UniverseRenderer(gameMount, currentLevel);
  hud.setSelectedLevel(selectedLevelIndex, currentLevel);
  if (startImmediately) {
    simulation.start();
  }
  hud.update(simulation.state, [], 0);
  lastTime = performance.now();
}

function selectLevel(index: number): void {
  if (index === selectedLevelIndex) {
    return;
  }

  loadLevel(index, false);
}

hud = new Hud({
  onStart: () => simulation.start(),
  onRestart: () => simulation.restart(),
  onNextLevel: () => loadLevel(selectedLevelIndex + 1, true),
  onBackToTitle: () => loadLevel(selectedLevelIndex, false),
  onSelectLevel: selectLevel,
}, LEVELS);

function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  const events = simulation.update(dt, input);
  renderer.update(simulation.state, events, dt);
  hud.update(simulation.state, events, dt);
  input.endFrame();
  requestAnimationFrame(frame);
}

hud.setSelectedLevel(selectedLevelIndex, currentLevel);
hud.update(simulation.state, [], 0);
requestAnimationFrame(frame);

window.addEventListener("beforeunload", () => {
  input.dispose();
  renderer.dispose();
});
