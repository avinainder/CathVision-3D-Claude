import * as THREE from 'three';

export function createLabelManager(scene) {
  const labels = [];

  function createTextSprite(text) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 12);
    ctx.fill();

    ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3, 0.75, 1);
    return sprite;
  }

  function addLabel(text, position) {
    const sprite = createTextSprite(text);
    sprite.position.copy(position);
    sprite.position.y += 0.5; // float above surface
    scene.add(sprite);
    const id = crypto.randomUUID();
    const label = { id, text, position: position.clone(), sprite };
    labels.push(label);
    return label;
  }

  function removeLabel(id) {
    const idx = labels.findIndex((l) => l.id === id);
    if (idx !== -1) {
      scene.remove(labels[idx].sprite);
      labels[idx].sprite.material.map.dispose();
      labels[idx].sprite.material.dispose();
      labels.splice(idx, 1);
    }
  }

  function setVisible(visible) {
    labels.forEach((l) => (l.sprite.visible = visible));
  }

  function getLabels() {
    return labels.map(({ id, text, position }) => ({ id, text, position }));
  }

  function dispose() {
    labels.forEach((l) => {
      scene.remove(l.sprite);
      l.sprite.material.map.dispose();
      l.sprite.material.dispose();
    });
    labels.length = 0;
  }

  return { addLabel, removeLabel, setVisible, getLabels, dispose };
}
