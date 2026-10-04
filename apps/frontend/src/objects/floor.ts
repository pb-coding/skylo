import {
  BoxGeometry,
  TextureLoader,
  MeshBasicMaterial,
  SRGBColorSpace,
  Vector3,
  Mesh,
  RepeatWrapping,
} from "three";

export const createFloor = (
  position: Vector3,
  sizeObject: { x: number; y: number; z: number },
  texturePath: string,
  floorSize: number,
  repeating: boolean = false,
  repeatX: number = 1,
  repeatY: number = 1
) => {
  const textureLoader = new TextureLoader();
  const floorGeometry = new BoxGeometry(
    floorSize * sizeObject.x,
    floorSize * sizeObject.y,
    floorSize * sizeObject.z
  );

  const floorTexture = textureLoader.load(texturePath);
  floorTexture.colorSpace = SRGBColorSpace;
  if (repeating) {
    floorTexture.wrapS = RepeatWrapping;
    floorTexture.wrapT = RepeatWrapping;
    floorTexture.repeat.set(repeatX, repeatY);
  }

  const floorMaterial = [
    new MeshBasicMaterial(),
    new MeshBasicMaterial(),
    new MeshBasicMaterial({ map: floorTexture }),
    new MeshBasicMaterial({ map: floorTexture }),
    new MeshBasicMaterial(),
    new MeshBasicMaterial(),
  ];
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.name = "floor";
  floor.position.copy(position);

  return floor;
};
