import { FC, useState, useEffect } from "react";
import { Object3D, Object3DEventMap } from "three";
import { socket } from "../socket";

type CardStackCardProps = {
  card: Object3D<Object3DEventMap>;
  isUppermostCard: boolean;
};

const CardStackCard: FC<CardStackCardProps> = ({ card, isUppermostCard }) => {
  const [cardObject, setCardObject] =
    useState<Object3D<Object3DEventMap>>(card);

  useEffect(() => {
    if (cardObject.name === card.name) return;
    setCardObject(card);
  }, [card, cardObject]);

  const clickCard = () => {
    if (!isUppermostCard) return;
    console.log("Draw card");
    socket.emit("draw-from-card-stack", "draw card");
  };
  return <primitive object={cardObject} onClick={() => clickCard()} />;
};

export default CardStackCard;
