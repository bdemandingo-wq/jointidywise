import { useRef, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';

export function GalleryZoom({ children, onStep }: { children: React.ReactNode; onStep: (delta: number) => void }) {
  const scale = useRef(1);
  const [zoomed, setZoomed] = useState(false);
  const gesture = useRef<{ x: number; y: number; multiple: boolean } | null>(null);
  return <div className="flex h-full min-h-0 w-full items-center justify-center overflow-hidden touch-none"
    onTouchStart={event => {
      if (event.touches.length > 1) { if (gesture.current) gesture.current.multiple = true; return; }
      const touch = event.touches[0];
      if (touch) gesture.current = { x: touch.clientX, y: touch.clientY, multiple: false };
    }}
    onTouchEnd={event => {
      const start = gesture.current;
      gesture.current = null;
      const end = event.changedTouches[0];
      if (!start || !end || start.multiple || scale.current > 1.01) return;
      const dx = end.clientX - start.x;
      const dy = end.clientY - start.y;
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy)) onStep(dx < 0 ? 1 : -1);
    }} onTouchCancel={() => { gesture.current = null; }}>
    <TransformWrapper minScale={1} maxScale={4} centerOnInit panning={{ disabled: !zoomed }}
      onTransform={(_, state) => { scale.current = state.scale; setZoomed(state.scale > 1.01); }}>
      <TransformComponent wrapperClass="!h-full !w-full" contentClass="!h-full !w-full flex items-center justify-center">
        {children}
      </TransformComponent>
    </TransformWrapper>
  </div>;
}