import { Player, ObfuscatedPlayer, ConcealableColumn } from "./player";
import { CardStack, ConcealableCard } from "./card";
import { Card, ConcealableCardStack } from "./card";
import { Socket } from "socket.io";
import { io } from "../server";

type PlayerSocketSet = Set<string>;

type PlayerActionEventName = string;
type PlayerActionCallback = (playerSocketId: string, data: any) => void;

type ExpectedPlayerActions = Array<
  [PlayerActionEventName, PlayerActionCallback]
>;

type PlayerAction<ActionDataType> = {
  playerSocketId: string;
  data: ActionDataType;
};

type CardPosition = [number, number];

// obfuscated types are used to send only necessary data to the client
export type ObfuscatedGame = {
  sessionId: string;
  playerCount: number;
  players: ObfuscatedPlayer[];
  cardStack: ConcealableCardStack;
  discardPile: Card[];
  phase: string;
  round: number;
};

export const allGames: Game[] = [];

const gamePhase = {
  newRound: "new round",
  revealTwoCards: "reveal two cards",
  pickUpCard: "pick up card",
  placeCard: "place card",
  revealCard: "reveal card",
  revealedLastCard: "revealed last card",
  gameEnded: "game ended",
};

export class Game {
  socket: Socket;
  sessionId: string;
  playerCount: number;
  players: Player[];
  cardStack: CardStack;
  discardPile: Card[];
  phase: string;
  round: number;

  constructor(socket: Socket, sessionId: string, playerIds: PlayerSocketSet) {
    this.socket = socket;
    this.sessionId = sessionId;

    this.cardStack = new CardStack();
    this.cardStack.shuffleCards();

    this.playerCount = playerIds.size;
    this.players = this.initializePlayers(playerIds, this.cardStack);

    // get the first card from the cardStack and put it in the discard pile
    this.discardPile = [this.cardStack.cards.pop()!];
    this.phase = gamePhase.revealTwoCards;
    this.round = 1;
  }

  initializePlayers(
    playerIds: PlayerSocketSet,
    cardStack: CardStack
  ): Player[] {
    let players: Player[] = [];

    let index = 0;
    playerIds.forEach((socketId) => {
      index++;

      const player = new Player(index, socketId, `Player ${index}`, cardStack);
      players.push(player);
    });

    this.cardStack = cardStack;

    return players;
  }

  initializeNewRound(startOver: boolean = false) {
    this.round = startOver ? 1 : this.round + 1;
    this.cardStack = new CardStack();
    this.cardStack.shuffleCards();
    this.players.forEach((player) => {
      player.deck = player.generateDeck(this.cardStack);
      player.knownCardPositions = player.createUnknownCardPositions();
      player.playersTurn = true;
      player.cardCache = null;
      player.tookDispiledCard = false;
      player.roundPoints = 0;
      player.totalPoints = startOver ? 0 : player.totalPoints;
      player.closedRound = false;
      player.place = null;
    });
    this.discardPile = [this.cardStack.cards.pop()!];
    this.phase = gamePhase.revealTwoCards;
  }

  async gameLoop() {
    console.log("Game started!");
    this.sendObfuscatedGameUpdate();
    while (this.phase !== gamePhase.gameEnded) {
      this.checkForFullRevealedCards();
      this.removeThreeOfAKinds();
      switch (this.phase) {
        case gamePhase.revealTwoCards:
          console.log("\nGame phase: revealTwoCards");
          await this.revealInitialCards();
          break;
        case gamePhase.pickUpCard:
          console.log("\nGame phase: pickUpCard");
          await this.pickUpCard();
          break;
        case gamePhase.placeCard:
          console.log("\nGame phase: placeCard");
          await this.placeCard();
          break;
        case gamePhase.revealCard:
          console.log("\nGame phase: revealCard");
          await this.revealCard();
          break;
        case gamePhase.revealedLastCard:
          console.log("\nGame phase: revealedLastCard");
          await this.revealedLastCard();
          break;
        case gamePhase.newRound:
          console.log("\nGame phase: newRound");
          this.checkIfPointLimitReached();
          await this.nextRound();
          break;
        default:
          console.log("\nGame Ended.");
          break;
      }
    }
  }

  // Game Phases

