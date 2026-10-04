import { GameRunner } from "./runtime/GameRunner";
/** Active runtimes only; completed games are retained by their session for export. */
export const allGames: GameRunner[] = [];
export { GameRunner };
