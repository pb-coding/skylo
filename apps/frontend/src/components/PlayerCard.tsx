import CardMesh from "../scene/CardMesh";
import { Card } from "../types/gameTypes";
import { emitCardAction } from "../scene/gameActions";

type Props = { value: Card; revealed: boolean; columnIndex: number; cardIndex: number; enabled: boolean; columnCount?: number; focused?: boolean };
export default function PlayerCard({ value, revealed, columnIndex, cardIndex, enabled, focused, columnCount = 4 }: Props) {
  return <CardMesh value={value} revealed={revealed} position={[(columnIndex - (columnCount - 1) / 2) * 3.05, 0, (cardIndex - 1) * 4.1]} enabled={enabled} focused={focused}
    onActivate={() => emitCardAction("click-card", [columnIndex, cardIndex])} />;
}