  async revealInitialCards() {
    this.sendMessageToAllPlayers("Reveal two cards");
    while (!this.allPlayersRevealedInitialCards()) {
      const playersWithRevealedInitialCards =
        this.getPlayersWithRevealedInitialCards();
      const playersWithUnrevealedInitialCards = this.players.filter(
        (player) => !playersWithRevealedInitialCards.includes(player)
      );
      const playersSocketIds = playersWithUnrevealedInitialCards.map(
        (player) => player.socketId
      );
      await this.waitForPlayerActions<CardPosition>(
        [["click-card", this.revealCardAction.bind(this)]],
        playersSocketIds
      );
    }
    this.setInitialPlayersTurn();
    this.phase = gamePhase.pickUpCard;
    this.sendObfuscatedGameUpdate();
  }

  async pickUpCard() {
    const playerOnTurn = this.getPlayersTurn();
    if (playerOnTurn.closedRound) {
      this.phase = gamePhase.revealedLastCard;
      this.sendObfuscatedGameUpdate();
      return;
    }
    console.log(`Waiting for ${playerOnTurn.name} to pick up card`);
    await this.waitForPlayerActions(
      [
        ["draw-from-card-stack", this.drawCardAction.bind(this)],
        ["click-discard-pile", this.takeDiscardPileAction.bind(this)],
      ],
      [playerOnTurn.socketId]
    );
    this.phase = gamePhase.placeCard;
    this.sendObfuscatedGameUpdate();
  }

  async placeCard() {
    const playerOnTurn = this.getPlayersTurn();
    console.log(`Waiting for ${playerOnTurn.name} to place card`);

    const expectedActions: ExpectedPlayerActions = [
      ["click-card", this.placeCardAction.bind(this)],
    ];
    if (!playerOnTurn.tookDispiledCard) {
      expectedActions.push([
        "click-discard-pile",
        this.discardCardToPileAction.bind(this),
      ]);
    }
    playerOnTurn.tookDispiledCard = false;
    await this.waitForPlayerActions(expectedActions, [playerOnTurn.socketId]);
    this.sendObfuscatedGameUpdate();
  }

  async revealCard() {
    const playerOnTurn = this.getPlayersTurn();
    console.log(`Waiting for ${playerOnTurn.name} to reveal a card`);

    const numberOfRevealedCards = playerOnTurn.getRevealedCardCount();
    // ensures that the player does not select an already revealed card
    while (playerOnTurn.getRevealedCardCount() <= numberOfRevealedCards) {
      await this.waitForPlayerActions(
        [["click-card", this.revealCardAction.bind(this)]],
        [playerOnTurn.socketId]
      );
    }
    this.nextPlayersTurn();
    this.phase = gamePhase.pickUpCard;
    this.sendObfuscatedGameUpdate();
  }

  async revealedLastCard() {
    this.revealAllCards();
    this.evaluateAndSavePoints();
    this.phase = gamePhase.newRound;
    this.sendObfuscatedGameUpdate();
    console.log("Waiting for next round");
  }

  async nextRound() {
    const playerSocketIds = this.players.map((player) => player.socketId);
    await this.waitForPlayerActions(
      [["next-round", this.nextRoundAction.bind(this)]],
      playerSocketIds
    );
  }

  // Player Action Callbacks

  revealCardAction(playerSocketId: string, cardPosition: CardPosition) {
    const player = this.getPlayerBySocketId(playerSocketId);
    // ugly type checking - typescript is not able to check the type of the data sent by the client if its a type alias :(
    if (!(cardPosition instanceof Array)) return;
    if (cardPosition.length !== 2) return;
    if (cardPosition.some((position) => typeof position !== "number")) return;

    const [columnIndex, cardIndex] = cardPosition;
    const revealedCard = player.deck[columnIndex][cardIndex];
    console.log(
      `Revealed card ${revealedCard} at column ${columnIndex} card ${cardIndex}`
    );
    const playerIndex = this.players.indexOf(player!);
    this.players[playerIndex].knownCardPositions[columnIndex][cardIndex] = true;
    this.sendObfuscatedGameUpdate();
  }

  drawCardAction(playerSocketId: string, data: any) {
    const player = this.getPlayerBySocketId(playerSocketId);
    console.log(`Player ${player.name} drawed a card.`);
    const drawnCard = this.cardStack.cards.pop()!;
    player.cardCache = drawnCard;
    this.sendObfuscatedGameUpdate();
  }

  takeDiscardPileAction(playerSocketId: string, data: any) {
    const player = this.getPlayerBySocketId(playerSocketId);
    console.log(`Player ${player.name} took the card from discard pile.`);
    const discardPileCard = this.discardPile.pop()!;
    player.cardCache = discardPileCard;
    player.tookDispiledCard = true;
    this.sendObfuscatedGameUpdate();
  }

