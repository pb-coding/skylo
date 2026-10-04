import { FC, useEffect, useState } from "react";
import { Vector3, Object3D } from "three";

import { createCard } from "../objects/cards";
import { Player } from "../types/gameTypes";

type CardCacheProps = {
  playerData: Player;
  position: Vector3;
};

const CardCache: FC<CardCacheProps> = ({ playerData, position }) => {
  const [cardCacheCard, setCardCacheCard] = useState<Object3D | null>(null);

  const updateCardCache = (playerData: Player) => {
    if (playerData.cardCache == null) {
      setCardCacheCard(null);
      return;
    }
    const showFaceUp = true;
    const card = createCard(playerData.cardCache, position, showFaceUp);
    setCardCacheCard(card);
  };

  useEffect(() => {
    if (!playerData) return;
    updateCardCache(playerData);
  }, [playerData]);

  if (!cardCacheCard) return null;

  return <primitive object={cardCacheCard} />;
};

export default CardCache;
