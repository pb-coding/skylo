import { FC, useState, useEffect } from "react";
import { Object3D, Object3DEventMap } from "three";
// import { useFrame } from "@react-three/fiber";
import { socket } from "../socket";
import { PlayerVisualDeck } from "../types/gameTypes";

type PlayerCardProps = {
  card: Object3D<Object3DEventMap>;
  columnIndex: number;
  cardIndex: number;
  isCurrentPlayer: boolean;
  visualPlayerDeck: PlayerVisualDeck;
};

const PlayerCard: FC<PlayerCardProps> = ({
  card,
  columnIndex,
  cardIndex,
  isCurrentPlayer,
  visualPlayerDeck,
}) => {
  const isCardRevealed =
    visualPlayerDeck.player.knownCardPositions[columnIndex][cardIndex];
  const [cardObject, setCardObject] =
    useState<Object3D<Object3DEventMap>>(card);

  useEffect(() => {
    if (cardObject.name === card.name) return;
    setCardObject(card);
  }, [card, cardObject]);

  // TODO: Fix stuttering card rotation
  /*const [rotationGoal, setRotationGoal] = useState(0);
  const rotationSpeed = 0.05; // Adjust for faster/slower flip
  const currentRotation = useRef<number>(0);

  useFrame(() => {
    if (currentRotation.current < rotationGoal) {
      card.rotation.x += rotationSpeed;
      currentRotation.current += rotationSpeed;
      if (currentRotation.current >= rotationGoal) {
        card.rotation.x = rotationGoal;
      }
    } else if (currentRotation.current > rotationGoal) {
      card.rotation.x -= rotationSpeed;
      currentRotation.current -= rotationSpeed;
      if (currentRotation.current <= rotationGoal) {
        card.rotation.x = rotationGoal;
      }
    }
  });*/

  if (isCardRevealed) {
    card.rotation.x = Math.PI;
  }

  const clickCard = () => {
    if (!isCurrentPlayer) return;
    console.log("Clicked on one of my cards");
    socket.emit("click-card", [columnIndex, cardIndex]);
  };
  return (
    <primitive
      key={columnIndex + cardIndex * 4}
      object={cardObject}
      onClick={() => clickCard()}
    />
  );
};

export default PlayerCard;
