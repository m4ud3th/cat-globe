import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import countries from 'i18n-iso-countries'
import enLocale from 'i18n-iso-countries/langs/en.json'
import { geoArea, geoCentroid, geoEquirectangular, geoPath } from 'd3-geo'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './App.css'

countries.registerLocale(enLocale)

const GLOBE_RADIUS = 1
const MAP_TEXTURE_WIDTH = 4096
const MAP_TEXTURE_HEIGHT = 2048
const OCEAN_COLOR = '#cfe9ff'
const LAND_COLORS = ['#ffdbe8', '#ffe5cc', '#f9e7b2', '#d8f4d2', '#f0d9ff', '#ffd9c9', '#e9f8d8']
const BORDER_COLOR = '#6a56b7'
const LABEL_FRONT_SHOW = 0.08
const LABEL_FRONT_HIDE = -0.02
const COMMON_NAME_OVERRIDES = {
  'Russian Federation': 'Russia',
  'United States of America': 'United States',
  'Bolivarian Republic of Venezuela': 'Venezuela',
  'United Republic of Tanzania': 'Tanzania',
  'Democratic Republic of the Congo': 'DR Congo',
  'Republic of the Congo': 'Congo',
  'Syrian Arab Republic': 'Syria',
  'Islamic Republic of Iran': 'Iran',
  'Republic of Moldova': 'Moldova',
  'Lao People\'s Democratic Republic': 'Laos',
  'Democratic People\'s Republic of Korea': 'North Korea',
  'Republic of Korea': 'South Korea',
  'Viet Nam': 'Vietnam',
  'Czechia': 'Czech Republic',
}

function lonLatToVector3(lon, lat, radius = GLOBE_RADIUS) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180

  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

function disposeGroup(group) {
  group.children.forEach((child) => {
    if (child.geometry) child.geometry.dispose()
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose())
      } else {
        child.material.dispose()
      }
    }
  })

  while (group.children.length) {
    group.remove(group.children[0])
  }
}

function colorFromName(name) {
  if (!name) return LAND_COLORS[0]

  let hash = 0
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }

  return LAND_COLORS[hash % LAND_COLORS.length]
}

function createCountryTexture(geojson, maxAnisotropy, maxTextureSize) {
  if (geojson?.type !== 'FeatureCollection') return null

  const features = geojson.features ?? []
  if (!features.length) return null

  const safeWidth = Math.min(MAP_TEXTURE_WIDTH, maxTextureSize)
  const safeHeight = Math.min(MAP_TEXTURE_HEIGHT, Math.floor(maxTextureSize / 2))

  const canvas = document.createElement('canvas')
  canvas.width = safeWidth
  canvas.height = safeHeight
  const context = canvas.getContext('2d')
  if (!context) return null

  const projection = geoEquirectangular().fitSize([safeWidth, safeHeight], {
    type: 'FeatureCollection',
    features,
  })
  const path = geoPath(projection, context)

  context.fillStyle = OCEAN_COLOR
  context.fillRect(0, 0, safeWidth, safeHeight)

  features.forEach((feature) => {
    const name = resolveCountryName(feature)
    context.beginPath()
    path(feature)
    context.fillStyle = colorFromName(name)
    context.fill()
  })

  context.beginPath()
  path({ type: 'FeatureCollection', features })
  context.strokeStyle = BORDER_COLOR
  context.lineWidth = 1.6
  context.lineJoin = 'round'
  context.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = Math.min(maxAnisotropy, 16)
  texture.needsUpdate = true
  return texture
}

function resolveCountryName(feature) {
  const alpha3 = String(feature?.properties?.A3 ?? '').toUpperCase()
  if (!alpha3) return null

  const alpha2 = countries.alpha3ToAlpha2(alpha3)
  if (!alpha2) return alpha3

  const canonical = countries.getName(alpha2, 'en') ?? alpha3
  const override = COMMON_NAME_OVERRIDES[canonical]
  if (override) return override

  return canonical
}

