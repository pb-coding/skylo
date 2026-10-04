export type Card =
  | -2
  | -1
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12;

export type ConcealableCard = Card | null;

export type ConcealableCardStack = {
  cards: ConcealableCard[];
};

export class CardStack {
  cards: Card[];
  constructor() {
    this.cards = [];
    this.generateCards();
  }

  generateCards() {
    for (let cardNumber = 1; cardNumber <= 150; cardNumber++) {
      if (cardNumber <= 5) {
        this.cards.push(-2);
        continue;
      }

      if (cardNumber > 5 && cardNumber <= 15) {
        this.cards.push(-1);
        continue;
      }

      if (cardNumber > 15 && cardNumber <= 30) {
        this.cards.push(0);
        continue;
      }

      if (cardNumber > 30 && cardNumber <= 40) {
        this.cards.push(1);
        continue;
      }

      if (cardNumber > 40 && cardNumber <= 50) {
        this.cards.push(2);
        continue;
      }

      if (cardNumber > 50 && cardNumber <= 60) {
        this.cards.push(3);
        continue;
      }

      if (cardNumber > 60 && cardNumber <= 70) {
        this.cards.push(4);
        continue;
      }

      if (cardNumber > 70 && cardNumber <= 80) {
        this.cards.push(5);
        continue;
      }

      if (cardNumber > 80 && cardNumber <= 90) {
        this.cards.push(6);
        continue;
      }

      if (cardNumber > 90 && cardNumber <= 100) {
        this.cards.push(7);
        continue;
      }

      if (cardNumber > 100 && cardNumber <= 110) {
        this.cards.push(8);
        continue;
      }

      if (cardNumber > 110 && cardNumber <= 120) {
        this.cards.push(9);
        continue;
      }

      if (cardNumber > 120 && cardNumber <= 130) {
        this.cards.push(10);
        continue;
      }

      if (cardNumber > 130 && cardNumber <= 140) {
        this.cards.push(11);
        continue;
      }

      if (cardNumber > 140 && cardNumber <= 150) {
        this.cards.push(12);
        continue;
      }
    }
  }

  // Fisher-Yates shuffle algorithm
  shuffleCards() {
    for (let i = this.cards.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
    }
  }
}
