import { useMemo } from "react";
import * as THREE from "three";
import { useRollerCoaster } from "@/lib/stores/useRollerCoaster";
import { Line } from "@react-three/drei";
import {
  RAIL_OFFSET, TIE_WIDTH, TIE_HEIGHT, TIE_DEPTH,
  SUPPORT_LEG_SIZE, SUPPORT_CROSSBRACE_SIZE, SUPPORT_DIAGONAL_SIZE, LEG_INSET,
  CABLE_ANCHOR_TOP_RADIUS, CABLE_ANCHOR_BOTTOM_RADIUS, CABLE_ANCHOR_HEIGHT,
  SUPPORT_INTERVAL, LIGHT_INTERVAL, SAMPLES_PER_POINT,
  TRACK_LIGHT_SIZE, TRACK_LIGHT_OFFSET,
  MIN_SUPPORT_HEIGHT, CROSSBRACE_MIN_HEIGHT, DIAGONAL_MIN_HEIGHT
} from "@/lib/config/scale";

function interpolateTilt(trackPoints: { tilt: number }[], t: number, isLooped: boolean): number {
  if (trackPoints.length < 2) return 0;
  
  const n = trackPoints.length;
  const scaledT = isLooped ? t * n : t * (n - 1);
  const index = Math.floor(scaledT);
  const frac = scaledT - index;
  
  if (isLooped) {
    const i0 = index % n;
    const i1 = (index + 1) % n;
    return trackPoints[i0].tilt * (1 - frac) + trackPoints[i1].tilt * frac;
  } else {
    if (index >= n - 1) return trackPoints[n - 1].tilt;
    return trackPoints[index].tilt * (1 - frac) + trackPoints[index + 1].tilt * frac;
  }
}

