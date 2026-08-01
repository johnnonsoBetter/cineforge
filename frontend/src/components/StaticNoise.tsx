import React, { useEffect, useRef } from "react";

interface StaticNoiseProps {
  active: boolean;
}

export default function StaticNoise({
  active,
}: StaticNoiseProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationId = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };

    resize();

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;

      const image = ctx.createImageData(width, height);

      const data = image.data;

      for (let i = 0; i < data.length; i += 4) {
        const value = Math.random() * 255;

        data[i] = value;
        data[i + 1] = value;
        data[i + 2] = value;
        data[i + 3] = 255;
      }

      ctx.putImageData(image, 0, 0);

      animationId = requestAnimationFrame(draw);
    };

    draw();

    window.addEventListener("resize", resize);

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
    };
  }, [active]);

  return (
    <div
      className={`absolute inset-0 z-20 transition-opacity duration-300 ${
        active
          ? "opacity-100"
          : "opacity-0 pointer-events-none"
      }`}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}