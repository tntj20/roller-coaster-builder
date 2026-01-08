import { create } from "zustand";

interface AudioState {
  backgroundMusic: HTMLAudioElement | null;
  daylightMusic: HTMLAudioElement | null;
  hitSound: HTMLAudioElement | null;
  successSound: HTMLAudioElement | null;
  isMuted: boolean;
  isDaylightMusicPlaying: boolean;
  
  // Setter functions
  setBackgroundMusic: (music: HTMLAudioElement) => void;
  setDaylightMusic: (music: HTMLAudioElement) => void;
  setHitSound: (sound: HTMLAudioElement) => void;
  setSuccessSound: (sound: HTMLAudioElement) => void;
  
  // Control functions
  toggleMute: () => void;
  playHit: () => void;
  playSuccess: () => void;
  playDaylightMusic: () => void;
  stopDaylightMusic: () => void;
}

export const useAudio = create<AudioState>((set, get) => ({
  backgroundMusic: null,
  daylightMusic: null,
  hitSound: null,
  successSound: null,
  isMuted: false, // Start unmuted to allow daylight music
  isDaylightMusicPlaying: false,
  
  setBackgroundMusic: (music) => set({ backgroundMusic: music }),
  setDaylightMusic: (music) => set({ daylightMusic: music }),
  setHitSound: (sound) => set({ hitSound: sound }),
  setSuccessSound: (sound) => set({ successSound: sound }),
  
  toggleMute: () => {
    const { isMuted } = get();
    const newMutedState = !isMuted;
    
    // Just update the muted state
    set({ isMuted: newMutedState });
    
    // Log the change
    console.log(`Sound ${newMutedState ? 'muted' : 'unmuted'}`);
  },
  
  playHit: () => {
    const { hitSound, isMuted } = get();
    if (hitSound) {
      // If sound is muted, don't play anything
      if (isMuted) {
        console.log("Hit sound skipped (muted)");
        return;
      }
      
      // Clone the sound to allow overlapping playback
      const soundClone = hitSound.cloneNode() as HTMLAudioElement;
      soundClone.volume = 0.3;
      soundClone.play().catch(error => {
        console.log("Hit sound play prevented:", error);
      });
    }
  },
  
  playSuccess: () => {
    const { successSound, isMuted } = get();
    if (successSound) {
      // If sound is muted, don't play anything
      if (isMuted) {
        console.log("Success sound skipped (muted)");
        return;
      }
      
      successSound.currentTime = 0;
      successSound.play().catch(error => {
        console.log("Success sound play prevented:", error);
      });
    }
  },
  
  playDaylightMusic: () => {
    const { daylightMusic, isMuted, isDaylightMusicPlaying } = get();
    if (daylightMusic && !isDaylightMusicPlaying) {
      daylightMusic.loop = true;
      daylightMusic.volume = 0.5;
      
      if (!isMuted) {
        daylightMusic.play().catch(() => {});
      }
      set({ isDaylightMusicPlaying: true });
    }
  },
  
  stopDaylightMusic: () => {
    const { daylightMusic } = get();
    if (daylightMusic) {
      daylightMusic.pause();
      daylightMusic.currentTime = 0;
      set({ isDaylightMusicPlaying: false });
    }
  }
}));