export function Track() {
  const { trackPoints, isLooped, showWoodSupports, isNightMode } = useRollerCoaster();
  
  const { curve, railData, woodSupports, trackLights, loopCables } = useMemo(() => {
    if (trackPoints.length < 2) {
      return { curve: null, railData: [], woodSupports: [], trackLights: [], loopCables: [] };
    }
    
    const points = trackPoints.map((p) => p.position.clone());
    const curve = new THREE.CatmullRomCurve3(points, isLooped, "catmullrom", 0.5);
    
    const railData: { point: THREE.Vector3; tilt: number; tangent: THREE.Vector3; normal: THREE.Vector3; isLoop: boolean; loopTheta?: number }[] = [];
    const numSamples = Math.max(trackPoints.length * SAMPLES_PER_POINT, 60);
    
    // Helper to get loop metadata at parameter t
    const getLoopMetaAt = (t: number): { meta: typeof trackPoints[0]['loopMeta'], theta: number } | null => {
      const n = trackPoints.length;
      const scaledT = t * (isLooped ? n : n - 1);
      const idx = Math.floor(scaledT);
      const frac = scaledT - idx;
      
      const i0 = isLooped ? ((idx % n) + n) % n : Math.min(idx, n - 1);
      const i1 = isLooped ? ((idx + 1) % n) : Math.min(idx + 1, n - 1);
      
      const p0 = trackPoints[i0];
      const p1 = trackPoints[i1];
      
      // If either point has loop metadata, interpolate
      if (p0.loopMeta && p1.loopMeta) {
        // Interpolate theta between the two points
        const theta = p0.loopMeta.theta + frac * (p1.loopMeta.theta - p0.loopMeta.theta);
        return { meta: p0.loopMeta, theta };
      } else if (p0.loopMeta) {
        return { meta: p0.loopMeta, theta: p0.loopMeta.theta };
      } else if (p1.loopMeta) {
        return { meta: p1.loopMeta, theta: p1.loopMeta.theta };
      }
      return null;
    };
    
    // Standard parallel transport initialization
    let prevTangent = curve.getTangent(0).normalize();
    let prevUp = new THREE.Vector3(0, 1, 0);
    const initDot = prevUp.dot(prevTangent);
    prevUp.sub(prevTangent.clone().multiplyScalar(initDot));
    if (prevUp.length() < 0.01) {
      prevUp.set(1, 0, 0);
      const d = prevUp.dot(prevTangent);
      prevUp.sub(prevTangent.clone().multiplyScalar(d));
    }
    prevUp.normalize();
    
    for (let i = 0; i <= numSamples; i++) {
      const t = i / numSamples;
      const point = curve.getPoint(t);
      const tangent = curve.getTangent(t).normalize();
      const tilt = interpolateTilt(trackPoints, t, isLooped);
      
      let up: THREE.Vector3;
      let normal: THREE.Vector3;
      
      // Check if we're in a loop segment
      const loopInfo = getLoopMetaAt(t);
      
      if (loopInfo && loopInfo.meta) {
        // Use COMPLETE reference frame from loop metadata - including tangent!
        const meta = loopInfo.meta;
        const theta = loopInfo.theta;
        
        // Reference TANGENT for ideal circular loop: d/dθ of position = cos(θ)*forward + sin(θ)*up
        // This is the key fix - we must NOT use the spline tangent which has helical torsion
        const refTangent = new THREE.Vector3()
          .addScaledVector(meta.forward, Math.cos(theta))
          .addScaledVector(meta.up, Math.sin(theta))
          .normalize();
        
        // Inward radial pointing toward loop center: -sin(θ)*forward + cos(θ)*up
        up = new THREE.Vector3()
          .addScaledVector(meta.forward, -Math.sin(theta))
          .addScaledVector(meta.up, Math.cos(theta))
          .normalize();
        
        // Normal (sideways) is always the right vector - constant throughout the loop
        normal = meta.right.clone();
        
        // OVERRIDE the spline tangent with our reference tangent
        // This is critical - the sleeper/tie rotation uses tangent, and helical tangent causes twist
        railData.push({ point, tilt, tangent: refTangent, normal, isLoop: true, loopTheta: theta });
        
        prevUp.copy(up);
        prevTangent.copy(refTangent);
        continue; // Skip the normal push at end of loop
      } else {
        // Standard parallel transport for non-loop sections
        if (i === 0) {
          up = prevUp.clone();
        } else {
          const dot = Math.max(-1, Math.min(1, prevTangent.dot(tangent)));
          
          if (dot > 0.9999) {
            up = prevUp.clone();
          } else if (dot < -0.9999) {
            up = prevUp.clone();
          } else {
            const axis = new THREE.Vector3().crossVectors(prevTangent, tangent);
            if (axis.length() > 0.0001) {
              axis.normalize();
              const angle = Math.acos(dot);
              const quat = new THREE.Quaternion().setFromAxisAngle(axis, angle);
              up = prevUp.clone().applyQuaternion(quat);
            } else {
              up = prevUp.clone();
            }
          }
          
          const upDot = up.dot(tangent);
          up.sub(tangent.clone().multiplyScalar(upDot));
          if (up.length() > 0.001) {
            up.normalize();
          } else {
            up = prevUp.clone();
          }
        }
        
        prevTangent.copy(tangent);
        prevUp.copy(up);
        
        normal = new THREE.Vector3().crossVectors(tangent, up).normalize();
      }
      
      railData.push({ point, tilt, tangent, normal, isLoop: false });
    }
    
    const woodSupports: { pos: THREE.Vector3; tangent: THREE.Vector3; height: number; tilt: number }[] = [];
    const supportInterval = SUPPORT_INTERVAL;
    
    // Only add wood supports for non-loop sections
    for (let i = 0; i < railData.length; i += supportInterval) {
      const { point, tangent, tilt, isLoop } = railData[i];
      if (point.y > MIN_SUPPORT_HEIGHT && !isLoop) {
        woodSupports.push({ 
          pos: point.clone(), 
          tangent: tangent.clone(),
          height: point.y,
          tilt
        });
      }
    }
    
    // Add cables for loop sections - at specific theta angles (4 cables total)
    const loopCables: { trackPos: THREE.Vector3; groundPos: THREE.Vector3 }[] = [];
    const cableAngles = [Math.PI * 0.25, Math.PI * 0.5, Math.PI * 0.75, Math.PI * 1.25]; // 45°, 90°, 135°, 225°
    
    for (let i = 0; i < railData.length; i++) {
      const data = railData[i];
      if (data.isLoop && data.loopTheta !== undefined) {
        // Check if this sample is close to one of our cable angles
        for (const targetAngle of cableAngles) {
          if (Math.abs(data.loopTheta - targetAngle) < 0.15) {
            // Ground anchor directly below track point
            const groundPos = new THREE.Vector3(data.point.x, 0, data.point.z);
            loopCables.push({
              trackPos: data.point.clone(),
              groundPos
            });
            break; // Only one cable per sample
          }
        }
      }
    }
    
    const trackLights: { pos: THREE.Vector3; normal: THREE.Vector3 }[] = [];
    const lightInterval = LIGHT_INTERVAL;
    
    for (let i = 0; i < railData.length; i += lightInterval) {
      const { point, tangent } = railData[i];
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      trackLights.push({ pos: point.clone(), normal: normal.clone() });
    }
    
    return { curve, railData, woodSupports, trackLights, loopCables };
  }, [trackPoints, isLooped]);
  
  if (!curve || railData.length < 2) {
    return null;
  }
  
  const leftRail: [number, number, number][] = [];
  const rightRail: [number, number, number][] = [];
  const railOffset = RAIL_OFFSET;
  
  for (let i = 0; i < railData.length; i++) {
    const { point, tilt, tangent, normal } = railData[i];
    
    const tiltRad = (tilt * Math.PI) / 180;
    const tiltCos = Math.cos(tiltRad);
    const tiltSin = Math.sin(tiltRad);
    
    const leftYOffset = railOffset * tiltSin;
    const rightYOffset = -railOffset * tiltSin;
    const horizontalScale = tiltCos;
    
    leftRail.push([
      point.x + normal.x * railOffset * horizontalScale,
      point.y + leftYOffset,
      point.z + normal.z * railOffset * horizontalScale,
    ]);
    rightRail.push([
      point.x - normal.x * railOffset * horizontalScale,
      point.y + rightYOffset,
      point.z - normal.z * railOffset * horizontalScale,
    ]);
  }
  
  return (
    <group>
      <Line
        points={leftRail}
        color="#ff4444"
        lineWidth={4}
      />
      <Line
        points={rightRail}
        color="#ff4444"
        lineWidth={4}
      />
      
      {railData.filter((_, i) => i % 2 === 0).map((data, i) => {
        const { point, tangent, tilt } = data;
        const angle = Math.atan2(tangent.x, tangent.z);
        const tiltRad = (tilt * Math.PI) / 180;
        
        return (
          <mesh
            key={`tie-${i}`}
            position={[point.x, point.y - TIE_HEIGHT, point.z]}
            rotation={[tiltRad, angle, 0]}
          >
            <boxGeometry args={[TIE_WIDTH, TIE_HEIGHT, TIE_DEPTH]} />
            <meshStandardMaterial color="#8B4513" />
          </mesh>
        );
      })}
      
      {showWoodSupports && woodSupports.map((support, i) => {
        const { pos, tangent, height, tilt } = support;
        const angle = Math.atan2(tangent.x, tangent.z);
        const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
        
        const tiltRad = (tilt * Math.PI) / 180;
        const tiltCos = Math.cos(tiltRad);
        const tiltSin = Math.sin(tiltRad);
        
        const leftX = pos.x + normal.x * railOffset * tiltCos;
        const leftY = pos.y + railOffset * tiltSin;
        const leftZ = pos.z + normal.z * railOffset * tiltCos;
        const rightX = pos.x - normal.x * railOffset * tiltCos;
        const rightY = pos.y - railOffset * tiltSin;
        const rightZ = pos.z - normal.z * railOffset * tiltCos;
        
        const leftHeight = leftY;
        const rightHeight = rightY;
        
        const legInset = LEG_INSET;
        const leftLegX = pos.x + normal.x * (railOffset - legInset) * tiltCos;
        const leftLegZ = pos.z + normal.z * (railOffset - legInset) * tiltCos;
        const rightLegX = pos.x - normal.x * (railOffset - legInset) * tiltCos;
        const rightLegZ = pos.z - normal.z * (railOffset - legInset) * tiltCos;
        
        const crossbraceHeight = height * 0.6;
        const crossLength = Math.sqrt(Math.pow(railOffset * 2, 2) + Math.pow(crossbraceHeight, 2));
        const crossAngle = Math.atan2(crossbraceHeight, railOffset * 2);
        
        return (
          <group key={`wood-${i}`}>
            <mesh position={[leftLegX, leftHeight / 2, leftLegZ]}>
              <boxGeometry args={[SUPPORT_LEG_SIZE, leftHeight, SUPPORT_LEG_SIZE]} />
              <meshStandardMaterial color="#8B5A2B" />
            </mesh>
            <mesh position={[rightLegX, rightHeight / 2, rightLegZ]}>
              <boxGeometry args={[SUPPORT_LEG_SIZE, rightHeight, SUPPORT_LEG_SIZE]} />
              <meshStandardMaterial color="#8B5A2B" />
            </mesh>
            
            {height > CROSSBRACE_MIN_HEIGHT && (
              <>
                <mesh 
                  position={[pos.x, height * 0.3, pos.z]} 
                  rotation={[0, angle, 0]}
                >
                  <boxGeometry args={[SUPPORT_CROSSBRACE_SIZE, SUPPORT_CROSSBRACE_SIZE, railOffset * 2.2]} />
                  <meshStandardMaterial color="#A0522D" />
                </mesh>
                <mesh 
                  position={[pos.x, height * 0.6, pos.z]} 
                  rotation={[0, angle, 0]}
                >
                  <boxGeometry args={[SUPPORT_CROSSBRACE_SIZE, SUPPORT_CROSSBRACE_SIZE, railOffset * 2.2]} />
                  <meshStandardMaterial color="#A0522D" />
                </mesh>
              </>
            )}
            
            {height > DIAGONAL_MIN_HEIGHT && (
              <mesh 
                position={[pos.x, height * 0.45, pos.z]} 
                rotation={[crossAngle, angle, 0]}
              >
                <boxGeometry args={[SUPPORT_DIAGONAL_SIZE, crossLength * 0.5, SUPPORT_DIAGONAL_SIZE]} />
                <meshStandardMaterial color="#CD853F" />
              </mesh>
            )}
          </group>
        );
      })}
      
      {/* Loop cables - thin steel cables connecting loop to ground */}
      {showWoodSupports && loopCables.map((cable, i) => {
        const { trackPos, groundPos } = cable;
        const midY = (trackPos.y + groundPos.y) / 2;
        const height = trackPos.y - groundPos.y;
        
        // Calculate angle for the cable
        const dx = trackPos.x - groundPos.x;
        const dz = trackPos.z - groundPos.z;
        const horizontalDist = Math.sqrt(dx * dx + dz * dz);
        const cableAngle = Math.atan2(height, horizontalDist);
        const yawAngle = Math.atan2(dx, dz);
        
        const cableLength = Math.sqrt(height * height + horizontalDist * horizontalDist);
        
        return (
          <group key={`cable-${i}`}>
            {/* Cable line */}
            <Line
              points={[
                [trackPos.x, trackPos.y, trackPos.z],
                [groundPos.x, groundPos.y, groundPos.z]
              ]}
              color="#444444"
              lineWidth={2}
            />
            {/* Ground anchor */}
            <mesh position={[groundPos.x, CABLE_ANCHOR_HEIGHT / 2, groundPos.z]}>
              <cylinderGeometry args={[CABLE_ANCHOR_TOP_RADIUS, CABLE_ANCHOR_BOTTOM_RADIUS, CABLE_ANCHOR_HEIGHT, 8]} />
              <meshStandardMaterial color="#555555" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        );
      })}
      
      {isNightMode && trackLights.map((light, i) => {
        const { pos, normal } = light;
        const leftX = pos.x + normal.x * TRACK_LIGHT_OFFSET;
        const leftZ = pos.z + normal.z * TRACK_LIGHT_OFFSET;
        const rightX = pos.x - normal.x * TRACK_LIGHT_OFFSET;
        const rightZ = pos.z - normal.z * TRACK_LIGHT_OFFSET;
        const colors = ["#FF0000", "#FFFF00", "#00FF00", "#00FFFF", "#FF00FF"];
        const color = colors[i % colors.length];
        
        return (
          <group key={`light-${i}`}>
            <mesh position={[leftX, pos.y + 0.1, leftZ]}>
              <sphereGeometry args={[TRACK_LIGHT_SIZE, 6, 6]} />
              <meshBasicMaterial color={color} />
            </mesh>
            <mesh position={[rightX, pos.y + 0.1, rightZ]}>
              <sphereGeometry args={[TRACK_LIGHT_SIZE, 6, 6]} />
              <meshBasicMaterial color={color} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

export function getTrackCurve(trackPoints: { position: THREE.Vector3 }[], isLooped: boolean = false) {
  if (trackPoints.length < 2) return null;
  const points = trackPoints.map((p) => p.position.clone());
  return new THREE.CatmullRomCurve3(points, isLooped, "catmullrom", 0.5);
}

export function getTrackTiltAtProgress(trackPoints: { tilt: number }[], progress: number, isLooped: boolean): number {
  return interpolateTilt(trackPoints, progress, isLooped);
}
