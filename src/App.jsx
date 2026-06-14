import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import './App.css'

const GLOBE_RADIUS = 1
const MAX_RINGS = 18000
const MAX_SEGMENTS = 320000

function lonLatToVector3(lon, lat, radius = GLOBE_RADIUS) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180

  return new THREE.Vector3(
    -(radius * Math.sin(phi) * Math.cos(theta)),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

function simplifyRing(ring, step = 2) {
  if (!Array.isArray(ring) || ring.length <= 3) return ring
  const simplified = ring.filter((_, index) => index % step === 0)
  const last = ring[ring.length - 1]
  const tail = simplified[simplified.length - 1]

  if (!tail || tail[0] !== last[0] || tail[1] !== last[1]) {
    simplified.push(last)
  }

  return simplified
}

function buildCountryLines(geojson, group) {
  const positions = []
  let ringCount = 0
  let segmentCount = 0

  const addRing = (ring) => {
    if (ringCount >= MAX_RINGS || segmentCount >= MAX_SEGMENTS) return
    if (!Array.isArray(ring) || ring.length < 6) return

    const dynamicStep = Math.max(2, Math.ceil(ring.length / 180))
    const compactRing = simplifyRing(ring, dynamicStep)
    if (!compactRing || compactRing.length < 3) return

    for (let i = 1; i < compactRing.length; i += 1) {
      if (segmentCount >= MAX_SEGMENTS) break

      const lonA = compactRing[i - 1][0]
      const latA = compactRing[i - 1][1]
      const lonB = compactRing[i][0]
      const latB = compactRing[i][1]

      // Skip segments that jump across the anti-meridian to avoid long chords.
      if (Math.abs(lonA - lonB) > 180) continue

      const prev = lonLatToVector3(
        lonA,
        latA,
        GLOBE_RADIUS + 0.002,
      )
      const curr = lonLatToVector3(
        lonB,
        latB,
        GLOBE_RADIUS + 0.002,
      )

      positions.push(prev.x, prev.y, prev.z, curr.x, curr.y, curr.z)
      segmentCount += 1
    }

    ringCount += 1
  }

  const processGeometry = (geometry) => {
    if (!geometry) return

    if (geometry.type === 'Polygon') {
      geometry.coordinates.forEach(addRing)
      return
    }

    if (geometry.type === 'MultiPolygon') {
      geometry.coordinates.forEach((polygon) => polygon.forEach(addRing))
      return
    }

    if (geometry.type === 'GeometryCollection') {
      geometry.geometries.forEach(processGeometry)
    }
  }

  if (geojson.type === 'FeatureCollection') {
    geojson.features.forEach((feature) => processGeometry(feature.geometry))
  } else if (geojson.type === 'Feature') {
    processGeometry(geojson.geometry)
  } else {
    processGeometry(geojson)
  }

  if (!positions.length) return null

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  const material = new THREE.LineBasicMaterial({ color: 0xa5f3fc })
  const lines = new THREE.LineSegments(geometry, material)
  group.add(lines)

  return lines
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

function App() {
  const mountRef = useRef(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return undefined

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x020617)

    const camera = new THREE.PerspectiveCamera(
      45,
      mount.clientWidth / mount.clientHeight,
      0.1,
      100,
    )
    camera.position.set(0, 0, 3.2)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    mount.appendChild(renderer.domElement)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.enablePan = false
    controls.minDistance = 1.6
    controls.maxDistance = 6

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.55)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(4, 3, 2)
    scene.add(directionalLight)

    const globe = new THREE.Mesh(
      new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64),
      new THREE.MeshStandardMaterial({
        color: 0x0f172a,
        metalness: 0.15,
        roughness: 0.75,
      }),
    )
    scene.add(globe)

    const bordersGroup = new THREE.Group()
    scene.add(bordersGroup)

    fetch('/map.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load map.json: ${response.status}`)
        }
        return response.json()
      })
      .then((geojson) => {
        buildCountryLines(geojson, bordersGroup)
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
    const animate = () => {
      controls.update()
      renderer.render(scene, camera)
      frameId = window.requestAnimationFrame(animate)
    }
    animate()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.cancelAnimationFrame(frameId)

      disposeGroup(bordersGroup)

      globe.geometry.dispose()
      globe.material.dispose()
      controls.dispose()
      renderer.dispose()

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement)
      }
    }
  }, [])

  return (
    <main className="app">
      <h1>Cat Globe</h1>
      <div className="globe" ref={mountRef} />
    </main>
  )
}

export default App