  discardCardToPileAction(playerSocketId: string, data: any) {
    const player = this.getPlayerBySocketId(playerSocketId);
    console.log(`Player ${player.name} discarded a card to the pile.`);
    const discardedCard = player.cardCache!;
    this.discardPile.push(discardedCard);
    player.cardCache = null;
    this.phase = gamePhase.revealCard;
    this.sendObfuscatedGameUpdate();
  }

  placeCardAction(playerSocketId: string, cardPosition: CardPosition) {
    const player = this.getPlayerBySocketId(playerSocketId);
    console.log(`Player ${player.name} placed a card.`);
    const placedCard = player.cardCache!;
    player.cardCache = null;
    const [columnIndex, cardIndex] = cardPosition;
    const replacedCard = player.deck[columnIndex][cardIndex];
    this.discardPile.push(replacedCard);
    player.deck[columnIndex][cardIndex] = placedCard;
    player.knownCardPositions[columnIndex][cardIndex] = true;
    // TODO: check for three of a kind
    this.nextPlayersTurn();
    this.phase = gamePhase.pickUpCard;
    this.sendObfuscatedGameUpdate();
  }

  nextRoundAction(playerSocketId: string, data: any) {
    this.initializeNewRound();
    this.sendObfuscatedGameUpdate();
  }

  /**
   * This function waits for a player to perform one of the expected actions.
   * When a player performs one of the expected actions, the corresponding callback is called and further processes the player data.
   * All event listeners are removed after every player defined in expectedFrom performed the expected action.
   * The function also returns a promise that resolves with the data sent by the player.
   * @param expectedActions
   * @param expectedFrom
   * @returns playerSocketId and data sent by the player
   */
  waitForPlayerActions<ActionDataType>(
    expectedActions: ExpectedPlayerActions,
    expectedFrom: Player["socketId"][]
  ): Promise<PlayerAction<ActionDataType>> {
    const eventListeners = new Map<string, (...args: any[]) => void>();

    const addPlayerActionListeners = (
      resolve: (
        value:
          | PlayerAction<ActionDataType>
          | PromiseLike<PlayerAction<ActionDataType>>
      ) => void
    ) => {
      expectedFrom.forEach((playerSocketId) => {
        const playerSocket = io.sockets.sockets.get(playerSocketId);
        if (playerSocket) {
          expectedActions.forEach((expectedAction) => {
            const [actionName, processAction] = expectedAction;
            const eventListener = (data: ActionDataType, ackFunction: any) => {
              console.log(`Received ${actionName} from ${playerSocketId}`);
              processAction(playerSocketId, data);
              // remove current and event listeners of alternative expected actions
              removePlayerActionListeners();
              const playerResponse = { playerSocketId, data };
              // ackFunction("success");
              resolve(playerResponse);
            };
            playerSocket.on(actionName, eventListener);
            eventListeners.set(
              `${playerSocketId}-${actionName}`,
              eventListener
            );
          });
        }
      });
    };

    const removePlayerActionListeners = () => {
      expectedFrom.forEach((playerSocketId) => {
        const playerSocket = io.sockets.sockets.get(playerSocketId);
        if (playerSocket) {
          expectedActions.forEach((expectedAction) => {
            const [actionName] = expectedAction;

            const eventListener = eventListeners.get(
              `${playerSocketId}-${actionName}`
            );
            if (eventListener) {
              playerSocket.off(actionName, eventListener);
              eventListeners.delete(`${playerSocketId}-${actionName}`);
            }
          });
        }
      });
    };

    return new Promise<PlayerAction<ActionDataType>>((resolve) => {
      addPlayerActionListeners(resolve);
    });
  }

  sendObfuscatedGameUpdate() {
    // console.trace("sendObfuscatedGameUpdate");
    this.updatePlayerRoundPoints();
    const obfuscatedGame: ObfuscatedGame = {
      sessionId: this.sessionId,
      playerCount: this.playerCount,
      phase: this.phase,
      round: this.round,
      discardPile: this.discardPile,
      players: this.players.map(({ deck, ...player }) => {
        return {
          ...player,
          deck: deck.map((column, columnIndex) => {
            const concealableColumn = column.map((card, cardIndex) => {
              // unknown cards are obfuscated to null
              return player.knownCardPositions[columnIndex][cardIndex]
                ? card
                : (null as ConcealableCard);
            });
            return concealableColumn as ConcealableColumn;
          }),
        } satisfies ObfuscatedPlayer;
      }),
      cardStack: {
        cards: this.cardStack.cards.map((card: Card) => {
          // player may not see the value of the facedown cards in the cardStack
          return null;
        }),
      },
    };
    console.log("Sending game update");
    io.to(this.sessionId).emit("game-update", obfuscatedGame);
  }

