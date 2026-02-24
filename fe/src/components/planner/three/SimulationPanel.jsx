import { useCallback, useRef, useState } from 'react'
import {
  simulateTraffic,
  simulateWind,
  simulateSun,
  fetchWeather,
  fetchDensity,
} from '../../../lib/planner/api'

const TIME_OPTIONS = [
  { value: 'morning_rush', label: 'Morning Rush' },
  { value: 'midday', label: 'Midday' },
  { value: 'evening_rush', label: 'Evening Rush' },
  { value: 'night', label: 'Night' },
]

function extractRoads(features) {
  if (!Array.isArray(features)) return []
  return features
    .filter((f) => f.entityType === 'road')
    .map((f) => ({
      id: f.id,
      name: f.attributes?.name || 'Road',
      type: f.attributes?.type || 'road',
      width: f.attributes?.width || 6,
      lanes: f.attributes?.lanes || 1,
      maxspeed: f.attributes?.maxspeed ?? null,
      oneway: f.attributes?.oneway || 'no',
      paths: f.geometry?.paths || [],
    }))
}

function extractBuildings(features) {
  if (!Array.isArray(features)) return []
  return features
    .filter((f) => f.entityType === 'building')
    .map((f) => ({
      id: f.id,
      name: f.attributes?.name || 'Building',
      center: f.center || [0, 0],
      height: f.attributes?.height || 10,
      floors: f.attributes?.floors || 3,
    }))
}

function extractDensityFeatures(features) {
  if (!Array.isArray(features)) return []
  return features.map((f) => ({
    id: f.id,
    entityType: f.entityType,
    center: Array.isArray(f.center) ? f.center : null,
    geometry: f.geometry
      ? {
          paths: f.geometry.paths || null,
          rings: f.geometry.rings || null,
        }
      : null,
  }))
}

