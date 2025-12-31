import { create } from "zustand";
import * as THREE from "three";

export type CoasterMode = "build" | "ride" | "preview";

export interface TrackPoint {
  id: string;
  position: THREE.Vector3;
  tilt: number;
}

interface RollerCoasterState {
  mode: CoasterMode;
  trackPoints: TrackPoint[];
  selectedPointId: string | null;
  rideProgress: number;
  isRiding: boolean;
  rideSpeed: number;
  isDraggingPoint: boolean;
  isAddingPoints: boolean;
  isLooped: boolean;
  hasChainLift: boolean;
  showWoodSupports: boolean;
  isNightMode: boolean;
  cameraTarget: THREE.Vector3 | null;
  
  setMode: (mode: CoasterMode) => void;
  setCameraTarget: (target: THREE.Vector3 | null) => void;
  addTrackPoint: (position: THREE.Vector3) => void;
  updateTrackPoint: (id: string, position: THREE.Vector3) => void;
  updateTrackPointTilt: (id: string, tilt: number) => void;
  removeTrackPoint: (id: string) => void;
  createLoopAtPoint: (id: string) => void;
  selectPoint: (id: string | null) => void;
  clearTrack: () => void;
  setRideProgress: (progress: number) => void;
  setIsRiding: (riding: boolean) => void;
  setRideSpeed: (speed: number) => void;
  setIsDraggingPoint: (dragging: boolean) => void;
  setIsAddingPoints: (adding: boolean) => void;
  setIsLooped: (looped: boolean) => void;
  setHasChainLift: (hasChain: boolean) => void;
  setShowWoodSupports: (show: boolean) => void;
  setIsNightMode: (night: boolean) => void;
  startRide: () => void;
  stopRide: () => void;
}

let pointCounter = 0;