  sendNullGameUpdate() {
    io.to(this.sessionId).emit("game-update", null);
  }

  updatePlayerRoundPoints() {
    this.players.forEach((player) => {
      const revealedCardValuesSum = player.getRevealedCardsValueSum();
      player.roundPoints = revealedCardValuesSum;
    });
  }

  getPlayersWithLowestPoints(): Player[] {
    this.updatePlayerRoundPoints();
    const lowestScore = Math.min(
      ...this.players.map((player) => player.roundPoints)
    );
    const playersWithLowestPoints = this.players.filter(
      (player) => player.roundPoints === lowestScore
    );
    return playersWithLowestPoints;
  }

  evaluateAndSavePoints() {
    const playersWithLowestPoints = this.getPlayersWithLowestPoints();
    const playerClosedRound = this.getPlayerThatClosedRound();
    let playerClosedRoundLostMessage = "";
    if (
      playersWithLowestPoints.includes(playerClosedRound) &&
      playersWithLowestPoints.length === 1
    ) {
      this.sendMessageToAllPlayers(`${playerClosedRound.name} won the round!`);
      this.players.forEach((player) => {
        player.totalPoints += player.roundPoints;
      });
      return;
    } else if (playersWithLowestPoints.length === 1) {
      playerClosedRoundLostMessage = playerClosedRoundLostMessage.concat(
        `${playersWithLowestPoints[0].name} won the round!`
      );
    } else if (playersWithLowestPoints.length > 1) {
      playerClosedRoundLostMessage = playerClosedRoundLostMessage.concat(
        `\n ${playersWithLowestPoints
          .map((player) => player.name)
          .join(", ")} scored equally the lowest points!`
      );
    }
    this.players.forEach((player) => {
      if (player.closedRound) player.totalPoints += player.roundPoints * 2;
      else player.totalPoints += player.roundPoints;
    });
    playerClosedRoundLostMessage = playerClosedRoundLostMessage.concat(
      `\n ${playerClosedRound.name} points are doubled!`
    );
    this.sendMessageToAllPlayers(playerClosedRoundLostMessage);
  }

  checkForFullRevealedCards() {
    const alreadyClosedPlayers = this.players.filter(
      (player) => player.closedRound
    );
    if (alreadyClosedPlayers.length > 0) return; // TODO: check if this is correct with more than 2 players

    const playerWithAllCardsRevealed = this.players.find((player) =>
      player.knownCardPositions.every((knownCardsColumn) =>
        knownCardsColumn.every((knownCard) => knownCard === true)
      )
    );
    if (playerWithAllCardsRevealed) {
      playerWithAllCardsRevealed.closedRound = true;
    }
  }

  removeThreeOfAKinds() {
    this.players.forEach((player) => {
      const threeOfAKinds = player.getThreeOfAKinds();
      if (threeOfAKinds.length == 0) return;
      threeOfAKinds.forEach((threeOfAKind) => {
        const { columnIndex, value } = threeOfAKind;
        this.discardPile.push(value as Card);
        this.discardPile.push(value as Card);
        this.discardPile.push(value as Card);
        player.deck.splice(columnIndex, 1);
        player.knownCardPositions.splice(columnIndex, 1);
      });
      this.sendObfuscatedGameUpdate();
    });
  }

  checkIfPointLimitReached() {
    const highestPoints = Math.max(
      ...this.players.map((player) => player.totalPoints)
    );

    const lowestPoints = Math.min(
      ...this.players.map((player) => player.totalPoints)
    );
    const playersWithHighestPoints = this.players.filter(
      (player) => player.totalPoints === highestPoints
    );

    if (highestPoints >= 100) {
      if (playersWithHighestPoints.length === 1) {
        const playerWithHighestPoints = playersWithHighestPoints[0];
        this.sendMessageToAllPlayers(
          `${playerWithHighestPoints.name} lost with ${playerWithHighestPoints.totalPoints}!`
        );
      } else {
        const playerNames = playersWithHighestPoints
          .map((player) => player.name)
          .join(", ");
        this.sendMessageToAllPlayers(
          `Multiple players: ${playerNames} lost with ${highestPoints} points!`
        );
      }
      const playersWithLowestPoints = this.players.filter(
        (player) => player.totalPoints === lowestPoints
      );
      playersWithLowestPoints.forEach((player) => (player.place = 1));

      this.phase = gamePhase.gameEnded;
      this.sendObfuscatedGameUpdate();
      allGames.splice(allGames.indexOf(this), 1);
    }
  }

