import * as d3 from "d3";
import { useEffect, useId, useRef } from "react";
import {
  KEYBOARD_SURFACE_BG,
  renderKeyboardSvg,
  updateGridNodeCirclesFromSnapshot,
} from "./keyboardSvg";
import { mountRainSimulation } from "./rainSimulation";

export interface CanvasProps {
  active: Record<string, boolean>;
}

export default function Canvas({ active }: CanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gradientIdPrefix = useId().replace(/:/g, "");
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    return mountRainSimulation(host, () => activeRef.current, () => {
      updateGridNodeCirclesFromSnapshot(host, gradientIdPrefix);
    });
  }, [gradientIdPrefix]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const paint = () =>
      renderKeyboardSvg(host, activeRef.current, gradientIdPrefix, false);

    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(host);

    return () => {
      ro.disconnect();
      d3.select(host).selectAll("svg.keyboard-svg").remove();
    };
  }, [gradientIdPrefix]);

  useEffect(() => {
    activeRef.current = active;
    const host = hostRef.current;
    if (host) renderKeyboardSvg(host, active, gradientIdPrefix, true);
  }, [active, gradientIdPrefix]);

  return (
    <div
      ref={hostRef}
      className="relative w-full flex-1 min-h-0 min-w-0"
      style={{ backgroundColor: KEYBOARD_SURFACE_BG }}
    />
  );
}
