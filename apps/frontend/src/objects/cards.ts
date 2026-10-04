import {
  BoxGeometry,
  TextureLoader,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
  Mesh,
  Object3DEventMap,
  Object3D,
} from "three";

import { Card, Deck, VisualColumn, VisualDeck } from "../types/gameTypes";

const textureLoader = new TextureLoader();
const cardSize = 5;
const cardGeometry = new BoxGeometry(
  cardSize * 0.4,
  cardSize * 0.001,
  cardSize * 0.6
);

const getCardTexture = (value: number | null) => {
  let cardTexture;
  switch (value) {
    case -2:
      cardTexture = textureLoader.load("/textures/card-minus2.png");
      break;
    case -1:
      cardTexture = textureLoader.load("/textures/card-minus1.png");
      break;
    case 0:
      cardTexture = textureLoader.load("/textures/card-0.png");
      break;
    case 1:
      cardTexture = textureLoader.load("/textures/card-1.png");
      break;
    case 2:
      cardTexture = textureLoader.load("/textures/card-2.png");
      break;
    case 3:
      cardTexture = textureLoader.load("/textures/card-3.png");
      break;
    case 4:
      cardTexture = textureLoader.load("/textures/card-4.png");
      break;
    case 5:
      cardTexture = textureLoader.load("/textures/card-5.png");
      break;
    case 6:
      cardTexture = textureLoader.load("/textures/card-6.png");
      break;
    case 7:
      cardTexture = textureLoader.load("/textures/card-7.png");
      break;
    case 8:
      cardTexture = textureLoader.load("/textures/card-8.png");
      break;
    case 9:
      cardTexture = textureLoader.load("/textures/card-9.png");
      break;
    case 10:
      cardTexture = textureLoader.load("/textures/card-10.png");
      break;
    case 11:
      cardTexture = textureLoader.load("/textures/card-11.png");
      break;
    case 12:
      cardTexture = textureLoader.load("/textures/card-12.png");
      break;
    case null:
      cardTexture = textureLoader.load("/textures/card-back.png");
      break;
    default:
      cardTexture = textureLoader.load("/textures/card-back.png");
      break;
  }
  cardTexture.colorSpace = SRGBColorSpace;
  return cardTexture;
};

export const createCard = (
  card: Card,
  position: Vector3,
  faceUp: boolean = false
) => {
  const cardMaterial = [
    new MeshBasicMaterial(),
    new MeshBasicMaterial(),
    new MeshBasicMaterial({ map: getCardTexture(null) }), // X = backside
    new MeshBasicMaterial({ map: getCardTexture(card) }),
    new MeshBasicMaterial(),
    new MeshBasicMaterial(),
  ];
  const visualCard = new Mesh(cardGeometry, cardMaterial);
  visualCard.name = card !== null ? card.toString() : "Facedown card";
  visualCard.position.copy(position);

  if (faceUp) {
    visualCard.rotation.x = Math.PI;
  }

  return visualCard;
};

export const createPlayerCards = (deck: Deck, positionReference: Vector3) => {
  const playerDeck: Object3D[][] = [];

  let visualColumn: Object3D[] = [];
  deck.forEach((column, columnIndex) => {
    column.forEach((card, cardIndex) => {
      const cardPositionX = positionReference.x + columnIndex * 4 - 6;
      const cardPositionY = positionReference.y;
      const cardPositionZ = positionReference.z + cardIndex * 4 - 8;

      const cardPosition = new Vector3(
        cardPositionX,
        cardPositionY,
        cardPositionZ
      );
      const playerCard = createCard(card, cardPosition);
      visualColumn.push(playerCard);
      if (cardIndex === 2) {
        playerDeck.push(visualColumn as VisualColumn);
        visualColumn = [];
      }
    });
  });
  return playerDeck as VisualDeck;
};

export const createCardStaple = (
  cards: Card[],
  positionReference: Vector3,
  faceUp: boolean = false
) => {
  const cardStackCards: Mesh<
    BoxGeometry,
    MeshBasicMaterial[],
    Object3DEventMap
  >[] = [];
  cards.forEach((card: Card, index: number) => {
    const cardPositionX = positionReference.x;
    const cardPositionY = positionReference.y + index * 0.01;
    const cardPositionZ = positionReference.z;

    const cardPosition = new Vector3(
      cardPositionX,
      cardPositionY,
      cardPositionZ
    );
    const cardStackCard = createCard(card, cardPosition, faceUp);
    cardStackCards.push(cardStackCard);
  });
  return cardStackCards;
};
