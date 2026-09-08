// Call only when the subtree is no longer used. Pools keep their materials until unmount.
export function disposeTree(root, materials = true) {
  const resources = new Set();
  root.traverse((object) => {
    if (object.geometry) resources.add(object.geometry);
    if (object.isInstancedMesh) resources.add(object);
    if (materials && object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        resources.add(material);
      }
    }
  });
  root.removeFromParent();
  for (const resource of resources) resource.dispose();
}
