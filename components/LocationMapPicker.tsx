'use client';

import { useEffect, useRef, useState } from 'react';

type Place = { place_id: number; display_name: string; lat: string; lon: string };
type LeafletMap = { setView: (point: [number, number], zoom: number) => LeafletMap; on: (event: string, callback: (event: { latlng: { lat: number; lng: number } }) => void) => void; remove: () => void; invalidateSize?: () => void };
type LeafletMarker = { setLatLng: (point: [number, number]) => LeafletMarker; addTo: (map: LeafletMap) => LeafletMarker };
type LeafletApi = { map: (element: HTMLElement, options: object) => LeafletMap; tileLayer: (url: string, options: object) => { addTo: (map: LeafletMap) => void }; marker: (point: [number, number]) => LeafletMarker };
declare global { interface Window { L?: LeafletApi } }

export default function LocationMapPicker({ onSelect }: { onSelect: (place: { address: string; latitude: number; longitude: number }) => void }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markerRef = useRef<LeafletMarker | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      if (!document.querySelector('link[data-leaflet]')) {
        const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; link.dataset.leaflet = 'true'; document.head.appendChild(link);
      }
      if (!window.L) {
        await new Promise<void>((resolve, reject) => {
          const existing = document.querySelector<HTMLScriptElement>('script[data-leaflet]');
          if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(), { once: true }); return; }
          const script = document.createElement('script'); script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'; script.dataset.leaflet = 'true'; script.onload = () => resolve(); script.onerror = () => reject(); document.body.appendChild(script);
        });
      }
      if (disposed || !mapElement.current || !window.L) return;
      const L = window.L;
      const map = L.map(mapElement.current).setView([20.2961, 85.8245], 12);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      map.on('click', async event => {
        const lat = Number(event.latlng.lat.toFixed(7)), lon = Number(event.latlng.lng.toFixed(7));
        if (!markerRef.current) markerRef.current = L.marker([lat, lon]).addTo(map);
        else markerRef.current.setLatLng([lat, lon]);
        try {
          const response = await fetch('https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + lat + '&lon=' + lon);
          const place = await response.json();
          const address = place.display_name || lat + ', ' + lon;
          setSelected({ place_id: Date.now(), display_name: address, lat: String(lat), lon: String(lon) });
          onSelect({ address, latitude: lat, longitude: lon });
        } catch {
          const address = lat + ', ' + lon;
          setSelected({ place_id: Date.now(), display_name: address, lat: String(lat), lon: String(lon) });
          onSelect({ address, latitude: lat, longitude: lon });
        }
      });
      mapRef.current = map;
      setTimeout(() => map.invalidateSize?.(), 100);
    };
    load().catch(() => setError('Map could not be loaded. Check your internet connection and try again.'));
    return () => { disposed = true; mapRef.current?.remove(); mapRef.current = null; markerRef.current = null; };
  }, [onSelect]);

  async function search() {
    if (query.trim().length < 3) { setError('Enter at least 3 characters to search.'); return; }
    setBusy(true); setError('');
    try {
      const response = await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=' + encodeURIComponent(query.trim()), { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Search unavailable');
      const places = await response.json() as Place[];
      setResults(places);
      if (!places.length) setError('No matching places found. Try a nearby landmark or full address.');
    } catch { setError('Location search is temporarily unavailable. Please try again.'); }
    finally { setBusy(false); }
  }

  function choose(place: Place) {
    setSelected(place);
    const latitude = Number(place.lat), longitude = Number(place.lon);
    if (window.L && mapRef.current) {
      mapRef.current.setView([latitude, longitude], 16);
      if (!markerRef.current) markerRef.current = window.L.marker([latitude, longitude]).addTo(mapRef.current);
      else markerRef.current.setLatLng([latitude, longitude]);
    }
    onSelect({ address: place.display_name, latitude, longitude });
    setResults([]);
  }

  return <div className="map-picker">
    <div className="map-search"><input aria-label="Search location" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} placeholder="Search office, area, landmark or address" /><button className="button button-primary" type="button" onClick={() => void search()} disabled={busy}>{busy ? 'Searching…' : 'Search'}</button></div>
    {results.length > 0 && <div className="map-results">{results.map(place => <button type="button" key={place.place_id} onClick={() => choose(place)}>{place.display_name}</button>)}</div>}
    <div ref={mapElement} className="location-map" />
    <p className="form-note">Search for a place or tap the map to pin the exact location. Coordinates are captured automatically. Map data © OpenStreetMap contributors.</p>
    {selected && <div className="map-selected"><strong>Selected location</strong><span>{selected.display_name}</span><small>{Number(selected.lat).toFixed(6)}, {Number(selected.lon).toFixed(6)}</small></div>}
    {error && <div className="notice notice-error">{error}</div>}
  </div>;
}
