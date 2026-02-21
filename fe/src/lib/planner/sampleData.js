import { zoneFromTags } from './theme'

function squareFootprint(size = 16) {
  const half = size / 2
  return [
    { x: -half, z: -half },
    { x: half, z: -half },
    { x: half, z: half },
    { x: -half, z: half },
  ]
}

function rectanglePath(length = 40, width = 8) {
  const halfL = length / 2
  const halfW = width / 2

  return [
    { x: -halfL, z: -halfW },
    { x: halfL, z: -halfW },
    { x: halfL, z: halfW },
    { x: -halfL, z: halfW },
  ]
}

function id(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function createDefaultEntities() {
  return [
    {
      id: id('bld'),
      type: 'building',
      geometry: { footprint: squareFootprint(18) },
      transform: { position: [-28, 0, -24], rotation: [0, 0, 0], scale: [1, 1, 1] },
      style: { height: 22, zone: zoneFromTags({ building: 'apartments' }) },
      metadata: { name: 'Residential Block' },
    },
    {
      id: id('bld'),
      type: 'building',
      geometry: { footprint: squareFootprint(22) },
      transform: { position: [18, 0, -18], rotation: [0, 0, 0], scale: [1, 1, 1] },
      style: { height: 36, zone: zoneFromTags({ office: 'yes' }) },
      metadata: { name: 'Commercial Tower' },
    },
    {
      id: id('bld'),
      type: 'building',
      geometry: { footprint: rectanglePath(18, 26) },
      transform: { position: [32, 0, 30], rotation: [0, 0.2, 0], scale: [1, 1, 1] },
      style: { height: 18, zone: zoneFromTags({ landuse: 'industrial' }) },
      metadata: { name: 'Workshop' },
    },
    {
      id: id('road'),
      type: 'road',
      geometry: {
        path: [
          { x: -130, z: -10 },
          { x: 130, z: -10 },
          { x: 130, z: 10 },
          { x: -130, z: 10 },
          { x: -130, z: -10 },
        ],
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      style: { width: 8 },
      metadata: { highway: 'primary' },
    },
    {
      id: id('river'),
      type: 'river',
      geometry: {
        path: [
          { x: -140, z: 70 },
          { x: -80, z: 52 },
          { x: -10, z: 60 },
          { x: 70, z: 52 },
          { x: 140, z: 62 },
        ],
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      style: { width: 16 },
      metadata: { waterway: 'river' },
    },
    {
      id: id('park'),
      type: 'park',
      geometry: {
        footprint: [
          { x: -42, z: 16 },
          { x: -4, z: 10 },
          { x: 18, z: 28 },
          { x: 10, z: 56 },
          { x: -26, z: 60 },
        ],
      },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      style: { height: 0.7 },
      metadata: { leisure: 'park' },
    },
  ]
}

export function createMontrealSeed() {
  return {
    entities: createDefaultEntities(),
    locationMeta: {
      query: 'Montreal',
      center: { lat: 45.5017, lon: -73.5673 },
      source: 'seed',
    },
  }
}

export function createEntityTemplate(type) {
  const base = {
    id: id(type),
    type,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    },
    style: {},
    metadata: {},
  }

  if (type === 'building') {
    return {
      ...base,
      geometry: { footprint: squareFootprint(16) },
      style: { height: 20, zone: 'mixed' },
    }
  }

  if (type === 'road') {
    return {
      ...base,
      geometry: {
        path: [
          { x: -20, z: 0 },
          { x: 20, z: 0 },
        ],
      },
      style: { width: 7 },
    }
  }

  if (type === 'river') {
    return {
      ...base,
      geometry: {
        path: [
          { x: -30, z: -4 },
          { x: 30, z: 6 },
        ],
      },
      style: { width: 14 },
    }
  }

  return {
    ...base,
    type: 'park',
    geometry: {
      footprint: rectanglePath(30, 20),
    },
    style: { height: 0.5 },
  }
}
