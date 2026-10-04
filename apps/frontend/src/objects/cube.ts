import {
  Vector3,
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
  ColorRepresentation,
} from "three";

export const createCube = (size: Vector3, color: ColorRepresentation) => {
  const geometry = new BoxGeometry(size.x, size.y, size.z);
  const material = new MeshBasicMaterial({ color });
  const cube = new Mesh(geometry, material);
  return cube;
};
