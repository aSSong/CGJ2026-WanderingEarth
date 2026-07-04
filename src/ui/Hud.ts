import { diameterRatio, type GameEvent, type GameState } from "../game/simulation";
import type { LevelDefinition } from "../game/level";

type HudCallbacks = {
  onStart: () => void;
  onRestart: () => void;
  onSelectLevel: (index: number) => void;
};

export class Hud {
  private readonly startOverlay = this.requireElement<HTMLElement>("startOverlay");
  private readonly resultOverlay = this.requireElement<HTMLElement>("resultOverlay");
  private readonly levelKicker = this.requireElement<HTMLElement>("levelKicker");
  private readonly levelSelect = this.requireElement<HTMLElement>("levelSelect");
  private readonly startButton = this.requireElement<HTMLButtonElement>("startButton");
  private readonly restartButton = this.requireElement<HTMLButtonElement>("restartButton");
  private readonly objectiveText = this.requireElement<HTMLElement>("objectiveText");
  private readonly orbitText = this.requireElement<HTMLElement>("orbitText");
  private readonly massText = this.requireElement<HTMLElement>("massText");
  private readonly diameterText = this.requireElement<HTMLElement>("diameterText");
  private readonly shardText = this.requireElement<HTMLElement>("shardText");
  private readonly prompt = this.requireElement<HTMLElement>("prompt");
  private readonly promptText = this.requireElement<HTMLElement>("promptText");
  private readonly resultKicker = this.requireElement<HTMLElement>("resultKicker");
  private readonly resultTitle = this.requireElement<HTMLElement>("resultTitle");
  private readonly resultBody = this.requireElement<HTMLElement>("resultBody");
  private readonly levelButtons: HTMLButtonElement[] = [];

  private lastPhase: GameState["phase"] | null = null;
  private promptTimer = 0;

  constructor(callbacks: HudCallbacks, levels: readonly LevelDefinition[]) {
    this.levelButtons = levels.map((level, index) => {
      const button = document.createElement("button");
      button.className = "level-option";
      button.type = "button";
      button.textContent = `${index + 1}. ${level.name.replace(/^第.关：/, "")}`;
      button.addEventListener("click", () => callbacks.onSelectLevel(index));
      this.levelSelect.appendChild(button);
      return button;
    });

    this.startButton.addEventListener("click", callbacks.onStart);
    this.restartButton.addEventListener("click", callbacks.onRestart);
  }

  setSelectedLevel(index: number, level: LevelDefinition): void {
    this.levelKicker.textContent = level.name.replace("：", " · ");
    for (const [buttonIndex, button] of this.levelButtons.entries()) {
      button.classList.toggle("is-active", buttonIndex === index);
      button.setAttribute("aria-pressed", buttonIndex === index ? "true" : "false");
    }
  }

  update(state: GameState, events: GameEvent[], dt: number): void {
    this.updatePhase(state, events);
    this.updateStats(state);
    this.updatePrompt(state, events, dt);
  }

  private updatePhase(state: GameState, events: GameEvent[]): void {
    if (state.phase === this.lastPhase && events.length === 0) {
      return;
    }

    document.body.classList.toggle("is-menu", state.phase === "menu");
    document.body.classList.toggle("is-playing", state.phase === "playing");
    document.body.classList.toggle("is-ended", state.phase === "lost" || state.phase === "won");
    this.startOverlay.classList.toggle("is-visible", state.phase === "menu");
    this.resultOverlay.classList.toggle("is-visible", state.phase === "lost" || state.phase === "won");

    for (const event of events) {
      if (event.type === "lost") {
        this.resultKicker.textContent = "航线失败";
        this.resultTitle.textContent = "地球飞出了屏幕";
        this.resultBody.textContent = `最终质量 M ${event.mass.toFixed(2)}，撞碎 ${event.shards} 颗星。`;
      }
      if (event.type === "earthCrash") {
        this.resultKicker.textContent = "撞击失败";
        this.resultTitle.textContent = "地球碎裂了";
        this.resultBody.textContent = `撞上 ${event.planetName}，最终质量 M ${event.mass.toFixed(2)}，撞碎 ${event.shards} 颗星。`;
      }
      if (event.type === "won") {
        this.resultKicker.textContent = `${state.level.name}完成`;
        this.resultTitle.textContent = "地球突破星群";
        this.resultBody.textContent = `质量达到 M ${event.mass.toFixed(2)}，已吸收 ${event.shards} 颗碎星。`;
      }
    }

    this.lastPhase = state.phase;
  }

  private updateStats(state: GameState): void {
    const orbitPlanet = state.earth.orbit
      ? state.planets.find((planet) => planet.id === state.earth.orbit?.planetId)
      : null;

    this.objectiveText.textContent = state.phase === "won" ? "关卡完成" : `目标 M ${state.level.goalMass.toFixed(1)}`;
    this.orbitText.textContent = orbitPlanet ? `环绕 ${orbitPlanet.name}` : state.lastMessage;
    this.massText.textContent = `M ${state.earth.mass.toFixed(2)}`;
    this.diameterText.textContent = `D x${diameterRatio(state.earth.radius).toFixed(2)}`;
    this.shardText.textContent = `${state.stats.smashed} / ${state.level.goalShards}`;
  }

  private updatePrompt(state: GameState, events: GameEvent[], dt: number): void {
    if (state.earth.orbit && state.phase === "playing") {
      this.promptTimer = Math.max(this.promptTimer, 0.9);
      this.promptText.textContent = "切线喷射";
    }

    for (const event of events) {
      if (event.type === "capture") {
        this.promptTimer = 1.25;
        this.promptText.textContent = "切线喷射";
      }
      if (event.type === "release") {
        this.promptTimer = event.reason === "breakthrough" ? 1.4 : 0.45;
        this.promptText.textContent = event.reason === "breakthrough" ? "质量突破" : "喷射中";
      }
      if (event.type === "smash") {
        this.promptTimer = 0.9;
        this.promptText.textContent = `+M ${event.gainedMass.toFixed(2)}`;
      }
    }

    this.promptTimer = Math.max(0, this.promptTimer - dt);
    this.prompt.classList.toggle("is-visible", this.promptTimer > 0 && state.phase === "playing");
  }

  private requireElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Missing UI element #${id}`);
    }
    return element as T;
  }
}
