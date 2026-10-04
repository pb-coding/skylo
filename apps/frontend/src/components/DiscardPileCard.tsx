import { FC, useState, useEffect } from "react";
import { Object3D, Object3DEventMap } from "three";
import { socket } from "../socket";

type DiscardPileCardProps = {
  card: Object3D<Object3DEventMap>;
  isUppermostCard: boolean;
};

const DiscardPileCard: FC<DiscardPileCardProps> = ({
  card,
  isUppermostCard,
}) => {
  const [cardObject, setCardObject] =
    useState<Object3D<Object3DEventMap>>(card);

  useEffect(() => {
    if (cardObject.name === card.name) return;
    setCardObject(card);
  }, [card, cardObject]);

  const clickCard = () => {
    if (!isUppermostCard) return;
    console.log("Draw card");
    socket.emit("click-discard-pile", "take discard pile card");
  };
  return <primitive object={cardObject} onClick={() => clickCard()} />;
};

export default DiscardPileCard;
