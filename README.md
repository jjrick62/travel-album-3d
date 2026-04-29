# Travel Album 3D

A particle-based 3D Earth travel album built with Three.js. Record places you've visited, mark them on a glowing particle globe with China's administrative boundaries down to district level.

All data stored locally in IndexedDB. No backend, no signup, no tracking.

## Features

- **3D Particle Earth** — Coastlines, country borders, and China's province/city/district boundaries rendered as white particles with additive blending. Earth auto-rotates with zoom-adaptive speed and drag sensitivity.
- **Four-Level Administrative Detail** — Boundaries reveal progressively as you zoom in: borders at global view, provinces at moderate zoom, cities and districts at close range. Each level uses distinct particle density and size.
- **Region-Fill Highlighting** — Visited locations fill their corresponding administrative polygon with dense particles, creating a glow effect that matches the map aesthetic. Zoom out and the fill collapses to a subtle luminous dot.
- **Home-to-Destination Arcs** — Quadratic Bezier curves projected above the sphere surface connect your home base to each visited place.
- **Full Chinese City Search** — 3,200+ entries covering all provinces, prefecture-level cities, and counties. Relevance-ranked search with instant dropdown.
- **Offline Map Data** — All GeoJSON boundaries stored locally. No runtime network dependency for map rendering.
- **Photo Gallery** — Attach photos to each place. Thumbnail grid in the detail card, full-size viewer with captions.
- **Star Ratings** — Rate each place 1-5. The fill density and dot brightness scale with rating.
- **Export / Import** — Download all data as JSON. Import to restore or share.
- **Persistent Storage** — IndexedDB-backed. Refresh the page, close the browser — your data stays.

## Tech Stack

| Layer | Technology |
|-------|------------|
| 3D Engine | Three.js (ES module, CDN) |
| Controls | OrbitControls with adaptive sensitivity |
| Storage | IndexedDB (raw API) |
| Map Data | DataV GeoAtlas (GeoJSON, 23MB district boundaries lazy-loaded) |
| UI | Vanilla HTML/CSS/JS, dark monochrome |

## Project Structure

```
travel-album-3d/
├── index.html              # Entry point
├── css/style.css            # Dark monochrome UI
├── js/
│   ├── app.js               # UI logic, search, persistence
│   ├── earth.js              # Three.js particle globe engine
│   └── data.js               # IndexedDB data layer
├── data/
│   ├── cities.json           # 3,229 Chinese city/district entries
│   └── map/
│       ├── coastline.geojson  # Global coastline
│       ├── borders.geojson    # Country borders
│       ├── china_provinces.geojson  # Province boundaries
│       ├── china_cities.geojson     # City boundaries (3.2 MB)
│       └── china_districts.geojson  # District boundaries (23 MB, lazy)
└── README.md
```

## Getting Started

Serve the project root with any static file server:

```bash
npx http-server . -p 8081
```

Open `http://localhost:8081` in a modern browser (Chrome/Firefox/Edge, ES modules required).

## Usage

1. Open the settings dropdown and set your home city.
2. Click [+] to add a place — search by city or district name, set a date and rating.
3. Zoom in to reveal province, city, and district boundaries.
4. Click a glowing dot on the globe to open the detail card.
5. Add photos, edit notes, change ratings.
6. Export your data anytime from the settings menu.

## Browser Support

Chrome 80+, Firefox 80+, Edge 80+, Safari 15+. Requires ES modules, IndexedDB, and WebGL.

## License

MIT
