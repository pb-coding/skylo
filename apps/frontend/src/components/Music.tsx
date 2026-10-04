import { FC, useEffect } from "react";
import { AudioLoader, Audio, AudioListener } from "three";
import { useThree } from "@react-three/fiber";

const Music: FC = () => {
  const { camera } = useThree(); // Access the camera using useThree hook

  useEffect(() => {
    const listener = new AudioListener();
    camera.add(listener); // Add the listener to the camera

    const sound = new Audio(listener);
    const audioLoader = new AudioLoader();
    audioLoader.load("/music/Local_Forecast.mp3", function (buffer) {
      sound.setBuffer(buffer);
      sound.setLoop(true);
      sound.setVolume(0.5);
      sound.play();
    });

    // Cleanup listener on component unmount
    return () => {
      sound.stop();
      camera.remove(listener);
    };
  }, [camera]);

  return <></>;
};

export default Music;
