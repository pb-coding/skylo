import { FC, useRef, useEffect } from "react";

const CardFanAnimation: FC = () => {
  const cardContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = cardContainerRef.current;
    if (!container) return;
    const cards = Array.from(container.children) as HTMLImageElement[];
    const angle = -30;
    const angleIncrement = 20;

    cards.forEach((card, index) => {
      const calculatedAngle = angle + index * angleIncrement;
      const rotation = `rotate(${calculatedAngle}deg)`;
      const translateX = `translate(${index * -40 + 40}px)`;
      const translateY = `translateY(${
        Math.abs(calculatedAngle) * 3.5 - 20
      }px)`;
      card.style.transform = `${rotation} ${translateX} ${translateY}`;
    });
  }, []);

  const imageClasses = "w-40 transition-transform duration-1000";

  return (
    <div
      ref={cardContainerRef}
      className="fixed bottom-0 w-full flex justify-center space-x-1"
    >
      <img src="/textures/card-7.png" className={imageClasses} alt="Card 7" />
      <img src="/textures/card-3.png" className={imageClasses} alt="Card 3" />
      <img src="/textures/card-12.png" className={imageClasses} alt="Card 12" />
      <img
        src="/textures/card-minus2.png"
        className={imageClasses}
        alt="Card -2"
      />
    </div>
  );
};

export default CardFanAnimation;
