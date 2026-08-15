declare module "@/components/RippleGrid" {
  import type { ComponentType } from "react";

  const RippleGrid: ComponentType<{
    enableRainbow?: boolean;
    gridColor?: string;
    rippleIntensity?: number;
    gridSize?: number;
    gridThickness?: number;
    fadeDistance?: number;
    vignetteStrength?: number;
    glowIntensity?: number;
    opacity?: number;
    gridRotation?: number;
    mouseInteraction?: boolean;
    mouseInteractionRadius?: number;
  }>;

  export default RippleGrid;
}
