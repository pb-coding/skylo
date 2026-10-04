import { FC, useEffect, useState } from "react";
import { Vector3, Object3D } from "three";
import { CardStack } from "../types/gameTypes";
import { createCardStaple } from "../objects/cards";
import CardStackCard from "./CardStackCard";

type CardStackProps = {
  cardStackData: CardStack | null;
};

const CardStackStaple: FC<CardStackProps> = ({ cardStackData }) => {
  const [cardStack, setCardStack] = useState<Object3D[]>([]);

  const updateCardStack = (cardStackData: CardStack) => {
    const stack = createCardStaple(
      cardStackData.cards,
      new Vector3(-1.2, 20, 0)
    );
    setCardStack(stack);
  };

  const checkIfUppermostCard = (index: number) => {
    return index === cardStack.length - 1;
  };

  useEffect(() => {
    if (!cardStackData) return;
    updateCardStack(cardStackData);
  }, [cardStackData]);
  if (!cardStackData) return null;

  return (
    <>
      {cardStack.map((card, index) => (
        <CardStackCard
          key={index}
          card={card}
          isUppermostCard={checkIfUppermostCard(index)}
        />
      ))}
    </>
  );
};

export default CardStackStaple;
