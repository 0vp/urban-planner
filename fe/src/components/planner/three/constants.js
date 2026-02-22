export const DEFAULT_LOCATION = 'Montreal, Quebec, Canada'

export const I3S_SCENE_LAYER_URL =
  'https://basemaps3d.arcgis.com/arcgis/rest/services/Esri3D_Buildings_v1/SceneServer/layers/0'

export const WORLD_MAP_TILE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}'

export const DEFAULT_VIEW_STATE = {
  longitude: -73.5673,
  latitude: 45.5017,
  zoom: 15,
  pitch: 60,
  bearing: 20,
}

export const COLORS = {
  road: [228, 161, 27, 235],
  roadSelected: [96, 165, 250, 255],
  river: [78, 168, 222, 240],
  riverSelected: [96, 165, 250, 255],
}

export const ENTITY_OPTIONS = [
  { value: 'building', label: 'Building' },
  { value: 'road', label: 'Road' },
  { value: 'river', label: 'River' },
]

export const SELECT_HINT = 'Click a feature to select.'

export const CAMERA_REFERENCE_ZOOM = 15
export const CAMERA_REFERENCE_DISTANCE = 1800

export const DEFAULT_FETCH_RADIUS_METERS = 1200
export const MIN_FETCH_RADIUS_METERS = 300
export const MAX_FETCH_RADIUS_METERS = 10000

export const TILE_CACHE_LIMIT = 320
export const BASEMAP_CACHE_LIMIT = 320
export const BASEMAP_TILE_RADIUS = 4
export const TILE_VISIBILITY_GRACE_TICKS = 3
export const TILE_SELECTION_OVERSCAN = 1.15
export const TILE_SELECTION_ZOOM_BIAS = 0.35
export const TILE_SYNC_DEBOUNCE_MS = 120
export const TILE_SYNC_HEARTBEAT_MS = 1200
export const TILE_SYNC_WARMUP_DELAYS_MS = [0, 120, 320]
