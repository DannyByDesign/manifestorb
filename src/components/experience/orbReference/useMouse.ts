import { useEffect, useRef } from "react";

export type PointerState = {
  x: number;
  y: number;
  version: number;
};

export function usePointerState() {
  const pointerRef = useRef<PointerState>({
    x: 0,
    y: 0,
    version: 0,
  });

  useEffect(() => {
    const updatePointer = (clientX: number, clientY: number) => {
      pointerRef.current.x = (clientX / window.innerWidth) * 2 - 1;
      pointerRef.current.y = -(clientY / window.innerHeight) * 2 + 1;
      pointerRef.current.version += 1;
    };

    const handlePointerMove = (event: PointerEvent) => {
      updatePointer(event.clientX, event.clientY);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    updatePointer(window.innerWidth / 2, window.innerHeight / 2);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  return pointerRef;
}
