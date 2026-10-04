import { BoxGeometry, MeshBasicMaterial, TextureLoader, SRGBColorSpace, Texture } from "three";
import { Card } from "../types/gameTypes";

export const CARD_WIDTH = 2.4;
export const CARD_HEIGHT = 3.6;
export const cardGeometry = new BoxGeometry(CARD_WIDTH, 0.045, CARD_HEIGHT);
const loader = new TextureLoader();
const textures = new Map<string, Texture>();
const waiting = new Map<string, Set<() => void>>();
const materials = new Map<string, MeshBasicMaterial[]>();
const edgeMaterial = new MeshBasicMaterial({ color: "#e8dfce" });

function texture(path: string, onReady: () => void) {
  let result = textures.get(path);
  if (!result) {
    waiting.set(path, new Set([onReady]));
    result = loader.load(path, () => {
      result!.userData.ready = true;
      waiting.get(path)?.forEach((invalidate) => invalidate());
      waiting.delete(path);
    });
    result.colorSpace = SRGBColorSpace;
    result.anisotropy = 4;
    textures.set(path, result);
  }
  if (!result.userData.ready) waiting.get(path)?.add(onReady);
  return result;
}

/** Shared for the application lifetime. Meshes use dispose={null}; no per-turn allocations. */
export function getCardMaterials(value: Card, onReady: () => void): MeshBasicMaterial[] {
  const key = String(value);
  let result = materials.get(key);
  if (!result) {
    const path = value === null ? "/textures/skylo-card-back.png" : `/textures/card-${value === -2 ? "minus2" : value === -1 ? "minus1" : value}.png`;
    const back = new MeshBasicMaterial({ map: texture("/textures/skylo-card-back.png", onReady) });
    const face = new MeshBasicMaterial({ map: texture(path, onReady) });
    result = [edgeMaterial, edgeMaterial, back, face, edgeMaterial, edgeMaterial];
    materials.set(key, result);
  }
  for (const material of result) {
    if (material.map && !material.map.userData.ready) {
      for (const [path, map] of textures) if (map === material.map) waiting.get(path)?.add(onReady);
    }
  }
  return result;
}
