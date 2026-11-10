import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LocateFixed, MapPin, Minus, Plus, Store, ZoomIn } from 'lucide-react';
import type { ApiStore } from '../api';

type Point = { latitude: number; longitude: number };
type View = Point & { zoom: number };
type Dimensions = { width: number; height: number };
type StoreMapProps = {
  location: Point;
  isGps: boolean;
  stores: ApiStore[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  radiusKm: number;
};

const TILE = 256;
const MIN_ZOOM = 9;
const MAX_ZOOM = 18;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const numberKm = (n: number | null) => n === null ? 'distância indisponível' : n < 1 ? `${Math.round(n * 1000)} m` : `${n.toFixed(1).replace('.', ',')} km`;

// Projeção Web Mercator, a mesma utilizada pelos mosaicos do OpenStreetMap.
// Não dependemos de um segundo iframe: cada coordenada recebe seu próprio marcador.
export function project(point: Point, zoom: number) {
  // O driver MySQL pode serializar campos DECIMAL como texto; normalizamos no cliente.
  const latitude = clamp(Number(point.latitude), -85.05112878, 85.05112878);
  const longitude = Number(point.longitude);
  const scale = TILE * 2 ** zoom;
  const rad = latitude * Math.PI / 180;
  return {
    x: (longitude + 180) / 360 * scale,
    y: (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2 * scale,
  };
}
export function unproject(x: number, y: number, zoom: number): Point {
  const scale = TILE * 2 ** zoom;
  return {
    latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI,
    longitude: x / scale * 360 - 180,
  };
}

function fitView(points: Point[], size: Dimensions): View {
  if (points.length === 0) return { latitude: -2.53, longitude: -44.28, zoom: 13 };
  if (size.width < 80 || size.height < 80) return { ...points[0], zoom: 13 };
  // Margens para evitar que os pins e seus balões sejam cortados.
  const usableW = Math.max(140, size.width - 120);
  const usableH = Math.max(140, size.height - 155);
  let bestZoom = MIN_ZOOM;
  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
    const p = points.map(point => project(point, z));
    const extentX = Math.max(...p.map(a => a.x)) - Math.min(...p.map(a => a.x));
    const extentY = Math.max(...p.map(a => a.y)) - Math.min(...p.map(a => a.y));
    if (extentX <= usableW && extentY <= usableH) { bestZoom = z; break; }
  }
  const projected = points.map(point => project(point, bestZoom));
  const x = (Math.min(...projected.map(p => p.x)) + Math.max(...projected.map(p => p.x))) / 2;
  const y = (Math.min(...projected.map(p => p.y)) + Math.max(...projected.map(p => p.y))) / 2;
  return { ...unproject(x, y, bestZoom), zoom: Math.min(bestZoom, 16) };
}

function openPlace(store: ApiStore) {
  return `https://www.openstreetmap.org/?mlat=${encodeURIComponent(store.latitude)}&mlon=${encodeURIComponent(store.longitude)}#map=17/${store.latitude}/${store.longitude}`;
}

export default function StoresMap({ location, isGps, stores, selectedId, onSelect, radiusKm }: StoreMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; center: { x: number; y: number }; pointerId: number } | null>(null);
  const [size, setSize] = useState<Dimensions>({ width: 820, height: 535 });
  const [view, setView] = useState<View>({ ...location, zoom: 13 });
  const [tileErrors, setTileErrors] = useState<Set<string>>(new Set());
  const selected = stores.find(store => store.id === selectedId) ?? null;

  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const resize = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A primeira visualização enquadra todas as lojas que passaram nos filtros.
  useEffect(() => {
    setView(fitView([location, ...stores], size));
  }, [location.latitude, location.longitude, stores, size.width, size.height]);

  // O pin selecionado fica centralizado com zoom suficiente para ser identificado.
  useEffect(() => {
    if (selected) setView(current => ({ latitude: selected.latitude, longitude: selected.longitude, zoom: Math.max(14, current.zoom) }));
  }, [selected?.id, selected?.latitude, selected?.longitude]);

  const center = project(view, view.zoom);
  const topLeft = { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  const tiles = useMemo(() => {
    const result: { key: string; url: string; x: number; y: number }[] = [];
    const total = 2 ** view.zoom;
    const firstX = Math.floor(topLeft.x / TILE);
    const firstY = Math.floor(topLeft.y / TILE);
    const lastX = Math.floor((topLeft.x + size.width) / TILE);
    const lastY = Math.floor((topLeft.y + size.height) / TILE);
    for (let x = firstX; x <= lastX; x++) {
      for (let y = firstY; y <= lastY; y++) {
        if (y < 0 || y >= total) continue;
        const wrapX = ((x % total) + total) % total;
        result.push({
          key: `${view.zoom}-${x}-${y}`,
          url: `https://tile.openstreetmap.org/${view.zoom}/${wrapX}/${y}.png`,
          x: x * TILE - topLeft.x,
          y: y * TILE - topLeft.y,
        });
      }
    }
    return result;
  }, [view.latitude, view.longitude, view.zoom, size.width, size.height]);

  const pixel = (point: Point) => {
    const p = project(point, view.zoom);
    return { x: p.x - topLeft.x, y: p.y - topLeft.y };
  };
  const me = pixel(location);
  const distancePerPixel = 156543.03392 * Math.cos(location.latitude * Math.PI / 180) / 2 ** view.zoom;
  const radiusPx = radiusKm * 1000 / Math.max(0.001, distancePerPixel);
  const selectedPoint = selected ? pixel(selected) : null;

  function changeZoom(by: number) {
    setView(current => ({ ...current, zoom: clamp(current.zoom + by, MIN_ZOOM, MAX_ZOOM) }));
  }
  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button,a')) return;
    const currentCenter = project(view, view.zoom);
    drag.current = { x: event.clientX, y: event.clientY, center: currentCenter, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    const moved = unproject(drag.current.center.x - dx, drag.current.center.y - dy, view.zoom);
    setView(current => ({ ...moved, zoom: current.zoom }));
  }
  function endPointer(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  return <div
    ref={container}
    className="pc-real-map pc-interactive-map"
    aria-label={`Mapa interativo com ${stores.length} estabelecimentos encontrados`}
    onPointerDown={onPointerDown}
    onPointerMove={onPointerMove}
    onPointerUp={endPointer}
    onPointerCancel={endPointer}
  >
    <div className="pc-map-tiles" aria-hidden="true">
      {tiles.map(tile => !tileErrors.has(tile.key) && <img
        key={tile.key}
        src={tile.url}
        alt=""
        draggable={false}
        loading="lazy"
        onError={() => setTileErrors(previous => new Set([...previous, tile.key]))}
        style={{ transform: `translate(${tile.x}px, ${tile.y}px)` }}
      />)}
    </div>
    <div className="pc-map-search-radius" style={{ left: me.x, top: me.y, width: radiusPx * 2, height: radiusPx * 2 }} aria-hidden="true" />
    <div className="pc-map-user-pin" style={{ left: me.x, top: me.y }} title={isGps ? 'Sua localização pelo navegador' : 'Bairro escolhido (posição aproximada)'}>
      <span />
    </div>
    {stores.map((store, index) => {
      const point = pixel(store);
      if (point.x < -50 || point.y < -50 || point.x > size.width + 50 || point.y > size.height + 50) return null;
      return <button
        key={store.osmId || store.id}
        type="button"
        className={`pc-map-store-pin ${selectedId === store.id ? 'is-selected' : ''}`}
        style={{ left: point.x, top: point.y }}
        aria-label={`${store.name}, ${numberKm(store.distanceKm)}. Ver localização.`}
        title={`${store.name} · ${numberKm(store.distanceKm)}`}
        onClick={() => onSelect(store.id)}
      >
        <Store size={17} strokeWidth={2.2} />
        <span>{index + 1}</span>
      </button>;
    })}
    {selected && selectedPoint && <div className="pc-map-store-popover" style={{ left: clamp(selectedPoint.x, 142, size.width - 142), top: Math.max(92, selectedPoint.y - 24) }}>
      <strong>{selected.name}</strong>
      <small>{selected.address || selected.neighborhood || 'Endereço não informado'}</small>
      <span><MapPin size={12} /> {numberKm(selected.distanceKm)} · localização mapeada</span>
      <a href={openPlace(selected)} target="_blank" rel="noopener noreferrer">Abrir no OpenStreetMap <ExternalLink size={12} /></a>
    </div>}
    <div className="pc-map-overlay"><MapPin size={15} /> {selected ? 'Mercado selecionado' : `${stores.length} mercado${stores.length !== 1 ? 's' : ''} no mapa`}</div>
    <button type="button" className="pc-map-show-all" onClick={() => setView(fitView([location, ...stores], size))}>Ver todos os mercados</button>
    <div className="pc-map-controls">
      <button type="button" title="Aumentar zoom" aria-label="Aumentar zoom" onClick={() => changeZoom(1)}><Plus size={18} /></button>
      <button type="button" title="Diminuir zoom" aria-label="Diminuir zoom" onClick={() => changeZoom(-1)}><Minus size={18} /></button>
      <button type="button" className="pc-map-fit" title="Mostrar todos os supermercados" aria-label="Mostrar todos os supermercados" onClick={() => setView(fitView([location, ...stores], size))}><ZoomIn size={17} /></button>
      <button type="button" className="pc-map-fit" title="Centralizar na sua localização" aria-label="Centralizar na sua localização" onClick={() => setView({ ...location, zoom: 15 })}><LocateFixed size={17} /></button>
    </div>
    <div className="pc-map-bottom">
      <span>© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · ODbL</span>
      <span className="pc-map-hint">Arraste para mover · +/− para zoom · <span className="pc-map-hint-number">1</span> a <span className="pc-map-hint-number">{stores.length}</span> são as lojas</span>
    </div>
  </div>;
}
