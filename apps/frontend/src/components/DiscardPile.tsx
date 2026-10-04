import { FC, useState, useEffect } from "react";
import { Vector3, Object3D } from "three";

import { Card } from "../types/gameTypes";
import { createCardStaple } from "../objects/cards";
import DiscardPileCard from "./DiscardPileCard";

type DiscardPileProps = {
  discardPileData: Card[] | null;
};

const DiscardPile: FC<DiscardPileProps> = ({ discardPileData }) => {
  const [discardPile, setDiscardPile] = useState<Object3D[]>([]);

  const updateDiscardPile = (discardPileData: Card[]) => {
    const showFaceUp = true;
    const pile = createCardStaple(
      discardPileData,
      new Vector3(1.2, 20, 0),
      showFaceUp
    );
    setDiscardPile(pile);
  };

  const checkIfUppermostCard = (index: number) => {
    return index === discardPile.length - 1;
  };

  useEffect(() => {
    if (!discardPileData) return;
    updateDiscardPile(discardPileData);
  }, [discardPileData]);

  if (!discardPile) return null;
  return (
    <>
      {discardPile.map((card, index) => (
        <DiscardPileCard
          key={index}
          card={card}
          isUppermostCard={checkIfUppermostCard(index)}
        />
      ))}
    </>
  );
};

export default DiscardPile;
