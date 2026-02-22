import { Vector3 } from '@math.gl/core'
import { WebMercatorViewport } from '@math.gl/web-mercator'
import { mat4 } from 'gl-matrix'

function getFrustumPlane(a, b, c, d) {
  const length = Math.hypot(a, b, c) || 1
  return {
    distance: d / length,
    normal: new Vector3(-a / length, -b / length, -c / length),
  }
}

function getFrustumPlanes(viewProjectionMatrix) {
  return {
    left: getFrustumPlane(
      viewProjectionMatrix[3] + viewProjectionMatrix[0],
      viewProjectionMatrix[7] + viewProjectionMatrix[4],
      viewProjectionMatrix[11] + viewProjectionMatrix[8],
      viewProjectionMatrix[15] + viewProjectionMatrix[12],
    ),
    right: getFrustumPlane(
      viewProjectionMatrix[3] - viewProjectionMatrix[0],
      viewProjectionMatrix[7] - viewProjectionMatrix[4],
      viewProjectionMatrix[11] - viewProjectionMatrix[8],
      viewProjectionMatrix[15] - viewProjectionMatrix[12],
    ),
    bottom: getFrustumPlane(
      viewProjectionMatrix[3] + viewProjectionMatrix[1],
      viewProjectionMatrix[7] + viewProjectionMatrix[5],
      viewProjectionMatrix[11] + viewProjectionMatrix[9],
      viewProjectionMatrix[15] + viewProjectionMatrix[13],
    ),
    top: getFrustumPlane(
      viewProjectionMatrix[3] - viewProjectionMatrix[1],
      viewProjectionMatrix[7] - viewProjectionMatrix[5],
      viewProjectionMatrix[11] - viewProjectionMatrix[9],
      viewProjectionMatrix[15] - viewProjectionMatrix[13],
    ),
    near: getFrustumPlane(
      viewProjectionMatrix[3] + viewProjectionMatrix[2],
      viewProjectionMatrix[7] + viewProjectionMatrix[6],
      viewProjectionMatrix[11] + viewProjectionMatrix[10],
      viewProjectionMatrix[15] + viewProjectionMatrix[14],
    ),
    far: getFrustumPlane(
      viewProjectionMatrix[3] - viewProjectionMatrix[2],
      viewProjectionMatrix[7] - viewProjectionMatrix[6],
      viewProjectionMatrix[11] - viewProjectionMatrix[10],
      viewProjectionMatrix[15] - viewProjectionMatrix[14],
    ),
  }
}

function normalize3([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1
  return [x / length, y / length, z / length]
}

export class I3SViewportAdapter {
  constructor({
    id = 'main',
    width = 1,
    height = 1,
    longitude = 0,
    latitude = 0,
    zoom = 0,
    pitch = 0,
    bearing = 0,
  } = {}) {
    this.id = id
    this.width = width || 1
    this.height = height || 1
    this.longitude = longitude
    this.latitude = latitude
    this.zoom = zoom
    this.pitch = pitch
    this.bearing = bearing

    this._base = new WebMercatorViewport({
      width: this.width,
      height: this.height,
      longitude,
      latitude,
      zoom,
      pitch,
      bearing,
    })

    this.center = this._base.center
    this.distanceScales = this._base.distanceScales
    this.viewMatrix = this._base.viewMatrix
    this.projectionMatrix = this._base.projectionMatrix
    this.viewProjectionMatrix = this._base.viewProjectionMatrix

    const inverseViewMatrix = mat4.invert([], this.viewMatrix) || this.viewMatrix
    this.cameraPosition = [inverseViewMatrix[12], inverseViewMatrix[13], inverseViewMatrix[14]]
    this.cameraDirection = normalize3([-inverseViewMatrix[8], -inverseViewMatrix[9], -inverseViewMatrix[10]])
    this.cameraUp = normalize3([inverseViewMatrix[4], inverseViewMatrix[5], inverseViewMatrix[6]])
    this._frustumPlanes = null
  }

  project = (...args) => this._base.project(...args)

  unproject = (...args) => this._base.unproject(...args)

  projectPosition = (...args) => this._base.projectPosition(...args)

  unprojectPosition = (...args) => this._base.unprojectPosition(...args)

  getFrustumPlanes() {
    if (!this._frustumPlanes) {
      this._frustumPlanes = getFrustumPlanes(this.viewProjectionMatrix)
    }
    return this._frustumPlanes
  }

  equals(other) {
    if (!other) {
      return false
    }
    return (
      other.width === this.width &&
      other.height === this.height &&
      other.longitude === this.longitude &&
      other.latitude === this.latitude &&
      other.zoom === this.zoom &&
      other.pitch === this.pitch &&
      other.bearing === this.bearing
    )
  }
}
