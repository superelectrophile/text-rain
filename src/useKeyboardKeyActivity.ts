import { useCallback, useEffect, useRef, useState } from "react";

function delayMsFromSeconds(delaySeconds: number): number {
  return Math.max(0, delaySeconds * 1000);
}

/**
 * Tracks which keys are visually "active": true on keydown, false after
 * `delaySeconds` without another keydown/keyup for that key.
 * Each keydown (including OS repeat while held) and each keyup clears the
 * previous deadline and schedules a new one — similar to debounce trailing
 * behavior per key.
 */
export function useKeyboardKeyActivity(
  supportedKeys: ReadonlySet<string>,
  delaySeconds: number,
) {
  const delayRef = useRef(delayMsFromSeconds(delaySeconds));
  delayRef.current = delayMsFromSeconds(delaySeconds);

  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const [active, setActive] = useState<Record<string, boolean>>(() =>
    Object.fromEntries([...supportedKeys].map((k) => [k, false])),
  );

  const clearTimer = useCallback((key: string) => {
    const id = timersRef.current.get(key);
    if (id !== undefined) {
      clearTimeout(id);
      timersRef.current.delete(key);
    }
  }, []);

  const scheduleAutoRelease = useCallback(
    (key: string) => {
      clearTimer(key);
      const id = setTimeout(() => {
        timersRef.current.delete(key);
        setActive((prev) => ({ ...prev, [key]: false }));
      }, delayRef.current);
      timersRef.current.set(key, id);
    },
    [clearTimer],
  );

  const onKeyDown = useCallback(
    (key: string) => {
      if (!supportedKeys.has(key)) return;
      setActive((prev) => ({ ...prev, [key]: true }));
      scheduleAutoRelease(key);
    },
    [supportedKeys, scheduleAutoRelease],
  );

  const onKeyUp = useCallback(
    (key: string) => {
      if (!supportedKeys.has(key)) return;
      scheduleAutoRelease(key);
    },
    [supportedKeys, scheduleAutoRelease],
  );

  useEffect(
    () => () => {
      for (const id of timersRef.current.values()) clearTimeout(id);
      timersRef.current.clear();
    },
    [],
  );

  return { active, onKeyDown, onKeyUp };
}
