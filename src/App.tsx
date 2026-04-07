import "./App.css";
import KeyboardButton from "./KeyboardButton";
import {
  KEYBOARD_BOUNDS,
  KEYBOARD_HEIGHT_UNITS,
  KEYBOARD_WIDTH_UNITS,
  KEY_POSITION_MAP,
} from "./keyboardLayout";
import { useKeyboardKeyActivity } from "./useKeyboardKeyActivity";
import { useCallback, useEffect, useMemo, useState } from "react";
import Canvas from "./Canvas";

function App() {
  const [delay, setDelay] = useState<number>(5);
  const [mode, setMode] = useState<"debug" | "text-rain">("text-rain");
  const supportedKeys = useMemo(
    () => new Set<string>(Object.keys(KEY_POSITION_MAP)),
    [],
  );
  const { active, onKeyDown, onKeyUp } = useKeyboardKeyActivity(
    supportedKeys,
    delay,
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      onKeyDown(event.key.toLowerCase());
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      onKeyUp(event.key.toLowerCase());
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [onKeyDown, onKeyUp]);

  const handleDelayChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setDelay(Number(event.target.value));
    },
    [],
  );

  const handleModeChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      setMode(event.target.value as "debug" | "text-rain");
    },
    [],
  );

  return (
    <div className="flex flex-col items-center justify-center gap-2 h-full w-full m-0">
      <div className="border-b border-gray-300 w-full p-2 flex flex-row gap-8 items-center">
        <p>Press a key!</p>
        <div className="flex flex-row gap-1 items-center">
          <label htmlFor="delay-input">
            Enter Delay (currently {delay} seconds)
          </label>
          <input
            name="delay-input"
            type="range"
            min={0}
            max={10}
            value={delay}
            onChange={handleDelayChange}
          />
        </div>
        <div className="flex flex-row gap-1 items-center">
          <input
            type="radio"
            id="mode1"
            name="mode-input"
            value="debug"
            checked={mode === "debug"}
            onChange={handleModeChange}
          />
          <label htmlFor="mode1">Debug</label>

          <input
            type="radio"
            id="mode2"
            name="mode-input"
            value="text-rain"
            checked={mode === "text-rain"}
            onChange={handleModeChange}
          />
          <label htmlFor="mode2">Text Rain</label>
        </div>
      </div>
      {mode === "debug" && (
        <div className="flex w-full justify-center">
          <div
            className="relative w-full max-w-full"
            style={{
              aspectRatio: `${KEYBOARD_WIDTH_UNITS} / ${KEYBOARD_HEIGHT_UNITS}`,
            }}
          >
            {(
              Object.keys(KEY_POSITION_MAP) as (keyof typeof KEY_POSITION_MAP)[]
            ).map((key) => {
              const { x, y } = KEY_POSITION_MAP[key];
              const { minX, minY } = KEYBOARD_BOUNDS;
              return (
                <KeyboardButton
                  key={key}
                  label={key.toUpperCase()}
                  leftPct={((x - minX) / KEYBOARD_WIDTH_UNITS) * 100}
                  topPct={((y - minY) / KEYBOARD_HEIGHT_UNITS) * 100}
                  widthPct={(1 / KEYBOARD_WIDTH_UNITS) * 100}
                  heightPct={(1 / KEYBOARD_HEIGHT_UNITS) * 100}
                  active={active[key]}
                />
              );
            })}
          </div>
        </div>
      )}

      {mode === "text-rain" && <Canvas active={active} />}
    </div>
  );
}

export default App;
