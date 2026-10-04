import { Player, ObfuscatedPlayer, ConcealableColumn } from "./player";
import { CardStack, ConcealableCard } from "./card";
import { Card, ConcealableCardStack } from "./card";
import { Socket } from "socket.io";
import { io } from "../server";
import { sessionRoom } from "./sessionRoom";

type PlayerSocketSet = Set<string>;

type PlayerActionEventName = string;
type PlayerActionCallback = (playerSocketId: string, data: unknown) => boolean;

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
  private disposed = false;
  private looping = false;
  private pendingWaits = new Set<() => void>();
  private actionWindows = new Map<string, { since: number; count: number }>();
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
    if (this.disposed || this.phase === gamePhase.gameEnded) return;
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
    if (this.looping || this.disposed) return;
    this.looping = true;
    try {
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
            if (!this.disposed) await this.nextRound();
            break;
          default:
            console.log("\nGame Ended.");
            this.dispose();
            break;
        }
      }
    } catch (error) {
      console.error("Game loop failed", error);
      this.dispose();
      this.sendNullGameUpdate();
    } finally {
      this.looping = false;
    }
  }

  // Game Phases

  async revealInitialCards() {
    if (this.disposed) return;
    this.sendMessageToAllPlayers("Reveal two cards");
    while (!this.disposed && !this.allPlayersRevealedInitialCards()) {
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
    if (this.disposed) return;
    this.setInitialPlayersTurn();
    this.phase = gamePhase.pickUpCard;
    this.sendObfuscatedGameUpdate();
  }

  async pickUpCard() {
    if (this.disposed) return;
    const playerOnTurn = this.getPlayersTurn();
    if (playerOnTurn.closedRound) {
      this.phase = gamePhase.revealedLastCard;
      this.sendObfuscatedGameUpdate();
      return;
    }
    console.log(`Waiting for ${playerOnTurn.name} to pick up card`);
    const action = await this.waitForPlayerActions(
      [
        ["draw-from-card-stack", this.drawCardAction.bind(this)],
        ["click-discard-pile", this.takeDiscardPileAction.bind(this)],
      ],
      [playerOnTurn.socketId]
    );
    if (!action || this.disposed) return;
    this.phase = gamePhase.placeCard;
    this.sendObfuscatedGameUpdate();
  }

  async placeCard() {
    if (this.disposed) return;
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
    await this.waitForPlayerActions(expectedActions, [playerOnTurn.socketId]);
    if (this.disposed) return;
    this.sendObfuscatedGameUpdate();
  }

  async revealCard() {
    if (this.disposed) return;
    const playerOnTurn = this.getPlayersTurn();
    console.log(`Waiting for ${playerOnTurn.name} to reveal a card`);

    const numberOfRevealedCards = playerOnTurn.getRevealedCardCount();
    // ensures that the player does not select an already revealed card
    while (
      !this.disposed &&
      playerOnTurn.getRevealedCardCount() <= numberOfRevealedCards
    ) {
      await this.waitForPlayerActions(
        [["click-card", this.revealCardAction.bind(this)]],
        [playerOnTurn.socketId]
      );
    }
    if (this.disposed) return;
    this.nextPlayersTurn();
    this.phase = gamePhase.pickUpCard;
    this.sendObfuscatedGameUpdate();
  }

  async revealedLastCard() {
    if (this.disposed) return;
    this.revealAllCards();
    this.evaluateAndSavePoints();
    this.phase = gamePhase.newRound;
    this.sendObfuscatedGameUpdate();
    console.log("Waiting for next round");
  }

  async nextRound() {
    if (this.disposed) return;
    const playerSocketIds = this.players.map((player) => player.socketId);
    await this.waitForPlayerActions(
      [["next-round", this.nextRoundAction.bind(this)]],
      playerSocketIds
    );
  }

  // Player Action Callbacks

  private actionPlayer(playerSocketId: string, phase: string): Player | undefined {
    if (this.disposed || this.phase !== phase) return;
    const player = this.players.find((candidate) => candidate.socketId === playerSocketId);
    if (!player || (phase !== gamePhase.revealTwoCards && !player.playersTurn)) return;
    return player;
  }

  private validPosition(player: Player, position: unknown): position is CardPosition {
    if (!Array.isArray(position) || position.length !== 2) return false;
    const [column, row] = position;
    return Number.isInteger(column) && Number.isInteger(row) &&
      column >= 0 && column < player.deck.length && row >= 0 && row < 3 &&
      player.deck[column]?.[row] !== undefined;
  }

  private actionRate(playerSocketId: string): number {
    const now = Date.now();
    let window = this.actionWindows.get(playerSocketId);
    if (!window || now - window.since >= 10_000) {
      window = { since: now, count: 0 };
      this.actionWindows.set(playerSocketId, window);
    }
    return ++window.count;
  }

  revealCardAction(playerSocketId: string, cardPosition: unknown): boolean {
    const player = this.actionPlayer(playerSocketId, this.phase);
    if (!player || ![gamePhase.revealTwoCards, gamePhase.revealCard].includes(this.phase)) return false;
    if (!this.validPosition(player, cardPosition)) return false;
    const [columnIndex, cardIndex] = cardPosition;
    if (player.knownCardPositions[columnIndex][cardIndex]) return false;
    if (this.phase === gamePhase.revealTwoCards && player.hasInitialCardsRevealed()) return false;
    player.knownCardPositions[columnIndex][cardIndex] = true;
    this.sendObfuscatedGameUpdate();
    return true;
  }

  drawCardAction(playerSocketId: string, _data: unknown): boolean {
    const player = this.actionPlayer(playerSocketId, gamePhase.pickUpCard);
    if (!player || player.cardCache !== null) return false;
    if (this.cardStack.cards.length === 0) {
      if (this.discardPile.length <= 1) return false;
      const topDiscard = this.discardPile.pop()!;
      this.cardStack.cards = this.discardPile;
      this.discardPile = [topDiscard];
      this.cardStack.shuffleCards();
    }
    player.cardCache = this.cardStack.cards.pop()!;
    player.tookDispiledCard = false;
    this.phase = gamePhase.placeCard;
    this.sendObfuscatedGameUpdate();
    return true;
  }

  takeDiscardPileAction(playerSocketId: string, _data: unknown): boolean {
    const player = this.actionPlayer(playerSocketId, gamePhase.pickUpCard);
    if (!player || player.cardCache !== null || this.discardPile.length === 0) return false;
    player.cardCache = this.discardPile.pop()!;
    player.tookDispiledCard = true;
    this.phase = gamePhase.placeCard;
    this.sendObfuscatedGameUpdate();
    return true;
  }

  discardCardToPileAction(playerSocketId: string, _data: unknown): boolean {
    const player = this.actionPlayer(playerSocketId, gamePhase.placeCard);
    if (!player || player.cardCache === null || player.tookDispiledCard) return false;
    this.discardPile.push(player.cardCache);
    player.cardCache = null;
    this.phase = gamePhase.revealCard;
    this.sendObfuscatedGameUpdate();
    return true;
  }

  placeCardAction(playerSocketId: string, cardPosition: unknown): boolean {
    const player = this.actionPlayer(playerSocketId, gamePhase.placeCard);
    if (!player || player.cardCache === null || !this.validPosition(player, cardPosition)) return false;
    const [columnIndex, cardIndex] = cardPosition;
    const replacedCard = player.deck[columnIndex][cardIndex];
    player.deck[columnIndex][cardIndex] = player.cardCache;
    player.cardCache = null;
    player.tookDispiledCard = false;
    this.discardPile.push(replacedCard);
    player.knownCardPositions[columnIndex][cardIndex] = true;
    this.nextPlayersTurn();
    this.phase = gamePhase.pickUpCard;
    this.sendObfuscatedGameUpdate();
    return true;
  }

  nextRoundAction(playerSocketId: string, _data: unknown): boolean {
    if (this.disposed || this.phase !== gamePhase.newRound ||
        !this.players.some((player) => player.socketId === playerSocketId)) return false;
    this.checkIfPointLimitReached();
    if (this.disposed) return false;
    this.initializeNewRound();
    this.sendObfuscatedGameUpdate();
    return true;
  }

  /** Invalid actions keep the current wait active; disposal resolves it with null. */
  waitForPlayerActions<ActionDataType>(
    expectedActions: ExpectedPlayerActions,
    expectedFrom: Player["socketId"][]
  ): Promise<PlayerAction<ActionDataType> | null> {
    if (this.disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      const listeners: Array<{ socket: Socket; name: string; listener: (...args: any[]) => void }> = [];
      let settled = false;
      const cleanup = () => {
        for (const { socket, name, listener } of listeners) socket.off(name, listener);
        this.pendingWaits.delete(cancel);
      };
      const cancel = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(null);
      };
      const ack = (callback: unknown, result: string) => {
        if (typeof callback !== "function") return;
        try { callback(result); } catch { /* An acknowledgement must never terminate the game. */ }
      };
      this.pendingWaits.add(cancel);
      for (const playerSocketId of expectedFrom) {
        const playerSocket = io.sockets.sockets.get(playerSocketId);
        if (!playerSocket) continue;
        for (const [name, processAction] of expectedActions) {
          const listener = (data: ActionDataType, callback: unknown) => {
            if (settled || this.disposed) return;
            const requests = this.actionRate(playerSocketId);
            if (requests > 60) {
              // Avoid amplifying floods into an unbounded stream of error ACKs.
              if (requests === 61) ack(callback, "error:rate-limited");
              return;
            }
            let accepted = false;
            try { accepted = processAction(playerSocketId, data); }
            catch (error) { console.error("Game action failed", name, error); }
            if (!accepted) {
              ack(callback, "error:invalid-action");
              return;
            }
            settled = true;
            cleanup();
            ack(callback, "success");
            resolve({ playerSocketId, data });
          };
          playerSocket.on(name, listener);
          listeners.push({ socket: playerSocket, name, listener });
        }
      }
    });
  }

  /** Ends this game and releases waits/listeners, including disconnected sockets. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.phase = gamePhase.gameEnded;
    for (const cancel of Array.from(this.pendingWaits)) cancel();
    this.actionWindows.clear();
    const index = allGames.indexOf(this);
    if (index !== -1) allGames.splice(index, 1);
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
    io.to(sessionRoom(this.sessionId)).emit("game-update", obfuscatedGame);
  }

  sendNullGameUpdate() {
    io.to(sessionRoom(this.sessionId)).emit("game-update", null);
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
      threeOfAKinds.sort((a, b) => b.columnIndex - a.columnIndex).forEach((threeOfAKind) => {
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
    if (this.disposed) return;
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
      this.dispose();
    }
  }

  checkForPlayerLeave() {
    const playersInSession = io.sockets.adapter.rooms.get(sessionRoom(this.sessionId));
    if (this.disposed) return;
    if ((playersInSession?.size ?? 0) < this.playerCount) {
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
        io.to(sessionRoom(this.sessionId)).emit(
          "clients-in-session",
          playersInSession?.size ?? 0
        );
        this.dispose();
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
    io.to(sessionRoom(this.sessionId)).emit("message", message);
    console.log(`Sent Message (Session): ${message}`);
  }
}