export function SimulationPanel({
  center,
  features,
  radiusMeters,
  lassoPolygon,
  onTrafficResult,
  onWindResult,
  onSunResult,
  onWeatherResult,
  onClearOverlays,
  setStatus,
  setSimulationResults,
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [running, setRunning] = useState(null)
  const [timeOfDay, setTimeOfDay] = useState('evening_rush')
  const [sunDate, setSunDate] = useState('2025-06-21')
  const [sunHour, setSunHour] = useState(12)
  const [results, setResults] = useState({})
  const resultsRef = useRef({})

  const updateResults = useCallback((type, result) => {
    const next = { ...resultsRef.current, [type]: result }
    resultsRef.current = next
    setResults(next)
    setSimulationResults?.(next)
  }, [setSimulationResults])

  const run = useCallback(async (type) => {
    if (!center || center.length < 2) {
      setStatus('No region loaded.')
      return
    }
    setRunning(type)
    setStatus(`Running ${type} simulation...`)

    try {
      let result

      if (type === 'traffic') {
        const roads = extractRoads(features)
        if (roads.length === 0) {
          setStatus('No roads in region to simulate traffic.')
          setRunning(null)
          return
        }
        result = await simulateTraffic({
          roads,
          time_of_day: timeOfDay,
          polygon: lassoPolygon,
        })
        onTrafficResult?.(result)

      } else if (type === 'wind') {
        const buildings = extractBuildings(features)
        result = await simulateWind({
          lat: center[1],
          lon: center[0],
          buildings,
        })
        onWindResult?.(result)

      } else if (type === 'sun') {
        // Sun runs purely client-side via the onSunResult callback (uses SunCalc + Three.js)
        result = await simulateSun({
          lat: center[1],
          lon: center[0],
          date: sunDate,
          hours: [sunHour],
        })
        onSunResult?.({ date: sunDate, hour: sunHour })

      } else if (type === 'weather') {
        result = await fetchWeather(center[0], center[1])
        onWeatherResult?.(result)

      } else if (type === 'density') {
        result = await fetchDensity({
          polygon: lassoPolygon || null,
          features: extractDensityFeatures(features),
          radius_meters: radiusMeters,
        })
      }

      updateResults(type, result)
      setStatus(`${type} simulation complete.`)
    } catch (err) {
      setStatus(`${type} simulation failed: ${err.message}`)
    } finally {
      setRunning(null)
    }
  }, [center, features, lassoPolygon, timeOfDay, sunDate, sunHour, radiusMeters, onTrafficResult, onWindResult, onSunResult, onWeatherResult, setStatus, updateResults])

  const runAll = useCallback(async () => {
    for (const type of ['traffic', 'wind', 'sun', 'weather', 'density']) {
      await run(type)
    }
  }, [run])

  if (!isExpanded) {
    return (
      <div className="group relative">
        <button
          onClick={() => setIsExpanded(true)}
          className="p-2 rounded-lg hover:bg-[#2A2A2A] text-[#8b8b8b] hover:text-[#E0E0E0] transition-colors"
        >
          <i className="fa-solid fa-bolt text-lg"></i>
        </button>
        <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-[#2A2A2A] text-[#E0E0E0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          Simulations
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 w-full">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] font-semibold uppercase tracking-widest text-[#666666]">Simulations</h3>
        <button onClick={() => setIsExpanded(false)} className="text-[10px] text-[#666666] hover:text-[#E0E0E0]">
          <i className="fa-solid fa-chevron-up"></i>
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex gap-1.5">
          <select
            value={timeOfDay}
            onChange={(e) => setTimeOfDay(e.target.value)}
            className="flex-1 h-7 rounded-md border border-[#2A2A2A] bg-[#0D0D0D] px-2 text-[11px] text-[#E0E0E0] outline-none"
          >
            {TIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            onClick={() => run('traffic')}
            disabled={!!running}
            className="h-7 px-2.5 rounded-md bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] disabled:opacity-50 text-[11px] font-medium transition-colors"
          >
            {running === 'traffic' ? '...' : 'Traffic'}
          </button>
        </div>

        <div className="flex gap-1.5">
          <input
            type="date"
            value={sunDate}
            onChange={(e) => setSunDate(e.target.value)}
            className="flex-1 h-7 rounded-md border border-[#2A2A2A] bg-[#0D0D0D] px-2 text-[11px] text-[#E0E0E0] outline-none"
          />
          <input
            type="number"
            min={0}
            max={23}
            value={sunHour}
            onChange={(e) => setSunHour(Number(e.target.value))}
            className="w-12 h-7 rounded-md border border-[#2A2A2A] bg-[#0D0D0D] px-2 text-[11px] text-[#E0E0E0] outline-none"
            title="Hour (0-23)"
          />
          <button
            onClick={() => run('sun')}
            disabled={!!running}
            className="h-7 px-2.5 rounded-md bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] disabled:opacity-50 text-[11px] font-medium transition-colors"
          >
            {running === 'sun' ? '...' : 'Sun'}
          </button>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={() => run('wind')}
            disabled={!!running}
            className="flex-1 h-7 rounded-md bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] disabled:opacity-50 text-[11px] font-medium transition-colors"
          >
            {running === 'wind' ? '...' : 'Wind'}
          </button>
          <button
            onClick={() => run('weather')}
            disabled={!!running}
            className="flex-1 h-7 rounded-md bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] disabled:opacity-50 text-[11px] font-medium transition-colors"
          >
            {running === 'weather' ? '...' : 'Weather'}
          </button>
          <button
            onClick={() => run('density')}
            disabled={!!running}
            className="flex-1 h-7 rounded-md bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] disabled:opacity-50 text-[11px] font-medium transition-colors"
          >
            {running === 'density' ? '...' : 'Density'}
          </button>
        </div>

        <div className="flex gap-1.5">
          <button
            onClick={runAll}
            disabled={!!running}
            className="flex-1 h-7 rounded-md bg-[#E0E0E0] text-[#0D0D0D] hover:bg-white disabled:opacity-50 text-[11px] font-medium transition-colors"
          >
            {running ? `Running ${running}...` : 'Run All'}
          </button>
          <button
            onClick={() => {
              onClearOverlays?.()
              resultsRef.current = {}
              setResults({})
              setSimulationResults?.({})
            }}
            className="h-7 px-2.5 rounded-md bg-[#2A2A2A] text-[#E0E0E0] border border-[#333333] hover:bg-[#333333] text-[11px] font-medium transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {Object.keys(results).length > 0 && (
        <div className="rounded-lg border border-[#2A2A2A] bg-[#0D0D0D]/50 p-2.5 space-y-2 text-[11px] max-h-52 overflow-y-auto custom-scrollbar">
          {results.traffic?.summary && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#666666] mb-1">Traffic</div>
              <div className="space-y-0.5 text-[#8b8b8b]">
                <div className="flex justify-between"><span>Segments</span><span className="text-[#E0E0E0]">{results.traffic.summary.total_segments}</span></div>
                <div className="flex justify-between"><span>Congested</span><span className="text-[#E0E0E0]">{results.traffic.summary.congested_segments}</span></div>
                <div className="flex justify-between"><span>Avg V/C</span><span className="text-[#E0E0E0]">{results.traffic.summary.avg_vc_ratio}</span></div>
                {results.traffic.hotspots?.slice(0, 3).map((h, i) => (
                  <div key={i} className="text-[#ff8800] text-[10px]">
                    <i className="fa-solid fa-triangle-exclamation mr-1"></i>{h.road_name} ({h.congestion})
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.wind?.summary && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#666666] mb-1">Wind</div>
              <div className="space-y-0.5 text-[#8b8b8b]">
                <div className="flex justify-between"><span>Avg speed</span><span className="text-[#E0E0E0]">{results.wind.summary.avg_speed_kmh} km/h</span></div>
                <div className="flex justify-between"><span>Max speed</span><span className="text-[#E0E0E0]">{results.wind.summary.max_speed_kmh} km/h</span></div>
                <div className="flex justify-between"><span>Wind tunnels</span><span className="text-[#E0E0E0]">{results.wind.summary.wind_tunnels_detected}</span></div>
              </div>
            </div>
          )}

          {results.sun?.summary && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#666666] mb-1">Sun</div>
              <div className="space-y-0.5 text-[#8b8b8b]">
                <div className="flex justify-between"><span>Daylight hours</span><span className="text-[#E0E0E0]">{results.sun.summary.daylight_hours}h</span></div>
                <div className="flex justify-between"><span>Peak elevation</span><span className="text-[#E0E0E0]">{results.sun.summary.peak_elevation}°</span></div>
                <div className="flex justify-between"><span>Winter noon</span><span className="text-[#E0E0E0]">{results.sun.summary.winter_noon_elevation}°</span></div>
              </div>
            </div>
          )}

          {results.weather?.current && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#666666] mb-1">Weather</div>
              <div className="space-y-0.5 text-[#8b8b8b]">
                <div className="flex justify-between"><span>Temperature</span><span className="text-[#E0E0E0]">{results.weather.current.temperature_c}°C</span></div>
                <div className="flex justify-between"><span>Feels like</span><span className="text-[#E0E0E0]">{results.weather.current.feels_like_c}°C</span></div>
                <div className="flex justify-between"><span>Wind</span><span className="text-[#E0E0E0]">{results.weather.current.wind_speed_kmh} km/h</span></div>
                <div className="flex justify-between"><span>UV Index</span><span className="text-[#E0E0E0]">{results.weather.current.uv_index}</span></div>
              </div>
            </div>
          )}

          {results.density && (
            <div>
              <div className="text-[10px] uppercase tracking-wide text-[#666666] mb-1">Density</div>
              <div className="space-y-0.5 text-[#8b8b8b]">
                <div className="flex justify-between"><span>Buildings/km²</span><span className="text-[#E0E0E0]">{results.density.building_density_per_km2}</span></div>
                <div className="flex justify-between"><span>Green ratio</span><span className="text-[#E0E0E0]">{(results.density.green_space_ratio * 100).toFixed(1)}%</span></div>
                <div className="flex justify-between"><span>Walkability</span><span className="text-[#E0E0E0]">{results.density.walkability_score}/100</span></div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
