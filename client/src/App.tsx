import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import "@fontsource/inter";
import { Ground } from "./components/game/Ground";
import { TrackBuilder } from "./components/game/TrackBuilder";
import { BuildCamera } from "./components/game/BuildCamera";
import { RideCamera } from "./components/game/RideCamera";
import { CoasterCar } from "./components/game/CoasterCar";
import { Sky } from "./components/game/Sky";
import { GameUI } from "./components/game/GameUI";
import { useRollerCoaster } from "./lib/stores/useRollerCoaster";
import { useAudio } from "./lib/stores/useAudio";

function MusicController() {
  const { isNightMode } = useRollerCoaster();
  const { setDaylightMusic, playDaylightMusic, stopDaylightMusic, daylightMusic, isMuted } = useAudio();
  
  useEffect(() => {
    const music = new Audio("/sounds/music.mp3");
    music.loop = true;
    music.volume = 0.5;
    setDaylightMusic(music);
    
    return () => {
      music.pause();
      music.src = "";
    };
  }, [setDaylightMusic]);
  
  useEffect(() => {
    if (!isNightMode) {
      playDaylightMusic();
    } else {
      stopDaylightMusic();
    }
  }, [isNightMode, playDaylightMusic, stopDaylightMusic]);
  
  useEffect(() => {
    if (daylightMusic) {
      if (isMuted) {
        daylightMusic.pause();
      } else if (!isNightMode) {
        daylightMusic.play().catch(() => {});
      }
    }
  }, [isMuted, daylightMusic, isNightMode]);
  
  return null;
}

function Scene() {
  const { mode } = useRollerCoaster();
  
  return (
    <>
      <Sky />
      <BuildCamera />
      <RideCamera />
      
      <Suspense fallback={null}>
        <Ground />
        <TrackBuilder />
        <CoasterCar />
      </Suspense>
    </>
  );
}

function App() {
  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <MusicController />
      <Canvas
        shadows
        camera={{
          position: [20, 15, 20],
          fov: 60,
          near: 0.1,
          far: 1000
        }}
        gl={{
          antialias: true,
          powerPreference: "default"
        }}
      >
        <Scene />
      </Canvas>
      <GameUI />
    </div>
  );
}

export default App;
