import { Grid } from '@react-three/drei'

export function GridPlane() {
  return (
    <Grid
      args={[100, 100]}
      cellSize={1}
      cellThickness={0.5}
      cellColor="#404040"
      sectionSize={5}
      sectionThickness={1}
      sectionColor="#737373"
      fadeDistance={80}
      fadeStrength={2}
      followCamera={false}
      infiniteGrid
    />
  )
}
