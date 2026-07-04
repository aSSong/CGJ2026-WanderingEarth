export class InputController {
  thrustDown = false;
  thrustPressed = false;
  restartPressed = false;

  private readonly touchButton: HTMLButtonElement | null;

  constructor(touchButton: HTMLButtonElement | null) {
    this.touchButton = touchButton;
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    this.touchButton?.addEventListener("pointerdown", this.handlePointerDown);
    this.touchButton?.addEventListener("pointerup", this.handlePointerUp);
    this.touchButton?.addEventListener("pointercancel", this.handlePointerUp);
    this.touchButton?.addEventListener("pointerleave", this.handlePointerUp);
  }

  endFrame(): void {
    this.thrustPressed = false;
    this.restartPressed = false;
  }

  dispose(): void {
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    this.touchButton?.removeEventListener("pointerdown", this.handlePointerDown);
    this.touchButton?.removeEventListener("pointerup", this.handlePointerUp);
    this.touchButton?.removeEventListener("pointercancel", this.handlePointerUp);
    this.touchButton?.removeEventListener("pointerleave", this.handlePointerUp);
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      event.preventDefault();
      if (!this.thrustDown) {
        this.thrustPressed = true;
      }
      this.thrustDown = true;
    }

    if (event.code === "KeyR") {
      this.restartPressed = true;
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (event.code === "Space") {
      event.preventDefault();
      this.thrustDown = false;
    }
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    event.preventDefault();
    this.touchButton?.setPointerCapture(event.pointerId);
    if (!this.thrustDown) {
      this.thrustPressed = true;
    }
    this.thrustDown = true;
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    event.preventDefault();
    if (this.touchButton?.hasPointerCapture(event.pointerId)) {
      this.touchButton.releasePointerCapture(event.pointerId);
    }
    this.thrustDown = false;
  };
}