function createLabelSprite(text) {
  const minWidth = 300
  const maxWidth = 1200
  const fontSize = 32
  const sidePadding = 42
  const verticalPadding = 24

  const measureCanvas = document.createElement('canvas')
  const measureContext = measureCanvas.getContext('2d')
  if (!measureContext) return null

  measureContext.font = `600 ${fontSize}px Segoe UI`
  const textWidth = measureContext.measureText(text).width

  const canvasWidth = Math.max(minWidth, Math.min(maxWidth, Math.ceil(textWidth + sidePadding * 2)))
  const canvasHeight = Math.max(88, Math.ceil(fontSize + verticalPadding * 2))

  const canvas = document.createElement('canvas')
  canvas.width = canvasWidth
  canvas.height = canvasHeight

  const context = canvas.getContext('2d')
  if (!context) return null

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.font = `600 ${fontSize}px Segoe UI`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'

  context.strokeStyle = 'rgba(8, 14, 30, 0.62)'
  context.lineWidth = Math.max(2, Math.ceil(fontSize * 0.07))
  context.strokeText(text, canvas.width / 2, canvas.height / 2)

  context.strokeStyle = 'rgba(255, 255, 255, 0.72)'
  context.lineWidth = Math.max(1, Math.ceil(fontSize * 0.04))
  context.strokeText(text, canvas.width / 2, canvas.height / 2)

  context.fillStyle = '#ffffff'
  context.fillText(text, canvas.width / 2, canvas.height / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  })

  const sprite = new THREE.Sprite(material)
  sprite.renderOrder = 4
  return { sprite, aspectRatio: canvas.height / canvas.width }
}

function buildCountryLabels(geojson, group) {
  if (geojson?.type !== 'FeatureCollection') return

  geojson.features.forEach((feature) => {
    if (!feature?.geometry) return

    const area = geoArea(feature)
    if (area < 0.0002) return

    const name = resolveCountryName(feature)
    if (!name) return

    const centroid = geoCentroid(feature)
    if (!Array.isArray(centroid) || centroid.length !== 2) return

    const labelData = createLabelSprite(name)
    if (!labelData) return

    const { sprite, aspectRatio } = labelData

    sprite.position.copy(lonLatToVector3(centroid[0], centroid[1], GLOBE_RADIUS + 0.03))

    const importance = THREE.MathUtils.clamp(Math.sqrt(area) * 10, 0, 1)

    let minZoom = 0.68
    if (area > 0.03) minZoom = 0
    else if (area > 0.012) minZoom = 0.08
    else if (area > 0.005) minZoom = 0.2
    else if (area > 0.002) minZoom = 0.34
    else if (area > 0.001) minZoom = 0.5
    sprite.scale.set(0.08, 0.08 * aspectRatio, 1)
    sprite.userData.aspectRatio = aspectRatio
    sprite.userData.area = area
    sprite.userData.importance = importance
    sprite.userData.minZoom = minZoom
    sprite.userData.isVisibleStable = false
    group.add(sprite)
  })
}

function worldScaleForPixelHeight(camera, viewportHeight, distance, pixelHeight, aspectRatio) {
  const fovRadians = (camera.fov * Math.PI) / 180
  const worldHeightAtDistance = 2 * Math.tan(fovRadians / 2) * distance
  const worldLabelHeight = worldHeightAtDistance * (pixelHeight / viewportHeight)
  return worldLabelHeight / Math.max(aspectRatio, 0.001)
}