export const useRollerCoaster = create<RollerCoasterState>((set, get) => ({
  mode: "build",
  trackPoints: [],
  selectedPointId: null,
  rideProgress: 0,
  isRiding: false,
  rideSpeed: 1.0,
  isDraggingPoint: false,
  isAddingPoints: true,
  isLooped: false,
  hasChainLift: true,
  showWoodSupports: false,
  isNightMode: false,
  cameraTarget: null,
  
  setMode: (mode) => set({ mode }),
  
  setCameraTarget: (target) => set({ cameraTarget: target }),
  
  setIsDraggingPoint: (dragging) => set({ isDraggingPoint: dragging }),
  
  setIsAddingPoints: (adding) => set({ isAddingPoints: adding }),
  
  setIsLooped: (looped) => set({ isLooped: looped }),
  
  setHasChainLift: (hasChain) => set({ hasChainLift: hasChain }),
  
  setShowWoodSupports: (show) => set({ showWoodSupports: show }),
  
  setIsNightMode: (night) => set({ isNightMode: night }),
  
  addTrackPoint: (position) => {
    const id = `point-${++pointCounter}`;
    set((state) => ({
      trackPoints: [...state.trackPoints, { id, position: position.clone(), tilt: 0 }],
    }));
  },
  
  updateTrackPoint: (id, position) => {
    set((state) => ({
      trackPoints: state.trackPoints.map((point) =>
        point.id === id ? { ...point, position: position.clone() } : point
      ),
    }));
  },
  
  updateTrackPointTilt: (id, tilt) => {
    set((state) => ({
      trackPoints: state.trackPoints.map((point) =>
        point.id === id ? { ...point, tilt } : point
      ),
    }));
  },
  
  removeTrackPoint: (id) => {
    set((state) => ({
      trackPoints: state.trackPoints.filter((point) => point.id !== id),
      selectedPointId: state.selectedPointId === id ? null : state.selectedPointId,
    }));
  },
  
  createLoopAtPoint: (id) => {
    set((state) => {
      const pointIndex = state.trackPoints.findIndex((p) => p.id === id);
      if (pointIndex === -1 || pointIndex >= state.trackPoints.length - 1) return state;
      
      const basePoint = state.trackPoints[pointIndex];
      const nextPoint = state.trackPoints[pointIndex + 1];
      const pos = basePoint.position.clone();
      const nextPos = nextPoint.position.clone();
      
      // Calculate forward direction (along track)
      let forward = new THREE.Vector3(1, 0, 0);
      if (pointIndex > 0) {
        const prevPoint = state.trackPoints[pointIndex - 1];
        forward = pos.clone().sub(prevPoint.position);
        forward.y = 0;
        if (forward.length() < 0.1) {
          forward = new THREE.Vector3(1, 0, 0);
        }
        forward.normalize();
      }
      
      // Calculate LEFT direction (perpendicular to forward, in horizontal plane)
      const up = new THREE.Vector3(0, 1, 0);
      const left = new THREE.Vector3().crossVectors(up, forward).normalize();
      
      const loopRadius = 8;
      const lateralOffset = loopRadius + 2; // How far left/right to separate the tracks
      const numLoopPoints = 16;
      
      // STEP 1: Shift incoming section (up to and including selected point) LEFT
      const incomingPoints = state.trackPoints.slice(0, pointIndex + 1).map(p => ({
        ...p,
        position: new THREE.Vector3(
          p.position.x + left.x * lateralOffset,
          p.position.y,
          p.position.z + left.z * lateralOffset
        )
      }));
      
      // STEP 2: Shift outgoing section (after selected point) RIGHT
      const outgoingPoints = state.trackPoints.slice(pointIndex + 1).map(p => ({
        ...p,
        position: new THREE.Vector3(
          p.position.x - left.x * lateralOffset,
          p.position.y,
          p.position.z - left.z * lateralOffset
        )
      }));
      
      // Entry point (left side) and exit point (right side)
      const entryPos = incomingPoints[incomingPoints.length - 1].position.clone();
      const exitPos = outgoingPoints[0].position.clone();
      
      // STEP 3: Create loop points bridging from left entry to right exit
      // Loop is in vertical plane perpendicular to the left vector
      // Entry is on left, exit is on right, loop goes up and over
      const loopPoints: TrackPoint[] = [];
      
      // Center of loop is midway between entry and exit, at loopRadius height
      const loopCenterX = (entryPos.x + exitPos.x) / 2;
      const loopCenterY = entryPos.y + loopRadius;
      const loopCenterZ = (entryPos.z + exitPos.z) / 2;
      
      // Lead-in: rise from entry toward loop
      loopPoints.push({
        id: `point-${++pointCounter}`,
        position: new THREE.Vector3(
          entryPos.x - left.x * 2,
          entryPos.y + 3,
          entryPos.z - left.z * 2
        ),
        tilt: 0
      });
      
      // Loop goes from left (entry side) up over and down to right (exit side)
      // Angle 0 = left side (entry), angle PI = right side (exit)
      for (let i = 1; i < numLoopPoints; i++) {
        const t = i / numLoopPoints;
        const angle = t * Math.PI * 2; // Full circle starting from left
        
        // Left vector points from center to entry side
        // -left points from center to exit side
        const lateralPos = Math.cos(angle) * loopRadius; // positive = toward entry (left)
        const heightPos = Math.sin(angle) * loopRadius;
        
        const pointPos = new THREE.Vector3(
          loopCenterX + left.x * lateralPos,
          loopCenterY + heightPos,
          loopCenterZ + left.z * lateralPos
        );
        
        loopPoints.push({
          id: `point-${++pointCounter}`,
          position: pointPos,
          tilt: 0
        });
      }
      
      // Lead-out: descend toward exit
      loopPoints.push({
        id: `point-${++pointCounter}`,
        position: new THREE.Vector3(
          exitPos.x + left.x * 2,
          exitPos.y + 3,
          exitPos.z + left.z * 2
        ),
        tilt: 0
      });
      
      // Combine: shifted incoming + loop + shifted outgoing
      const newTrackPoints = [
        ...incomingPoints,
        ...loopPoints,
        ...outgoingPoints
      ];
      
      return { trackPoints: newTrackPoints };
    });
  },
  
  selectPoint: (id) => set({ selectedPointId: id }),
  
  clearTrack: () => {
    set({ trackPoints: [], selectedPointId: null, rideProgress: 0, isRiding: false });
  },
  
  setRideProgress: (progress) => set({ rideProgress: progress }),
  
  setIsRiding: (riding) => set({ isRiding: riding }),
  
  setRideSpeed: (speed) => set({ rideSpeed: speed }),
  
  startRide: () => {
    const { trackPoints } = get();
    if (trackPoints.length >= 2) {
      set({ mode: "ride", isRiding: true, rideProgress: 0 });
    }
  },
  
  stopRide: () => {
    set({ mode: "build", isRiding: false, rideProgress: 0 });
  },
}));