  checkForPlayerLeave() {
    const playersInSession = io.sockets.adapter.rooms.get(this.sessionId);
    if (playersInSession?.size ?? 0 < this.playerCount) {
      const playerThatLeftSession = this.players.filter(
        (player) => !playersInSession?.has(player.socketId)
      );
      console.log("players that left session", playerThatLeftSession);
      if (playerThatLeftSession.length > 0) {
        this.sendMessageToAllPlayers(
          `${playerThatLeftSession.map(
            (player) => player.name + " "
          )} left the session!`
        );
        this.phase = gamePhase.gameEnded;
        this.sendNullGameUpdate();
        io.to(this.sessionId).emit(
          "clients-in-session",
          playersInSession?.size ?? 0
        );
        allGames.splice(allGames.indexOf(this), 1);
      }
    }
  }

  revealAllCards() {
    this.players.forEach((player) => {
      player.knownCardPositions.forEach((column, columnIndex) => {
        column.forEach((card, cardIndex) => {
          player.knownCardPositions[columnIndex][cardIndex] = true;
        });
      });
    });
  }

  // Helpers

  getPlayersWithRevealedInitialCards(): Player[] {
    return this.players.filter((player) => {
      return player.hasInitialCardsRevealed();
    });
  }

  allPlayersRevealedInitialCards() {
    const playersWithRevealedInitialCards =
      this.getPlayersWithRevealedInitialCards();
    return playersWithRevealedInitialCards.length === this.playerCount;
  }

  setInitialPlayersTurn() {
    const playersWithHighestRevealedCardsValueSum = this.players.reduce(
      (playersWithHighestRevealedCardsValueSum, player) => {
        if (
          player.getRevealedCardsValueSum() ===
          playersWithHighestRevealedCardsValueSum[0].getRevealedCardsValueSum()
        ) {
          if (
            player.getHighestRevealedCardValue() >
            playersWithHighestRevealedCardsValueSum[0].getHighestRevealedCardValue()
          ) {
            playersWithHighestRevealedCardsValueSum = [player];
          } else if (
            player.getHighestRevealedCardValue() ===
            playersWithHighestRevealedCardsValueSum[0].getHighestRevealedCardValue()
          ) {
            playersWithHighestRevealedCardsValueSum.push(player);
          }
        } else if (
          player.getRevealedCardsValueSum() >
          playersWithHighestRevealedCardsValueSum[0].getRevealedCardsValueSum()
        ) {
          playersWithHighestRevealedCardsValueSum = [player];
        }
        return playersWithHighestRevealedCardsValueSum;
      },
      [this.players[0]]
    );

    const playerWithHighestRevealedCardsValueSum =
      playersWithHighestRevealedCardsValueSum[
        Math.floor(
          Math.random() * playersWithHighestRevealedCardsValueSum.length
        )
      ];

    this.players.forEach((player) => {
      if (player === playerWithHighestRevealedCardsValueSum) {
        player.playersTurn = true;
      } else {
        player.playersTurn = false;
      }
    });
  }

  nextPlayersTurn() {
    const playerOnTurn = this.getPlayersTurn();
    const playersTurnIndex = this.players.indexOf(playerOnTurn);
    const nextPlayersTurnIndex = (playersTurnIndex + 1) % this.playerCount;
    this.players[playersTurnIndex].playersTurn = false;
    this.players[nextPlayersTurnIndex].playersTurn = true;
  }

  getPlayersTurn(): Player {
    const playerOnTurn = this.players.find(
      (player) => player.playersTurn === true
    );
    if (playerOnTurn) return playerOnTurn;
    else throw new Error("No player on turn found!");
  }

  getPlayerThatClosedRound(): Player {
    const playerThatClosedRound = this.players.find(
      (player) => player.closedRound === true
    );
    if (playerThatClosedRound) return playerThatClosedRound;
    else throw new Error("No player that closed the round found!");
  }

  getPlayerBySocketId(playerSocketId: string): Player {
    const player = this.players.find(
      (player) => player.socketId === playerSocketId
    );
    if (player) return player;
    else throw new Error(`No player with socketId ${playerSocketId} found!`);
  }

  sendMessageToAllPlayers(message: string) {
    io.to(this.sessionId).emit("message", message);
    console.log(`Sent Message (Session): ${message}`);
  }
}