function App() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = null

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.01,
      100,
    )
    camera.position.set(0, 0, 3.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setClearColor(0x000000, 0)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 1.05
    controls.maxDistance = 6

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.82)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.92)
    directionalLight.position.set(4, 3, 2)
    scene.add(directionalLight)

    const fillLight = new THREE.DirectionalLight(0xdbeafe, 0.32)
    fillLight.position.set(-3, -2, -3)
    scene.add(fillLight)

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 128, 128),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        metalness: 0.03,
        roughness: 0.9,
      }),
    )
    scene.add(globe)

    const labelsGroup = new THREE.Group()
    scene.add(labelsGroup)

    let globeTexture = null

    fetch('/map.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load map.json: ${response.status}`)
        }
        return response.json()
      })
      .then((geojson) => {
        globeTexture = createCountryTexture(
          geojson,
          renderer.capabilities.getMaxAnisotropy(),
          renderer.capabilities.maxTextureSize,
        )
        if (globeTexture) {
          globe.material.map = globeTexture
          globe.material.needsUpdate = true
        }
        buildCountryLabels(geojson, labelsGroup)
      })
      .catch((error) => {
        console.error(error)
        // Keep globe functional even if data fails to load.
      })

    const handleResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight
      camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
    }

    window.addEventListener('resize', handleResize)

    let frameId = 0
    const projectedPosition = new THREE.Vector3()
    const animate = () => {
      const zoomFactor = THREE.MathUtils.clamp(
        (controls.maxDistance - controls.getDistance()) /
          (controls.maxDistance - controls.minDistance),
        0,
        1,
      )
      const cameraDir = camera.position.clone().normalize()
      const placed = []
      const maxVisibleLabels = Math.floor(14 + zoomFactor * 42)
      let visibleCount = 0
      const labels = [...labelsGroup.children].sort(
        (a, b) => (b.userData.area ?? 0) - (a.userData.area ?? 0),
      )

      labels.forEach((label) => {
        const minZoom = label.userData.minZoom ?? 0
        if (zoomFactor < minZoom) {
          label.visible = false
          label.userData.isVisibleStable = false
          return
        }

        if (visibleCount >= maxVisibleLabels) {
          label.visible = false
          label.userData.isVisibleStable = false
          return
        }

        const wasVisible = Boolean(label.userData.isVisibleStable)
        const outward = label.position.clone().normalize()
        const facing = outward.dot(cameraDir)
        const shouldBeVisible = wasVisible
          ? facing > LABEL_FRONT_HIDE
          : facing > LABEL_FRONT_SHOW

        label.visible = shouldBeVisible
        label.userData.isVisibleStable = shouldBeVisible
        if (!label.visible) return

        const aspectRatio = label.userData.aspectRatio ?? 0.28
        const importance = label.userData.importance ?? 0

        const desiredPixelHeight = THREE.MathUtils.clamp(
          16 + zoomFactor * 10 + importance * 6,
          15,
          32,
        )

        projectedPosition.copy(label.position).project(camera)
        if (projectedPosition.z > 1) {
          label.visible = false
          label.userData.isVisibleStable = false
          return
        }

        const distanceToCamera = camera.position.distanceTo(label.position)
        const scale = worldScaleForPixelHeight(
          camera,
          renderer.domElement.height,
          distanceToCamera,
          desiredPixelHeight,
          aspectRatio,
        )

        const collisionRadius = (desiredPixelHeight * 0.85 * 2) / renderer.domElement.height
        const isOverlapping = placed.some((point) => {
          const dx = point.x - projectedPosition.x
          const dy = point.y - projectedPosition.y
          return dx * dx + dy * dy < collisionRadius * collisionRadius
        })

        if (isOverlapping) {
          label.visible = false
          label.userData.isVisibleStable = false
          return
        }

        placed.push({ x: projectedPosition.x, y: projectedPosition.y })
        visibleCount += 1
        label.scale.set(scale, scale * aspectRatio, 1)
      })

      controls.update()
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.cancelAnimationFrame(frameId)

      disposeGroup(labelsGroup)

      globe.geometry.dispose()
      globe.material.dispose()
      if (globeTexture) globeTexture.dispose()
      controls.dispose()
      renderer.dispose()

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <main className="app">
      <div className="globe" ref={mountRef} />
    </main>
  )
}

export default App
