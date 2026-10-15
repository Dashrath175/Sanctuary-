"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { BodyDef } from "@/lib/solar";
import { fitDistance, plateBounds, poseBody } from "./thumbs";

// Small standalone renderer for the records detail panel: the same survey surface (or
// hologram model) as in flight, lit from the upper left. Drag to turn.
export default function RecordPreview({ body }: { body: BodyDef }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, logarithmicDepthBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    const scene = new THREE.Scene();
    const craft = body.surface === "craft";
    const unitKm = craft ? (body.spanM ?? 10) / 1000 / 2 : body.radiusKm;
    const { root, material, ready } = poseBody(body, unitKm, "1k");
    const turn = new THREE.Group();
    turn.add(root);
    scene.add(turn);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
    const frame = () => {
      const { radius, centre } = plateBounds(body, root);
      camera.position.set(centre.x, centre.y, centre.z + fitDistance(radius, 30, body.kind === "star" ? 0.6 : 0.8));
      camera.lookAt(centre);
    };
    frame();
    // a vehicle's model arrives a moment later; frame it once it is there
    if (craft) void ready.then(() => frame());

    let yaw = 0, pitch = 0, drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      yaw += (e.clientX - drag.x) * 0.01;
      pitch = THREE.MathUtils.clamp(pitch + (e.clientY - drag.y) * 0.01, -1.2, 1.2);
      drag = { x: e.clientX, y: e.clientY };
    };
    const up = () => (drag = null);
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);

    const fit = () => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const timer = new THREE.Timer();
    let raf = 0;
    const loop = (now?: number) => {
      raf = requestAnimationFrame(loop);
      timer.update(now);
      if (!drag) yaw += 0.003;
      turn.rotation.set(pitch, yaw, 0);
      if (material) material.uniforms.uTime.value = timer.getElapsed();
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", down);
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", up);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!craft) m.geometry?.dispose?.();
        (m.material as THREE.Material | undefined)?.dispose?.();
      });
      renderer.dispose();
    };
  }, [body]);

  return <canvas ref={ref} className="h-full w-full cursor-grab touch-none active:cursor-grabbing" aria-label={`${body.name}, drag to turn`} />;
}
