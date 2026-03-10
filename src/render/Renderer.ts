import * as PIXI from 'pixi.js';

export class Renderer {
  readonly app: PIXI.Application;

  constructor() {
    this.app = new PIXI.Application();
  }

  async init(container: HTMLElement): Promise<void> {
    await this.app.init({
      preference: 'webgl',
      resizeTo: container,
      backgroundColor: 0x000510,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      webgl: {
        powerPreference: 'high-performance',
      },
    });

    // Check for WebGL context - works even with minified class names
    const renderer = this.app.renderer as any;
    const hasWebGL = renderer.gl || renderer.context?.gl || renderer.type === 1;
    if (!hasWebGL) {
      throw new Error('WebGL renderer required but not available');
    }

    container.appendChild(this.app.canvas);
  }

  get width(): number  { return this.app.screen.width; }
  get height(): number { return this.app.screen.height; }
  get stage(): PIXI.Container { return this.app.stage; }

  destroy(): void {
    this.app.destroy(true);
  }
}
