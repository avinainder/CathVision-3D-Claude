import * as THREE from 'three';

/**
 * Markers that pin coronary segments to places on the model.
 *
 * They live in the model mesh's own coordinate frame (as its children), so
 * they stay on the vessel when the mesh is flipped or its geometry swapped.
 */
export function createSegmentMarkers() {
  const group = new THREE.Group();
  const markers = new Map();
  const dotGeometry = new THREE.SphereGeometry(0.2, 20, 16);

  function createLabel(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 56;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(8,8,13,0.78)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 14);
    ctx.fill();
    ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
    sprite.scale.set(1.5, 0.525, 1);
    sprite.renderOrder = 12;
    return sprite;
  }

  function dispose(marker) {
    group.remove(marker.dot, marker.ring, marker.label);
    marker.dot.material.dispose();
    marker.ring.material.dispose();
    marker.label.material.map.dispose();
    marker.label.material.dispose();
  }

  function remove(id) {
    const marker = markers.get(id);
    if (!marker) return;
    dispose(marker);
    markers.delete(id);
  }

  function clear() {
    for (const marker of markers.values()) dispose(marker);
    markers.clear();
  }

  function set(id, local, color, text, selected) {
    remove(id);
    const ring = new THREE.Mesh(
      dotGeometry,
      new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.95 })
    );
    const dot = new THREE.Mesh(dotGeometry, new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }));
    const size = selected ? 1.35 : 1;
    ring.scale.setScalar(size * 1.3);
    dot.scale.setScalar(size);
    ring.renderOrder = 10;
    dot.renderOrder = 11;
    dot.userData.segmentId = id;
    const label = createLabel(text);
    for (const object of [ring, dot, label]) object.position.fromArray(local);
    label.position.y += 0.62;
    group.add(ring, dot, label);
    markers.set(id, { ring, dot, label });
  }

  return {
    /** Move the markers onto a (new) model mesh, dropping the old ones. */
    attach(mesh) {
      clear();
      mesh.add(group);
    },
    detach() {
      clear();
      group.removeFromParent();
    },
    /** Replace all markers. `pins` is a list of { id, local, color, text, selected }. */
    sync(pins) {
      clear();
      for (const pin of pins) set(pin.id, pin.local, pin.color, pin.text, pin.selected);
    },
    /** The tappable objects; each carries userData.segmentId. */
    objects() {
      return [...markers.values()].map((m) => m.dot);
    },
    setVisible(visible) {
      group.visible = visible;
    },
  };
}
