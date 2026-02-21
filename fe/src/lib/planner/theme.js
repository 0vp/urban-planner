export const plannerThemes = {
  pastel: {
    scene: {
      background: '#dbeafe',
      fog: '#e0f2fe',
      fogNear: 120,
      fogFar: 520,
    },
    lighting: {
      ambient: 0.5,
      hemisphere: 0.35,
      directional: 1.2,
      sunColor: '#fffaf0',
      skyColor: '#e0f2fe',
      groundColor: '#d8b4fe',
    },
    ground: {
      color: '#f8fafc',
      gridCell: '#cbd5e1',
      gridSection: '#94a3b8',
    },
    layers: {
      roads: '#94a3b8',
      rivers: '#7dd3fc',
      parks: '#86efac',
      buildingOutline: '#334155',
      selected: '#fb7185',
    },
    zones: {
      residential: '#fecdd3',
      commercial: '#c4b5fd',
      industrial: '#fdba74',
      mixed: '#bfdbfe',
      default: '#ddd6fe',
    },
  },
  night: {
    scene: {
      background: '#020617',
      fog: '#0b1120',
      fogNear: 120,
      fogFar: 460,
    },
    lighting: {
      ambient: 0.3,
      hemisphere: 0.2,
      directional: 0.9,
      sunColor: '#dbeafe',
      skyColor: '#172554',
      groundColor: '#111827',
    },
    ground: {
      color: '#111827',
      gridCell: '#334155',
      gridSection: '#64748b',
    },
    layers: {
      roads: '#475569',
      rivers: '#0ea5e9',
      parks: '#16a34a',
      buildingOutline: '#cbd5e1',
      selected: '#fb7185',
    },
    zones: {
      residential: '#f472b6',
      commercial: '#818cf8',
      industrial: '#fb923c',
      mixed: '#38bdf8',
      default: '#a78bfa',
    },
  },
}

export const defaultThemeName = 'pastel'

export function getTheme(themeName = defaultThemeName) {
  return plannerThemes[themeName] ?? plannerThemes[defaultThemeName]
}

export function zoneFromTags(tags = {}) {
  if (tags.landuse === 'industrial') {
    return 'industrial'
  }

  if (tags.shop || tags.office || tags.commercial === 'yes') {
    return 'commercial'
  }

  if (tags.building === 'apartments' || tags.building === 'house' || tags.residential === 'yes') {
    return 'residential'
  }

  if (tags.building === 'yes') {
    return 'mixed'
  }

  return 'default'
}
