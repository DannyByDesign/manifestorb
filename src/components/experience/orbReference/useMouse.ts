import { useEffect, useState } from "react";

export function useMouse() {
  const [mouse, setMouse] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const x = (event.clientX / window.innerWidth) * 2 - 1;
      const y = -(event.clientY / window.innerHeight) * 2 + 1;

      setMouse({ x, y });
    };

    window.addEventListener("mousemove", handleMouseMove);
    handleMouseMove({
      clientX: window.innerWidth / 2,
      clientY: window.innerHeight / 2,
    } as MouseEvent);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
    };
  }, []);

  return mouse;
}
